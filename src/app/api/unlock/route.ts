import { z } from 'zod';
import {
  buildSessionSetCookieHeader,
  checkUnlockRateLimit,
  clearUnlockRateLimit,
  constantTimeStringEqual,
  createSessionToken,
  extractClientIp,
  hashClientIp,
  recordUnlockFailure,
} from '@/server/access/guard';
import { jsonError, jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { writeAuditLog } from '@/server/observability/logger';

export const dynamic = 'force-dynamic';

const UnlockBodySchema = z.object({
  passcode: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/unlock',
      requireAuth: false,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, config, supabase }) => {
      if (!config.appPasscode) {
        return jsonOk({ ok: true, mode: 'unauthenticated' }, { requestId });
      }

      const body = await parseJsonBody(request, UnlockBodySchema, requestId);
      if (!body.ok) {
        return body.response;
      }

      const ip = extractClientIp(request);
      const ipHash = ip ? await hashClientIp(ip, config.cronSecret) : null;

      const rateState = await checkUnlockRateLimit(supabase, ipHash);
      if (rateState.locked) {
        return jsonError({
          status: 429,
          code: 'RATE_LIMITED',
          message: 'Too many failed unlock attempts. Try again shortly.',
          requestId,
          headers: { 'Retry-After': String(rateState.retryAfterSec) },
        });
      }

      const matches = await constantTimeStringEqual(
        body.data.passcode,
        config.appPasscode,
      );

      if (!matches) {
        const failure = await recordUnlockFailure(
          supabase,
          ipHash,
          rateState.existingAttempts,
        );

        if (failure.nowLocked) {
          await writeAuditLog(supabase, {
            level: 'WARN',
            category: 'AUTH',
            event_name: 'unlock_rate_limited',
            request_id: requestId,
            summary: 'Unlock temporarily rate-limited after consecutive failures.',
            context: {
              ip_hash_prefix: ipHash ? ipHash.slice(0, 12) : null,
              attempts: failure.attempts,
            },
          });

          return jsonError({
            status: 429,
            code: 'RATE_LIMITED',
            message: 'Too many failed unlock attempts. Try again shortly.',
            requestId,
            headers: { 'Retry-After': String(failure.retryAfterSec) },
          });
        }

        return jsonError({
          status: 401,
          code: 'INVALID_PASSCODE',
          message: 'Invalid passcode.',
          requestId,
        });
      }

      await clearUnlockRateLimit(supabase, ipHash);
      const token = await createSessionToken(config);
      const setCookie = buildSessionSetCookieHeader(request, config, token);

      await writeAuditLog(supabase, {
        level: 'INFO',
        category: 'AUTH',
        event_name: 'unlock_succeeded',
        request_id: requestId,
        summary: 'Owner unlocked session.',
        context: { has_ip: Boolean(ipHash) },
      });

      return jsonOk(
        { ok: true },
        {
          requestId,
          headers: { 'Set-Cookie': setCookie },
        },
      );
    },
  );
}

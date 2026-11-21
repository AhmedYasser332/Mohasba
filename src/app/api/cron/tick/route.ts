import { verifyCronSecret } from '@/server/access/guard';
import { loadRuntimeConfig, type RuntimeConfig } from '@/server/config';
import { createServerSupabaseClient } from '@/server/db/supabase';
import { getRequestId, jsonError, jsonOk } from '@/server/http/response';
import { logAccess, writeAuditLog } from '@/server/observability/logger';
import { runCronTick } from '@/server/services/ntfy-dispatcher';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  return jsonError({
    status: 405,
    code: 'METHOD_NOT_ALLOWED',
    message: 'Use POST /api/cron/tick with Authorization: Bearer <CRON_SECRET>.',
    requestId,
    headers: { Allow: 'POST' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const startMs = performance.now();
  const requestId = getRequestId(req);

  let config: RuntimeConfig;
  try {
    config = loadRuntimeConfig();
  } catch (err) {
    const res = jsonError({
      status: 500,
      code: 'CONFIG_ERROR',
      message:
        err instanceof Error ? err.message : 'Invalid server configuration.',
      requestId,
    });
    logAccess({
      level: 'ERROR',
      requestId,
      route: '/api/cron/tick',
      method: 'POST',
      status: 500,
      ms: performance.now() - startMs,
      code: 'CONFIG_ERROR',
    });
    return res;
  }

  const auth = await verifyCronSecret(req, config, requestId);
  if (!auth.ok) {
    logAccess({
      requestId,
      route: '/api/cron/tick',
      method: 'POST',
      status: auth.response.status,
      ms: performance.now() - startMs,
    });
    return auth.response;
  }

  const supabase = createServerSupabaseClient(config);

  try {
    const summary = await runCronTick(config, supabase, { requestId });
    logAccess({
      requestId,
      route: '/api/cron/tick',
      method: 'POST',
      status: 200,
      ms: performance.now() - startMs,
    });
    return jsonOk(summary, { requestId });
  } catch (err) {
    await writeAuditLog(supabase, {
      level: 'ERROR',
      category: 'CRON',
      event_name: 'cron_tick_failed',
      request_id: requestId,
      summary: 'Cron tick execution failed.',
      error: err,
    });

    logAccess({
      level: 'ERROR',
      requestId,
      route: '/api/cron/tick',
      method: 'POST',
      status: 500,
      ms: performance.now() - startMs,
      code: 'INTERNAL_ERROR',
    });

    return jsonError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Cron tick failed.',
      requestId,
    });
  }
}

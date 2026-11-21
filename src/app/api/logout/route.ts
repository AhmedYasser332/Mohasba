import { buildLogoutSetCookieHeader } from '@/server/access/guard';
import { jsonOk } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { writeAuditLog } from '@/server/observability/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/logout',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: false,
    },
    async ({ req: request, requestId, config, supabase }) => {
      const clearCookie = buildLogoutSetCookieHeader(request, config);

      await writeAuditLog(supabase, {
        level: 'INFO',
        category: 'AUTH',
        event_name: 'logout_succeeded',
        request_id: requestId,
        summary: 'Owner signed out and cleared session cookie.',
      });

      return jsonOk(
        { ok: true },
        {
          requestId,
          headers: { 'Set-Cookie': clearCookie },
        },
      );
    },
  );
}

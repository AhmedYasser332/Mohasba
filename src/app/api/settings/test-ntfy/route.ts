import { jsonOk } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { sendTestNtfy } from '@/server/services/ntfy-dispatcher';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/settings/test-ntfy',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: false,
    },
    async ({ requestId, config, supabase }) => {
      const result = await sendTestNtfy(config, supabase);
      return jsonOk(result, { requestId });
    },
  );
}

import { jsonOk } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { revealNtfyTopicUrl } from '@/server/services/ntfy-dispatcher';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/settings/ntfy-reveal',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: false,
    },
    async ({ requestId, config, supabase }) => {
      const result = await revealNtfyTopicUrl(config, supabase);
      return jsonOk(result, {
        requestId,
        headers: { 'cache-control': 'no-store' },
      });
    },
  );
}

import { jsonOk } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { getBootstrap } from '@/server/services/bootstrap-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/bootstrap',
      requireAuth: true,
      requireCsrf: false,
    },
    async ({ req: request, requestId, config, supabase }) => {
      const url = new URL(request.url);
      const since = url.searchParams.get('since');
      const data = await getBootstrap({ config, supabase, since });
      return jsonOk(data, { requestId });
    },
  );
}

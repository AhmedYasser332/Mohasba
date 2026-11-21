import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import {
  SettingsPatchSchema,
  updateSettings,
} from '@/server/services/crud-service';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/settings',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, supabase }) => {
      const body = await parseJsonBody(request, SettingsPatchSchema, requestId);
      if (!body.ok) {
        return body.response;
      }

      const result = await updateSettings({
        supabase,
        patch: body.data,
        requestId,
      });

      return jsonOk(result, { requestId });
    },
  );
}

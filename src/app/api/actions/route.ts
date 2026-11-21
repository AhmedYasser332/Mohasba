import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import {
  CreateActionInputSchema,
  createAction,
} from '@/server/services/crud-service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/actions',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, supabase }) => {
      const body = await parseJsonBody(
        request,
        CreateActionInputSchema,
        requestId,
      );
      if (!body.ok) {
        return body.response;
      }

      const result = await createAction({
        supabase,
        input: body.data,
        requestId,
      });

      return jsonOk(result, { status: 201, requestId });
    },
  );
}

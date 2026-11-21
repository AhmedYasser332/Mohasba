import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import {
  ReorderSchemaInputSchema,
  reorderSchema,
} from '@/server/services/crud-service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/schema/reorder',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, supabase }) => {
      const body = await parseJsonBody(
        request,
        ReorderSchemaInputSchema,
        requestId,
      );
      if (!body.ok) {
        return body.response;
      }

      const result = await reorderSchema({
        supabase,
        input: body.data,
        requestId,
      });

      return jsonOk(result, { requestId });
    },
  );
}

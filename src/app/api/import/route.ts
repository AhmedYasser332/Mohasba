import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import {
  ImportChunkInputSchema,
  processImportChunk,
} from '@/server/services/export-import-service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/import',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, supabase }) => {
      const body = await parseJsonBody(
        request,
        ImportChunkInputSchema,
        requestId,
      );
      if (!body.ok) {
        return body.response;
      }

      const result = await processImportChunk({
        supabase,
        input: body.data,
        requestId,
      });

      return jsonOk(result, { requestId });
    },
  );
}

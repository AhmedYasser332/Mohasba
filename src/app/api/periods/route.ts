import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import {
  CreatePeriodInputSchema,
  createPeriod,
} from '@/server/services/crud-service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/periods',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, supabase }) => {
      const body = await parseJsonBody(
        request,
        CreatePeriodInputSchema,
        requestId,
      );
      if (!body.ok) {
        return body.response;
      }

      const result = await createPeriod({
        supabase,
        input: body.data,
        requestId,
      });

      return jsonOk(result, { status: 201, requestId });
    },
  );
}

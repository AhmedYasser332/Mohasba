import { z } from 'zod';
import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { resetWorkspaceForOnboarding } from '@/server/services/bootstrap-service';

export const dynamic = 'force-dynamic';

const ResetWorkspaceSchema = z.object({
  confirm: z.literal('RESET_WORKSPACE'),
});

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/bootstrap/reset',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, supabase }) => {
      const body = await parseJsonBody(request, ResetWorkspaceSchema, requestId);
      if (!body.ok) {
        return body.response;
      }

      const result = await resetWorkspaceForOnboarding({
        supabase,
        requestId,
      });

      return jsonOk(result, { requestId });
    },
  );
}

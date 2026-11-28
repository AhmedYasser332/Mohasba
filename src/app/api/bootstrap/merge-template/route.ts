import { z } from 'zod';
import { TemplateLevelIdSchema } from '@/domain/templates';
import { IsoDateSchema } from '@/domain/types';
import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { mergeTemplateIntoWorkspace } from '@/server/services/bootstrap-service';

export const dynamic = 'force-dynamic';

const MergeTemplateSchema = z.object({
  level: TemplateLevelIdSchema,
  active_from: IsoDateSchema.optional(),
  excluded_period_ids: z.array(z.string().uuid()).max(50).optional(),
  excluded_action_ids: z.array(z.string().uuid()).max(250).optional(),
});

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/bootstrap/merge-template',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, supabase }) => {
      const body = await parseJsonBody(request, MergeTemplateSchema, requestId);
      if (!body.ok) {
        return body.response;
      }

      const result = await mergeTemplateIntoWorkspace({
        supabase,
        level: body.data.level,
        excludedPeriodIds: body.data.excluded_period_ids,
        excludedActionIds: body.data.excluded_action_ids,
        activeFromIso: body.data.active_from,
        requestId,
      });

      return jsonOk(result, { requestId });
    },
  );
}

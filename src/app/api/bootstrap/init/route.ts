import { z } from 'zod';
import { TemplateLevelIdSchema } from '@/domain/templates';
import { IsoDateSchema } from '@/domain/types';
import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { initStarterPack } from '@/server/services/bootstrap-service';
import { SettingsPatchSchema } from '@/server/services/crud-service';

export const dynamic = 'force-dynamic';

const CustomOnboardingActionInputSchema = z.object({
  id: z.string().uuid().optional(),
  period_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
});

const BootstrapInitSchema = z
  .object({
    mode: z.enum(['starter_pack', 'blank', 'template']),
    level: TemplateLevelIdSchema.optional(),
    active_from: IsoDateSchema.optional(),
    excluded_period_ids: z.array(z.string().uuid()).max(50).optional(),
    excluded_action_ids: z.array(z.string().uuid()).max(250).optional(),
    custom_actions: z.array(CustomOnboardingActionInputSchema).max(50).optional(),
    ntfy_all_periods_enabled: z.boolean().optional(),
    settings_patch: SettingsPatchSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'template' && !val.level) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['level'],
        message: 'level is required when mode is "template".',
      });
    }
  });

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/bootstrap/init',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, config, requestId, supabase }) => {
      const body = await parseJsonBody(request, BootstrapInitSchema, requestId);
      if (!body.ok) {
        return body.response;
      }

      const result = await initStarterPack({
        supabase,
        config,
        mode: body.data.mode,
        level: body.data.level,
        excludedPeriodIds: body.data.excluded_period_ids,
        excludedActionIds: body.data.excluded_action_ids,
        customActions: body.data.custom_actions,
        ntfyAllPeriodsEnabled: body.data.ntfy_all_periods_enabled,
        settingsPatch: body.data.settings_patch,
        requestId,
        activeFromIso: body.data.active_from,
      });

      return jsonOk(result, { requestId });
    },
  );
}

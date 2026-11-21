import { z } from 'zod';
import { IsoDateSchema } from '@/domain/types';
import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { initStarterPack } from '@/server/services/bootstrap-service';

export const dynamic = 'force-dynamic';

const BootstrapInitSchema = z.object({
  mode: z.enum(['starter_pack', 'blank']),
  active_from: IsoDateSchema.optional(),
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
    async ({ req: request, requestId, supabase }) => {
      const body = await parseJsonBody(request, BootstrapInitSchema, requestId);
      if (!body.ok) {
        return body.response;
      }

      const result = await initStarterPack({
        supabase,
        mode: body.data.mode,
        requestId,
        activeFromIso: body.data.active_from,
      });

      return jsonOk(result, { requestId });
    },
  );
}

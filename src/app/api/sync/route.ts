import { z } from 'zod';
import { SyncMutationSchema } from '@/domain/types';
import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { processSyncBatch } from '@/server/services/sync-service';

export const dynamic = 'force-dynamic';

const SyncRequestSchema = z.object({
  device_id: z.string().uuid(),
  mutations: z.array(SyncMutationSchema).min(1).max(50),
});

export async function POST(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/sync',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, supabase }) => {
      const body = await parseJsonBody(request, SyncRequestSchema, requestId);
      if (!body.ok) {
        return body.response;
      }

      const result = await processSyncBatch({
        supabase,
        deviceId: body.data.device_id,
        mutations: body.data.mutations,
        requestId,
      });

      return jsonOk(result, { requestId });
    },
  );
}

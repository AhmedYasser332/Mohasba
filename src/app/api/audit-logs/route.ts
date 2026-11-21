import { ServiceError } from '@/server/errors';
import { jsonOk } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import {
  ListAuditLogsQuerySchema,
  listAuditLogs,
} from '@/server/services/crud-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/audit-logs',
      requireAuth: true,
      requireCsrf: false,
    },
    async ({ req: request, requestId, supabase }) => {
      const url = new URL(request.url);
      const parsed = ListAuditLogsQuerySchema.safeParse({
        level: url.searchParams.get('level') ?? undefined,
        category: url.searchParams.get('category') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      });

      if (!parsed.success) {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          'Invalid audit-logs query parameters.',
          parsed.error.flatten(),
        );
      }

      const result = await listAuditLogs({
        supabase,
        level: parsed.data.level,
        category: parsed.data.category,
        limit: parsed.data.limit,
      });

      return jsonOk(result, { requestId });
    },
  );
}

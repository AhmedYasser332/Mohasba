import { diffDaysIso, parseIsoDateParts } from '@/domain/prayer-engine';
import { IsoDateSchema } from '@/domain/types';
import { fetchAllDailyLogsKeyset } from '@/server/db/pagination';
import { ServiceError } from '@/server/errors';
import { jsonOk } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/logs',
      requireAuth: true,
      requireCsrf: false,
    },
    async ({ req: request, requestId, supabase }) => {
      const url = new URL(request.url);
      const fromRaw = url.searchParams.get('from');
      const toRaw = url.searchParams.get('to');

      const fromParsed = IsoDateSchema.safeParse(fromRaw);
      const toParsed = IsoDateSchema.safeParse(toRaw);

      if (!fromParsed.success || !toParsed.success) {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          'Query parameters from and to (YYYY-MM-DD) are required.',
        );
      }

      const from = fromParsed.data;
      const to = toParsed.data;

      try {
        parseIsoDateParts(from);
        parseIsoDateParts(to);
      } catch {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          'Query parameters from and to must be valid calendar dates.',
        );
      }

      if (from > to) {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          'Query parameter from must be <= to.',
        );
      }

      if (diffDaysIso(from, to) > 366) {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          'Requested date span cannot exceed 366 days.',
        );
      }

      const daily_logs = await fetchAllDailyLogsKeyset(supabase, (q) =>
        q.gte('log_date', from).lte('log_date', to),
      );

      return jsonOk({ from, to, daily_logs }, { requestId });
    },
  );
}

import { jsonOk } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import { buildFullExport } from '@/server/services/export-import-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/export',
      requireAuth: true,
      requireCsrf: false,
    },
    async ({ requestId, supabase }) => {
      const snapshot = await buildFullExport({ supabase });
      const dateStamp = snapshot.exported_at.slice(0, 10);

      return jsonOk(snapshot, {
        requestId,
        headers: {
          'Content-Disposition': `attachment; filename="mohasba-${dateStamp}.json"`,
          'Cache-Control': 'no-store',
        },
      });
    },
  );
}

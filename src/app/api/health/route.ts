import { getRequestId, jsonOk } from '@/server/http/response';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  return jsonOk({ ok: true }, { requestId });
}

import { z } from 'zod';
import { ServiceError } from '@/server/errors';
import {
  jsonOk,
  parseDeleteForceFlag,
  parseJsonBody,
} from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import {
  UpdateActionInputSchema,
  deleteAction,
  updateAction,
} from '@/server/services/crud-service';

export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/actions/[id]',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: true,
    },
    async ({ req: request, requestId, supabase }) => {
      const { id } = await context.params;
      if (!UuidSchema.safeParse(id).success) {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          'Invalid action id UUID.',
        );
      }

      const body = await parseJsonBody(
        request,
        UpdateActionInputSchema,
        requestId,
      );
      if (!body.ok) {
        return body.response;
      }

      const result = await updateAction({
        supabase,
        id,
        patch: body.data,
        requestId,
      });

      return jsonOk(result, { requestId });
    },
  );
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/actions/[id]',
      requireAuth: true,
      requireCsrf: true,
      requireJsonContentType: false,
    },
    async ({ req: request, requestId, supabase }) => {
      const { id } = await context.params;
      if (!UuidSchema.safeParse(id).success) {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          'Invalid action id UUID.',
        );
      }

      const force = await parseDeleteForceFlag(request);

      const result = await deleteAction({
        supabase,
        id,
        force,
        requestId,
      });

      return jsonOk(result, { requestId });
    },
  );
}

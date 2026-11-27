import { z } from 'zod';
import { ServiceError } from '@/server/errors';
import { jsonOk, parseJsonBody } from '@/server/http/response';
import { handleAppRoute } from '@/server/http/route-handler';
import {
  UpdatePeriodInputSchema,
  deletePeriod,
  updatePeriod,
} from '@/server/services/crud-service';

export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();
const DeleteBodySchema = z.object({ force: z.boolean().optional() }).strict();

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleAppRoute(
    req,
    {
      route: '/api/periods/[id]',
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
          'Invalid period id UUID.',
        );
      }

      const body = await parseJsonBody(
        request,
        UpdatePeriodInputSchema,
        requestId,
      );
      if (!body.ok) {
        return body.response;
      }

      const result = await updatePeriod({
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
      route: '/api/periods/[id]',
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
          'Invalid period id UUID.',
        );
      }

      const url = new URL(request.url);
      let force = url.searchParams.get('force') === 'true';
      const rawText = (await request.text()).trim();
      if (rawText.length > 0) {
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          throw new ServiceError(
            400,
            'INVALID_JSON',
            'Malformed JSON body on DELETE request.',
          );
        }
        const validated = DeleteBodySchema.safeParse(parsedJson);
        if (!validated.success) {
          throw new ServiceError(
            400,
            'VALIDATION_ERROR',
            'Invalid DELETE request body; expected optional boolean "force".',
            validated.error.flatten(),
          );
        }
        if (validated.data.force === true) {
          force = true;
        }
      }

      const result = await deletePeriod({
        supabase,
        id,
        force,
        requestId,
      });

      return jsonOk(result, { requestId });
    },
  );
}

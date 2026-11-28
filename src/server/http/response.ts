import { z } from 'zod';
import { ServiceError } from '../errors';

const DeleteForceBodySchema = z
  .object({ force: z.boolean().optional() })
  .strict();

export function getRequestId(req: Request): string {
  const incoming = req.headers.get('x-request-id')?.trim();
  if (incoming && incoming.length > 0) {
    return incoming.slice(0, 64);
  }
  return crypto.randomUUID();
}

export function jsonOk(
  data: unknown,
  options?: {
    status?: number;
    requestId?: string;
    headers?: HeadersInit;
  },
): Response {
  const headers = new Headers(options?.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'no-store');
  }
  if (options?.requestId) {
    headers.set('x-request-id', options.requestId);
  }
  return new Response(JSON.stringify(data), {
    status: options?.status ?? 200,
    headers,
  });
}

export function jsonError(params: {
  status: number;
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
  headers?: HeadersInit;
}): Response {
  const headers = new Headers(params.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'no-store');
  }
  headers.set('x-request-id', params.requestId);

  return new Response(
    JSON.stringify({
      error: {
        code: params.code,
        message: params.message,
        ...(params.details !== undefined ? { details: params.details } : {}),
      },
      request_id: params.requestId,
    }),
    {
      status: params.status,
      headers,
    },
  );
}

export async function parseDeleteForceFlag(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  let force = url.searchParams.get('force') === 'true';
  const rawText = (await req.text()).trim();
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
    const validated = DeleteForceBodySchema.safeParse(parsedJson);
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
  return force;
}

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  req: Request,
  schema: TSchema,
  requestId: string,
): Promise<
  { ok: true; data: z.output<TSchema> } | { ok: false; response: Response }
> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: jsonError({
        status: 400,
        code: 'INVALID_JSON',
        message: 'Request body must be valid JSON.',
        requestId,
      }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: parsed.error.flatten(),
        requestId,
      }),
    };
  }

  return { ok: true, data: parsed.data };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { guardAppRequest } from '../access/guard';
import { loadRuntimeConfig, type RuntimeConfig } from '../config';
import { createServerSupabaseClient } from '../db/supabase';
import { ServiceError } from '../errors';
import { logAccess, writeAuditLog } from '../observability/logger';
import { getRequestId, jsonError } from './response';

export interface RouteContext {
  req: Request;
  requestId: string;
  config: RuntimeConfig;
  supabase: SupabaseClient;
}

export async function handleAppRoute(
  req: Request,
  options: {
    route: string;
    requireAuth?: boolean;
    requireCsrf?: boolean;
    requireJsonContentType?: boolean;
  },
  handler: (ctx: RouteContext) => Promise<Response>,
): Promise<Response> {
  const startMs = performance.now();
  const requestId = getRequestId(req);

  let config: RuntimeConfig;
  try {
    config = loadRuntimeConfig();
  } catch (err) {
    const res = jsonError({
      status: 500,
      code: 'CONFIG_ERROR',
      message:
        err instanceof Error ? err.message : 'Invalid server configuration.',
      requestId,
    });
    logAccess({
      level: 'ERROR',
      requestId,
      route: options.route,
      method: req.method,
      status: 500,
      ms: performance.now() - startMs,
      code: 'CONFIG_ERROR',
    });
    return res;
  }

  const guard = await guardAppRequest(req, config, requestId, {
    requireAuth: options.requireAuth,
    requireCsrf: options.requireCsrf,
    requireJsonContentType: options.requireJsonContentType,
  });

  if (!guard.ok) {
    logAccess({
      requestId,
      route: options.route,
      method: req.method,
      status: guard.response.status,
      ms: performance.now() - startMs,
    });
    return guard.response;
  }

  const supabase = createServerSupabaseClient(config);

  try {
    const response = await handler({ req, requestId, config, supabase });
    logAccess({
      requestId,
      route: options.route,
      method: req.method,
      status: response.status,
      ms: performance.now() - startMs,
    });
    return response;
  } catch (err) {
    if (err instanceof ServiceError) {
      const res = jsonError({
        status: err.status,
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      });
      logAccess({
        requestId,
        route: options.route,
        method: req.method,
        status: err.status,
        ms: performance.now() - startMs,
        code: err.code,
      });
      return res;
    }

    await writeAuditLog(supabase, {
      level: 'ERROR',
      category: 'SYSTEM',
      event_name: 'unhandled_route_error',
      request_id: requestId,
      summary: `Unhandled error on ${req.method} ${options.route}.`,
      context: { route: options.route, method: req.method },
      error: err,
    });

    const res = jsonError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected server error occurred.',
      requestId,
    });
    logAccess({
      level: 'ERROR',
      requestId,
      route: options.route,
      method: req.method,
      status: 500,
      ms: performance.now() - startMs,
      code: 'INTERNAL_ERROR',
    });
    return res;
  }
}

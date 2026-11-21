import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditLogCategory, AuditLogLevel } from '@/domain/types';

const SENSITIVE_KEY_PATTERN =
  /passcode|secret|token|cookie|authorization|password|topic_url|service_role|key/i;
const RAW_NOTE_KEY_PATTERN = /^note$/i;
const MAX_AUDIT_CONTEXT_BYTES = 2048;
const MAX_ERROR_STACK_CHARS = 1500;
const encoder = new TextEncoder();

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[MAX_DEPTH]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    if (/^Bearer\s+/i.test(value)) {
      return '[REDACTED]';
    }
    return value.length > 400 ? `${value.slice(0, 397)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => scrubValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else if (RAW_NOTE_KEY_PATTERN.test(k)) {
        const noteText = typeof v === 'string' ? v : '';
        out.has_note = noteText.length > 0;
        out.note_length = noteText.length;
      } else {
        out[k] = scrubValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/**
 * Recursively redacts sensitive keys, replaces raw `note` text with `{ has_note, note_length }`,
 * and guarantees serialized UTF-8 byte length <= 2048 bytes.
 */
export function sanitizeAuditContext(
  context: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {};
  }

  const scrubbed = scrubValue(context) as Record<string, unknown>;
  const json = JSON.stringify(scrubbed);
  if (encoder.encode(json).length <= MAX_AUDIT_CONTEXT_BYTES) {
    return scrubbed;
  }

  // Progressively trim keys to fit within 2048 bytes.
  const trimmed: Record<string, unknown> = { _truncated: true };
  for (const [k, v] of Object.entries(scrubbed)) {
    const candidate = { ...trimmed, [k]: v };
    if (encoder.encode(JSON.stringify(candidate)).length <= MAX_AUDIT_CONTEXT_BYTES) {
      trimmed[k] = v;
    } else {
      break;
    }
  }
  return trimmed;
}

export function truncateErrorStack(error: unknown): string | null {
  if (error === undefined || error === null) {
    return null;
  }
  const raw =
    error instanceof Error
      ? error.stack ?? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  const scrubbed = raw.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  return scrubbed.length > MAX_ERROR_STACK_CHARS
    ? scrubbed.slice(0, MAX_ERROR_STACK_CHARS)
    : scrubbed;
}

export function logAccess(entry: {
  level?: 'INFO' | 'WARN' | 'ERROR';
  requestId: string;
  route: string;
  method: string;
  status: number;
  ms: number;
  code?: string;
}): void {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    level: entry.level ?? (entry.status >= 500 ? 'ERROR' : entry.status >= 400 ? 'WARN' : 'INFO'),
    reqId: entry.requestId,
    route: entry.route,
    method: entry.method,
    status: entry.status,
    ms: Math.round(entry.ms),
    ...(entry.code ? { code: entry.code } : {}),
  });

  if (entry.status >= 500) {
    console.error(payload);
  } else {
    console.log(payload);
  }
}

export interface AuditLogInput {
  level: AuditLogLevel;
  category: AuditLogCategory;
  event_name: string;
  request_id?: string | null;
  device_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  summary: string;
  context?: Record<string, unknown>;
  error?: unknown;
}

/**
 * Fail-safe non-blocking audit log writer. Never throws into caller flows.
 */
export async function writeAuditLog(
  supabase: SupabaseClient,
  input: AuditLogInput,
): Promise<void> {
  try {
    const context = sanitizeAuditContext(input.context);
    const errorStack = truncateErrorStack(input.error);

    const { error } = await supabase.from('audit_logs').insert({
      level: input.level,
      category: input.category,
      event_name: input.event_name.slice(0, 80),
      request_id: input.request_id ? input.request_id.slice(0, 64) : null,
      device_id: input.device_id ?? null,
      entity_type: input.entity_type ? input.entity_type.slice(0, 40) : null,
      entity_id: input.entity_id ? input.entity_id.slice(0, 80) : null,
      summary: input.summary.slice(0, 500),
      context,
      error_stack: errorStack,
    });

    if (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'WARN',
          event: 'audit_log_insert_failed',
          reqId: input.request_id ?? null,
          message: error.message,
        }),
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'WARN',
        event: 'audit_log_exception',
        reqId: input.request_id ?? null,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

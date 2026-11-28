import type { SupabaseClient } from '@supabase/supabase-js';
import type { RuntimeConfig } from '../config';
import { jsonError } from '../http/response';

export const SESSION_COOKIE_NAME = 'mohasba_session';
export const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // 15552000 (180 days)
export const MAX_UNLOCK_FAILURES = 5;
export const LOCKOUT_DURATION_MS = 60_000;
export const UNLOCK_WINDOW_MS = 15 * 60_000;

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const base64 = padded + '='.repeat(padLen);
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Constant-time equality over SHA-256 digests so string length & prefix never leak via timing.
 */
export async function constantTimeStringEqual(
  a: string,
  b: string,
): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

async function deriveSessionHmacKey(config: RuntimeConfig): Promise<CryptoKey> {
  const ikm = `${config.cronSecret ?? ''}:${config.appPasscode ?? ''}`;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ikm),
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('mohasba-session-v1'),
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionToken(
  config: RuntimeConfig,
  nowMs: number = Date.now(),
): Promise<string> {
  const issuedSec = Math.floor(nowMs / 1000);
  const expSec = issuedSec + SESSION_MAX_AGE_SECONDS;
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(12)));
  const payload = `v1.${expSec}.${nonce}`;

  const key = await deriveSessionHmacKey(config);
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sig = toBase64Url(new Uint8Array(sigBuf));
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  token: string,
  config: RuntimeConfig,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    return false;
  }
  const expSec = Number(parts[1]);
  if (!Number.isInteger(expSec) || expSec <= Math.floor(nowMs / 1000)) {
    return false;
  }
  const sigBytes = fromBase64Url(parts[3] ?? '');
  if (!sigBytes) {
    return false;
  }

  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const key = await deriveSessionHmacKey(config);
  return crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes.buffer as ArrayBuffer,
    encoder.encode(payload),
  );
}

export function parseCookieHeader(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const k = pair.slice(0, eqIdx).trim();
    if (k === name) {
      try {
        return decodeURIComponent(pair.slice(eqIdx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isHttpsContext(req: Request, config: RuntimeConfig): boolean {
  if (req.headers.get('x-forwarded-proto')?.toLowerCase() === 'https') {
    return true;
  }
  try {
    if (new URL(req.url).protocol === 'https:') {
      return true;
    }
  } catch {
    // ignore
  }
  if (config.appUrl) {
    try {
      if (new URL(config.appUrl).protocol === 'https:') {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

export function buildSessionSetCookieHeader(
  req: Request,
  config: RuntimeConfig,
  token: string,
): string {
  const secure = isHttpsContext(req, config) ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

export function buildLogoutSetCookieHeader(
  req: Request,
  config: RuntimeConfig,
): string {
  const secure = isHttpsContext(req, config) ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function isSetupIncomplete(config: RuntimeConfig): boolean {
  return config.isProduction && !config.appPasscode && !config.allowUnauthenticated;
}

export function extractClientIp(req: Request): string | null {
  const cfIp = req.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) {
    return cfIp;
  }
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return null;
}

export function resolveClientIpForRateLimit(
  req: Request,
  isProduction: boolean,
): string | null {
  const ip = extractClientIp(req);
  if (ip) {
    return ip;
  }
  return isProduction ? 'unknown' : null;
}

export async function hashClientIp(
  ip: string,
  cronSecret: string | null,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(cronSecret ?? 'mohasba-local-ip-salt'),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const saltBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('mohasba-ip-salt-v1'),
    },
    keyMaterial,
    256,
  );
  const saltBytes = new Uint8Array(saltBits);
  const ipBytes = encoder.encode(ip);
  const combined = new Uint8Array(saltBytes.length + ipBytes.length);
  combined.set(saltBytes, 0);
  combined.set(ipBytes, saltBytes.length);

  const digest = await crypto.subtle.digest('SHA-256', combined);
  return toHex(new Uint8Array(digest));
}

export async function checkUnlockRateLimit(
  supabase: SupabaseClient,
  ipHash: string | null,
  nowMs: number = Date.now(),
): Promise<{ locked: boolean; retryAfterSec: number; existingAttempts: number }> {
  if (!ipHash) {
    return { locked: false, retryAfterSec: 0, existingAttempts: 0 };
  }

  const { data, error } = await supabase
    .from('unlock_rate_limits')
    .select('failed_attempts, locked_until')
    .eq('ip_hash', ipHash)
    .maybeSingle();

  if (error || !data) {
    return { locked: false, retryAfterSec: 0, existingAttempts: 0 };
  }

  const lockedUntilMs = data.locked_until ? Date.parse(String(data.locked_until)) : 0;
  if (Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs) {
    const retryAfterSec = Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000));
    return {
      locked: true,
      retryAfterSec,
      existingAttempts: Number(data.failed_attempts ?? 0),
    };
  }

  // Cooldown expired: reset count for fresh window
  if (lockedUntilMs > 0 && lockedUntilMs <= nowMs) {
    return { locked: false, retryAfterSec: 0, existingAttempts: 0 };
  }

  return {
    locked: false,
    retryAfterSec: 0,
    existingAttempts: Number(data.failed_attempts ?? 0),
  };
}

export async function recordUnlockFailure(
  supabase: SupabaseClient,
  ipHash: string | null,
  nowMs: number = Date.now(),
): Promise<{ nowLocked: boolean; attempts: number; retryAfterSec: number }> {
  if (!ipHash) {
    return { nowLocked: false, attempts: 0, retryAfterSec: 0 };
  }

  const { data, error } = await supabase.rpc('record_unlock_failure_atomic', {
    p_ip_hash: ipHash,
    p_now: new Date(nowMs).toISOString(),
    p_window_ms: UNLOCK_WINDOW_MS,
    p_max_attempts: MAX_UNLOCK_FAILURES,
    p_lock_ms: LOCKOUT_DURATION_MS,
  });

  if (error) {
    throw new Error(`Failed recording unlock failure: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { failed_attempts?: number; locked_until?: string | null }
    | null
    | undefined;

  const attempts = Number(row?.failed_attempts ?? 1);
  const lockedUntilMs = row?.locked_until
    ? Date.parse(String(row.locked_until))
    : 0;
  const nowLocked = Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs;
  const retryAfterSec = nowLocked
    ? Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000))
    : 0;

  return {
    nowLocked,
    attempts,
    retryAfterSec,
  };
}

export async function clearUnlockRateLimit(
  supabase: SupabaseClient,
  ipHash: string | null,
): Promise<void> {
  if (!ipHash) {
    return;
  }
  await supabase.from('unlock_rate_limits').delete().eq('ip_hash', ipHash);
}

function getAllowedOrigins(req: Request, config: RuntimeConfig): Set<string> {
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(req.url).origin);
  } catch {
    // ignore
  }
  if (config.appUrl) {
    try {
      allowed.add(new URL(config.appUrl).origin);
    } catch {
      // ignore
    }
  }
  return allowed;
}

/**
 * Verifies CSRF protection on mutating routes (`POST`/`PATCH`/`DELETE`):
 * - Checks `Content-Type: application/json` when a JSON body is expected.
 * - Requires matching `Origin` (against `APP_URL` or request URL origin) OR `Sec-Fetch-Site: same-origin`.
 */
export function verifyCsrf(
  req: Request,
  config: RuntimeConfig,
  options: { requireJsonContentType?: boolean } = {},
): { ok: true } | { ok: false; code: 'CSRF_REJECTED'; message: string } {
  const { requireJsonContentType = true } = options;

  if (requireJsonContentType) {
    const ct = req.headers.get('content-type')?.toLowerCase() ?? '';
    if (!ct.includes('application/json')) {
      return {
        ok: false,
        code: 'CSRF_REJECTED',
        message: 'Content-Type application/json is required.',
      };
    }
  }

  const originHeader = req.headers.get('origin')?.trim();
  const secFetchSite = req.headers.get('sec-fetch-site')?.trim().toLowerCase();
  const allowed = getAllowedOrigins(req, config);

  if (originHeader) {
    if (!allowed.has(originHeader)) {
      return {
        ok: false,
        code: 'CSRF_REJECTED',
        message: 'Cross-origin request rejected.',
      };
    }
    return { ok: true };
  }

  if (secFetchSite === 'same-origin') {
    return { ok: true };
  }

  return {
    ok: false,
    code: 'CSRF_REJECTED',
    message: 'Missing or invalid Origin / Sec-Fetch-Site header.',
  };
}

/**
 * Enforces Fail-Closed production check, session cookie (when `APP_PASSCODE` is set),
 * and CSRF check on mutating methods (`POST`/`PATCH`/`DELETE`).
 */
export async function guardAppRequest(
  req: Request,
  config: RuntimeConfig,
  requestId: string,
  options: {
    requireAuth?: boolean;
    requireCsrf?: boolean;
    requireJsonContentType?: boolean;
  } = {},
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (isSetupIncomplete(config)) {
    return {
      ok: false,
      response: jsonError({
        status: 503,
        code: 'SETUP_INCOMPLETE',
        message:
          'Server security configuration is incomplete: set APP_PASSCODE or ALLOW_UNAUTHENTICATED=true.',
        requestId,
      }),
    };
  }

  const {
    requireAuth = true,
    requireCsrf = req.method === 'POST' ||
      req.method === 'PATCH' ||
      req.method === 'DELETE',
    requireJsonContentType = requireCsrf,
  } = options;

  if (requireAuth && config.appPasscode) {
    const token = parseCookieHeader(
      req.headers.get('cookie'),
      SESSION_COOKIE_NAME,
    );
    const valid = token ? await verifySessionToken(token, config) : false;
    if (!valid) {
      return {
        ok: false,
        response: jsonError({
          status: 401,
          code: 'UNLOCK_REQUIRED',
          message: 'Passcode unlock is required.',
          requestId,
        }),
      };
    }
  }

  if (requireCsrf) {
    const csrf = verifyCsrf(req, config, { requireJsonContentType });
    if (!csrf.ok) {
      return {
        ok: false,
        response: jsonError({
          status: 403,
          code: csrf.code,
          message: csrf.message,
          requestId,
        }),
      };
    }
  }

  return { ok: true };
}

export async function verifyCronSecret(
  req: Request,
  config: RuntimeConfig,
  requestId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!config.cronSecret) {
    return {
      ok: false,
      response: jsonError({
        status: 503,
        code: 'CRON_NOT_CONFIGURED',
        message: 'CRON_SECRET is not configured.',
        requestId,
      }),
    };
  }

  const authHeader = req.headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = match?.[1]?.trim() ?? '';

  if (!token || !(await constantTimeStringEqual(token, config.cronSecret))) {
    return {
      ok: false,
      response: jsonError({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Invalid cron authorization.',
        requestId,
      }),
    };
  }

  return { ok: true };
}

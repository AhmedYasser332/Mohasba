/**
 * SSRF-hardened ntfy topic URL validation, masking, and secret scrubbing.
 * Uses 100% Web Standard APIs (zero Node `net` import) for Node 20 + Cloudflare Workers parity.
 */

export type NtfyUrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
] as const;

const BLOCKED_EXACT_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.goog',
  'metadata.google.internal',
]);

function isBlockedIpv4(a: number, b: number, c: number, d: number): boolean {
  if (
    a < 0 ||
    a > 255 ||
    b < 0 ||
    b > 255 ||
    c < 0 ||
    c > 255 ||
    d < 0 ||
    d > 255
  ) {
    return true;
  }

  // 0.0.0.0/8 (this-network / unspecified)
  if (a === 0) return true;
  // 10.0.0.0/8 (RFC1918 private)
  if (a === 10) return true;
  // 100.64.0.0/10 (CGNAT / shared address space)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local / cloud IMDS)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (RFC1918 private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (RFC1918 private)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 (multicast) and 240.0.0.0/4 (reserved / broadcast >= 224)
  if (a >= 224) return true;

  return false;
}

function parseIpv4Dotted(host: string): [number, number, number, number] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return null;
  }
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

function parseIpv6Hextets(rawInner: string): number[] | null {
  if (!rawInner || rawInner.includes('%')) {
    return null;
  }

  // Handle optional embedded dotted IPv4 tail if not already hex-normalized
  let input = rawInner;
  const lastColon = input.lastIndexOf(':');
  if (lastColon !== -1 && input.slice(lastColon + 1).includes('.')) {
    const ipv4 = parseIpv4Dotted(input.slice(lastColon + 1));
    if (!ipv4) return null;
    const hi = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const lo = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    input = `${input.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColonParts = input.split('::');
  if (doubleColonParts.length > 2) {
    return null;
  }

  const parseSide = (side: string): number[] | null => {
    if (side === '') return [];
    const tokens = side.split(':');
    const out: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-f]{1,4}$/i.test(token)) {
        return null;
      }
      out.push(parseInt(token, 16));
    }
    return out;
  };

  if (doubleColonParts.length === 1) {
    const groups = parseSide(doubleColonParts[0]!);
    return groups && groups.length === 8 ? groups : null;
  }

  const left = parseSide(doubleColonParts[0]!);
  const right = parseSide(doubleColonParts[1]!);
  if (!left || !right) {
    return null;
  }
  const missing = 8 - (left.length + right.length);
  if (missing < 1) {
    return null;
  }

  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function isBlockedIpv6(h: readonly number[]): boolean {
  if (h.length !== 8) return true;

  // ::/96 (includes :: unspecified, ::1 loopback, and IPv4-compatible IPv6)
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0
  ) {
    return true;
  }

  // 100::/64 (discard-only)
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
    return true;
  }

  // fc00::/7 (Unique Local Address)
  if ((h[0]! & 0xfe00) === 0xfc00) {
    return true;
  }

  // fe80::/10 (Link-Local)
  if ((h[0]! & 0xffc0) === 0xfe80) {
    return true;
  }

  // fec0::/10 (Deprecated Site-Local)
  if ((h[0]! & 0xffc0) === 0xfec0) {
    return true;
  }

  // ff00::/8 (Multicast)
  if ((h[0]! & 0xff00) === 0xff00) {
    return true;
  }

  // ::ffff:0:0/96 (IPv4-mapped IPv6) -> extract embedded IPv4 and check IPv4 blocklist
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0xffff
  ) {
    const a = (h[6]! >> 8) & 0xff;
    const b = h[6]! & 0xff;
    const c = (h[7]! >> 8) & 0xff;
    const d = h[7]! & 0xff;
    return isBlockedIpv4(a, b, c, d);
  }

  // 64:ff9b::/96 (NAT64 well-known prefix) -> extract embedded IPv4 and check IPv4 blocklist
  if (
    h[0] === 0x0064 &&
    h[1] === 0xff9b &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0
  ) {
    const a = (h[6]! >> 8) & 0xff;
    const b = h[6]! & 0xff;
    const c = (h[7]! >> 8) & 0xff;
    const d = h[7]! & 0xff;
    return isBlockedIpv4(a, b, c, d);
  }

  // 64:ff9b:1::/48 (NAT64 local-use)
  if (h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0x0001) {
    return true;
  }

  return false;
}

/**
 * Validates an in-app ntfy topic URL against strict HTTPS + anti-SSRF rules.
 */
export function validateNtfyTopicUrl(raw: string): NtfyUrlValidationResult {
  const trimmed = raw.trim();

  // 1. Length & control/whitespace check
  if (trimmed.length < 10 || trimmed.length > 500) {
    return {
      ok: false,
      reason: 'ntfy topic URL must be between 10 and 500 characters.',
    };
  }
  if (/[\s\u0000-\u001F\u007F]/.test(trimmed)) {
    return {
      ok: false,
      reason: 'ntfy topic URL must not contain whitespace or control characters.',
    };
  }

  // Pre-check raw authority & path before WHATWG URL dot-segment collapsing
  if (!/^https:\/\//i.test(trimmed)) {
    return {
      ok: false,
      reason: 'ntfy topic URL must use https://.',
    };
  }
  const slashIdx = trimmed.indexOf('/', 8);
  if (slashIdx === -1) {
    return {
      ok: false,
      reason: 'ntfy topic URL must include a topic path segment.',
    };
  }
  const rawAuthority = trimmed.slice(8, slashIdx);
  if (rawAuthority.includes('@')) {
    return {
      ok: false,
      reason: 'ntfy topic URL must not contain credentials.',
    };
  }
  const rawPathPart = trimmed.slice(slashIdx);
  if (rawPathPart.includes('?') || rawPathPart.includes('#')) {
    return {
      ok: false,
      reason: 'ntfy topic URL must not contain query parameters or fragments.',
    };
  }
  const rawSegments = rawPathPart.split('/').filter((s) => s.length > 0);
  if (rawSegments.length < 1 || rawSegments.some((s) => s === '.' || s === '..')) {
    return {
      ok: false,
      reason: 'ntfy topic URL must include a valid topic path without dot segments.',
    };
  }

  // 2. Parse via WHATWG URL
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: 'Invalid ntfy topic URL.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'ntfy topic URL must use https://.',
    };
  }

  // 3. Reject credentials, query, and hash
  if (parsed.username !== '' || parsed.password !== '') {
    return {
      ok: false,
      reason: 'ntfy topic URL must not contain credentials.',
    };
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return {
      ok: false,
      reason: 'ntfy topic URL must not contain query parameters or fragments.',
    };
  }

  // 4. Require non-empty topic path segment without . or ..
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 1 || segments.some((s) => s === '.' || s === '..')) {
    return {
      ok: false,
      reason: 'ntfy topic URL must include a valid topic path.',
    };
  }

  // 5-8. Hostname normalization & SSRF IPv4 / IPv6 blocklists
  const rawHost = parsed.hostname.toLowerCase();
  if (!rawHost) {
    return { ok: false, reason: 'ntfy topic URL hostname is missing.' };
  }

  if (rawHost.startsWith('[') && rawHost.endsWith(']')) {
    const inner = rawHost.slice(1, -1);
    const hextets = parseIpv6Hextets(inner);
    if (!hextets) {
      return { ok: false, reason: 'Invalid IPv6 host in ntfy topic URL.' };
    }
    if (isBlockedIpv6(hextets)) {
      return {
        ok: false,
        reason: 'Private, loopback, link-local, or reserved IPv6 hosts are not allowed.',
      };
    }
  } else {
    if (rawHost.endsWith('..')) {
      return { ok: false, reason: 'Invalid hostname in ntfy topic URL.' };
    }
    const host = rawHost.replace(/\.$/, '');
    if (!host) {
      return { ok: false, reason: 'Invalid hostname in ntfy topic URL.' };
    }

    if (
      BLOCKED_EXACT_HOSTS.has(host) ||
      BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
    ) {
      return {
        ok: false,
        reason: 'Local or internal hostnames are not allowed for ntfy topic URL.',
      };
    }

    const ipv4 = parseIpv4Dotted(host);
    if (ipv4) {
      if (isBlockedIpv4(ipv4[0], ipv4[1], ipv4[2], ipv4[3])) {
        return {
          ok: false,
          reason: 'Private, loopback, link-local, or reserved IPv4 addresses are not allowed.',
        };
      }
    } else {
      // Block single-label internal DNS names (e.g. postgres, redis, cloudflared)
      if (!host.includes('.')) {
        return {
          ok: false,
          reason: 'Single-label internal hostnames are not allowed.',
        };
      }
      const labels = host.split('.');
      if (labels.some((l) => l.length === 0)) {
        return { ok: false, reason: 'Invalid hostname in ntfy topic URL.' };
      }
    }
  }

  return { ok: true, url: trimmed };
}

/**
 * Formats a secret ntfy topic URL into a safe masked hint (`${origin}/••••${tail}`).
 */
export function formatNtfyTopicHint(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const last = segments[segments.length - 1]!;
  let tail = '';
  if (last.length > 8) {
    tail = last.slice(-4);
  } else if (last.length > 4) {
    tail = last.slice(-2);
  }

  return `${parsed.origin}/••••${tail}`;
}

/**
 * Scrubs raw ntfy topic URLs and Bearer tokens from error messages and log strings.
 */
export function scrubNtfySecrets(
  text: string,
  effectiveUrl?: string | null,
  accessToken?: string | null,
): string {
  let out = text;

  if (effectiveUrl) {
    const trimmed = effectiveUrl.trim();
    const hint = formatNtfyTopicHint(trimmed) ?? '[REDACTED_NTFY_URL]';
    if (trimmed) {
      out = out.split(trimmed).join(hint);
      try {
        const canonical = new URL(trimmed).toString();
        if (canonical !== trimmed) {
          out = out.split(canonical).join(hint);
        }
      } catch {
        // ignore unparseable effectiveUrl
      }
    }
  }

  if (accessToken) {
    out = out.split(accessToken).join('[REDACTED]');
  }

  out = out.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  return out;
}

/**
 * Produces a secret-scrubbed Error/string suitable for audit_logs persistence.
 */
export function scrubNtfyError(
  error: unknown,
  effectiveUrl?: string | null,
  accessToken?: string | null,
): Error | string {
  if (error instanceof Error) {
    const safeErr = new Error(
      scrubNtfySecrets(error.message, effectiveUrl, accessToken),
    );
    safeErr.name = error.name;
    if (error.stack) {
      safeErr.stack = scrubNtfySecrets(error.stack, effectiveUrl, accessToken);
    }
    return safeErr;
  }

  const raw = typeof error === 'string' ? error : JSON.stringify(error);
  return scrubNtfySecrets(raw ?? 'Unknown error', effectiveUrl, accessToken);
}

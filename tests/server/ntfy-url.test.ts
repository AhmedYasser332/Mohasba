import { describe, expect, it } from 'vitest';
import { truncateErrorStack } from '@/server/observability/logger';
import {
  formatNtfyTopicHint,
  scrubNtfyError,
  scrubNtfySecrets,
  validateNtfyTopicUrl,
} from '@/server/security/ntfy-url';

describe('server/security/ntfy-url (SSRF & zero-leakage)', () => {
  it('accepts valid HTTPS public ntfy topic URLs', () => {
    expect(validateNtfyTopicUrl('https://ntfy.sh/mohasba-9f8a7b6c5d4e')).toEqual(
      {
        ok: true,
        url: 'https://ntfy.sh/mohasba-9f8a7b6c5d4e',
      },
    );
    expect(
      validateNtfyTopicUrl('https://ntfy.example.com:8443/team/mohasba-alerts'),
    ).toEqual({
      ok: true,
      url: 'https://ntfy.example.com:8443/team/mohasba-alerts',
    });
  });

  it('rejects non-HTTPS, credentials, query strings, fragments, empty paths, and dot segments', () => {
    const badUrls = [
      'http://ntfy.sh/my-topic-1234',
      'https://user:pass@ntfy.sh/my-topic-1234',
      'https://ntfy.sh/my-topic-1234?token=abc',
      'https://ntfy.sh/my-topic-1234?',
      'https://ntfy.sh/my-topic-1234#frag',
      'https://ntfy.sh/',
      'https://ntfy.sh',
      'https://ntfy.sh/./secret',
      'https://ntfy.sh/a/../secret',
      'https://ntfy.sh/bad topic',
      'https://a',
    ];

    for (const url of badUrls) {
      expect(validateNtfyTopicUrl(url).ok).toBe(false);
    }
  });

  it('blocks localhost, trailing-dot FQDN, .local/.internal, metadata, and single-label internal DNS hosts', () => {
    const blockedHosts = [
      'https://localhost/topic',
      'https://localhost./topic',
      'https://sub.localhost/topic',
      'https://ntfy.local/topic',
      'https://service.internal/topic',
      'https://box.localdomain/topic',
      'https://nas.home.arpa/topic',
      'https://metadata/computeMetadata/v1',
      'https://metadata.goog/computeMetadata/v1',
      'https://metadata.google.internal/computeMetadata/v1',
      'https://postgres/topic',
      'https://redis/topic',
      'https://cloudflared/topic',
    ];

    for (const url of blockedHosts) {
      expect(validateNtfyTopicUrl(url).ok).toBe(false);
    }
  });

  it('blocks private, loopback, IMDS, CGNAT, and multicast/reserved IPv4 addresses (including integer/hex forms)', () => {
    const blockedIpv4 = [
      'https://0.0.0.1/topic',
      'https://10.0.0.1/topic',
      'https://100.64.0.1/topic',
      'https://127.0.0.1/topic',
      'https://127.0.0.1:8080/topic',
      'https://2130706433/topic', // 127.0.0.1 decimal
      'https://0x7f.0.0.1/topic', // 127.0.0.1 hex
      'https://169.254.169.254/latest/meta-data',
      'https://172.16.0.1/topic',
      'https://172.31.255.254/topic',
      'https://192.168.1.10/topic',
      'https://198.18.0.1/topic',
      'https://224.0.0.1/topic',
      'https://255.255.255.255/topic',
    ];

    for (const url of blockedIpv4) {
      expect(validateNtfyTopicUrl(url).ok).toBe(false);
    }

    // Public IPv4 outside blocked ranges passes
    expect(validateNtfyTopicUrl('https://1.1.1.1/mohasba-topic').ok).toBe(true);
    expect(validateNtfyTopicUrl('https://172.32.0.1/mohasba-topic').ok).toBe(
      true,
    );
  });

  it('blocks loopback, ULA, link-local, multicast, ::/96, and embedded IPv4-mapped/NAT64 IPv6 literals', () => {
    const blockedIpv6 = [
      'https://[::]/topic',
      'https://[::1]/topic',
      'https://[fc00::1]/topic',
      'https://[fd12:3456:789a::1]/topic',
      'https://[fe80::1]/topic',
      'https://[fec0::1]/topic',
      'https://[ff02::1]/topic',
      'https://[::ffff:7f00:1]/topic',
      'https://[::ffff:127.0.0.1]/topic',
      'https://[::ffff:169.254.169.254]/topic',
      'https://[::ffff:10.0.0.5]/topic',
      'https://[64:ff9b::7f00:1]/topic',
      'https://[64:ff9b::a9fe:a9fe]/topic',
      'https://[64:ff9b:1::1]/topic',
    ];

    for (const url of blockedIpv6) {
      expect(validateNtfyTopicUrl(url).ok).toBe(false);
    }

    // Public IPv6 passes
    expect(
      validateNtfyTopicUrl('https://[2606:4700:4700::1111]/mohasba-topic').ok,
    ).toBe(true);
  });

  it('formats masked ntfy topic hints and scrubs raw URLs and Bearer tokens from logs/errors', () => {
    expect(formatNtfyTopicHint(null)).toBeNull();
    expect(formatNtfyTopicHint('https://ntfy.sh/mohasba-9f2a')).toBe(
      'https://ntfy.sh/••••9f2a',
    );
    expect(formatNtfyTopicHint('https://ntfy.sh/abcdef')).toBe(
      'https://ntfy.sh/••••ef',
    );
    expect(formatNtfyTopicHint('https://ntfy.sh/abc')).toBe(
      'https://ntfy.sh/••••',
    );

    const secretUrl = 'https://ntfy.sh/mohasba-secret-9f2a';
    const token = 'tk_super+secret/base64==';
    const scrubbed = scrubNtfySecrets(
      `POST ${secretUrl} failed with Authorization: Bearer ${token}`,
      secretUrl,
      token,
    );
    expect(scrubbed).not.toContain('mohasba-secret-9f2a');
    expect(scrubbed).not.toContain(token);
    expect(scrubbed).toContain('https://ntfy.sh/••••9f2a');
    expect(scrubbed).toContain('Bearer [REDACTED]');

    const err = new Error(`Network failed calling ${secretUrl} (Bearer ${token})`);
    const safeErr = scrubNtfyError(err, secretUrl, token) as Error;
    expect(safeErr.message).not.toContain('mohasba-secret-9f2a');
    expect(safeErr.message).not.toContain(token);

    const truncated = truncateErrorStack(
      new Error(`Authorization Bearer ${token} rejected`),
    );
    expect(truncated).not.toContain(token);
    expect(truncated).toContain('Bearer [REDACTED]');
  });
});

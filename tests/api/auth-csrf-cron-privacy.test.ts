import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as auditLogsGet } from '@/app/api/audit-logs/route';
import { GET as bootstrapGet } from '@/app/api/bootstrap/route';
import { POST as initPost } from '@/app/api/bootstrap/init/route';
import { GET as cronGet, POST as cronPost } from '@/app/api/cron/tick/route';
import { GET as exportGet } from '@/app/api/export/route';
import { GET as healthGet } from '@/app/api/health/route';
import { POST as logoutPost } from '@/app/api/logout/route';
import { PATCH as settingsPatch } from '@/app/api/settings/route';
import { POST as syncPost } from '@/app/api/sync/route';
import { POST as unlockPost } from '@/app/api/unlock/route';
import { resolveActiveWindow } from '@/domain/prayer-engine';
import {
  buildStarterPack,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
} from '@/domain/starter-pack';
import { loadRuntimeConfig } from '@/server/config';
import {
  sanitizeAuditContext,
  writeAuditLog,
} from '@/server/observability/logger';
import { runCronTick } from '@/server/services/ntfy-dispatcher';
import {
  extractCookiePair,
  makeGetRequest,
  makeJsonRequest,
  restoreEnv,
  snapshotEnv,
  TEST_ORIGIN,
  type EnvSnapshot,
} from '../helpers/api-test-client';
import { createTestAdminClient, resetTestDb } from '../helpers/reset-test-db';

describe('Slice 2: Auth, Fail-Closed 503, Rate-Limit, CSRF, Cron & Privacy', () => {
  const admin = createTestAdminClient();
  let envSnap: EnvSnapshot;

  beforeAll(() => {
    envSnap = snapshotEnv();
  });

  afterAll(async () => {
    await resetTestDb();
    restoreEnv(envSnap);
  });

  beforeEach(async () => {
    await resetTestDb();
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = 'test';
    env.APP_URL = TEST_ORIGIN;
    env.APP_PASSCODE = 'test-passcode-min-12';
    env.CRON_SECRET = 'test-cron-secret-min-32-chars-0001';
    env.NTFY_TOPIC_URL = 'https://ntfy.sh/test-private-topic-0001';
    delete env.ALLOW_UNAUTHENTICATED;
  });

  it('fails closed (503 SETUP_INCOMPLETE) in production when APP_PASSCODE and ALLOW_UNAUTHENTICATED are unset', async () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = 'production';
    delete env.APP_PASSCODE;
    delete env.ALLOW_UNAUTHENTICATED;

    // Health stays 200
    const healthRes = await healthGet(makeGetRequest('/api/health'));
    expect(healthRes.status).toBe(200);

    const bootRes = await bootstrapGet(makeGetRequest('/api/bootstrap'));
    expect(bootRes.status).toBe(503);
    const bootErr = (await bootRes.json()) as { error: { code: string } };
    expect(bootErr.error.code).toBe('SETUP_INCOMPLETE');

    const unlockRes = await unlockPost(
      makeJsonRequest('/api/unlock', 'POST', { passcode: 'anything' }),
    );
    expect(unlockRes.status).toBe(503);
  });

  it('completes POST /api/unlock -> cookie -> authenticated route -> POST /api/logout -> 401 UNLOCK_REQUIRED round-trip', async () => {
    const unauthBoot = await bootstrapGet(makeGetRequest('/api/bootstrap'));
    expect(unauthBoot.status).toBe(401);
    expect(
      ((await unauthBoot.json()) as { error: { code: string } }).error.code,
    ).toBe('UNLOCK_REQUIRED');

    const unlockRes = await unlockPost(
      makeJsonRequest('/api/unlock', 'POST', {
        passcode: 'test-passcode-min-12',
      }),
    );
    expect(unlockRes.status).toBe(200);
    const setCookie = unlockRes.headers.get('set-cookie');
    expect(setCookie).toContain('mohasba_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=15552000');

    const cookiePair = extractCookiePair(setCookie);

    const authBoot = await bootstrapGet(
      makeGetRequest('/api/bootstrap', { cookie: cookiePair }),
    );
    expect(authBoot.status).toBe(200);

    const logoutRes = await logoutPost(
      makeJsonRequest('/api/logout', 'POST', undefined, {
        cookie: cookiePair,
      }),
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get('set-cookie')).toContain('Max-Age=0');

    // Without cookie after logout -> 401 UNLOCK_REQUIRED
    const afterLogout = await bootstrapGet(makeGetRequest('/api/bootstrap'));
    expect(afterLogout.status).toBe(401);
  });

  it('enforces per-IP 429 lockout after 5 failures without locking a second IP', async () => {
    const ip1 = '203.0.113.10';
    const ip2 = '203.0.113.11';

    for (let i = 0; i < 4; i += 1) {
      const res = await unlockPost(
        makeJsonRequest(
          '/api/unlock',
          'POST',
          { passcode: 'wrong-passcode' },
          { 'cf-connecting-ip': ip1 },
        ),
      );
      expect(res.status).toBe(401);
    }

    // 5th failure triggers 429 lockout for IP 1
    const fifthRes = await unlockPost(
      makeJsonRequest(
        '/api/unlock',
        'POST',
        { passcode: 'wrong-passcode' },
        { 'cf-connecting-ip': ip1 },
      ),
    );
    expect(fifthRes.status).toBe(429);
    expect(fifthRes.headers.get('retry-after')).toBe('60');

    // Even the correct passcode from IP 1 stays locked out during cooldown
    const lockedRes = await unlockPost(
      makeJsonRequest(
        '/api/unlock',
        'POST',
        { passcode: 'test-passcode-min-12' },
        { 'cf-connecting-ip': ip1 },
      ),
    );
    expect(lockedRes.status).toBe(429);

    // 2nd IP is NOT locked out and unlocks cleanly
    const ip2Res = await unlockPost(
      makeJsonRequest(
        '/api/unlock',
        'POST',
        { passcode: 'test-passcode-min-12' },
        { 'cf-connecting-ip': ip2 },
      ),
    );
    expect(ip2Res.status).toBe(200);
  });

  it('rejects cross-origin and invalid Content-Type mutating requests with 403 CSRF_REJECTED', async () => {
    const unlockRes = await unlockPost(
      makeJsonRequest('/api/unlock', 'POST', {
        passcode: 'test-passcode-min-12',
      }),
    );
    const cookiePair = extractCookiePair(unlockRes.headers.get('set-cookie'));

    const crossOriginSync = await syncPost(
      new Request(`${TEST_ORIGIN}/api/sync`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
          cookie: cookiePair,
        },
        body: JSON.stringify({ device_id: crypto.randomUUID(), mutations: [] }),
      }),
    );
    expect(crossOriginSync.status).toBe(403);
    expect(
      ((await crossOriginSync.json()) as { error: { code: string } }).error
        .code,
    ).toBe('CSRF_REJECTED');

    const wrongCtSync = await syncPost(
      new Request(`${TEST_ORIGIN}/api/sync`, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          origin: TEST_ORIGIN,
          cookie: cookiePair,
        },
        body: '{}',
      }),
    );
    expect(wrongCtSync.status).toBe(403);
  });

  it('guards /api/cron/tick (GET 405, unset 503, bad token 401) and runs idempotent anti-flood ntfy dispatch', async () => {
    // GET -> 405
    const getRes = await cronGet(makeGetRequest('/api/cron/tick'));
    expect(getRes.status).toBe(405);

    // Bad token -> 401
    const badCron = await cronPost(
      new Request(`${TEST_ORIGIN}/api/cron/tick`, {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-token' },
      }),
    );
    expect(badCron.status).toBe(401);

    // Unset CRON_SECRET -> 503
    const savedCron = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const unsetCron = await cronPost(
      new Request(`${TEST_ORIGIN}/api/cron/tick`, {
        method: 'POST',
        headers: { authorization: 'Bearer anything' },
      }),
    );
    expect(unsetCron.status).toBe(503);
    process.env.CRON_SECRET = savedCron;

    // Unlock and seed starter pack + enable ntfy_master_enabled
    const unlockRes = await unlockPost(
      makeJsonRequest('/api/unlock', 'POST', {
        passcode: 'test-passcode-min-12',
      }),
    );
    const cookiePair = extractCookiePair(unlockRes.headers.get('set-cookie'));

    await initPost(
      makeJsonRequest(
        '/api/bootstrap/init',
        'POST',
        { mode: 'starter_pack', active_from: '2026-10-01' },
        { cookie: cookiePair },
      ),
    );
    await settingsPatch(
      makeJsonRequest(
        '/api/settings',
        'PATCH',
        {
          ntfy_master_enabled: true,
          quiet_start_hhmm: null,
          quiet_end_hhmm: null,
          backup_reminder_enabled: false,
          digest_enabled: false,
        },
        { cookie: cookiePair },
      ),
    );

    // Valid POST /api/cron/tick executes keep-alive + daily prune
    const liveTickRes = await cronPost(
      new Request(`${TEST_ORIGIN}/api/cron/tick`, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );
    expect(liveTickRes.status).toBe(200);
    const liveTickBody = (await liveTickRes.json()) as {
      ok: boolean;
      pruned: boolean;
    };
    expect(liveTickBody.ok).toBe(true);
    expect(liveTickBody.pruned).toBe(true);

    // Clear any wall-clock dispatches triggered by the live POST above so the injected-clock check is 100% deterministic at any hour
    await admin
      .from('reminder_dispatches')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    // Deterministic ntfy anti-flood + idempotency check via runCronTick with injected `now` & mock fetch
    const { data: settingsRow } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', 1)
      .single();
    const bundle = buildStarterPack('2026-10-01');
    const middayUtc = Date.parse('2026-11-21T11:30:00.000Z');
    const resolved = resolveActiveWindow(middayUtc, bundle.periods, settingsRow);
    const activePeriodWindow =
      resolved.primaryWindow ?? resolved.activeWindows[0]!;
    expect(activePeriodWindow).toBeDefined();

    // Pick instant 10 minutes before window end (inside pre_expiry 25m window!)
    const insideTriggerMs = activePeriodWindow.endInstant - 10 * 60_000;
    const sentRequests: Array<{ url: string; body: string; click?: string }> =
      [];
    const mockFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      sentRequests.push({
        url: String(input),
        body: String(init?.body ?? ''),
        click: headers.get('Click') ?? undefined,
      });
      return new Response('ok', { status: 200 });
    };

    const config = loadRuntimeConfig();

    // First tick inside [triggerInstant, endInstant) -> dispatches 1 reminder with deep link
    const tick1 = await runCronTick(config, admin, {
      now: insideTriggerMs,
      fetchImpl: mockFetch,
    });
    expect(tick1.failed_count).toBe(0);
    expect(tick1.dispatched_count).toBe(1);
    expect(sentRequests).toHaveLength(1);
    expect(sentRequests[0]?.click).toContain(
      `/?period=${activePeriodWindow.periodId}&date=${activePeriodWindow.islamicDate}`,
    );

    // Second tick in the same window -> idempotent cap skips duplicate dispatch!
    const tick2 = await runCronTick(config, admin, {
      now: insideTriggerMs + 60_000,
      fetchImpl: mockFetch,
    });
    expect(tick2.dispatched_count).toBe(0);
    expect(sentRequests).toHaveLength(1);

    // Tick AFTER endInstant (e.g. +20m past expiry) on a different window -> anti-flood bound skips expired window!
    const afterExpiryMs = activePeriodWindow.endInstant + 1000;
    // Clear dispatches to test anti-flood bound purely
    await admin.from('reminder_dispatches').delete().neq('id', STARTER_PACK_PERIOD_IDS.FAJR);
    // Mark all items in the next period done or check that expired period wasn't sent:
    await runCronTick(config, admin, {
      now: afterExpiryMs,
      fetchImpl: mockFetch,
    });
    expect(
      sentRequests
        .slice(1)
        .some((r) => r.click?.includes(`period=${activePeriodWindow.periodId}`)),
    ).toBe(false);
  });

  it('scrubs all secrets and raw user note text from audit_logs, GET /api/audit-logs, and GET /api/export', async () => {
    const scrubbed = sanitizeAuditContext({
      passcode: 'my-secret-passcode',
      cron_secret: 'secret-cron',
      authorization: 'Bearer top-secret-token',
      topic_url: 'https://ntfy.sh/private',
      service_role_key: 'service-role-xyz',
      note: 'ملاحظة خاصة في قيام الليل',
      nested: {
        note: 'nested private note',
        cookie: 'mohasba_session=abc',
      },
      safe_count: 3,
    });

    expect(JSON.stringify(scrubbed)).not.toContain('my-secret-passcode');
    expect(JSON.stringify(scrubbed)).not.toContain('secret-cron');
    expect(JSON.stringify(scrubbed)).not.toContain('top-secret-token');
    expect(JSON.stringify(scrubbed)).not.toContain('https://ntfy.sh/private');
    expect(JSON.stringify(scrubbed)).not.toContain('service-role-xyz');
    expect(JSON.stringify(scrubbed)).not.toContain('ملاحظة خاصة');
    expect(JSON.stringify(scrubbed)).not.toContain('nested private note');
    expect(scrubbed).toMatchObject({
      has_note: true,
      note_length: 'ملاحظة خاصة في قيام الليل'.length,
      safe_count: 3,
    });

    await writeAuditLog(admin, {
      level: 'INFO',
      category: 'SYNC',
      event_name: 'privacy_check',
      summary: 'Testing audit scrubbing',
      context: {
        note: 'شعور خاص بالخشوع',
        authorization: 'Bearer super-secret-jwt',
      },
    });

    const unlockRes = await unlockPost(
      makeJsonRequest('/api/unlock', 'POST', {
        passcode: 'test-passcode-min-12',
      }),
    );
    const cookiePair = extractCookiePair(unlockRes.headers.get('set-cookie'));

    await initPost(
      makeJsonRequest(
        '/api/bootstrap/init',
        'POST',
        { mode: 'starter_pack', active_from: '2026-10-01' },
        { cookie: cookiePair },
      ),
    );

    // Sync a log with personal note
    await syncPost(
      makeJsonRequest(
        '/api/sync',
        'POST',
        {
          device_id: crypto.randomUUID(),
          mutations: [
            {
              mutation_id: crypto.randomUUID(),
              device_id: crypto.randomUUID(),
              parent_mutation_id: null,
              action_id: STARTER_PACK_ACTION_IDS.FAJR_FARD,
              log_date: '2026-11-20',
              base_row_version: null,
              availability_override: null,
              status: 'DONE',
              percent_value: null,
              qadaa_resolved_at: null,
              client_target_version_id: null,
              note: 'تأثر خاص بالدعاء',
              note_updated_at: '2026-11-20T05:00:00.000Z',
              client_updated_at: '2026-11-20T05:00:00.000Z',
            },
          ],
        },
        { cookie: cookiePair },
      ),
    );

    const auditRes = await auditLogsGet(
      makeGetRequest('/api/audit-logs?limit=20', { cookie: cookiePair }),
    );
    expect(auditRes.status).toBe(200);
    const auditText = await auditRes.text();
    expect(auditText).not.toContain('شعور خاص بالخشوع');
    expect(auditText).not.toContain('super-secret-jwt');
    expect(auditText).not.toContain('تأثر خاص بالدعاء');
    expect(auditText).not.toContain('test-passcode-min-12');

    const exportRes = await exportGet(
      makeGetRequest('/api/export', { cookie: cookiePair }),
    );
    expect(exportRes.status).toBe(200);
    const exportText = await exportRes.text();
    expect(exportText).not.toContain('test-passcode-min-12');
    expect(exportText).not.toContain('test-cron-secret-min-32-chars-0001');
    expect(exportText).not.toContain('test-private-topic-0001');
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as auditLogsGet } from '@/app/api/audit-logs/route';
import { GET as bootstrapGet } from '@/app/api/bootstrap/route';
import { POST as initPost } from '@/app/api/bootstrap/init/route';
import { GET as exportGet } from '@/app/api/export/route';
import { POST as importPost } from '@/app/api/import/route';
import { POST as reorderPost } from '@/app/api/schema/reorder/route';
import { PATCH as settingsPatch } from '@/app/api/settings/route';
import { POST as testNtfyPost } from '@/app/api/settings/test-ntfy/route';
import {
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
} from '@/domain/starter-pack';
import type { AppSettings, NtfySource } from '@/domain/types';
import { loadRuntimeConfig } from '@/server/config';
import { runCronTick, sendTestNtfy } from '@/server/services/ntfy-dispatcher';
import {
  enableTestUnauthenticatedMode,
  makeGetRequest,
  makeJsonRequest,
  restoreEnv,
  snapshotEnv,
  type EnvSnapshot,
} from '../helpers/api-test-client';
import { createTestAdminClient, resetTestDb } from '../helpers/reset-test-db';

describe('UX Preferences, Self-Hoster ntfy SSRF/Zero-Leak & Cross-Period Reorder', () => {
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
    enableTestUnauthenticatedMode();
    delete process.env.NTFY_TOPIC_URL;
  });

  it('rejects SSRF ntfy_topic_url payloads with 400 VALIDATION_ERROR', async () => {
    const ssrfCandidates = [
      'http://ntfy.sh/my-topic-1234',
      'https://localhost/my-topic',
      'https://localhost./my-topic',
      'https://127.0.0.1/my-topic',
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:7f00:1]/my-topic',
      'https://[::1]/my-topic',
      'https://postgres/my-topic',
      'https://user:pass@ntfy.sh/my-topic',
      'https://ntfy.sh/my-topic?evil=1',
      'https://ntfy.sh/my-topic#frag',
    ];

    for (const candidate of ssrfCandidates) {
      const res = await settingsPatch(
        makeJsonRequest('/api/settings', 'PATCH', {
          ntfy_topic_url: candidate,
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('saves/masks/clears in-app ntfy_topic_url & ntfy_access_token, dispatches with Bearer + redirect:error, and leaks zero secrets', async () => {
    const secretTopicUrl = 'https://ntfy.sh/mohasba-private-9f2a';
    const secretToken = 'tk_secret+token/xyz==';

    // 1. Save in-app URL & token while env is unset
    const saveRes = await settingsPatch(
      makeJsonRequest('/api/settings', 'PATCH', {
        ntfy_topic_url: secretTopicUrl,
        ntfy_access_token: secretToken,
      }),
    );
    expect(saveRes.status).toBe(200);
    const saveBody = (await saveRes.json()) as {
      settings: AppSettings;
      ntfy_configured: boolean;
      ntfy_source: NtfySource;
      ntfy_topic_hint: string | null;
      ntfy_has_token: boolean;
    };
    expect(saveBody.ntfy_configured).toBe(true);
    expect(saveBody.ntfy_source).toBe('db');
    expect(saveBody.ntfy_topic_hint).toBe('https://ntfy.sh/••••9f2a');
    expect(saveBody.ntfy_has_token).toBe(true);
    expect(JSON.stringify(saveBody)).not.toContain('mohasba-private-9f2a');
    expect(JSON.stringify(saveBody)).not.toContain(secretToken);

    // 2. Subsequent PATCH omitting token keeps existing token intact
    const keepTokenRes = await settingsPatch(
      makeJsonRequest('/api/settings', 'PATCH', {
        ntfy_master_enabled: true,
      }),
    );
    expect(keepTokenRes.status).toBe(200);
    const keepBody = (await keepTokenRes.json()) as {
      ntfy_has_token: boolean;
      ntfy_source: NtfySource;
    };
    expect(keepBody.ntfy_has_token).toBe(true);
    expect(keepBody.ntfy_source).toBe('db');

    // 3. GET /api/bootstrap & GET /api/export NEVER leak raw URL or token
    const bootRes = await bootstrapGet(makeGetRequest('/api/bootstrap'));
    expect(bootRes.status).toBe(200);
    const bootText = await bootRes.text();
    const bootJson = JSON.parse(bootText) as {
      ntfy_configured: boolean;
      ntfy_source: NtfySource;
      ntfy_topic_hint: string | null;
      ntfy_has_token: boolean;
    };
    expect(bootJson.ntfy_configured).toBe(true);
    expect(bootJson.ntfy_source).toBe('db');
    expect(bootJson.ntfy_topic_hint).toBe('https://ntfy.sh/••••9f2a');
    expect(bootJson.ntfy_has_token).toBe(true);
    expect(bootText).not.toContain('mohasba-private-9f2a');
    expect(bootText).not.toContain(secretToken);

    const exportRes = await exportGet(makeGetRequest('/api/export'));
    expect(exportRes.status).toBe(200);
    const exportText = await exportRes.text();
    expect(exportText).not.toContain('mohasba-private-9f2a');
    expect(exportText).not.toContain(secretToken);

    // 4. POST /api/import with smuggled ntfy secrets strips them without modifying DB secrets
    const importRes = await importPost(
      makeJsonRequest('/api/import', 'POST', {
        schema_version: 1,
        settings: {
          city_name: 'Alexandria',
          ntfy_topic_url: 'http://127.0.0.1/evil',
          ntfy_access_token: 'hijacked-token',
        },
      }),
    );
    expect(importRes.status).toBe(200);

    // 5. sendTestNtfy uses DB URL + Bearer token + redirect: 'error'
    const calls: Array<{
      url: string;
      auth: string | null;
      redirect: RequestRedirect | undefined;
    }> = [];
    const config = loadRuntimeConfig();
    const testResult = await sendTestNtfy(config, admin, async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        auth: headers.get('Authorization'),
        redirect: init?.redirect,
      });
      return new Response('ok', { status: 200 });
    });
    expect(testResult).toEqual({ ok: true, status: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: secretTopicUrl,
      auth: `Bearer ${secretToken}`,
      redirect: 'error',
    });

    // 6. Simulated failed cron dispatch scrubs effectiveUrl & token from reminder_dispatches & audit_logs
    await settingsPatch(
      makeJsonRequest('/api/settings', 'PATCH', {
        backup_reminder_enabled: true,
        quiet_start_hhmm: null,
        quiet_end_hhmm: null,
      }),
    );
    const cronSummary = await runCronTick(config, admin, {
      now: Date.parse('2026-11-25T10:00:00.000Z'),
      fetchImpl: async () => {
        throw new Error(
          `request to ${secretTopicUrl} failed with Bearer ${secretToken}`,
        );
      },
    });
    expect(cronSummary.failed_count).toBe(1);

    const { data: dispatches } = await admin
      .from('reminder_dispatches')
      .select('error_message');
    const dispatchesText = JSON.stringify(dispatches ?? []);
    expect(dispatchesText).not.toContain('mohasba-private-9f2a');
    expect(dispatchesText).not.toContain(secretToken);
    expect(dispatchesText).toContain('https://ntfy.sh/••••9f2a');

    const auditRes = await auditLogsGet(
      makeGetRequest('/api/audit-logs?limit=20'),
    );
    expect(auditRes.status).toBe(200);
    const auditText = await auditRes.text();
    expect(auditText).not.toContain('mohasba-private-9f2a');
    expect(auditText).not.toContain(secretToken);

    // 7. Clear DB override & token -> falls back to env when env is set, or none when unset
    process.env.NTFY_TOPIC_URL = 'https://ntfy.sh/env-fallback-4455';
    const clearRes = await settingsPatch(
      makeJsonRequest('/api/settings', 'PATCH', {
        ntfy_topic_url: '',
        ntfy_access_token: '',
      }),
    );
    expect(clearRes.status).toBe(200);
    const clearBody = (await clearRes.json()) as {
      ntfy_configured: boolean;
      ntfy_source: NtfySource;
      ntfy_topic_hint: string | null;
      ntfy_has_token: boolean;
    };
    expect(clearBody.ntfy_configured).toBe(true);
    expect(clearBody.ntfy_source).toBe('env');
    expect(clearBody.ntfy_topic_hint).toBe('https://ntfy.sh/••••4455');
    expect(clearBody.ntfy_has_token).toBe(false);

    // Route POST /api/settings/test-ntfy returns 400 NTFY_NOT_CONFIGURED when both DB and env are unset
    delete process.env.NTFY_TOPIC_URL;
    const unconfiguredTestRes = await testNtfyPost(
      makeJsonRequest('/api/settings/test-ntfy', 'POST', {}),
    );
    expect(unconfiguredTestRes.status).toBe(400);
    const unconfiguredBody = (await unconfiguredTestRes.json()) as {
      error: { code: string };
    };
    expect(unconfiguredBody.error.code).toBe('NTFY_NOT_CONFIGURED');
  });

  it('round-trips the 4 UX preferences and rejects duplicate keyboard shortcut chords', async () => {
    const dupRes = await settingsPatch(
      makeJsonRequest('/api/settings', 'PATCH', {
        keyboard_shortcuts: {
          nav_now: { code: 'KeyK', alt: true },
          nav_week: { code: 'KeyK', alt: true },
        },
      }),
    );
    expect(dupRes.status).toBe(400);
    const dupBody = (await dupRes.json()) as { error: { code: string } };
    expect(dupBody.error.code).toBe('VALIDATION_ERROR');

    const patchRes = await settingsPatch(
      makeJsonRequest('/api/settings', 'PATCH', {
        show_catchup_banner: false,
        default_home_view: 'week',
        default_week_mode: 'one_glance',
        keyboard_shortcuts: {
          toggle_sidebar: { code: 'KeyB', ctrl: true },
          nav_week: { code: 'Digit9', alt: true },
        },
      }),
    );
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { settings: AppSettings };
    expect(patchBody.settings.show_catchup_banner).toBe(false);
    expect(patchBody.settings.default_home_view).toBe('week');
    expect(patchBody.settings.default_week_mode).toBe('one_glance');
    expect(patchBody.settings.keyboard_shortcuts).toEqual({
      toggle_sidebar: { code: 'KeyB', ctrl: true },
      nav_week: { code: 'Digit9', alt: true },
    });

    const bootRes = await bootstrapGet(makeGetRequest('/api/bootstrap'));
    const bootBody = (await bootRes.json()) as { settings: AppSettings };
    expect(bootBody.settings.show_catchup_banner).toBe(false);
    expect(bootBody.settings.default_home_view).toBe('week');
    expect(bootBody.settings.default_week_mode).toBe('one_glance');
    expect(bootBody.settings.keyboard_shortcuts).toEqual({
      toggle_sidebar: { code: 'KeyB', ctrl: true },
      nav_week: { code: 'Digit9', alt: true },
    });

    const exportRes = await exportGet(makeGetRequest('/api/export'));
    const exportBody = (await exportRes.json()) as { settings: AppSettings };
    expect(exportBody.settings.show_catchup_banner).toBe(false);
    expect(exportBody.settings.default_home_view).toBe('week');
    expect(exportBody.settings.default_week_mode).toBe('one_glance');
    expect(exportBody.settings.keyboard_shortcuts).toEqual({
      toggle_sidebar: { code: 'KeyB', ctrl: true },
      nav_week: { code: 'Digit9', alt: true },
    });
  });

  it('auto-clears bound_time_period_id when cross-period reorder moves a bound action into a TIME_BOUND period', async () => {
    await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'starter_pack',
        active_from: '2026-10-01',
      }),
    );

    // HABIT_NO_SNOOZE starts in GROUP_DAILY_HABITS with bound_time_period_id = FAJR
    const { data: beforeRow } = await admin
      .from('actions')
      .select('period_id, bound_time_period_id')
      .eq('id', STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE)
      .single();
    expect(beforeRow?.period_id).toBe(
      STARTER_PACK_PERIOD_IDS.GROUP_DAILY_HABITS,
    );
    expect(beforeRow?.bound_time_period_id).toBe(STARTER_PACK_PERIOD_IDS.FAJR);

    // Duplicate item.id -> 400
    const dupReorderRes = await reorderPost(
      makeJsonRequest('/api/schema/reorder', 'POST', {
        target: 'actions',
        items: [
          { id: STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE, sort_order: 1 },
          { id: STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE, sort_order: 2 },
        ],
      }),
    );
    expect(dupReorderRes.status).toBe(400);

    // Non-existent period_id -> 400
    const badPeriodRes = await reorderPost(
      makeJsonRequest('/api/schema/reorder', 'POST', {
        target: 'actions',
        items: [
          {
            id: STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE,
            sort_order: 1,
            period_id: '99999999-9999-4999-8999-999999999999',
          },
        ],
      }),
    );
    expect(badPeriodRes.status).toBe(400);

    // Move HABIT_NO_SNOOZE into TIME_BOUND FAJR period via reorder -> clears bound_time_period_id!
    const moveRes = await reorderPost(
      makeJsonRequest('/api/schema/reorder', 'POST', {
        target: 'actions',
        items: [
          {
            id: STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE,
            sort_order: 5,
            period_id: STARTER_PACK_PERIOD_IDS.FAJR,
          },
        ],
      }),
    );
    expect(moveRes.status).toBe(200);
    expect(await moveRes.json()).toEqual({ updated_count: 1, failed_ids: [] });

    const { data: afterRow } = await admin
      .from('actions')
      .select('period_id, bound_time_period_id, sort_order')
      .eq('id', STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE)
      .single();
    expect(afterRow).toEqual({
      period_id: STARTER_PACK_PERIOD_IDS.FAJR,
      bound_time_period_id: null,
      sort_order: 5,
    });
  });
});

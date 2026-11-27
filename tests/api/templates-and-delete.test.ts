import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DELETE as actionDelete,
} from '@/app/api/actions/[id]/route';
import { POST as initPost } from '@/app/api/bootstrap/init/route';
import { POST as periodsPost } from '@/app/api/periods/route';
import {
  DELETE as periodDelete,
} from '@/app/api/periods/[id]/route';
import { POST as syncPost } from '@/app/api/sync/route';
import { buildTemplateBundle } from '@/domain/templates';
import {
  enableTestUnauthenticatedMode,
  makeJsonRequest,
  restoreEnv,
  snapshotEnv,
  type EnvSnapshot,
} from '../helpers/api-test-client';
import { createTestAdminClient, resetTestDb } from '../helpers/reset-test-db';

describe('3-Level Template Onboarding & Smart 2-Tier Permanent Delete (Live DB)', () => {
  const admin = createTestAdminClient();
  let envSnap: EnvSnapshot;

  beforeAll(() => {
    envSnap = snapshotEnv();
    enableTestUnauthenticatedMode();
  });

  afterAll(async () => {
    await resetTestDb();
    restoreEnv(envSnap);
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  it('rejects SSRF ntfy_topic_url during template init BEFORE seeding any rows', async () => {
    const res = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'template',
        level: 'level_1',
        settings_patch: {
          ntfy_master_enabled: true,
          ntfy_topic_url: 'http://127.0.0.1:8080/internal',
        },
      }),
    );

    expect(res.status).toBe(400);
    const { count: periodCount } = await admin
      .from('periods')
      .select('id', { count: 'exact', head: true });
    expect(periodCount).toBe(0);
    const { data: settingsRow } = await admin
      .from('app_settings')
      .select('onboarding_completed')
      .eq('id', 1)
      .single();
    expect(settingsRow?.onboarding_completed).toBe(false);
  });

  it('seeds customized Level 1 with excluded period, excluded action, custom action, city & global ntfy', async () => {
    const base = buildTemplateBundle('level_1', '2026-11-01');
    const fastingPeriod = base.periods.find((p) => p.title === 'الصيام')!;
    const fajrPeriod = base.periods.find((p) => p.title === 'الفجر')!;
    const nightPeriod = base.periods.find((p) => p.title === 'الليل')!;
    const excludedAction = base.actions.find(
      (a) => a.title === 'أذكار بعد صلاة الظهر',
    )!;

    const res = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'template',
        level: 'level_1',
        active_from: '2026-11-01',
        excluded_period_ids: [fastingPeriod.id, fajrPeriod.id],
        excluded_action_ids: [excludedAction.id],
        custom_actions: [{ period_id: nightPeriod.id, title: 'صلاة التوبة' }],
        ntfy_all_periods_enabled: false,
        settings_patch: {
          city_name: 'مكة المكرمة',
          iana_timezone: 'Asia/Riyadh',
          latitude: 21.4225,
          longitude: 39.8262,
          calc_method: 'UmmAlQura',
          ntfy_master_enabled: false,
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      level: string;
      settings: { city_name: string; onboarding_completed: boolean; ntfy_master_enabled: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.level).toBe('level_1');
    expect(body.settings.onboarding_completed).toBe(true);
    expect(body.settings.city_name).toBe('مكة المكرمة');
    expect(body.settings.ntfy_master_enabled).toBe(false);

    const { data: periods } = await admin.from('periods').select('*');
    const { data: actions } = await admin.from('actions').select('*');

    expect(periods?.length).toBe(base.periods.length - 2);
    expect(
      periods
        ?.filter((p) => p.side === 'TIME_BOUND')
        .every((p) => p.ntfy_enabled === false),
    ).toBe(true);
    expect(actions?.some((a) => a.title === 'صلاة التوبة')).toBe(true);
    expect(actions?.some((a) => a.id === excludedAction.id)).toBe(false);
    // Bound action whose target Fajr was excluded was nulled safely
    const wakeAction = actions?.find((a) => a.title === 'أذكار الاستيقاظ');
    expect(wakeAction?.bound_time_period_id).toBeNull();
  });

  it('seeds full Level 2 (61 actions) and Level 3 (118 actions) cleanly against live DB', async () => {
    const l2Res = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'template',
        level: 'level_2',
        active_from: '2026-11-01',
      }),
    );
    expect(l2Res.status).toBe(200);
    const { count: l2Actions } = await admin
      .from('actions')
      .select('id', { count: 'exact', head: true });
    expect(l2Actions).toBe(buildTemplateBundle('level_2').actions.length);

    await resetTestDb();

    const l3Res = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'template',
        level: 'level_3',
        active_from: '2026-11-01',
      }),
    );
    expect(l3Res.status).toBe(200);
    const { count: l3Actions } = await admin
      .from('actions')
      .select('id', { count: 'exact', head: true });
    expect(l3Actions).toBe(buildTemplateBundle('level_3').actions.length);
  });

  it('enforces smart 2-tier permanent delete for actions and periods (instant when 0 logs, 409 guard with counts when logged/children, force cascade)', async () => {
    const initRes = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'template',
        level: 'level_1',
        active_from: '2026-11-01',
      }),
    );
    expect(initRes.status).toBe(200);

    const base = buildTemplateBundle('level_1', '2026-11-01');
    const quranReadAction = base.actions.find((a) => a.title === 'قراءة القرآن')!;
    const fajrAction = base.actions.find((a) => a.title === 'الجماعة الأولى (الفجر)')!;
    const fajrPeriod = base.periods.find((p) => p.title === 'الفجر')!;
    const fastingPeriod = base.periods.find((p) => p.title === 'الصيام')!;

    // 1. Delete unlogged action (even with a target_version!) -> instant 200 OK
    const delUnloggedRes = await actionDelete(
      makeJsonRequest(`/api/actions/${quranReadAction.id}`, 'DELETE'),
      { params: Promise.resolve({ id: quranReadAction.id }) },
    );
    expect(delUnloggedRes.status).toBe(200);
    const { data: quranStillThere } = await admin
      .from('actions')
      .select('id')
      .eq('id', quranReadAction.id)
      .maybeSingle();
    expect(quranStillThere).toBeNull();

    // 2. Log 2 days on fajrAction -> delete without force returns 409 HAS_HISTORY with log_count=2
    const deviceId = 'aaaaaaaa-0000-4000-8000-000000000099';
    const syncRes = await syncPost(
      makeJsonRequest('/api/sync', 'POST', {
        device_id: deviceId,
        mutations: [
          {
            mutation_id: '55000000-0000-4000-8000-000000000001',
            device_id: deviceId,
            parent_mutation_id: null,
            action_id: fajrAction.id,
            log_date: '2026-11-20',
            base_row_version: null,
            availability_override: null,
            status: 'DONE',
            percent_value: null,
            qadaa_resolved_at: null,
            client_target_version_id: null,
            note: null,
            note_updated_at: null,
            client_updated_at: '2026-11-20T06:00:00.000Z',
          },
          {
            mutation_id: '55000000-0000-4000-8000-000000000002',
            device_id: deviceId,
            parent_mutation_id: null,
            action_id: fajrAction.id,
            log_date: '2026-11-21',
            base_row_version: null,
            availability_override: null,
            status: 'DONE',
            percent_value: null,
            qadaa_resolved_at: null,
            client_target_version_id: null,
            note: null,
            note_updated_at: null,
            client_updated_at: '2026-11-21T06:00:00.000Z',
          },
        ],
      }),
    );
    expect(syncRes.status).toBe(200);

    const blockedActionDel = await actionDelete(
      makeJsonRequest(`/api/actions/${fajrAction.id}`, 'DELETE'),
      { params: Promise.resolve({ id: fajrAction.id }) },
    );
    expect(blockedActionDel.status).toBe(409);
    const blockedActionJson = (await blockedActionDel.json()) as {
      error: { code: string; details: { log_count: number } };
    };
    expect(blockedActionJson.error.code).toBe('HAS_HISTORY');
    expect(blockedActionJson.error.details.log_count).toBe(2);

    // 3. Period containing logged fajrAction without force -> 409 HAS_HISTORY with action_count & log_count
    const blockedPeriodDel = await periodDelete(
      makeJsonRequest(`/api/periods/${fajrPeriod.id}`, 'DELETE'),
      { params: Promise.resolve({ id: fajrPeriod.id }) },
    );
    expect(blockedPeriodDel.status).toBe(409);
    const blockedPeriodJson = (await blockedPeriodDel.json()) as {
      error: { code: string; details: { action_count: number; log_count: number } };
    };
    expect(blockedPeriodJson.error.code).toBe('HAS_HISTORY');
    expect(blockedPeriodJson.error.details.action_count).toBe(3);
    expect(blockedPeriodJson.error.details.log_count).toBe(2);

    // 4. Force delete logged period -> deletes logs, child actions, and period cleanly + nulls bound_time_period_id
    const forcePeriodDel = await periodDelete(
      makeJsonRequest(`/api/periods/${fajrPeriod.id}?force=true`, 'DELETE'),
      { params: Promise.resolve({ id: fajrPeriod.id }) },
    );
    expect(forcePeriodDel.status).toBe(200);
    const forcePeriodJson = (await forcePeriodDel.json()) as {
      ok: boolean;
      deleted_actions_count: number;
      deleted_logs_count: number;
    };
    expect(forcePeriodJson.deleted_actions_count).toBe(3);
    expect(forcePeriodJson.deleted_logs_count).toBe(2);

    const { data: wakeAfterPeriodDel } = await admin
      .from('actions')
      .select('bound_time_period_id')
      .eq('title', 'أذكار الاستيقاظ')
      .single();
    expect(wakeAfterPeriodDel?.bound_time_period_id).toBeNull();

    // 5. Period with unlogged children -> 409 HAS_CHILDREN without force, 200 with force
    const unloggedPeriodDel = await periodDelete(
      makeJsonRequest(`/api/periods/${fastingPeriod.id}`, 'DELETE'),
      { params: Promise.resolve({ id: fastingPeriod.id }) },
    );
    expect(unloggedPeriodDel.status).toBe(409);
    const unloggedPeriodJson = (await unloggedPeriodDel.json()) as {
      error: { code: string; details: { action_count: number; log_count: number } };
    };
    expect(unloggedPeriodJson.error.code).toBe('HAS_CHILDREN');
    expect(unloggedPeriodJson.error.details.action_count).toBe(1);
    expect(unloggedPeriodJson.error.details.log_count).toBe(0);

    const forceUnloggedPeriodDel = await periodDelete(
      makeJsonRequest(`/api/periods/${fastingPeriod.id}?force=true`, 'DELETE'),
      { params: Promise.resolve({ id: fastingPeriod.id }) },
    );
    expect(forceUnloggedPeriodDel.status).toBe(200);

    // 6. Empty period (0 actions, 0 logs) -> instant 200 OK without force
    const createdEmptyRes = await periodsPost(
      makeJsonRequest('/api/periods', 'POST', {
        title: 'مجموعة فارغة للحذف الفوري',
        side: 'DAILY_GROUP',
        sort_order: 200,
      }),
    );
    expect(createdEmptyRes.status).toBe(201);
    const { period: emptyPeriod } = (await createdEmptyRes.json()) as {
      period: { id: string };
    };

    const instantEmptyDel = await periodDelete(
      makeJsonRequest(`/api/periods/${emptyPeriod.id}`, 'DELETE'),
      { params: Promise.resolve({ id: emptyPeriod.id }) },
    );
    expect(instantEmptyDel.status).toBe(200);

    // 7. Malformed non-empty JSON body on DELETE returns 400 instead of silently deleting
    const malformedReq = new Request(
      `http://127.0.0.1:3000/api/periods/${emptyPeriod.id}`,
      {
        method: 'DELETE',
        headers: {
          Origin: 'http://127.0.0.1:3000',
          'X-Requested-With': 'fetch',
        },
        body: '{not-json',
      },
    );
    const malformedRes = await periodDelete(malformedReq, {
      params: Promise.resolve({ id: emptyPeriod.id }),
    });
    expect(malformedRes.status).toBe(400);
  });

  it('rejects invalid calendar active_from, unknown custom_actions.period_id, and 0-action template BEFORE mutating settings', async () => {
    const badDateRes = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'template',
        level: 'level_1',
        active_from: '2026-02-31',
        settings_patch: { city_name: 'جدة' },
      }),
    );
    expect(badDateRes.status).toBe(400);

    const badCustomRes = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'template',
        level: 'level_1',
        custom_actions: [
          {
            period_id: '99999999-0000-4000-8000-000000000099',
            title: 'عمل يتيم',
          },
        ],
        settings_patch: { city_name: 'جدة' },
      }),
    );
    expect(badCustomRes.status).toBe(400);

    const base = buildTemplateBundle('level_1');
    const emptyTemplateRes = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'template',
        level: 'level_1',
        excluded_period_ids: base.periods.map((p) => p.id),
      }),
    );
    expect(emptyTemplateRes.status).toBe(400);

    const { data: settingsRow } = await admin
      .from('app_settings')
      .select('city_name, onboarding_completed')
      .eq('id', 1)
      .single();
    expect(settingsRow?.city_name).not.toBe('جدة');
    expect(settingsRow?.onboarding_completed).toBe(false);
  });
});

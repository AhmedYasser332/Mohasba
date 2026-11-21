import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as actionsPost } from '@/app/api/actions/route';
import { POST as initPost } from '@/app/api/bootstrap/init/route';
import { GET as exportGet } from '@/app/api/export/route';
import { POST as importPost } from '@/app/api/import/route';
import { POST as periodsPost } from '@/app/api/periods/route';
import { POST as targetVersionsPost } from '@/app/api/target-versions/route';
import { PATCH as targetVersionPatch } from '@/app/api/target-versions/[id]/route';
import { POST as unlockPost } from '@/app/api/unlock/route';
import {
  addDaysIso,
  getIsoDayOfWeek,
  resolveIslamicDate,
} from '@/domain/prayer-engine';
import { getOpenQadaaQueue } from '@/domain/qadaa';
import {
  buildStarterPack,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_TARGET_IDS,
} from '@/domain/starter-pack';
import type { Action, DailyLog, ExportSnapshot, Period, TargetVersion } from '@/domain/types';
import {
  normalizeActionRow,
  normalizeAppSettingsRow,
  normalizePeriodRow,
  normalizeTargetVersionRow,
} from '@/server/db/normalizers';
import { fetchAllDailyLogsKeyset } from '@/server/db/pagination';
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

describe('Stage 8: >1,250-Row Full JSON Export -> Wipe -> Chunked Import Parity Restore Drill', () => {
  const admin = createTestAdminClient();
  let envSnap: EnvSnapshot;
  let sessionCookie = '';

  const SECRET_PASSCODE = 'stage8-secret-passcode-999';
  const SECRET_CRON = 'stage8-super-secret-cron-token-999';
  const SECRET_NTFY = 'https://ntfy.sh/stage8-super-secret-topic-999';

  beforeAll(async () => {
    envSnap = snapshotEnv();
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = 'test';
    env.APP_URL = TEST_ORIGIN;
    env.APP_PASSCODE = SECRET_PASSCODE;
    env.CRON_SECRET = SECRET_CRON;
    env.NTFY_TOPIC_URL = SECRET_NTFY;
    delete env.ALLOW_UNAUTHENTICATED;

    await resetTestDb();

    const unlockRes = await unlockPost(
      makeJsonRequest('/api/unlock', 'POST', { passcode: SECRET_PASSCODE }),
    );
    expect(unlockRes.status).toBe(200);
    sessionCookie = extractCookiePair(unlockRes.headers.get('set-cookie'));
  });

  afterAll(async () => {
    await resetTestDb();
    restoreEnv(envSnap);
  });

  it('exports 1,260 rich daily_logs + custom period/action + upgraded target, wipes mohasba-test, restores via chunked import with 100% parity', async () => {
    // 1. Initialize Starter Pack active since 2026-07-01 so >120d history is valid
    const initRes = await initPost(
      makeJsonRequest(
        '/api/bootstrap/init',
        'POST',
        {
          mode: 'starter_pack',
          active_from: '2026-07-01',
        },
        { cookie: sessionCookie },
      ),
    );
    expect(initRes.status).toBe(200);

    // Align Quran Wird v1 effective_from to 2026-08-01 ("10 صفحات" on 2026-08-01)
    const patchTvRes = await targetVersionPatch(
      makeJsonRequest(
        `/api/target-versions/${STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1}`,
        'PATCH',
        { effective_from: '2026-08-01' },
        { cookie: sessionCookie },
      ),
      { params: Promise.resolve({ id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1 }) },
    );
    expect(patchTvRes.status).toBe(200);

    // Upgrade Quran Wird target: "20 صفحة" on 2026-11-01
    const upgradeTvRes = await targetVersionsPost(
      makeJsonRequest(
        '/api/target-versions',
        'POST',
        {
          action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
          effective_from: '2026-11-01',
          target_label: '20 صفحة',
          target_value: 20,
          target_unit: 'صفحة',
          direction: 'level_up',
        },
        { cookie: sessionCookie },
      ),
    );
    expect(upgradeTvRes.status).toBe(201);
    const upgradeTvBody = (await upgradeTvRes.json()) as {
      target_version: TargetVersion;
    };
    const quranV2Id = upgradeTvBody.target_version.id;

    // 2. Add 1 custom DAILY_GROUP period + 1 custom action
    const customPeriodRes = await periodsPost(
      makeJsonRequest(
        '/api/periods',
        'POST',
        {
          title: 'مراجعة العلم الشرعي',
          side: 'DAILY_GROUP',
          sort_order: 105,
          ntfy_enabled: false,
          ntfy_mode: null,
          active_from: '2026-07-01',
        },
        { cookie: sessionCookie },
      ),
    );
    expect(customPeriodRes.status).toBe(201);
    const customPeriod = (
      (await customPeriodRes.json()) as { period: Period }
    ).period;

    const customActionRes = await actionsPost(
      makeJsonRequest(
        '/api/actions',
        'POST',
        {
          period_id: customPeriod.id,
          title: 'مذاكرة الفقه 30 دقيقة',
          sort_order: 1,
          is_mosque_action: false,
          is_qadaa_eligible: true,
          supports_percentage: true,
          include_in_normal_day_preset: true,
          analytics_role: 'standard',
          default_disabled_days: [],
          active_from: '2026-07-01',
        },
        { cookie: sessionCookie },
      ),
    );
    expect(customActionRes.status).toBe(201);
    const customAction = (
      (await customActionRes.json()) as { action: Action }
    ).action;

    // 3. Seed exact 1,260 daily_logs spanning >120 days
    const { data: settingsRow } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', 1)
      .single();
    const todayIslamic = resolveIslamicDate(Date.now(), settingsRow);

    const starterBundle = buildStarterPack('2026-07-01');
    const poolActions: Action[] = [
      ...starterBundle.actions.slice(0, 9),
      customAction,
    ]; // 10 actions x 126 days = 1,260 daily_logs spanning 126 days (>120d)!
    expect(poolActions).toHaveLength(10);

    const seedRows: Array<Record<string, unknown>> = [];
    const baseUpdatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    for (let dayOffset = 0; dayOffset < 126; dayOffset += 1) {
      const logDate = addDaysIso(todayIslamic, -dayOffset);
      const dow = getIsoDayOfWeek(logDate);
      for (let idx = 0; idx < poolActions.length; idx += 1) {
        const actionObj = poolActions[idx]!;
        const actionId = actionObj.id;
        let availabilityOverride: 'ENABLED' | 'DISABLED' | null =
          actionObj.default_disabled_days.includes(dow) ? 'ENABLED' : null;
        let status: 'DONE' | 'MISSED' | 'QADAA_DONE' | 'PERCENT' | null = 'DONE';
        let percentValue: number | null = null;
        let qadaaResolvedAt: string | null = null;
        const targetVersionId: string | null = null;
        let note: string | null = null;
        let noteUpdatedAt: string | null = null;

        if (dayOffset >= 95 && dayOffset <= 104 && idx === 0) {
          status = 'MISSED';
          note = `قضاء قديم يوم ${logDate}`;
          noteUpdatedAt = baseUpdatedAt;
        } else if (dayOffset % 15 === 0 && idx === 2) {
          // idx === 2 is FAJR_SUNNAH (is_qadaa_eligible: true)
          status = 'QADAA_DONE';
          qadaaResolvedAt = baseUpdatedAt;
          note = `تم القضاء في ${logDate}`;
          noteUpdatedAt = baseUpdatedAt;
        } else if (dayOffset % 7 === 0 && actionId === customAction.id) {
          status = 'PERCENT';
          percentValue = 50;
          note = 'نصف المذاكرة';
          noteUpdatedAt = baseUpdatedAt;
        } else if (dayOffset % 19 === 0 && idx === 3) {
          availabilityOverride = 'DISABLED';
          status = null;
          note = 'يوم معذور';
          noteUpdatedAt = baseUpdatedAt;
        }

        seedRows.push({
          action_id: actionId,
          log_date: logDate,
          availability_override: availabilityOverride,
          status,
          percent_value: percentValue,
          qadaa_resolved_at: qadaaResolvedAt,
          target_version_id: targetVersionId,
          note,
          note_updated_at: noteUpdatedAt,
          row_version: 1,
          client_updated_at: baseUpdatedAt,
          updated_at: baseUpdatedAt,
        });
      }
    }

    // Replace 12 entries in seedRows with explicit QURAN_WIRD rows (6 >90d open Qadaa referencing V1 "10 صفحات", 6 recent referencing V2 "20 صفحة")
    // while keeping total row count strictly equal to 1,260!
    // Wait: QURAN_WIRD is not in starterBundle.actions.slice(0, 9), so replacing action_id for 12 rows (at distinct dayOffsets) keeps primary key unique & total = 1,260!
    const quranOldDates = [95, 96, 97, 98, 99, 100].map((d) =>
      addDaysIso(todayIslamic, -d),
    );
    const quranNewDates = [1, 2, 3, 4, 5, 6].map((d) =>
      addDaysIso(todayIslamic, -d),
    );

    let oldReplaced = 0;
    let newReplaced = 0;
    for (let i = 0; i < seedRows.length; i += 1) {
      const row = seedRows[i]!;
      if (
        row.action_id === poolActions[8]!.id &&
        quranOldDates.includes(String(row.log_date))
      ) {
        seedRows[i] = {
          action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
          log_date: row.log_date,
          availability_override: null,
          status: 'MISSED',
          percent_value: null,
          qadaa_resolved_at: null,
          target_version_id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
          note: `ورد قديم 10 صفحات (${String(row.log_date)})`,
          note_updated_at: baseUpdatedAt,
          row_version: 1,
          client_updated_at: baseUpdatedAt,
          updated_at: baseUpdatedAt,
        };
        oldReplaced += 1;
      } else if (
        row.action_id === poolActions[8]!.id &&
        quranNewDates.includes(String(row.log_date))
      ) {
        seedRows[i] = {
          action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
          log_date: row.log_date,
          availability_override: null,
          status: newReplaced % 2 === 0 ? 'PERCENT' : 'DONE',
          percent_value: newReplaced % 2 === 0 ? 50 : null,
          qadaa_resolved_at: null,
          target_version_id: quranV2Id,
          note: `ورد جديد 20 صفحة (${String(row.log_date)})`,
          note_updated_at: baseUpdatedAt,
          row_version: 1,
          client_updated_at: baseUpdatedAt,
          updated_at: baseUpdatedAt,
        };
        newReplaced += 1;
      }
    }
    expect(oldReplaced).toBe(6);
    expect(newReplaced).toBe(6);
    expect(seedRows).toHaveLength(1260);

    for (let i = 0; i < seedRows.length; i += 400) {
      const { error } = await admin
        .from('daily_logs')
        .insert(seedRows.slice(i, i + 400));
      expect(error).toBeNull();
    }

    // 4. Live GET /api/export -> assert counts.daily_logs === 1260 and zero secrets
    const exportRes = await exportGet(
      makeGetRequest('/api/export', { cookie: sessionCookie }),
    );
    expect(exportRes.status).toBe(200);
    const exportText = await exportRes.text();

    expect(exportText).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    expect(exportText).not.toContain(SECRET_CRON);
    expect(exportText).not.toContain(SECRET_PASSCODE);
    expect(exportText).not.toContain(SECRET_NTFY);

    const snapshot = JSON.parse(exportText) as ExportSnapshot;
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.counts?.daily_logs).toBe(1260);
    expect(snapshot.daily_logs).toHaveLength(1260);

    const originalOpenQadaa = getOpenQadaaQueue({
      actions: snapshot.actions,
      periods: snapshot.periods,
      targetVersions: snapshot.target_versions,
      logs: snapshot.daily_logs,
      todayIslamicDate: todayIslamic,
    });
    expect(originalOpenQadaa.length).toBeGreaterThanOrEqual(16);

    // 5. Wipe mohasba-test via resetTestDb() -> verify 0 rows across schema & logs
    await resetTestDb();

    const [pCount, aCount, tvCount, dlCount] = await Promise.all([
      admin.from('periods').select('*', { count: 'exact', head: true }),
      admin.from('actions').select('*', { count: 'exact', head: true }),
      admin.from('target_versions').select('*', { count: 'exact', head: true }),
      admin.from('daily_logs').select('*', { count: 'exact', head: true }),
    ]);
    expect(pCount.count).toBe(0);
    expect(aCount.count).toBe(0);
    expect(tvCount.count).toBe(0);
    expect(dlCount.count).toBe(0);

    // 6. Replay full snapshot via chunked POST /api/import (<= 200 logs/chunk)
    const metaChunkRes = await importPost(
      makeJsonRequest(
        '/api/import',
        'POST',
        {
          schema_version: 1,
          settings: snapshot.settings,
          periods: snapshot.periods,
          actions: snapshot.actions,
          target_versions: snapshot.target_versions,
          daily_logs: [],
        },
        { cookie: sessionCookie },
      ),
    );
    expect(metaChunkRes.status).toBe(200);

    for (let i = 0; i < snapshot.daily_logs.length; i += 200) {
      const chunkLogs = snapshot.daily_logs.slice(i, i + 200);
      expect(chunkLogs.length).toBeLessThanOrEqual(200);
      const chunkRes = await importPost(
        makeJsonRequest(
          '/api/import',
          'POST',
          {
            schema_version: 1,
            daily_logs: chunkLogs,
          },
          { cookie: sessionCookie },
        ),
      );
      expect(chunkRes.status).toBe(200);
    }

    // 7. Assert 100% exact parity across app_settings, periods, actions, target_versions, all 1,260 daily_logs, and open Qadaa count
    const [
      restoredSettingsRes,
      restoredPeriodsRes,
      restoredActionsRes,
      restoredTvsRes,
      restoredLogs,
    ] = await Promise.all([
      admin.from('app_settings').select('*').eq('id', 1).single(),
      admin
        .from('periods')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true }),
      admin
        .from('actions')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true }),
      admin
        .from('target_versions')
        .select('*')
        .order('effective_from', { ascending: true })
        .order('id', { ascending: true }),
      fetchAllDailyLogsKeyset(admin),
    ]);

    expect(restoredSettingsRes.error).toBeNull();
    const restoredSettings = normalizeAppSettingsRow(
      restoredSettingsRes.data as Record<string, unknown>,
    );
    const {
      created_at: _sc1,
      updated_at: _su1,
      ...expectedSettingsCore
    } = snapshot.settings;
    const {
      created_at: _sc2,
      updated_at: _su2,
      ...restoredSettingsCore
    } = restoredSettings;
    void _sc1;
    void _su1;
    void _sc2;
    void _su2;
    expect(restoredSettingsCore).toEqual(expectedSettingsCore);

    const restoredPeriods = (restoredPeriodsRes.data ?? []).map((r) =>
      normalizePeriodRow(r as Record<string, unknown>),
    );
    expect(restoredPeriods).toHaveLength(snapshot.periods.length);
    for (let i = 0; i < snapshot.periods.length; i += 1) {
      const { created_at: _c1, updated_at: _u1, ...expP } = snapshot.periods[i]!;
      const { created_at: _c2, updated_at: _u2, ...actP } = restoredPeriods[i]!;
      void _c1;
      void _u1;
      void _c2;
      void _u2;
      expect(actP).toEqual(expP);
    }

    const restoredActions = (restoredActionsRes.data ?? []).map((r) =>
      normalizeActionRow(r as Record<string, unknown>),
    );
    expect(restoredActions).toHaveLength(snapshot.actions.length);
    for (let i = 0; i < snapshot.actions.length; i += 1) {
      const { created_at: _c1, updated_at: _u1, ...expA } = snapshot.actions[i]!;
      const { created_at: _c2, updated_at: _u2, ...actA } = restoredActions[i]!;
      void _c1;
      void _u1;
      void _c2;
      void _u2;
      expect(actA).toEqual(expA);
    }

    const restoredTvs = (restoredTvsRes.data ?? []).map((r) =>
      normalizeTargetVersionRow(r as Record<string, unknown>),
    );
    expect(restoredTvs).toHaveLength(snapshot.target_versions.length);
    for (let i = 0; i < snapshot.target_versions.length; i += 1) {
      const { created_at: _c1, ...expTv } = snapshot.target_versions[i]!;
      const { created_at: _c2, ...actTv } = restoredTvs[i]!;
      void _c1;
      void _c2;
      expect(actTv).toEqual(expTv);
    }

    expect(restoredLogs).toHaveLength(1260);
    const sortLogs = (arr: readonly DailyLog[]) =>
      [...arr].sort((a, b) => {
        if (a.log_date !== b.log_date) return a.log_date.localeCompare(b.log_date);
        return a.action_id.localeCompare(b.action_id);
      });

    const expSorted = sortLogs(snapshot.daily_logs);
    const actSorted = sortLogs(restoredLogs);

    const toIsoOrNull = (val: string | null) =>
      val ? new Date(val).toISOString() : null;

    for (let i = 0; i < expSorted.length; i += 1) {
      const exp = expSorted[i]!;
      const act = actSorted[i]!;
      expect(act.action_id).toBe(exp.action_id);
      expect(act.log_date).toBe(exp.log_date);
      expect(act.availability_override).toBe(exp.availability_override);
      expect(act.status).toBe(exp.status);
      expect(act.percent_value).toBe(exp.percent_value);
      expect(toIsoOrNull(act.qadaa_resolved_at)).toBe(
        toIsoOrNull(exp.qadaa_resolved_at),
      );
      expect(act.target_version_id).toBe(exp.target_version_id);
      expect(act.note).toBe(exp.note);
      expect(toIsoOrNull(act.note_updated_at)).toBe(
        toIsoOrNull(exp.note_updated_at),
      );
    }

    const restoredOpenQadaa = getOpenQadaaQueue({
      actions: restoredActions,
      periods: restoredPeriods,
      targetVersions: restoredTvs,
      logs: restoredLogs,
      todayIslamicDate: todayIslamic,
    });
    expect(restoredOpenQadaa).toHaveLength(originalOpenQadaa.length);
    expect(
      restoredOpenQadaa.filter(
        (q) =>
          q.action.id === STARTER_PACK_ACTION_IDS.QURAN_WIRD &&
          q.targetVersion?.id === STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1 &&
          q.targetLabel === '10 صفحات' &&
          q.ageDays > 90,
      ),
    ).toHaveLength(6);
  }, 60_000);
});

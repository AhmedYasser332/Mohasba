import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as bootstrapGet } from '@/app/api/bootstrap/route';
import { POST as initPost } from '@/app/api/bootstrap/init/route';
import { GET as exportGet } from '@/app/api/export/route';
import { POST as importPost } from '@/app/api/import/route';
import { GET as logsGet } from '@/app/api/logs/route';
import { addDaysIso, resolveIslamicDate } from '@/domain/prayer-engine';
import {
  buildStarterPack,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_TARGET_IDS,
} from '@/domain/starter-pack';
import type { DailyLog, ExportSnapshot } from '@/domain/types';
import { fetchAllDailyLogsKeyset } from '@/server/db/pagination';
import {
  enableTestUnauthenticatedMode,
  makeGetRequest,
  makeJsonRequest,
  restoreEnv,
  snapshotEnv,
  type EnvSnapshot,
} from '../helpers/api-test-client';
import { createTestAdminClient, resetTestDb } from '../helpers/reset-test-db';

describe('Slice 2: >1,000-row Keyset Pagination, Bootstrap, Export & Chunked Import', () => {
  const admin = createTestAdminClient();
  let envSnap: EnvSnapshot;

  beforeAll(async () => {
    envSnap = snapshotEnv();
    enableTestUnauthenticatedMode();
    process.env.CRON_SECRET = 'super-secret-cron-token-999';
    process.env.NTFY_TOPIC_URL = 'https://ntfy.sh/super-secret-topic-999';

    await resetTestDb();
    const initRes = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'starter_pack',
        active_from: '2025-01-01',
      }),
    );
    expect(initRes.status).toBe(200);
  });

  afterAll(async () => {
    await resetTestDb();
    restoreEnv(envSnap);
  });

  it('paginates 1,250+ daily_logs across bootstrap (full + 5m delta), /api/logs, /api/export (zero secrets), mid-read insert, and chunked /api/import', async () => {
    const { data: settingsRow } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', 1)
      .single();
    const todayIslamic = resolveIslamicDate(Date.now(), settingsRow);

    const bundle = buildStarterPack('2025-01-01');
    const actionIds = bundle.actions.slice(0, 25).map((a) => a.id);

    // Seed 25 actions x 50 recent days = 1,250 rows inside 90d window
    const recentSeedRows: Array<Record<string, unknown>> = [];
    const baseClientAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    for (let d = 0; d < 50; d += 1) {
      const logDate = addDaysIso(todayIslamic, -d);
      for (const actionId of actionIds) {
        recentSeedRows.push({
          action_id: actionId,
          log_date: logDate,
          availability_override: null,
          status: 'DONE',
          percent_value: null,
          qadaa_resolved_at: null,
          target_version_id:
            actionId === STARTER_PACK_ACTION_IDS.QURAN_WIRD
              ? STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1
              : null,
          note: null,
          note_updated_at: null,
          row_version: 1,
          client_updated_at: baseClientAt,
          updated_at: baseClientAt,
        });
      }
    }

    // Plus 2 rows > 120 days ago:
    // 1) Old open Qadaa row (status = MISSED) -> MUST appear in full bootstrap!
    // 2) Old DONE row -> must appear in /api/export & /api/logs, NOT in full bootstrap 90d+openQadaa
    const oldDate = addDaysIso(todayIslamic, -130);
    const oldOpenQadaa = {
      action_id: STARTER_PACK_ACTION_IDS.FAJR_FARD,
      log_date: oldDate,
      availability_override: null,
      status: 'MISSED',
      percent_value: null,
      qadaa_resolved_at: null,
      target_version_id: null,
      note: null,
      note_updated_at: null,
      row_version: 1,
      client_updated_at: baseClientAt,
      updated_at: baseClientAt,
    };
    const oldDone = {
      action_id: STARTER_PACK_ACTION_IDS.DHUHR_FARD,
      log_date: oldDate,
      availability_override: null,
      status: 'DONE',
      percent_value: null,
      qadaa_resolved_at: null,
      target_version_id: null,
      note: null,
      note_updated_at: null,
      row_version: 1,
      client_updated_at: baseClientAt,
      updated_at: baseClientAt,
    };

    const allSeed = [...recentSeedRows, oldOpenQadaa, oldDone];
    for (let i = 0; i < allSeed.length; i += 500) {
      const chunk = allSeed.slice(i, i + 500);
      const { error } = await admin.from('daily_logs').insert(chunk);
      expect(error).toBeNull();
    }

    // 1. Full GET /api/bootstrap (>1,000 rows + >90d open Qadaa)
    const bootFullRes = await bootstrapGet(makeGetRequest('/api/bootstrap'));
    expect(bootFullRes.status).toBe(200);
    const bootFull = (await bootFullRes.json()) as {
      daily_logs: DailyLog[];
      ntfy_configured: boolean;
    };
    expect(bootFull.ntfy_configured).toBe(true);
    expect(bootFull.daily_logs).toHaveLength(1251);
    expect(
      bootFull.daily_logs.some(
        (l) =>
          l.action_id === STARTER_PACK_ACTION_IDS.FAJR_FARD &&
          l.log_date === oldDate &&
          l.status === 'MISSED',
      ),
    ).toBe(true);
    expect(
      bootFull.daily_logs.some(
        (l) =>
          l.action_id === STARTER_PACK_ACTION_IDS.DHUHR_FARD &&
          l.log_date === oldDate,
      ),
    ).toBe(false);

    // 2. Delta GET /api/bootstrap?since=... with 5-minute safety overlap
    const nowMs = Date.now();
    const overlapInsideDate = addDaysIso(todayIslamic, -60);
    const overlapOutsideDate = addDaysIso(todayIslamic, -61);
    const sinceIso = new Date(nowMs - 5 * 60 * 1000).toISOString();
    // Row updated 8 minutes ago (i.e. since - 3 minutes -> INSIDE the 5-minute safety overlap!)
    const insideOverlapAt = new Date(nowMs - 8 * 60 * 1000).toISOString();
    // Row updated 12 minutes ago (i.e. since - 7 minutes -> OUTSIDE the 5-minute safety overlap)
    const outsideOverlapAt = new Date(nowMs - 12 * 60 * 1000).toISOString();

    const { error: deltaSeedErr } = await admin.from('daily_logs').insert([
      {
        action_id: STARTER_PACK_ACTION_IDS.FAJR_FARD,
        log_date: overlapInsideDate,
        availability_override: null,
        status: 'DONE',
        percent_value: null,
        qadaa_resolved_at: null,
        target_version_id: null,
        note: null,
        note_updated_at: null,
        row_version: 1,
        client_updated_at: insideOverlapAt,
        updated_at: insideOverlapAt,
      },
      {
        action_id: STARTER_PACK_ACTION_IDS.FAJR_FARD,
        log_date: overlapOutsideDate,
        availability_override: null,
        status: 'DONE',
        percent_value: null,
        qadaa_resolved_at: null,
        target_version_id: null,
        note: null,
        note_updated_at: null,
        row_version: 1,
        client_updated_at: outsideOverlapAt,
        updated_at: outsideOverlapAt,
      },
    ]);
    expect(deltaSeedErr).toBeNull();

    const bootDeltaRes = await bootstrapGet(
      makeGetRequest(`/api/bootstrap?since=${encodeURIComponent(sinceIso)}`),
    );
    expect(bootDeltaRes.status).toBe(200);
    const bootDelta = (await bootDeltaRes.json()) as { daily_logs: DailyLog[] };
    expect(
      bootDelta.daily_logs.some((l) => l.log_date === overlapInsideDate),
    ).toBe(true);
    expect(
      bootDelta.daily_logs.some((l) => l.log_date === overlapOutsideDate),
    ).toBe(false);

    // 3. GET /api/logs full span (>1,000 rows)
    const logsRes = await logsGet(
      makeGetRequest(
        `/api/logs?from=${addDaysIso(todayIslamic, -135)}&to=${todayIslamic}`,
      ),
    );
    expect(logsRes.status).toBe(200);
    const logsBody = (await logsRes.json()) as { daily_logs: DailyLog[] };
    expect(logsBody.daily_logs).toHaveLength(1254);

    // 4. Mid-read concurrent insert stability during keyset pagination
    // Insert a row on an earlier date while keyset pagination runs -> cursor never duplicates/skips existing rows!
    const midReadPromise = fetchAllDailyLogsKeyset(admin);
    const midInsertAt = new Date().toISOString();
    await admin.from('daily_logs').insert({
      action_id: STARTER_PACK_ACTION_IDS.ASR_FARD,
      log_date: addDaysIso(todayIslamic, -125),
      availability_override: null,
      status: 'DONE',
      percent_value: null,
      qadaa_resolved_at: null,
      target_version_id: null,
      note: null,
      note_updated_at: null,
      row_version: 1,
      client_updated_at: midInsertAt,
      updated_at: midInsertAt,
    });
    const keysetRows = await midReadPromise;
    const uniqueKeys = new Set(
      keysetRows.map((r) => `${r.action_id}::${r.log_date}`),
    );
    expect(uniqueKeys.size).toBe(keysetRows.length);
    expect(keysetRows.length).toBeGreaterThanOrEqual(1254);

    // 5. GET /api/export completeness & zero secrets
    const exportRes = await exportGet(makeGetRequest('/api/export'));
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-disposition')).toContain(
      'attachment; filename="mohasba-',
    );
    const exportText = await exportRes.text();
    expect(exportText).not.toContain('super-secret-cron-token-999');
    expect(exportText).not.toContain('super-secret-topic-999');
    expect(exportText).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const snapshot = JSON.parse(exportText) as ExportSnapshot;
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.counts?.daily_logs).toBe(snapshot.daily_logs.length);
    expect(snapshot.daily_logs.length).toBe(1255);

    // 6. POST /api/import rejects cross-action target_version_id cleanly (400)
    const badImportRes = await importPost(
      makeJsonRequest('/api/import', 'POST', {
        schema_version: 1,
        daily_logs: [
          {
            action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
            log_date: todayIslamic,
            availability_override: null,
            status: 'DONE',
            percent_value: null,
            qadaa_resolved_at: null,
            // Wrong action's target version!
            target_version_id: STARTER_PACK_TARGET_IDS.QIYAM_V1,
            note: null,
            note_updated_at: null,
            client_updated_at: new Date().toISOString(),
          },
        ],
      }),
    );
    expect(badImportRes.status).toBe(400);

    // 7. Reset DB and restore entire exported snapshot via chunked POST /api/import (<= 200 logs/req)
    await resetTestDb();

    const metaImportRes = await importPost(
      makeJsonRequest('/api/import', 'POST', {
        schema_version: 1,
        settings: snapshot.settings,
        periods: snapshot.periods,
        actions: snapshot.actions,
        target_versions: snapshot.target_versions,
        daily_logs: [],
      }),
    );
    expect(metaImportRes.status).toBe(200);

    for (let i = 0; i < snapshot.daily_logs.length; i += 200) {
      const chunkLogs = snapshot.daily_logs.slice(i, i + 200);
      const chunkRes = await importPost(
        makeJsonRequest('/api/import', 'POST', {
          schema_version: 1,
          daily_logs: chunkLogs,
        }),
      );
      expect(chunkRes.status).toBe(200);
    }

    // Verify full restore parity and zero applied_mutations pollution
    const { count: restoredLogCount } = await admin
      .from('daily_logs')
      .select('*', { count: 'exact', head: true });
    expect(restoredLogCount).toBe(snapshot.daily_logs.length);

    const { count: appliedMutCount } = await admin
      .from('applied_mutations')
      .select('*', { count: 'exact', head: true });
    expect(appliedMutCount).toBe(0);
  }, 30_000);
});

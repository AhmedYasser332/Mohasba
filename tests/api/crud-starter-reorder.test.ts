import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as actionsPost } from '@/app/api/actions/route';
import { PATCH as actionPatch } from '@/app/api/actions/[id]/route';
import { POST as initPost } from '@/app/api/bootstrap/init/route';
import { POST as periodsPost } from '@/app/api/periods/route';
import { PATCH as periodPatch } from '@/app/api/periods/[id]/route';
import { POST as reorderPost } from '@/app/api/schema/reorder/route';
import { POST as targetPost } from '@/app/api/target-versions/route';
import {
  DELETE as targetDelete,
  PATCH as targetPatch,
} from '@/app/api/target-versions/[id]/route';
import {
  buildStarterPack,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
  STARTER_PACK_TARGET_IDS,
} from '@/domain/starter-pack';
import {
  enableTestUnauthenticatedMode,
  makeJsonRequest,
  restoreEnv,
  snapshotEnv,
  type EnvSnapshot,
} from '../helpers/api-test-client';
import { createTestAdminClient, resetTestDb } from '../helpers/reset-test-db';

describe('Slice 2: Resumable Starter Pack, Target Version guards, Reorder & Action updates', () => {
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

  it('resumes starter pack cleanly after a simulated partial seed while onboarding_completed = false', async () => {
    const bundle = buildStarterPack('2026-10-01');

    // Simulate partial failure: 2 periods + 2 actions inserted, onboarding_completed still false
    await admin.from('periods').insert(bundle.periods.slice(0, 2));
    await admin.from('actions').insert(bundle.actions.slice(0, 2));

    const res = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'starter_pack',
        active_from: '2026-10-01',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      already_completed: boolean;
      onboarding_completed: boolean;
    };
    expect(body.already_completed).toBe(false);
    expect(body.onboarding_completed).toBe(true);

    const { count: pCount } = await admin
      .from('periods')
      .select('*', { count: 'exact', head: true });
    const { count: aCount } = await admin
      .from('actions')
      .select('*', { count: 'exact', head: true });
    const { count: tCount } = await admin
      .from('target_versions')
      .select('*', { count: 'exact', head: true });

    expect(pCount).toBe(bundle.periods.length);
    expect(aCount).toBe(bundle.actions.length);
    expect(tCount).toBe(bundle.targetVersions.length);

    // Calling again is idempotent
    const secondRes = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'starter_pack',
      }),
    );
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as { already_completed: boolean };
    expect(secondBody.already_completed).toBe(true);
  });

  it('enforces 409 on referenced target_versions PATCH/DELETE and allows 200 on unreferenced ones', async () => {
    await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'starter_pack',
        active_from: '2026-10-01',
      }),
    );

    // Create a brand new unreferenced target version
    const createTvRes = await targetPost(
      makeJsonRequest('/api/target-versions', 'POST', {
        action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
        effective_from: '2026-11-25',
        target_label: '20 صفحة',
        target_value: 20,
        target_unit: 'صفحة',
        direction: 'level_up',
      }),
    );
    expect(createTvRes.status).toBe(201);
    const { target_version: unrefTv } = (await createTvRes.json()) as {
      target_version: { id: string };
    };

    // Duplicate effective_from -> 409
    const dupRes = await targetPost(
      makeJsonRequest('/api/target-versions', 'POST', {
        action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
        effective_from: '2026-11-25',
        target_label: '30 صفحة',
      }),
    );
    expect(dupRes.status).toBe(409);

    // PATCH unreferenced -> 200
    const patchOk = await targetPatch(
      makeJsonRequest(`/api/target-versions/${unrefTv.id}`, 'PATCH', {
        target_label: '15 صفحة',
        target_value: 15,
      }),
      { params: Promise.resolve({ id: unrefTv.id }) },
    );
    expect(patchOk.status).toBe(200);

    // DELETE unreferenced -> 200
    const delOk = await targetDelete(
      makeJsonRequest(`/api/target-versions/${unrefTv.id}`, 'DELETE'),
      { params: Promise.resolve({ id: unrefTv.id }) },
    );
    expect(delOk.status).toBe(200);

    // Reference QURAN_WIRD_V1 in daily_logs -> PATCH & DELETE return 409
    await admin.from('daily_logs').insert({
      action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
      log_date: '2026-11-15',
      status: 'DONE',
      target_version_id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
      client_updated_at: '2026-11-15T12:00:00.000Z',
    });

    const patchConflict = await targetPatch(
      makeJsonRequest(
        `/api/target-versions/${STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1}`,
        'PATCH',
        { target_label: '99 صفحة' },
      ),
      {
        params: Promise.resolve({
          id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
        }),
      },
    );
    expect(patchConflict.status).toBe(409);

    const delConflict = await targetDelete(
      makeJsonRequest(
        `/api/target-versions/${STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1}`,
        'DELETE',
      ),
      {
        params: Promise.resolve({
          id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
        }),
      },
    );
    expect(delConflict.status).toBe(409);
  });

  it('reorders periods and actions cleanly via per-row update without NOT NULL errors', async () => {
    await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'starter_pack',
        active_from: '2026-10-01',
      }),
    );

    const reorderPeriodsRes = await reorderPost(
      makeJsonRequest('/api/schema/reorder', 'POST', {
        target: 'periods',
        items: [
          { id: STARTER_PACK_PERIOD_IDS.DHUHR, sort_order: 1 },
          { id: STARTER_PACK_PERIOD_IDS.FAJR, sort_order: 2 },
        ],
      }),
    );
    expect(reorderPeriodsRes.status).toBe(200);
    const pBody = (await reorderPeriodsRes.json()) as {
      updated_count: number;
      failed_ids: string[];
    };
    expect(pBody).toEqual({ updated_count: 2, failed_ids: [] });

    const reorderActionsRes = await reorderPost(
      makeJsonRequest('/api/schema/reorder', 'POST', {
        target: 'actions',
        items: [
          {
            id: STARTER_PACK_ACTION_IDS.FAJR_SUNNAH,
            sort_order: 1,
            period_id: STARTER_PACK_PERIOD_IDS.FAJR,
          },
          { id: STARTER_PACK_ACTION_IDS.FAJR_FARD, sort_order: 2 },
        ],
      }),
    );
    expect(reorderActionsRes.status).toBe(200);
    const aBody = (await reorderActionsRes.json()) as {
      updated_count: number;
      failed_ids: string[];
    };
    expect(aBody).toEqual({ updated_count: 2, failed_ids: [] });

    const { data: fajrSunnah } = await admin
      .from('actions')
      .select('sort_order')
      .eq('id', STARTER_PACK_ACTION_IDS.FAJR_SUNNAH)
      .single();
    expect(fajrSunnah?.sort_order).toBe(1);
  });

  it('supports period/action creation, soft-archive/restore, and returns open_qadaa_warning_count when disabling is_qadaa_eligible', async () => {
    const pRes = await periodsPost(
      makeJsonRequest('/api/periods', 'POST', {
        title: 'ورد مسائي',
        side: 'DAILY_GROUP',
        sort_order: 10,
        active_from: '2026-10-01',
      }),
    );
    expect(pRes.status).toBe(201);
    const { period } = (await pRes.json()) as { period: { id: string } };

    const aRes = await actionsPost(
      makeJsonRequest('/api/actions', 'POST', {
        period_id: period.id,
        title: 'حفظ صفحة',
        is_qadaa_eligible: true,
        supports_percentage: true,
        active_from: '2026-10-01',
        initial_target: {
          target_label: 'صفحة واحدة',
          target_value: 1,
          target_unit: 'صفحة',
        },
      }),
    );
    expect(aRes.status).toBe(201);
    const { action } = (await aRes.json()) as { action: { id: string } };

    // Seed 2 open MISSED Qadaa rows for this action
    await admin.from('daily_logs').insert([
      {
        action_id: action.id,
        log_date: '2026-11-10',
        status: 'MISSED',
        client_updated_at: '2026-11-10T20:00:00.000Z',
      },
      {
        action_id: action.id,
        log_date: '2026-11-11',
        status: 'MISSED',
        client_updated_at: '2026-11-11T20:00:00.000Z',
      },
    ]);

    const toggleOffRes = await actionPatch(
      makeJsonRequest(`/api/actions/${action.id}`, 'PATCH', {
        is_qadaa_eligible: false,
      }),
      { params: Promise.resolve({ id: action.id }) },
    );
    expect(toggleOffRes.status).toBe(200);
    const toggleOffBody = (await toggleOffRes.json()) as {
      action: { is_qadaa_eligible: boolean };
      open_qadaa_warning_count?: number;
    };
    expect(toggleOffBody.action.is_qadaa_eligible).toBe(false);
    expect(toggleOffBody.open_qadaa_warning_count).toBe(2);

    // Soft-archive and restore period
    const archiveP = await periodPatch(
      makeJsonRequest(`/api/periods/${period.id}`, 'PATCH', {
        archived_at: '2026-11-20',
      }),
      { params: Promise.resolve({ id: period.id }) },
    );
    expect(archiveP.status).toBe(200);
    expect(
      ((await archiveP.json()) as { period: { archived_at: string | null } })
        .period.archived_at,
    ).toBe('2026-11-20');

    const restoreP = await periodPatch(
      makeJsonRequest(`/api/periods/${period.id}`, 'PATCH', {
        archived_at: null,
      }),
      { params: Promise.resolve({ id: period.id }) },
    );
    expect(restoreP.status).toBe(200);
    expect(
      ((await restoreP.json()) as { period: { archived_at: string | null } })
        .period.archived_at,
    ).toBeNull();
  });
});

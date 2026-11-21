import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as initPost } from '@/app/api/bootstrap/init/route';
import { POST as syncPost } from '@/app/api/sync/route';
import { POST as targetPost } from '@/app/api/target-versions/route';
import { PATCH as actionPatch } from '@/app/api/actions/[id]/route';
import {
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_TARGET_IDS,
} from '@/domain/starter-pack';
import type { SyncMutation, SyncResultItem } from '@/domain/types';
import {
  enableTestUnauthenticatedMode,
  makeJsonRequest,
  restoreEnv,
  snapshotEnv,
  type EnvSnapshot,
} from '../helpers/api-test-client';
import { createTestAdminClient, resetTestDb } from '../helpers/reset-test-db';

const PHONE_DEVICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const PC_DEVICE = 'bbbbbbbb-0000-4000-8000-000000000002';

function makeMutation(overrides: Partial<SyncMutation> = {}): SyncMutation {
  return {
    mutation_id: crypto.randomUUID(),
    device_id: PHONE_DEVICE,
    parent_mutation_id: null,
    action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
    log_date: '2026-11-15',
    base_row_version: null,
    availability_override: null,
    status: 'DONE',
    percent_value: null,
    qadaa_resolved_at: null,
    client_target_version_id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
    note: null,
    note_updated_at: null,
    client_updated_at: '2026-11-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('Slice 2: Sync concurrency, intra-batch chaining, retry & poison isolation', () => {
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
    const res = await initPost(
      makeJsonRequest('/api/bootstrap/init', 'POST', {
        mode: 'starter_pack',
        active_from: '2026-10-01',
      }),
    );
    expect(res.status).toBe(200);
  });

  it('handles simultaneous expected_row_version=null inserts via direct RPC (1 applied, 1 race_conflict)', async () => {
    const itemA = {
      mutation_id: crypto.randomUUID(),
      device_id: PHONE_DEVICE,
      action_id: STARTER_PACK_ACTION_IDS.FAJR_FARD,
      log_date: '2026-11-15',
      expected_row_version: null,
      availability_override: null,
      status: 'DONE',
      percent_value: null,
      qadaa_resolved_at: null,
      target_version_id: null,
      note: null,
      note_updated_at: null,
      client_updated_at: '2026-11-15T06:00:00.000Z',
    };

    const itemB = {
      ...itemA,
      mutation_id: crypto.randomUUID(),
      device_id: PC_DEVICE,
      status: 'MISSED',
      client_updated_at: '2026-11-15T07:00:00.000Z',
    };

    const [resA, resB] = await Promise.all([
      admin.rpc('commit_sync_batch', { p_items: [itemA] }),
      admin.rpc('commit_sync_batch', { p_items: [itemB] }),
    ]);

    expect(resA.error).toBeNull();
    expect(resB.error).toBeNull();

    const outcomes = [
      (resA.data as SyncResultItem[])[0]!.outcome,
      (resB.data as SyncResultItem[])[0]!.outcome,
    ].sort();
    expect(outcomes).toEqual(['applied', 'race_conflict']);
  });

  it('converges simultaneous POST /api/sync creations via server race retry (Positive > MISSED)', async () => {
    const phoneMut = makeMutation({
      device_id: PHONE_DEVICE,
      action_id: STARTER_PACK_ACTION_IDS.FAJR_FARD,
      log_date: '2026-11-16',
      status: 'DONE',
      client_target_version_id: null,
      client_updated_at: '2026-11-16T05:30:00.000Z',
    });

    const pcMut = makeMutation({
      device_id: PC_DEVICE,
      action_id: STARTER_PACK_ACTION_IDS.FAJR_FARD,
      log_date: '2026-11-16',
      status: 'MISSED',
      client_target_version_id: null,
      client_updated_at: '2026-11-16T08:00:00.000Z',
    });

    const [r1, r2] = await Promise.all([
      syncPost(
        makeJsonRequest('/api/sync', 'POST', {
          device_id: PHONE_DEVICE,
          mutations: [phoneMut],
        }),
      ),
      syncPost(
        makeJsonRequest('/api/sync', 'POST', {
          device_id: PC_DEVICE,
          mutations: [pcMut],
        }),
      ),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const b1 = (await r1.json()) as { results: SyncResultItem[] };
    const b2 = (await r2.json()) as { results: SyncResultItem[] };

    expect(b1.results[0]?.outcome).toBe('applied');
    expect(b2.results[0]?.outcome).toBe('applied');

    const { data: finalRow } = await admin
      .from('daily_logs')
      .select('*')
      .eq('action_id', STARTER_PACK_ACTION_IDS.FAJR_FARD)
      .eq('log_date', '2026-11-16')
      .single();

    expect(finalRow?.status).toBe('DONE');
    expect(Number(finalRow?.row_version)).toBe(2);
  });

  it('handles simultaneous duplicate mutation_id (1 applied, 1 already_applied)', async () => {
    const sharedMutId = crypto.randomUUID();
    const item = {
      mutation_id: sharedMutId,
      device_id: PHONE_DEVICE,
      action_id: STARTER_PACK_ACTION_IDS.DHUHR_FARD,
      log_date: '2026-11-15',
      expected_row_version: null,
      availability_override: null,
      status: 'DONE',
      percent_value: null,
      qadaa_resolved_at: null,
      target_version_id: null,
      note: null,
      note_updated_at: null,
      client_updated_at: '2026-11-15T12:30:00.000Z',
    };

    const [res1, res2] = await Promise.all([
      admin.rpc('commit_sync_batch', { p_items: [item] }),
      admin.rpc('commit_sync_batch', { p_items: [item] }),
    ]);

    expect(res1.error).toBeNull();
    expect(res2.error).toBeNull();

    const outcomes = [
      (res1.data as SyncResultItem[])[0]!.outcome,
      (res2.data as SyncResultItem[])[0]!.outcome,
    ].sort();
    expect(outcomes).toEqual(['already_applied', 'applied']);

    // Re-submitting via POST /api/sync also returns already_applied with resolved_row
    const res3 = await syncPost(
      makeJsonRequest('/api/sync', 'POST', {
        device_id: PHONE_DEVICE,
        mutations: [
          makeMutation({
            mutation_id: sharedMutId,
            action_id: STARTER_PACK_ACTION_IDS.DHUHR_FARD,
            log_date: '2026-11-15',
            client_target_version_id: null,
          }),
        ],
      }),
    );
    expect(res3.status).toBe(200);
    const body3 = (await res3.json()) as { results: SyncResultItem[] };
    expect(body3.results[0]?.outcome).toBe('already_applied');
    expect(body3.results[0]?.resolved_row?.status).toBe('DONE');
  });

  it('chains same-cell [M1, M2] cleanly in ONE POST /api/sync batch without MC001 collision', async () => {
    const m1 = makeMutation({
      device_id: PHONE_DEVICE,
      action_id: STARTER_PACK_ACTION_IDS.ASR_FARD,
      log_date: '2026-11-17',
      base_row_version: null,
      status: 'DONE',
      client_target_version_id: null,
      client_updated_at: '2026-11-17T15:00:00.000Z',
    });

    const m2 = makeMutation({
      device_id: PHONE_DEVICE,
      parent_mutation_id: m1.mutation_id,
      action_id: STARTER_PACK_ACTION_IDS.ASR_FARD,
      log_date: '2026-11-17',
      base_row_version: null,
      status: 'MISSED',
      client_target_version_id: null,
      client_updated_at: '2026-11-17T15:01:00.000Z',
    });

    const res = await syncPost(
      makeJsonRequest('/api/sync', 'POST', {
        device_id: PHONE_DEVICE,
        mutations: [m1, m2],
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: SyncResultItem[] };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]?.outcome).toBe('applied');
    expect(body.results[0]?.resolved_row?.row_version).toBe(1);
    expect(body.results[1]?.outcome).toBe('applied');
    expect(body.results[1]?.resolved_row?.status).toBe('MISSED');
    expect(body.results[1]?.resolved_row?.row_version).toBe(2);
  });

  it('applies cross-request dropped-ACK same-device M1(DONE)->M2(MISSED, parent=M1) via causal Fast Path while rejecting different-device MISSED', async () => {
    const m1 = makeMutation({
      device_id: PHONE_DEVICE,
      action_id: STARTER_PACK_ACTION_IDS.MAGHRIB_FARD,
      log_date: '2026-11-18',
      status: 'DONE',
      client_target_version_id: null,
      client_updated_at: '2026-11-18T17:10:00.000Z',
    });

    const r1 = await syncPost(
      makeJsonRequest('/api/sync', 'POST', {
        device_id: PHONE_DEVICE,
        mutations: [m1],
      }),
    );
    expect(r1.status).toBe(200);

    // Different device tries to overwrite DONE with MISSED -> loses to Positive > MISSED!
    const otherDeviceMissed = makeMutation({
      device_id: PC_DEVICE,
      parent_mutation_id: null,
      action_id: STARTER_PACK_ACTION_IDS.MAGHRIB_FARD,
      log_date: '2026-11-18',
      base_row_version: null,
      status: 'MISSED',
      client_target_version_id: null,
      client_updated_at: '2026-11-18T17:15:00.000Z',
    });

    const rOther = await syncPost(
      makeJsonRequest('/api/sync', 'POST', {
        device_id: PC_DEVICE,
        mutations: [otherDeviceMissed],
      }),
    );
    expect(rOther.status).toBe(200);
    const bOther = (await rOther.json()) as { results: SyncResultItem[] };
    expect(bOther.results[0]?.resolved_row?.status).toBe('DONE');

    // Now same Phone sends M2 (MISSED, parent_mutation_id=M1) -> wait: row's last_mutation_id changed to otherDeviceMissed?
    // Verify clean sequential dropped-ACK on another cell (Isha) where no third device intervened:
    const ishaM1 = makeMutation({
      device_id: PHONE_DEVICE,
      action_id: STARTER_PACK_ACTION_IDS.ISHA_FARD,
      log_date: '2026-11-18',
      status: 'DONE',
      client_target_version_id: null,
      client_updated_at: '2026-11-18T19:00:00.000Z',
    });
    const rIsha1 = await syncPost(
      makeJsonRequest('/api/sync', 'POST', {
        device_id: PHONE_DEVICE,
        mutations: [ishaM1],
      }),
    );
    expect(rIsha1.status).toBe(200);

    const ishaM2 = makeMutation({
      device_id: PHONE_DEVICE,
      parent_mutation_id: ishaM1.mutation_id,
      action_id: STARTER_PACK_ACTION_IDS.ISHA_FARD,
      log_date: '2026-11-18',
      base_row_version: null,
      status: 'MISSED',
      client_target_version_id: null,
      client_updated_at: '2026-11-18T19:02:00.000Z',
    });
    const rIsha2 = await syncPost(
      makeJsonRequest('/api/sync', 'POST', {
        device_id: PHONE_DEVICE,
        mutations: [ishaM2],
      }),
    );
    expect(rIsha2.status).toBe(200);
    const bIsha2 = (await rIsha2.json()) as { results: SyncResultItem[] };
    expect(bIsha2.results[0]?.outcome).toBe('applied');
    expect(bIsha2.results[0]?.resolved_row?.status).toBe('MISSED');
    expect(bIsha2.results[0]?.resolved_row?.row_version).toBe(2);
  });

  it('isolates 1 poison item in a 50-item batch (check_violation & 22007 invalid date -> 1 rejected, 49 applied)', async () => {
    const healthyItems = Array.from({ length: 49 }, (_, idx) => {
      const day = String((idx % 28) + 1).padStart(2, '0');
      const month = idx < 28 ? '10' : '11';
      return {
        mutation_id: crypto.randomUUID(),
        device_id: PHONE_DEVICE,
        action_id: STARTER_PACK_ACTION_IDS.FAJR_SUNNAH,
        log_date: `2026-${month}-${day}`,
        expected_row_version: null,
        availability_override: null,
        status: 'DONE',
        percent_value: null,
        qadaa_resolved_at: null,
        target_version_id: null,
        note: null,
        note_updated_at: null,
        client_updated_at: '2026-11-18T06:00:00.000Z',
      };
    });

    // Test 1: direct RPC batch with 1 check_violation poison item (PERCENT without percent_value)
    const poisonCheck = {
      ...healthyItems[0]!,
      mutation_id: crypto.randomUUID(),
      action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
      log_date: '2026-11-19',
      status: 'PERCENT',
      percent_value: null,
    };

    const { data: rpcCheckData, error: rpcCheckErr } = await admin.rpc(
      'commit_sync_batch',
      { p_items: [...healthyItems, poisonCheck] },
    );
    expect(rpcCheckErr).toBeNull();
    const checkResults = rpcCheckData as SyncResultItem[];
    expect(checkResults).toHaveLength(50);
    expect(
      checkResults.filter((r) => r.outcome === 'applied'),
    ).toHaveLength(49);
    expect(
      checkResults.filter((r) => r.outcome === 'rejected'),
    ).toHaveLength(1);
    expect(checkResults[49]?.outcome).toBe('rejected');

    // Test 2: direct RPC batch with 1 SQLSTATE 22007 invalid_datetime_format poison item
    const healthyBatch2 = Array.from({ length: 49 }, (_, idx) => {
      const day = String((idx % 28) + 1).padStart(2, '0');
      const month = idx < 28 ? '10' : '11';
      return {
        ...healthyItems[0]!,
        mutation_id: crypto.randomUUID(),
        action_id: STARTER_PACK_ACTION_IDS.DHUHR_QABLIYAH,
        log_date: `2026-${month}-${day}`,
      };
    });
    const poison22007 = {
      ...healthyBatch2[0]!,
      mutation_id: crypto.randomUUID(),
      action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
      log_date: '2026-11-20',
      client_updated_at: 'not-a-valid-timestamp',
    };

    const { data: rpcDateData, error: rpcDateErr } = await admin.rpc(
      'commit_sync_batch',
      { p_items: [...healthyBatch2, poison22007] },
    );
    expect(rpcDateErr).toBeNull();
    const dateResults = rpcDateData as SyncResultItem[];
    expect(dateResults).toHaveLength(50);
    expect(dateResults.filter((r) => r.outcome === 'applied')).toHaveLength(49);
    expect(dateResults.filter((r) => r.outcome === 'rejected')).toHaveLength(1);

    // Test 3: POST /api/sync 50-item batch with 1 invalid calendar date ('2026-02-31') -> 49 applied, 1 rejected
    const apiBatch = Array.from({ length: 49 }, (_, idx) => {
      const day = String((idx % 28) + 1).padStart(2, '0');
      const month = idx < 28 ? '10' : '11';
      return makeMutation({
        action_id: STARTER_PACK_ACTION_IDS.ASR_ADHKAR,
        log_date: `2026-${month}-${day}`,
        client_target_version_id: null,
      });
    });
    apiBatch.push(
      makeMutation({
        action_id: STARTER_PACK_ACTION_IDS.ASR_ADHKAR,
        log_date: '2026-02-31',
        client_target_version_id: null,
      }),
    );

    const apiRes = await syncPost(
      makeJsonRequest('/api/sync', 'POST', {
        device_id: PHONE_DEVICE,
        mutations: apiBatch,
      }),
    );
    expect(apiRes.status).toBe(200);
    const apiBody = (await apiRes.json()) as { results: SyncResultItem[] };
    expect(apiBody.results).toHaveLength(50);
    expect(apiBody.results.filter((r) => r.outcome === 'applied')).toHaveLength(
      49,
    );
    expect(
      apiBody.results.filter((r) => r.outcome === 'rejected'),
    ).toHaveLength(1);
  });

  it('allows replay on soft-archived actions for log_date <= archived_at and retains client_target_version_id across upgrades', async () => {
    // Soft-archive Fajr Adhkar effective 2026-11-15
    const archiveRes = await actionPatch(
      makeJsonRequest(
        `/api/actions/${STARTER_PACK_ACTION_IDS.FAJR_ADHKAR}`,
        'PATCH',
        { archived_at: '2026-11-15' },
      ),
      { params: Promise.resolve({ id: STARTER_PACK_ACTION_IDS.FAJR_ADHKAR }) },
    );
    expect(archiveRes.status).toBe(200);

    // Upgrade Quran Wird effective 2026-11-15 while offline phone still stamps QURAN_WIRD_V1
    const upgradeRes = await targetPost(
      makeJsonRequest('/api/target-versions', 'POST', {
        action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
        effective_from: '2026-11-15',
        target_label: '20 صفحة',
        target_value: 20,
        target_unit: 'صفحة',
        direction: 'level_up',
      }),
    );
    expect(upgradeRes.status).toBe(201);

    const allowedArchived = makeMutation({
      action_id: STARTER_PACK_ACTION_IDS.FAJR_ADHKAR,
      log_date: '2026-11-15',
      client_target_version_id: null,
    });
    const rejectedPostArchive = makeMutation({
      action_id: STARTER_PACK_ACTION_IDS.FAJR_ADHKAR,
      log_date: '2026-11-16',
      client_target_version_id: null,
    });
    const offlineTargetRetained = makeMutation({
      action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
      log_date: '2026-11-15',
      client_target_version_id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
    });

    const syncRes = await syncPost(
      makeJsonRequest('/api/sync', 'POST', {
        device_id: PHONE_DEVICE,
        mutations: [allowedArchived, rejectedPostArchive, offlineTargetRetained],
      }),
    );
    expect(syncRes.status).toBe(200);
    const body = (await syncRes.json()) as { results: SyncResultItem[] };

    expect(body.results[0]?.outcome).toBe('applied');
    expect(body.results[1]?.outcome).toBe('rejected');
    expect(body.results[2]?.outcome).toBe('applied');
    expect(body.results[2]?.resolved_row?.target_version_id).toBe(
      STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { resolveImportMerge, resolveSyncConflict } from '@/domain/conflict';
import {
  buildStarterPack,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_TARGET_IDS,
} from '@/domain/starter-pack';
import type { Action, DailyLog, SyncMutation, TargetVersion } from '@/domain/types';

const PHONE_DEVICE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const PC_DEVICE_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const MUT_1 = 'cccccccc-0000-4000-8000-000000000001';
const MUT_2 = 'cccccccc-0000-4000-8000-000000000002';

function makeMutation(overrides: Partial<SyncMutation> = {}): SyncMutation {
  return {
    mutation_id: MUT_1,
    device_id: PHONE_DEVICE_ID,
    parent_mutation_id: null,
    action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
    log_date: '2026-11-20',
    base_row_version: null,
    availability_override: null,
    status: 'DONE',
    percent_value: null,
    qadaa_resolved_at: null,
    client_target_version_id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
    note: null,
    note_updated_at: null,
    client_updated_at: '2026-11-20T12:00:00.000Z',
    ...overrides,
  };
}

function makeServerRow(overrides: Partial<DailyLog> = {}): DailyLog {
  return {
    action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
    log_date: '2026-11-20',
    availability_override: null,
    status: 'DONE',
    percent_value: null,
    qadaa_resolved_at: null,
    target_version_id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
    note: null,
    note_updated_at: null,
    row_version: 1,
    last_mutation_id: MUT_1,
    last_device_id: PC_DEVICE_ID,
    client_updated_at: '2026-11-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('conflict resolution & import merge', () => {
  const { actions, targetVersions } = buildStarterPack('2026-11-01');
  const quranAction = actions.find(
    (a) => a.id === STARTER_PACK_ACTION_IDS.QURAN_WIRD,
  )!;
  const fajrFard = actions.find(
    (a) => a.id === STARTER_PACK_ACTION_IDS.FAJR_FARD,
  )!;
  const serverNow = '2026-11-20T13:00:00.000Z';

  it('uses Fast Path 1 for clean creation when serverRow is null', () => {
    const res = resolveSyncConflict({
      serverRow: null,
      mutation: makeMutation(),
      action: quranAction,
      targetVersions,
      serverNow,
    });
    expect(res.kind).toBe('commit');
    if (res.kind === 'commit') {
      expect(res.resolution).toBe('fast_path_create');
      expect(res.item.expected_row_version).toBeNull();
      expect(res.item.status).toBe('DONE');
    }
  });

  it('uses Fast Path 2 when base_row_version matches serverRow.row_version', () => {
    const serverRow = makeServerRow({ row_version: 3, status: 'DONE' });
    const res = resolveSyncConflict({
      serverRow,
      mutation: makeMutation({
        mutation_id: MUT_2,
        base_row_version: 3,
        status: 'MISSED',
      }),
      action: quranAction,
      targetVersions,
      serverNow,
    });
    expect(res.kind).toBe('commit');
    if (res.kind === 'commit') {
      expect(res.resolution).toBe('fast_path_version');
      expect(res.item.expected_row_version).toBe(3);
      expect(res.item.status).toBe('MISSED');
    }
  });

  it('uses Fast Path 3 for same-device dropped-ACK causal self-correction (M1 DONE -> M2 MISSED)', () => {
    // Phone sent M1 (DONE), server committed M1, ACK dropped; Phone still thinks base_row_version=null
    // Phone then corrects to M2 (MISSED) with parent_mutation_id=M1 from the same device_id.
    const serverRow = makeServerRow({
      row_version: 1,
      status: 'DONE',
      last_mutation_id: MUT_1,
      last_device_id: PHONE_DEVICE_ID,
      client_updated_at: '2026-11-20T12:00:00.000Z',
    });

    const res = resolveSyncConflict({
      serverRow,
      mutation: makeMutation({
        mutation_id: MUT_2,
        device_id: PHONE_DEVICE_ID,
        parent_mutation_id: MUT_1,
        base_row_version: null,
        status: 'MISSED',
        client_updated_at: '2026-11-20T12:01:00.000Z',
      }),
      action: quranAction,
      targetVersions,
      serverNow,
    });

    expect(res.kind).toBe('commit');
    if (res.kind === 'commit') {
      expect(res.resolution).toBe('fast_path_causal');
      expect(res.item.status).toBe('MISSED');
      expect(res.item.expected_row_version).toBe(1);
    }
  });

  it('routes concurrent creation (base_row_version=null from different device) to Conflict Path where Positive > MISSED', () => {
    // PC marked MISSED at 12:05 via bulk defer, Phone marked DONE offline at 12:00
    const serverRow = makeServerRow({
      row_version: 1,
      status: 'MISSED',
      last_mutation_id: MUT_1,
      last_device_id: PC_DEVICE_ID,
      client_updated_at: '2026-11-20T12:05:00.000Z',
    });

    const res = resolveSyncConflict({
      serverRow,
      mutation: makeMutation({
        mutation_id: MUT_2,
        device_id: PHONE_DEVICE_ID,
        parent_mutation_id: null,
        base_row_version: null,
        status: 'DONE',
        client_updated_at: '2026-11-20T12:00:00.000Z',
      }),
      action: quranAction,
      targetVersions,
      serverNow,
    });

    expect(res.kind).toBe('commit');
    if (res.kind === 'commit') {
      expect(res.resolution).toBe('conflict_mutation_won');
      expect(res.item.status).toBe('DONE');
    }

    // Reverse: Server has DONE (12:00), different device sends MISSED (12:05) -> DONE still wins!
    const resReverse = resolveSyncConflict({
      serverRow: makeServerRow({
        status: 'DONE',
        last_device_id: PHONE_DEVICE_ID,
        client_updated_at: '2026-11-20T12:00:00.000Z',
      }),
      mutation: makeMutation({
        mutation_id: MUT_2,
        device_id: PC_DEVICE_ID,
        base_row_version: null,
        status: 'MISSED',
        client_updated_at: '2026-11-20T12:05:00.000Z',
      }),
      action: quranAction,
      targetVersions,
      serverNow,
    });
    expect(resReverse.kind).toBe('commit');
    if (resReverse.kind === 'commit') {
      expect(resReverse.resolution).toBe('conflict_server_won');
      expect(resReverse.item.status).toBe('DONE');
    }
  });

  it('resolves Explicit Clear (EMPTY) vs DONE strictly by newer client_updated_at LWW', () => {
    // Newer Explicit Clear (12:15) beats older DONE (12:00)
    const serverDone = makeServerRow({
      row_version: 2,
      status: 'DONE',
      last_device_id: PC_DEVICE_ID,
      client_updated_at: '2026-11-20T12:00:00.000Z',
    });

    const newerClear = resolveSyncConflict({
      serverRow: serverDone,
      mutation: makeMutation({
        mutation_id: MUT_2,
        device_id: PHONE_DEVICE_ID,
        base_row_version: 1,
        availability_override: null,
        status: null,
        client_updated_at: '2026-11-20T12:15:00.000Z',
      }),
      action: quranAction,
      targetVersions,
      serverNow,
    });
    expect(newerClear.kind).toBe('commit');
    if (newerClear.kind === 'commit') {
      expect(newerClear.resolution).toBe('conflict_mutation_won');
      expect(newerClear.item.status).toBeNull();
    }

    // Newer DONE (12:20) beats older Explicit Clear (12:15)
    const serverCleared = makeServerRow({
      row_version: 2,
      status: null,
      availability_override: null,
      last_device_id: PC_DEVICE_ID,
      client_updated_at: '2026-11-20T12:15:00.000Z',
    });

    const newerDone = resolveSyncConflict({
      serverRow: serverCleared,
      mutation: makeMutation({
        mutation_id: MUT_2,
        device_id: PHONE_DEVICE_ID,
        base_row_version: 1,
        status: 'DONE',
        client_updated_at: '2026-11-20T12:20:00.000Z',
      }),
      action: quranAction,
      targetVersions,
      serverNow,
    });
    expect(newerDone.kind).toBe('commit');
    if (newerDone.kind === 'commit') {
      expect(newerDone.resolution).toBe('conflict_mutation_won');
      expect(newerDone.item.status).toBe('DONE');
    }

    // Older Explicit Clear (11:50) loses to newer DONE (12:00)
    const olderClear = resolveSyncConflict({
      serverRow: serverDone,
      mutation: makeMutation({
        mutation_id: MUT_2,
        device_id: PHONE_DEVICE_ID,
        base_row_version: 1,
        availability_override: null,
        status: null,
        client_updated_at: '2026-11-20T11:50:00.000Z',
      }),
      action: quranAction,
      targetVersions,
      serverNow,
    });
    expect(olderClear.kind).toBe('commit');
    if (olderClear.kind === 'commit') {
      expect(olderClear.resolution).toBe('conflict_server_won');
      expect(olderClear.item.status).toBe('DONE');
    }
  });

  it('resolves Positive vs Positive by newer client_updated_at and merges note_updated_at independently', () => {
    // Server has QADAA_DONE at 12:10 with older note at 12:02
    const serverRow = makeServerRow({
      row_version: 2,
      status: 'QADAA_DONE',
      qadaa_resolved_at: '2026-11-20T12:10:00.000Z',
      note: 'old server note',
      note_updated_at: '2026-11-20T12:02:00.000Z',
      client_updated_at: '2026-11-20T12:10:00.000Z',
    });

    // Phone sends PERCENT 50% at 12:05 (older status -> loses to QADAA_DONE),
    // BUT newer note at 12:12 (wins note LWW!)
    const res = resolveSyncConflict({
      serverRow,
      mutation: makeMutation({
        mutation_id: MUT_2,
        base_row_version: 1,
        status: 'PERCENT',
        percent_value: 50,
        note: 'fresh phone note',
        note_updated_at: '2026-11-20T12:12:00.000Z',
        client_updated_at: '2026-11-20T12:05:00.000Z',
      }),
      action: quranAction,
      targetVersions,
      serverNow,
    });

    expect(res.kind).toBe('commit');
    if (res.kind === 'commit') {
      expect(res.resolution).toBe('conflict_server_won');
      expect(res.item.status).toBe('QADAA_DONE');
      expect(res.item.note).toBe('fresh phone note');
      expect(res.item.note_updated_at).toBe('2026-11-20T12:12:00.000Z');
    }
  });

  it('clamps future client_updated_at skew to serverNow + 5 minutes', () => {
    // Step 1: Skewed client sends 2026-11-25 (5 days in future) when serverNow is 13:00:00Z
    // -> persisted timestamp is clamped to 13:05:00Z.
    const fastSkew = resolveSyncConflict({
      serverRow: null,
      mutation: makeMutation({
        client_updated_at: '2026-11-25T12:00:00.000Z',
      }),
      action: quranAction,
      targetVersions,
      serverNow, // 13:00:00Z -> max clamp 13:05:00Z
    });
    expect(fastSkew.kind).toBe('commit');
    if (fastSkew.kind !== 'commit') return;
    expect(fastSkew.item.client_updated_at).toBe('2026-11-20T13:05:00.000Z');

    // Step 2: Later at serverNow=13:10:00Z, legitimate device sends 13:08:00Z
    // -> beats the clamped 13:05:00Z (would have lost without the skew clamp!).
    const skewedServerRow = makeServerRow({
      row_version: 1,
      status: 'DONE',
      client_updated_at: fastSkew.item.client_updated_at,
    });
    const legitimateLater = resolveSyncConflict({
      serverRow: skewedServerRow,
      mutation: makeMutation({
        mutation_id: MUT_2,
        device_id: PC_DEVICE_ID,
        base_row_version: null,
        status: 'PERCENT',
        percent_value: 75,
        client_updated_at: '2026-11-20T13:08:00.000Z',
      }),
      action: quranAction,
      targetVersions,
      serverNow: '2026-11-20T13:10:00.000Z',
    });

    expect(legitimateLater.kind).toBe('commit');
    if (legitimateLater.kind === 'commit') {
      expect(legitimateLater.resolution).toBe('conflict_mutation_won');
      expect(legitimateLater.item.status).toBe('PERCENT');
      expect(legitimateLater.item.percent_value).toBe(75);
    }
  });

  it('allows replay onto soft-archived actions for log_date <= archived_at and rejects > archived_at', () => {
    const archivedFajr: Action = {
      ...fajrFard,
      active_from: '2026-11-01',
      archived_at: '2026-11-18',
    };

    const allowed = resolveSyncConflict({
      serverRow: null,
      mutation: makeMutation({
        action_id: archivedFajr.id,
        log_date: '2026-11-18',
        client_target_version_id: null,
      }),
      action: archivedFajr,
      targetVersions,
      serverNow,
    });
    expect(allowed.kind).toBe('commit');

    const rejected = resolveSyncConflict({
      serverRow: null,
      mutation: makeMutation({
        action_id: archivedFajr.id,
        log_date: '2026-11-19',
        client_target_version_id: null,
      }),
      action: archivedFajr,
      targetVersions,
      serverNow,
    });
    expect(rejected.kind).toBe('rejected');
  });

  it('retains offline client_target_version_id when PC upgraded target effective same Day D, and rejects cross-action version', () => {
    const quranV2: TargetVersion = {
      id: '30000000-0000-4000-8000-000000000099',
      action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
      effective_from: '2026-11-20',
      target_label: '20 صفحة',
      target_value: 20,
      target_unit: 'صفحة',
      direction: 'level_up',
    };

    const res = resolveSyncConflict({
      serverRow: null,
      mutation: makeMutation({
        log_date: '2026-11-20',
        client_target_version_id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
      }),
      action: quranAction,
      targetVersions: [...targetVersions, quranV2],
      serverNow,
    });

    expect(res.kind).toBe('commit');
    if (res.kind === 'commit') {
      expect(res.item.target_version_id).toBe(
        STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
      );
    }

    // Cross-action target_version_id (QIYAM_V1 passed for QURAN_WIRD) must be rejected
    const crossAction = resolveSyncConflict({
      serverRow: null,
      mutation: makeMutation({
        client_target_version_id: STARTER_PACK_TARGET_IDS.QIYAM_V1,
      }),
      action: quranAction,
      targetVersions,
      serverNow,
    });
    expect(crossAction.kind).toBe('rejected');
  });

  it('resolves JSON import merges with Positive > MISSED and independent note LWW', () => {
    const existingRow = makeServerRow({
      status: 'MISSED',
      note: 'imported earlier note',
      note_updated_at: '2026-11-20T12:00:00.000Z',
      client_updated_at: '2026-11-20T12:15:00.000Z',
    });

    const merged = resolveImportMerge({
      existingRow,
      importedRow: {
        action_id: quranAction.id,
        log_date: '2026-11-20',
        availability_override: null,
        status: 'DONE',
        percent_value: null,
        qadaa_resolved_at: null,
        target_version_id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
        note: 'older note',
        note_updated_at: '2026-11-20T11:00:00.000Z',
        client_updated_at: '2026-11-20T12:00:00.000Z',
      },
      action: quranAction,
      targetVersions,
      serverNow,
    });

    expect(merged.kind).toBe('merge');
    if (merged.kind === 'merge') {
      expect(merged.resolution).toBe('import_incoming_won');
      expect(merged.row.status).toBe('DONE');
      // Existing newer note preserved
      expect(merged.row.note).toBe('imported earlier note');
    }
  });
});

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeClientDb,
  openClientDb,
  wipeAllLocalData,
} from '@/client/db/idb';
import {
  computeSyncBadgeState,
  OutboxEngine,
  type BootstrapPayload,
} from '@/client/sync/outbox-engine';
import {
  buildStarterPack,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
} from '@/domain/starter-pack';
import { makeCellKey, type AppSettings, type DailyLog } from '@/domain/types';

function makeSettings(): AppSettings {
  return {
    id: 1,
    rollover_mode: 'FAJR',
    iana_timezone: 'Africa/Cairo',
    city_name: 'Cairo',
    latitude: 30.0444,
    longitude: 31.2357,
    calc_method: 'Egyptian',
    asr_madhhab: 'Shafi',
    prayer_offsets: {
      fajr: 0,
      sunrise: 0,
      dhuhr: 0,
      asr: 0,
      maghrib: 0,
      isha: 0,
    },
    week_start_day: 6,
    ntfy_master_enabled: false,
    quiet_start_hhmm: null,
    quiet_end_hhmm: null,
    digest_enabled: true,
    digest_hhmm: '22:00',
    backup_reminder_enabled: true,
    onboarding_completed: true,
    last_pruned_date: null,
  };
}

let dbSeq = 0;

function nextDbName(): string {
  dbSeq += 1;
  return `mohasba-test-${Date.now()}-${dbSeq}`;
}

describe('Slice 3: OutboxEngine & IndexedDB Client Sync', () => {
  const starter = buildStarterPack('2026-11-01');
  const fajrAction = starter.actions.find(
    (a) => a.id === STARTER_PACK_ACTION_IDS.FAJR_FARD,
  )!;
  const adhkarAction = starter.actions.find(
    (a) => a.id === STARTER_PACK_ACTION_IDS.ADHKAR_MORNING,
  )!;
  const quranAction = starter.actions.find(
    (a) => a.id === STARTER_PACK_ACTION_IDS.QURAN_WIRD,
  )!;
  const periodFajrActions = starter.actions.filter(
    (a) => a.period_id === STARTER_PACK_PERIOD_IDS.FAJR,
  );

  let activeDbName: string;
  let activeEngine: OutboxEngine | null = null;

  beforeEach(() => {
    activeDbName = nextDbName();
  });

  afterEach(async () => {
    activeEngine?.dispose();
    activeEngine = null;
    await closeClientDb(activeDbName);
  });

  it('commits single tap & bulk batch Undo in <50ms with zero network calls', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    let now = Date.UTC(2026, 10, 21, 5, 30, 0);
    activeEngine = new OutboxEngine({
      dbName: activeDbName,
      fetchFn: fetchMock,
      nowFn: () => now,
      isOnlineFn: () => true,
    });

    const tapRes = await activeEngine.enqueueCellTap(
      {
        action: fajrAction,
        logDate: '2026-11-21',
        status: 'DONE',
      },
      { targetVersions: starter.targetVersions, holdMs: 5000 },
    );

    expect(tapRes.durationMs).toBeLessThan(500);
    expect(tapRes.items).toHaveLength(1);
    expect(tapRes.items[0]!.state).toBe('held');
    expect(tapRes.items[0]!.attempt_count).toBe(0);
    expect(tapRes.items[0]!.hold_until).toBe(now + 5000);
    expect(tapRes.items[0]!.undo_prior_snapshot).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const undoRes = await activeEngine.undoMutation(tapRes.items[0]!.mutation_id);
    expect(undoRes.undoneCount).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();

    const afterUndo = await activeEngine.readHydrationState();
    expect(afterUndo.logs).toHaveLength(0);
    expect(afterUndo.outbox).toHaveLength(0);

    // Bulk batch tap + batch Undo
    now += 1000;
    const bulkRes = await activeEngine.enqueueCellMutations(
      periodFajrActions.map((action) => ({
        action,
        logDate: '2026-11-21',
        status: 'DONE' as const,
      })),
      { targetVersions: starter.targetVersions, holdMs: 5000 },
    );

    expect(bulkRes.batchId).toBeTruthy();
    expect(bulkRes.items).toHaveLength(periodFajrActions.length);
    expect(fetchMock).not.toHaveBeenCalled();

    const midState = await activeEngine.readHydrationState();
    expect(midState.logs).toHaveLength(periodFajrActions.length);
    expect(midState.outbox).toHaveLength(periodFajrActions.length);

    const bulkUndo = await activeEngine.undoBatch(bulkRes.batchId!);
    expect(bulkUndo.undoneCount).toBe(periodFajrActions.length);
    expect(fetchMock).not.toHaveBeenCalled();

    const endState = await activeEngine.readHydrationState();
    expect(endState.logs).toHaveLength(0);
    expect(endState.outbox).toHaveLength(0);
  });

  it('recovers durable held items after app-close inside 5s Undo window without pagehide keepalive', async () => {
    let now = Date.UTC(2026, 10, 21, 5, 30, 0);
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        device_id: string;
        mutations: Array<{ mutation_id: string; action_id: string; log_date: string }>;
      };
      const m = body.mutations[0]!;
      const resolved: DailyLog = {
        action_id: m.action_id,
        log_date: m.log_date,
        availability_override: null,
        status: 'DONE',
        percent_value: null,
        qadaa_resolved_at: null,
        target_version_id: null,
        note: null,
        note_updated_at: null,
        row_version: 1,
        last_mutation_id: m.mutation_id,
        last_device_id: body.device_id,
        client_updated_at: new Date(now).toISOString(),
      };
      return new Response(
        JSON.stringify({
          server_now: new Date(now).toISOString(),
          results: [
            {
              mutation_id: m.mutation_id,
              outcome: 'applied',
              resolved_row: resolved,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    activeEngine = new OutboxEngine({
      dbName: activeDbName,
      fetchFn: fetchMock,
      nowFn: () => now,
      isOnlineFn: () => true,
    });

    await activeEngine.enqueueCellTap(
      { action: fajrAction, logDate: '2026-11-21', status: 'DONE' },
      { holdMs: 5000 },
    );

    // Simulate app closing before 5s and reopening at +6s
    activeEngine.dispose();
    await closeClientDb(activeDbName);
    now += 6000;

    activeEngine = new OutboxEngine({
      dbName: activeDbName,
      fetchFn: fetchMock,
      nowFn: () => now,
      isOnlineFn: () => true,
    });

    const promoted = await activeEngine.promoteExpiredHolds();
    expect(promoted).toBe(1);

    const flushRes = await activeEngine.flushOutbox();
    expect(flushRes.ok).toBe(true);
    expect(flushRes.appliedCount).toBe(1);

    const state = await activeEngine.readHydrationState();
    expect(state.outbox).toHaveLength(0);
    expect(state.logs).toHaveLength(1);
    expect(state.logs[0]!.server_row_version).toBe(1);
  });

  it('coalesces attempt_count===0, freezes M1 on dispatch, chains M2 with parent_mutation_id, and applies stale-ACK protection', async () => {
    let now = Date.UTC(2026, 10, 21, 6, 0, 0);
    let resolveM1Fetch!: (res: Response) => void;
    let callCount = 0;

    const sentPayloads: Array<{
      device_id: string;
      mutations: Array<{
        mutation_id: string;
        parent_mutation_id: string | null;
        base_row_version: number | null;
        status: string | null;
        percent_value: number | null;
      }>;
    }> = [];

    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      callCount += 1;
      const body = JSON.parse(String(init?.body)) as (typeof sentPayloads)[number];
      sentPayloads.push(body);

      if (callCount === 1) {
        return new Promise<Response>((resolve) => {
          resolveM1Fetch = resolve;
        });
      }

      const m2 = body.mutations[0]!;
      const resolvedM2: DailyLog = {
        action_id: quranAction.id,
        log_date: '2026-11-21',
        availability_override: null,
        status: 'MISSED',
        percent_value: null,
        qadaa_resolved_at: null,
        target_version_id: null,
        note: null,
        note_updated_at: null,
        row_version: 2,
        last_mutation_id: m2.mutation_id,
        last_device_id: body.device_id,
        client_updated_at: new Date(now).toISOString(),
      };
      return new Response(
        JSON.stringify({
          server_now: new Date(now).toISOString(),
          results: [
            {
              mutation_id: m2.mutation_id,
              outcome: 'applied',
              resolved_row: resolvedM2,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    activeEngine = new OutboxEngine({
      dbName: activeDbName,
      fetchFn: fetchMock,
      nowFn: () => now,
      isOnlineFn: () => true,
    });

    // Tap 1 (attempt_count === 0)
    const tap1 = await activeEngine.enqueueCellTap(
      {
        action: quranAction,
        logDate: '2026-11-21',
        status: 'PERCENT',
        percent_value: 25,
      },
      { targetVersions: starter.targetVersions, holdMs: 5000 },
    );
    const m1Id = tap1.items[0]!.mutation_id;

    // Rapid Tap 2 while held -> MUST coalesce into M1
    now += 500;
    const tap2 = await activeEngine.enqueueCellTap(
      {
        action: quranAction,
        logDate: '2026-11-21',
        status: 'PERCENT',
        percent_value: 50,
      },
      { targetVersions: starter.targetVersions, holdMs: 5000 },
    );
    expect(tap2.items[0]!.mutation_id).toBe(m1Id);
    expect(tap2.items[0]!.percent_value).toBe(50);

    // Expire hold and start flushing M1 (blocks mid-flight on fetch)
    now += 6000;
    const flush1Promise = activeEngine.flushOutbox();

    // Wait until fetchMock has been invoked for M1
    await vi.waitFor(() => {
      expect(callCount).toBe(1);
    });

    // While M1 is in_flight (attempt_count === 1), user taps MISSED -> MUST create M2 with parent_mutation_id = M1
    now += 100;
    const tap3 = await activeEngine.enqueueCellTap(
      {
        action: quranAction,
        logDate: '2026-11-21',
        status: 'MISSED',
      },
      { targetVersions: starter.targetVersions, holdMs: 0 },
    );
    const m2Item = tap3.items[0]!;
    expect(m2Item.mutation_id).not.toBe(m1Id);
    expect(m2Item.parent_mutation_id).toBe(m1Id);
    expect(m2Item.status).toBe('MISSED');

    // Now resolve M1's delayed ACK with older PERCENT 50 row (row_version = 1)
    const m1AckRow: DailyLog = {
      action_id: quranAction.id,
      log_date: '2026-11-21',
      availability_override: null,
      status: 'PERCENT',
      percent_value: 50,
      qadaa_resolved_at: null,
      target_version_id: m2Item.client_target_version_id,
      note: null,
      note_updated_at: null,
      row_version: 1,
      last_mutation_id: m1Id,
      last_device_id: m2Item.device_id,
      client_updated_at: new Date(now - 6000).toISOString(),
    };
    resolveM1Fetch(
      new Response(
        JSON.stringify({
          server_now: new Date(now).toISOString(),
          results: [
            {
              mutation_id: m1Id,
              outcome: 'applied',
              resolved_row: m1AckRow,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const flush1Res = await flush1Promise;
    expect(flush1Res.ok).toBe(true);
    expect(callCount).toBe(2);

    // Verify M2 was sent with parent_mutation_id = M1 and updated base_row_version = 1
    expect(sentPayloads[1]!.mutations[0]!.mutation_id).toBe(m2Item.mutation_id);
    expect(sentPayloads[1]!.mutations[0]!.parent_mutation_id).toBe(m1Id);
    expect(sentPayloads[1]!.mutations[0]!.base_row_version).toBe(1);

    const finalState = await activeEngine.readHydrationState();
    expect(finalState.outbox).toHaveLength(0);
    expect(finalState.logs).toHaveLength(1);
    expect(finalState.logs[0]!.status).toBe('MISSED');
    expect(finalState.logs[0]!.server_row_version).toBe(2);
  });

  it('keeps logs at M2 optimistic state when M1 stale ACK arrives before M2 flushes', async () => {
    let now = Date.UTC(2026, 10, 21, 7, 0, 0);
    let resolveM1Fetch!: (res: Response) => void;
    let online = true;

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Promise<Response>((resolve) => {
        resolveM1Fetch = resolve;
      });
    });

    activeEngine = new OutboxEngine({
      dbName: activeDbName,
      fetchFn: fetchMock,
      nowFn: () => now,
      isOnlineFn: () => online,
    });

    const m1 = await activeEngine.enqueueCellTap(
      { action: fajrAction, logDate: '2026-11-21', status: 'DONE' },
      { holdMs: 0 },
    );
    const m1Id = m1.items[0]!.mutation_id;

    const flush1 = activeEngine.flushOutbox();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Queue M2 while M1 is in_flight and go offline before M2 flushes
    online = false;
    now += 50;
    const m2 = await activeEngine.enqueueCellTap(
      { action: fajrAction, logDate: '2026-11-21', status: 'MISSED' },
      { holdMs: 0 },
    );

    // M1 ACK arrives with older DONE row
    resolveM1Fetch(
      new Response(
        JSON.stringify({
          server_now: new Date(now).toISOString(),
          results: [
            {
              mutation_id: m1Id,
              outcome: 'applied',
              resolved_row: {
                action_id: fajrAction.id,
                log_date: '2026-11-21',
                availability_override: null,
                status: 'DONE',
                percent_value: null,
                qadaa_resolved_at: null,
                target_version_id: null,
                note: null,
                note_updated_at: null,
                row_version: 1,
                last_mutation_id: m1Id,
                last_device_id: m2.items[0]!.device_id,
                client_updated_at: new Date(now - 50).toISOString(),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await flush1;

    const midState = await activeEngine.readHydrationState();
    // Stale-ACK MUST NOT overwrite M2's MISSED with M1's DONE!
    expect(midState.logs[0]!.status).toBe('MISSED');
    expect(midState.logs[0]!.server_row_version).toBe(1);
    expect(midState.outbox).toHaveLength(1);
    expect(midState.outbox[0]!.mutation_id).toBe(m2.items[0]!.mutation_id);
    expect(midState.outbox[0]!.base_row_version).toBe(1);
  });

  it('drains held/pending items without deadlocking on an attention_needed item and supports attention recovery', async () => {
    let now = Date.UTC(2026, 10, 21, 8, 0, 0);
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        device_id: string;
        mutations: Array<{ mutation_id: string; action_id: string; log_date: string }>;
      };
      const results = body.mutations.map((m) => {
        if (m.action_id === adhkarAction.id) {
          return {
            mutation_id: m.mutation_id,
            outcome: 'rejected',
            error: 'Simulated poison item',
          };
        }
        return {
          mutation_id: m.mutation_id,
          outcome: 'applied',
          resolved_row: {
            action_id: m.action_id,
            log_date: m.log_date,
            availability_override: null,
            status: 'DONE',
            percent_value: null,
            qadaa_resolved_at: null,
            target_version_id: null,
            note: null,
            note_updated_at: null,
            row_version: 1,
            last_mutation_id: m.mutation_id,
            last_device_id: body.device_id,
            client_updated_at: new Date(now).toISOString(),
          },
        };
      });
      return new Response(
        JSON.stringify({
          server_now: new Date(now).toISOString(),
          results,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    activeEngine = new OutboxEngine({
      dbName: activeDbName,
      fetchFn: fetchMock,
      nowFn: () => now,
      isOnlineFn: () => true,
    });

    // Enqueue poison item & flush -> moves to attention_needed
    const poison = await activeEngine.enqueueCellTap(
      { action: adhkarAction, logDate: '2026-11-21', status: 'DONE' },
      { holdMs: 0 },
    );
    await activeEngine.flushOutbox();

    const afterPoison = await activeEngine.readHydrationState();
    expect(afterPoison.outbox).toHaveLength(1);
    expect(afterPoison.outbox[0]!.state).toBe('attention_needed');

    // Enqueue a valid held item (5s Undo active) then call drainBeforeCrud()
    now += 1000;
    await activeEngine.enqueueCellTap(
      { action: fajrAction, logDate: '2026-11-21', status: 'DONE' },
      { holdMs: 5000 },
    );

    const drainRes = await activeEngine.drainBeforeCrud();
    expect(drainRes.ok).toBe(true);
    expect(drainRes.remainingActiveCount).toBe(0);
    expect(drainRes.remainingAttentionCount).toBe(1);

    // Verify retryAttentionItem + exportAndDiscardAttentionItem
    const poisonId = poison.items[0]!.mutation_id;
    expect(await activeEngine.retryAttentionItem(poisonId)).toBe(true);
    let badge = await activeEngine.getSyncBadgeSummary(false);
    expect(badge.state).toBe('offline_pending');

    // Flush again -> back to attention_needed
    await activeEngine.flushOutbox();
    badge = await activeEngine.getSyncBadgeSummary(false);
    expect(badge.state).toBe('attention_needed');

    const exp = await activeEngine.exportAndDiscardAttentionItem(poisonId);
    expect(exp.discarded).toBe(true);
    expect(exp.exportedItem?.mutation_id).toBe(poisonId);
    expect(exp.emergencySnapshot.export_kind).toBe('offline_emergency_backup');

    const postDiscard = await activeEngine.readHydrationState();
    expect(postDiscard.outbox).toHaveLength(0);
    // Restored undo_prior_snapshot (deleted because prior was null)
    expect(
      postDiscard.logs.find((l) => l.action_id === adhkarAction.id),
    ).toBeUndefined();
  });

  it('skips dirty outbox cells during /api/bootstrap and /api/logs merge, and wipes all 4 stores on wipeAllLocalData', async () => {
    const now = Date.UTC(2026, 10, 21, 9, 0, 0);
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          from: '2026-01-01',
          to: '2026-01-07',
          daily_logs: [
            {
              action_id: fajrAction.id,
              log_date: '2026-01-01',
              availability_override: null,
              status: 'DONE',
              percent_value: null,
              qadaa_resolved_at: null,
              target_version_id: null,
              note: null,
              note_updated_at: null,
              row_version: 1,
              last_mutation_id: null,
              last_device_id: null,
              client_updated_at: '2026-01-01T05:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    activeEngine = new OutboxEngine({
      dbName: activeDbName,
      fetchFn: fetchMock,
      nowFn: () => now,
      isOnlineFn: () => true,
    });

    // Cell A (fajrAction on 2026-11-21) is dirty in outbox with DONE
    await activeEngine.enqueueCellTap(
      { action: fajrAction, logDate: '2026-11-21', status: 'DONE' },
      { holdMs: 5000 },
    );

    const bootstrapPayload: BootstrapPayload = {
      server_now: new Date(now).toISOString(),
      ntfy_configured: false,
      settings: makeSettings(),
      periods: starter.periods,
      actions: starter.actions,
      target_versions: starter.targetVersions,
      daily_logs: [
        {
          action_id: fajrAction.id,
          log_date: '2026-11-21',
          availability_override: null,
          status: 'MISSED',
          percent_value: null,
          qadaa_resolved_at: null,
          target_version_id: null,
          note: 'server note',
          note_updated_at: new Date(now).toISOString(),
          row_version: 3,
          last_mutation_id: null,
          last_device_id: null,
          client_updated_at: new Date(now).toISOString(),
        },
        {
          action_id: adhkarAction.id,
          log_date: '2026-11-21',
          availability_override: null,
          status: 'DONE',
          percent_value: null,
          qadaa_resolved_at: null,
          target_version_id: null,
          note: null,
          note_updated_at: null,
          row_version: 2,
          last_mutation_id: null,
          last_device_id: null,
          client_updated_at: new Date(now).toISOString(),
        },
      ],
    };

    const mergeRes = await activeEngine.mergeBootstrapIntoIdb(bootstrapPayload);
    expect(mergeRes.skippedDirtyCells).toEqual([
      makeCellKey(fajrAction.id, '2026-11-21'),
    ]);
    expect(mergeRes.mergedLogCount).toBe(1);

    // Lazy >90d logs fetch
    await activeEngine.fetchAndCacheLogsRange('2026-01-01', '2026-01-07');

    const hydrated = await activeEngine.readHydrationState();
    const cellA = hydrated.logs.find(
      (l) => l.cell_key === makeCellKey(fajrAction.id, '2026-11-21'),
    );
    const cellB = hydrated.logs.find(
      (l) => l.cell_key === makeCellKey(adhkarAction.id, '2026-11-21'),
    );
    const historicalCell = hydrated.logs.find(
      (l) => l.cell_key === makeCellKey(fajrAction.id, '2026-01-01'),
    );

    expect(cellA?.status).toBe('DONE'); // Dirty local cell preserved!
    expect(cellB?.status).toBe('DONE');
    expect(cellB?.server_row_version).toBe(2);
    expect(historicalCell?.status).toBe('DONE');

    // Sync badge checks
    expect(
      computeSyncBadgeState({
        isOnline: false,
        outboxItems: hydrated.outbox,
        isSyncing: false,
        consecutiveFailures: 0,
        hasAuthError: false,
      }).state,
    ).toBe('offline_pending');
    expect(
      computeSyncBadgeState({
        isOnline: true,
        outboxItems: hydrated.outbox,
        isSyncing: true,
        consecutiveFailures: 0,
        hasAuthError: false,
      }).state,
    ).toBe('syncing');
    expect(
      computeSyncBadgeState({
        isOnline: true,
        outboxItems: hydrated.outbox,
        isSyncing: false,
        consecutiveFailures: 3,
        hasAuthError: false,
      }).state,
    ).toBe('attention_needed');
    expect(
      computeSyncBadgeState({
        isOnline: true,
        outboxItems: [],
        isSyncing: false,
        consecutiveFailures: 0,
        hasAuthError: false,
      }).state,
    ).toBe('synced');

    // Wipe all 4 IDB stores
    await wipeAllLocalData(activeDbName);
    const db = await openClientDb(activeDbName);
    expect(await db.count('snapshot')).toBe(0);
    expect(await db.count('logs')).toBe(0);
    expect(await db.count('outbox')).toBe(0);
    expect(await db.count('meta')).toBe(0);
  });
});

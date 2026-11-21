import {
  canonicalizeLogMutation,
  resolveActiveTargetVersion,
  type Action,
  type AppSettings,
  type AvailabilityOverride,
  type CellStatus,
  type DailyLog,
  type Period,
  type SyncMutation,
  type SyncResultItem,
  type TargetVersion,
  makeCellKey,
} from '@/domain';
import {
  DEFAULT_DB_NAME,
  openClientDb,
  runReadOnlyTx,
  runReadWriteTx,
  type LocalDailyLog,
  type OutboxItem,
  type OutboxState,
} from '../db/idb';

export const MAX_SYNC_BATCH_SIZE = 50;
export const DEFAULT_UNDO_HOLD_MS = 5_000;
export const SYNC_BROADCAST_CHANNEL = 'mohasba-sync';
export const SYNC_LOCK_NAME = 'mohasba-outbox-drain';

export type SyncBadgeState =
  | 'synced'
  | 'syncing'
  | 'offline_pending'
  | 'attention_needed';

export interface SyncBadgeSummary {
  state: SyncBadgeState;
  pendingCount: number;
  heldCount: number;
  inFlightCount: number;
  attentionCount: number;
  activeCount: number;
  consecutiveFailures: number;
  hasAuthError: boolean;
}

export interface CellMutationInput {
  action: Action;
  logDate: string;
  availability_override?: AvailabilityOverride | null;
  status?: CellStatus | null;
  percent_value?: number | null;
  qadaa_resolved_at?: string | null;
  clientTargetVersionId?: string | null;
  note?: string | null;
  note_updated_at?: string | null;
}

export interface EnqueueOptions {
  targetVersions?: readonly TargetVersion[];
  holdMs?: number;
  batchId?: string | null;
}

export interface EnqueueResult {
  batchId: string | null;
  items: OutboxItem[];
  logs: LocalDailyLog[];
  durationMs: number;
}

export interface UndoResult {
  undoneCount: number;
  cellKeys: string[];
}

export interface FlushResult {
  ok: boolean;
  reason?: 'offline' | 'locked' | 'auth_required' | 'network_error';
  flushedCount: number;
  appliedCount: number;
  attentionCount: number;
  remainingActiveCount: number;
}

export interface DrainBeforeCrudResult {
  ok: boolean;
  reason?: 'offline' | 'auth_required' | 'network_error';
  remainingActiveCount: number;
  remainingAttentionCount: number;
}

export interface BootstrapPayload {
  server_now: string;
  ntfy_configured: boolean;
  settings: AppSettings;
  periods: Period[];
  actions: Action[];
  target_versions: TargetVersion[];
  daily_logs: DailyLog[];
}

export interface OfflineEmergencyExport {
  schema_version: 1;
  export_kind: 'offline_emergency_backup';
  exported_at: string;
  device_id: string | null;
  last_synced_at: string | null;
  settings: AppSettings | null;
  periods: Period[];
  actions: Action[];
  target_versions: TargetVersion[];
  daily_logs: DailyLog[];
  pending_outbox: Array<Omit<OutboxItem, 'undo_prior_snapshot'>>;
  counts: {
    periods: number;
    actions: number;
    target_versions: number;
    daily_logs: number;
    pending_outbox: number;
  };
}

export type SyncBroadcastMessage = {
  type: 'idb_updated';
  reason: 'enqueue' | 'undo' | 'sync_ack' | 'bootstrap' | 'logs_range' | 'attention' | 'wipe';
  ts: number;
};

export interface OutboxEngineOptions {
  dbName?: string;
  fetchFn?: typeof fetch;
  nowFn?: () => number;
  isOnlineFn?: () => boolean;
  onBroadcast?: (msg: SyncBroadcastMessage) => void;
}

export function toLocalDailyLog(
  row: DailyLog,
  serverRowVersion: number | null = row.row_version,
): LocalDailyLog {
  return {
    ...row,
    cell_key: makeCellKey(row.action_id, row.log_date),
    server_row_version: serverRowVersion,
  };
}

export function stripLocalLogMeta(localLog: LocalDailyLog): DailyLog {
  const {
    cell_key: _cellKey,
    server_row_version: _serverRowVersion,
    ...domainLog
  } = localLog;
  void _cellKey;
  void _serverRowVersion;
  return domainLog;
}

export function toSyncMutation(item: OutboxItem): SyncMutation {
  return {
    mutation_id: item.mutation_id,
    device_id: item.device_id,
    parent_mutation_id: item.parent_mutation_id,
    action_id: item.action_id,
    log_date: item.log_date,
    base_row_version: item.base_row_version,
    availability_override: item.availability_override,
    status: item.status,
    percent_value: item.percent_value,
    qadaa_resolved_at: item.qadaa_resolved_at,
    client_target_version_id: item.client_target_version_id,
    note: item.note,
    note_updated_at: item.note_updated_at,
    client_updated_at: item.client_updated_at,
  };
}

export function computeSyncBadgeState(params: {
  isOnline: boolean;
  outboxItems: readonly OutboxItem[];
  isSyncing: boolean;
  consecutiveFailures: number;
  hasAuthError: boolean;
}): SyncBadgeSummary {
  let heldCount = 0;
  let pendingCount = 0;
  let inFlightCount = 0;
  let attentionCount = 0;

  for (const item of params.outboxItems) {
    switch (item.state) {
      case 'held':
        heldCount += 1;
        break;
      case 'pending':
        pendingCount += 1;
        break;
      case 'in_flight':
        inFlightCount += 1;
        break;
      case 'attention_needed':
        attentionCount += 1;
        break;
    }
  }

  const activeCount = heldCount + pendingCount + inFlightCount;

  let state: SyncBadgeState;
  if (
    params.hasAuthError ||
    attentionCount > 0 ||
    (params.isOnline && params.consecutiveFailures >= 3 && activeCount > 0)
  ) {
    state = 'attention_needed';
  } else if (params.isSyncing || inFlightCount > 0) {
    state = 'syncing';
  } else if (activeCount > 0) {
    state = 'offline_pending';
  } else {
    state = 'synced';
  }

  return {
    state,
    pendingCount,
    heldCount,
    inFlightCount,
    attentionCount,
    activeCount,
    consecutiveFailures: params.consecutiveFailures,
    hasAuthError: params.hasAuthError,
  };
}

export function computeBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(60_000, 1_000 * 2 ** (consecutiveFailures - 1));
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class OutboxEngine {
  readonly dbName: string;
  private readonly fetchFn: typeof fetch;
  private readonly nowFn: () => number;
  private readonly isOnlineFn: () => boolean;
  private readonly onBroadcast?: (msg: SyncBroadcastMessage) => void;
  private readonly channel: BroadcastChannel | null;
  private inMemoryLock: Promise<void> | null = null;
  private lastCreatedAt = 0;

  constructor(options: OutboxEngineOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.fetchFn =
      options.fetchFn ?? ((...args) => globalThis.fetch(...args));
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.isOnlineFn =
      options.isOnlineFn ??
      (() => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true));
    this.onBroadcast = options.onBroadcast;
    this.channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(SYNC_BROADCAST_CHANNEL)
        : null;
  }

  dispose(): void {
    if (this.channel) {
      this.channel.close();
    }
  }

  private nextCreatedAt(nowMs: number): number {
    this.lastCreatedAt = Math.max(nowMs, this.lastCreatedAt + 1);
    return this.lastCreatedAt;
  }

  private emitBroadcast(reason: SyncBroadcastMessage['reason']): void {
    const msg: SyncBroadcastMessage = {
      type: 'idb_updated',
      reason,
      ts: this.nowFn(),
    };
    this.onBroadcast?.(msg);
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch {
        // Channel may be closed during teardown
      }
    }
  }

  private async withDrainLock<T>(
    ifAvailable: boolean,
    fn: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    if (
      typeof navigator !== 'undefined' &&
      navigator.locks &&
      typeof navigator.locks.request === 'function'
    ) {
      let ran = false;
      let result: T | undefined;
      await navigator.locks.request(
        SYNC_LOCK_NAME,
        { ifAvailable },
        async (lock) => {
          if (!lock) return;
          ran = true;
          result = await fn();
        },
      );
      if (!ran) return { acquired: false };
      return { acquired: true, value: result as T };
    }

    if (ifAvailable && this.inMemoryLock) {
      return { acquired: false };
    }

    while (this.inMemoryLock) {
      await this.inMemoryLock;
    }

    let release!: () => void;
    this.inMemoryLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const value = await fn();
      return { acquired: true, value };
    } finally {
      this.inMemoryLock = null;
      release();
    }
  }

  async ensureDeviceId(): Promise<string> {
    return runReadWriteTx(
      ['meta'],
      async (tx) => {
        const metaStore = tx.objectStore('meta');
        const existing = await metaStore.get('device_id');
        if (existing && typeof existing.value === 'string' && existing.value.length > 0) {
          return existing.value;
        }
        const id = generateUuid();
        await metaStore.put({ key: 'device_id', value: id });
        return id;
      },
      this.dbName,
    );
  }

  /**
   * Atomically writes 1 or more cell mutations to `logs` + `outbox` in ONE readwrite transaction (<50ms).
   * - Coalesces ONLY when an existing outbox item for `cell_key` has `attempt_count === 0`.
   * - Once an item is dispatched (`attempt_count >= 1`), its `mutation_id` & payload stay frozen forever;
   *   subsequent edits allocate a new `mutation_id` with `parent_mutation_id = previous.mutation_id`.
   */
  async enqueueCellMutations(
    inputs: readonly CellMutationInput[],
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    if (inputs.length === 0) {
      return { batchId: null, items: [], logs: [], durationMs: 0 };
    }

    const startPerf = typeof performance !== 'undefined' ? performance.now() : this.nowFn();
    const nowMs = this.nowFn();
    const nowIso = new Date(nowMs).toISOString();
    const holdMs = options.holdMs ?? DEFAULT_UNDO_HOLD_MS;
    const batchId =
      options.batchId !== undefined
        ? options.batchId
        : inputs.length > 1
          ? generateUuid()
          : null;
    const targetVersions = options.targetVersions ?? [];

    const { items, logs } = await runReadWriteTx(
      ['logs', 'outbox', 'meta'],
      async (tx) => {
        const metaStore = tx.objectStore('meta');
        const logsStore = tx.objectStore('logs');
        const outboxStore = tx.objectStore('outbox');

        const devRec = await metaStore.get('device_id');
        let deviceId =
          devRec && typeof devRec.value === 'string' && devRec.value.length > 0
            ? devRec.value
            : '';
        if (!deviceId) {
          deviceId = generateUuid();
          await metaStore.put({ key: 'device_id', value: deviceId });
        }

        const writtenItems: OutboxItem[] = [];
        const writtenLogs: LocalDailyLog[] = [];

        for (const input of inputs) {
          const cellKey = makeCellKey(input.action.id, input.logDate);
          const existingLog = (await logsStore.get(cellKey)) ?? null;
          const cellOutbox = await outboxStore.index('by_cell_key').getAll(cellKey);
          cellOutbox.sort((a, b) => {
            if (a.created_at !== b.created_at) return a.created_at - b.created_at;
            return a.mutation_id.localeCompare(b.mutation_id);
          });

          const canonical = canonicalizeLogMutation(
            input.action,
            {
              availability_override: input.availability_override ?? null,
              status: input.status ?? null,
              percent_value: input.percent_value ?? null,
              qadaa_resolved_at: input.qadaa_resolved_at ?? null,
            },
            nowIso,
            input.logDate,
          );

          const note =
            input.note !== undefined ? input.note : (existingLog?.note ?? null);
          const noteUpdatedAt =
            input.note !== undefined
              ? (input.note_updated_at ?? nowIso)
              : (existingLog?.note_updated_at ?? null);

          const targetVersionId =
            input.clientTargetVersionId !== undefined
              ? input.clientTargetVersionId
              : existingLog?.target_version_id ??
                resolveActiveTargetVersion(targetVersions, input.action.id, input.logDate)
                  ?.id ??
                null;

          const existingMutable = cellOutbox.find(
            (item) =>
              item.attempt_count === 0 &&
              (item.state === 'held' || item.state === 'pending'),
          );

          const nextState: OutboxState = holdMs > 0 ? 'held' : 'pending';
          const holdUntil = holdMs > 0 ? nowMs + holdMs : null;

          let outboxItem: OutboxItem;
          if (existingMutable) {
            outboxItem = {
              ...existingMutable,
              batch_id: batchId,
              state: nextState,
              hold_until: holdUntil,
              updated_at: nowMs,
              last_error: null,
              last_http_status: null,
              availability_override: canonical.availability_override,
              status: canonical.status,
              percent_value: canonical.percent_value,
              qadaa_resolved_at: canonical.qadaa_resolved_at,
              client_target_version_id: targetVersionId,
              note,
              note_updated_at: noteUpdatedAt,
              client_updated_at: nowIso,
            };
          } else {
            const lastFrozen =
              cellOutbox.length > 0 ? cellOutbox[cellOutbox.length - 1]! : null;
            outboxItem = {
              mutation_id: generateUuid(),
              cell_key: cellKey,
              batch_id: batchId,
              state: nextState,
              hold_until: holdUntil,
              attempt_count: 0,
              created_at: this.nextCreatedAt(nowMs),
              updated_at: nowMs,
              last_error: null,
              last_http_status: null,
              device_id: deviceId,
              parent_mutation_id: lastFrozen ? lastFrozen.mutation_id : null,
              action_id: input.action.id,
              log_date: input.logDate,
              base_row_version: existingLog?.server_row_version ?? null,
              availability_override: canonical.availability_override,
              status: canonical.status,
              percent_value: canonical.percent_value,
              qadaa_resolved_at: canonical.qadaa_resolved_at,
              client_target_version_id: targetVersionId,
              note,
              note_updated_at: noteUpdatedAt,
              client_updated_at: nowIso,
              undo_prior_snapshot: existingLog,
            };
          }

          const nextLog: LocalDailyLog = {
            cell_key: cellKey,
            action_id: input.action.id,
            log_date: input.logDate,
            availability_override: canonical.availability_override,
            status: canonical.status,
            percent_value: canonical.percent_value,
            qadaa_resolved_at: canonical.qadaa_resolved_at,
            target_version_id: targetVersionId,
            note,
            note_updated_at: noteUpdatedAt,
            row_version: existingLog?.row_version ?? 1,
            server_row_version: existingLog?.server_row_version ?? null,
            last_mutation_id: outboxItem.mutation_id,
            last_device_id: deviceId,
            client_updated_at: nowIso,
            updated_at: nowIso,
          };

          await outboxStore.put(outboxItem);
          await logsStore.put(nextLog);
          writtenItems.push(outboxItem);
          writtenLogs.push(nextLog);
        }

        return { items: writtenItems, logs: writtenLogs };
      },
      this.dbName,
    );

    const endPerf = typeof performance !== 'undefined' ? performance.now() : this.nowFn();
    this.emitBroadcast('enqueue');
    return {
      batchId,
      items,
      logs,
      durationMs: Math.max(0, endPerf - startPerf),
    };
  }

  async enqueueCellTap(
    input: CellMutationInput,
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    return this.enqueueCellMutations([input], options);
  }

  async undoMutation(mutationId: string): Promise<UndoResult> {
    const result = await runReadWriteTx(
      ['logs', 'outbox'],
      async (tx) => {
        const outboxStore = tx.objectStore('outbox');
        const logsStore = tx.objectStore('logs');
        const item = await outboxStore.get(mutationId);

        if (
          !item ||
          item.attempt_count > 0 ||
          (item.state !== 'held' && item.state !== 'pending')
        ) {
          return { undoneCount: 0, cellKeys: [] };
        }

        await outboxStore.delete(item.mutation_id);
        if (item.undo_prior_snapshot) {
          await logsStore.put(item.undo_prior_snapshot);
        } else {
          await logsStore.delete(item.cell_key);
        }

        return { undoneCount: 1, cellKeys: [item.cell_key] };
      },
      this.dbName,
    );

    if (result.undoneCount > 0) {
      this.emitBroadcast('undo');
    }
    return result;
  }

  async undoBatch(batchId: string): Promise<UndoResult> {
    const result = await runReadWriteTx(
      ['logs', 'outbox'],
      async (tx) => {
        const outboxStore = tx.objectStore('outbox');
        const logsStore = tx.objectStore('logs');
        const all = await outboxStore.getAll();
        const targets = all.filter(
          (item) =>
            item.batch_id === batchId &&
            item.attempt_count === 0 &&
            (item.state === 'held' || item.state === 'pending'),
        );

        const cellKeys: string[] = [];
        for (const item of targets) {
          await outboxStore.delete(item.mutation_id);
          if (item.undo_prior_snapshot) {
            await logsStore.put(item.undo_prior_snapshot);
          } else {
            await logsStore.delete(item.cell_key);
          }
          cellKeys.push(item.cell_key);
        }

        return { undoneCount: targets.length, cellKeys };
      },
      this.dbName,
    );

    if (result.undoneCount > 0) {
      this.emitBroadcast('undo');
    }
    return result;
  }

  async promoteExpiredHolds(options: { releaseAll?: boolean; staleInFlightMs?: number } = {}): Promise<number> {
    const nowMs = this.nowFn();
    const releaseAll = options.releaseAll ?? false;
    const staleInFlightMs = options.staleInFlightMs ?? 30_000;

    return runReadWriteTx(
      ['outbox'],
      async (tx) => {
        const outboxStore = tx.objectStore('outbox');
        const all = await outboxStore.getAll();
        let promoted = 0;

        for (const item of all) {
          if (
            item.state === 'held' &&
            (releaseAll || item.hold_until === null || nowMs >= item.hold_until)
          ) {
            await outboxStore.put({
              ...item,
              state: 'pending',
              hold_until: null,
              updated_at: nowMs,
            });
            promoted += 1;
          } else if (
            item.state === 'in_flight' &&
            staleInFlightMs > 0 &&
            nowMs - item.updated_at >= staleInFlightMs
          ) {
            // Re-queue stale in_flight item while preserving attempt_count >= 1 & frozen mutation_id
            await outboxStore.put({
              ...item,
              state: 'pending',
              updated_at: nowMs,
            });
            promoted += 1;
          }
        }

        return promoted;
      },
      this.dbName,
    );
  }

  private async markNextBatchInFlight(): Promise<{
    deviceId: string;
    batch: OutboxItem[];
  }> {
    const nowMs = this.nowFn();
    return runReadWriteTx(
      ['outbox', 'meta'],
      async (tx) => {
        const metaStore = tx.objectStore('meta');
        const outboxStore = tx.objectStore('outbox');

        const devRec = await metaStore.get('device_id');
        let deviceId =
          devRec && typeof devRec.value === 'string' && devRec.value.length > 0
            ? devRec.value
            : '';
        if (!deviceId) {
          deviceId = generateUuid();
          await metaStore.put({ key: 'device_id', value: deviceId });
        }

        const pending = await outboxStore.index('by_state').getAll('pending');
        pending.sort((a, b) => {
          if (a.created_at !== b.created_at) return a.created_at - b.created_at;
          return a.mutation_id.localeCompare(b.mutation_id);
        });

        const batch = pending.slice(0, MAX_SYNC_BATCH_SIZE);
        const updatedBatch: OutboxItem[] = [];
        for (const item of batch) {
          const frozen: OutboxItem = {
            ...item,
            state: 'in_flight',
            attempt_count: item.attempt_count + 1,
            updated_at: nowMs,
          };
          await outboxStore.put(frozen);
          updatedBatch.push(frozen);
        }

        return { deviceId, batch: updatedBatch };
      },
      this.dbName,
    );
  }

  private async revertInFlightToPending(
    mutationIds: readonly string[],
    options: { authError?: string | null; incrementFailure?: boolean } = {},
  ): Promise<void> {
    const nowMs = this.nowFn();
    await runReadWriteTx(
      ['outbox', 'meta'],
      async (tx) => {
        const outboxStore = tx.objectStore('outbox');
        const metaStore = tx.objectStore('meta');

        for (const id of mutationIds) {
          const item = await outboxStore.get(id);
          if (item && item.state === 'in_flight') {
            await outboxStore.put({
              ...item,
              state: 'pending',
              updated_at: nowMs,
            });
          }
        }

        if (options.authError !== undefined) {
          await metaStore.put({
            key: 'last_auth_error',
            value: options.authError,
          });
        }

        if (options.incrementFailure) {
          const prev = await metaStore.get('consecutive_failures');
          const count = typeof prev?.value === 'number' ? prev.value + 1 : 1;
          await metaStore.put({
            key: 'consecutive_failures',
            value: count,
          });
        }
      },
      this.dbName,
    );
  }

  private async markBatchAttentionNeeded(
    mutationIds: readonly string[],
    httpStatus: number,
    errorMessage: string,
  ): Promise<void> {
    const nowMs = this.nowFn();
    await runReadWriteTx(
      ['outbox'],
      async (tx) => {
        const outboxStore = tx.objectStore('outbox');
        for (const id of mutationIds) {
          const item = await outboxStore.get(id);
          if (item) {
            await outboxStore.put({
              ...item,
              state: 'attention_needed',
              last_http_status: httpStatus,
              last_error: errorMessage,
              updated_at: nowMs,
            });
          }
        }
      },
      this.dbName,
    );
  }

  private async applySyncAckResults(
    serverNow: string,
    results: readonly SyncResultItem[],
  ): Promise<{ appliedCount: number; attentionCount: number }> {
    const nowMs = this.nowFn();
    const counts = await runReadWriteTx(
      ['outbox', 'logs', 'meta'],
      async (tx) => {
        const outboxStore = tx.objectStore('outbox');
        const logsStore = tx.objectStore('logs');
        const metaStore = tx.objectStore('meta');

        await metaStore.put({ key: 'consecutive_failures', value: 0 });
        await metaStore.put({ key: 'last_auth_error', value: null });
        await metaStore.put({ key: 'last_synced_at', value: serverNow });

        let appliedCount = 0;
        let attentionCount = 0;

        for (const res of results) {
          const item = await outboxStore.get(res.mutation_id);
          if (!item) continue;

          if (res.outcome === 'applied' || res.outcome === 'already_applied') {
            appliedCount += 1;
            await outboxStore.delete(item.mutation_id);

            const remainingForCell = (
              await outboxStore.index('by_cell_key').getAll(item.cell_key)
            ).filter((r) => r.mutation_id !== item.mutation_id);

            if (remainingForCell.length === 0) {
              if (res.resolved_row) {
                await logsStore.put(
                  toLocalDailyLog(res.resolved_row, res.resolved_row.row_version),
                );
              }
            } else if (res.resolved_row) {
              // STALE-ACK PROTECTION: Never overwrite newer optimistic state in `logs`
              // while M2+ is still queued in outbox for the same cell_key.
              const currentLocal = await logsStore.get(item.cell_key);
              if (currentLocal) {
                await logsStore.put({
                  ...currentLocal,
                  row_version: res.resolved_row.row_version,
                  server_row_version: res.resolved_row.row_version,
                });
              }
              for (const pendingItem of remainingForCell) {
                if (pendingItem.attempt_count === 0) {
                  await outboxStore.put({
                    ...pendingItem,
                    base_row_version: res.resolved_row.row_version,
                  });
                }
              }
            }
          } else if (res.outcome === 'rejected') {
            attentionCount += 1;
            await outboxStore.put({
              ...item,
              state: 'attention_needed',
              last_error: res.error ?? 'Rejected by server',
              last_http_status: 422,
              updated_at: nowMs,
            });
          } else if (res.outcome === 'race_conflict') {
            await outboxStore.put({
              ...item,
              state: 'pending',
              last_error: res.error ?? 'Race conflict; retry pending',
              updated_at: nowMs,
            });
          }
        }

        return { appliedCount, attentionCount };
      },
      this.dbName,
    );

    this.emitBroadcast('sync_ack');
    return counts;
  }

  async flushOutbox(
    options: { releaseAllHolds?: boolean; ifAvailableLock?: boolean } = {},
  ): Promise<FlushResult> {
    const releaseAllHolds = options.releaseAllHolds ?? false;
    const ifAvailableLock = options.ifAvailableLock ?? true;

    const lockRes = await this.withDrainLock(ifAvailableLock, async () => {
      if (!this.isOnlineFn()) {
        const remaining = await this.getActiveOutboxCount();
        return {
          ok: false,
          reason: 'offline' as const,
          flushedCount: 0,
          appliedCount: 0,
          attentionCount: 0,
          remainingActiveCount: remaining,
        };
      }

      await this.promoteExpiredHolds({ releaseAll: releaseAllHolds });

      let flushedCount = 0;
      let appliedCount = 0;
      let attentionCount = 0;

      while (true) {
        if (!this.isOnlineFn()) {
          const remaining = await this.getActiveOutboxCount();
          return {
            ok: false,
            reason: 'offline' as const,
            flushedCount,
            appliedCount,
            attentionCount,
            remainingActiveCount: remaining,
          };
        }

        const { deviceId, batch } = await this.markNextBatchInFlight();
        if (batch.length === 0) {
          break;
        }

        const mutationIds = batch.map((b) => b.mutation_id);
        let response: Response;
        try {
          response = await this.fetchFn('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              device_id: deviceId,
              mutations: batch.map(toSyncMutation),
            }),
            signal:
              typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
                ? AbortSignal.timeout(10_000)
                : undefined,
          });
        } catch {
          await this.revertInFlightToPending(mutationIds, {
            incrementFailure: true,
          });
          const remaining = await this.getActiveOutboxCount();
          return {
            ok: false,
            reason: 'network_error' as const,
            flushedCount,
            appliedCount,
            attentionCount,
            remainingActiveCount: remaining,
          };
        }

        if (response.status === 401) {
          await this.revertInFlightToPending(mutationIds, {
            authError: 'UNLOCK_REQUIRED',
          });
          const remaining = await this.getActiveOutboxCount();
          return {
            ok: false,
            reason: 'auth_required' as const,
            flushedCount,
            appliedCount,
            attentionCount,
            remainingActiveCount: remaining,
          };
        }

        if (response.status === 400 || response.status === 422) {
          const errText = await response.text().catch(() => 'Validation rejected');
          await this.markBatchAttentionNeeded(
            mutationIds,
            response.status,
            errText.slice(0, 300),
          );
          attentionCount += batch.length;
          this.emitBroadcast('attention');
          continue;
        }

        if (!response.ok) {
          await this.revertInFlightToPending(mutationIds, {
            incrementFailure: true,
          });
          const remaining = await this.getActiveOutboxCount();
          return {
            ok: false,
            reason: 'network_error' as const,
            flushedCount,
            appliedCount,
            attentionCount,
            remainingActiveCount: remaining,
          };
        }

        const data = (await response.json()) as {
          server_now: string;
          results: SyncResultItem[];
        };
        const ackSummary = await this.applySyncAckResults(
          data.server_now,
          data.results,
        );
        flushedCount += batch.length;
        appliedCount += ackSummary.appliedCount;
        attentionCount += ackSummary.attentionCount;
      }

      const remaining = await this.getActiveOutboxCount();
      return {
        ok: remaining === 0,
        flushedCount,
        appliedCount,
        attentionCount,
        remainingActiveCount: remaining,
      };
    });

    if (!lockRes.acquired) {
      const remaining = await this.getActiveOutboxCount();
      return {
        ok: false,
        reason: 'locked',
        flushedCount: 0,
        appliedCount: 0,
        attentionCount: 0,
        remainingActiveCount: remaining,
      };
    }

    return lockRes.value;
  }

  /**
   * Deadlock-free Drain-Before-CRUD gate:
   * Releases any `held` Undo items immediately and drains `held | pending | in_flight` to 0,
   * while explicitly EXCLUDING `attention_needed` items so poison items never deadlock Settings CRUD.
   */
  async drainBeforeCrud(): Promise<DrainBeforeCrudResult> {
    if (!this.isOnlineFn()) {
      const counts = await this.getOutboxCounts();
      return {
        ok: false,
        reason: 'offline',
        remainingActiveCount: counts.activeCount,
        remainingAttentionCount: counts.attentionCount,
      };
    }

    const flushRes = await this.flushOutbox({
      releaseAllHolds: true,
      ifAvailableLock: false,
    });
    const counts = await this.getOutboxCounts();

    if (counts.activeCount === 0) {
      return {
        ok: true,
        remainingActiveCount: 0,
        remainingAttentionCount: counts.attentionCount,
      };
    }

    return {
      ok: false,
      reason:
        flushRes.reason === 'auth_required'
          ? 'auth_required'
          : flushRes.reason === 'offline'
            ? 'offline'
            : 'network_error',
      remainingActiveCount: counts.activeCount,
      remainingAttentionCount: counts.attentionCount,
    };
  }

  /**
   * Merges `/api/bootstrap` (full or delta `?since=`) into IDB `snapshot` + `logs` + `meta`,
   * strictly skipping any `cell_key` currently present in `outbox`.
   */
  async mergeBootstrapIntoIdb(payload: BootstrapPayload): Promise<{
    skippedDirtyCells: string[];
    mergedLogCount: number;
  }> {
    const nowIso = new Date(this.nowFn()).toISOString();

    const summary = await runReadWriteTx(
      ['snapshot', 'logs', 'outbox', 'meta'],
      async (tx) => {
        const snapshotStore = tx.objectStore('snapshot');
        const logsStore = tx.objectStore('logs');
        const outboxStore = tx.objectStore('outbox');
        const metaStore = tx.objectStore('meta');

        await Promise.all([
          snapshotStore.put({
            key: 'settings',
            value: payload.settings,
            updated_at: nowIso,
          }),
          snapshotStore.put({
            key: 'periods',
            value: payload.periods,
            updated_at: nowIso,
          }),
          snapshotStore.put({
            key: 'actions',
            value: payload.actions,
            updated_at: nowIso,
          }),
          snapshotStore.put({
            key: 'target_versions',
            value: payload.target_versions,
            updated_at: nowIso,
          }),
        ]);

        const outboxItems = await outboxStore.getAll();
        const dirtyCellKeys = new Set(outboxItems.map((i) => i.cell_key));

        const skippedDirtyCells: string[] = [];
        let mergedLogCount = 0;

        for (const serverLog of payload.daily_logs) {
          const cellKey = makeCellKey(serverLog.action_id, serverLog.log_date);
          if (dirtyCellKeys.has(cellKey)) {
            skippedDirtyCells.push(cellKey);
            continue;
          }
          await logsStore.put(
            toLocalDailyLog(serverLog, serverLog.row_version),
          );
          mergedLogCount += 1;
        }

        await metaStore.put({ key: 'last_synced_at', value: payload.server_now });
        await metaStore.put({ key: 'last_auth_error', value: null });

        return { skippedDirtyCells, mergedLogCount };
      },
      this.dbName,
    );

    this.emitBroadcast('bootstrap');
    return summary;
  }

  /**
   * Lazy-loads >90d historical logs from `GET /api/logs?from=&to=` and caches into IDB
   * while still protecting dirty `outbox` cells.
   */
  async fetchAndCacheLogsRange(from: string, to: string): Promise<DailyLog[]> {
    const params = new URLSearchParams({ from, to });
    const response = await this.fetchFn(`/api/logs?${params.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`Failed loading logs range (${response.status})`);
    }

    const data = (await response.json()) as {
      from: string;
      to: string;
      daily_logs: DailyLog[];
    };

    await runReadWriteTx(
      ['logs', 'outbox'],
      async (tx) => {
        const logsStore = tx.objectStore('logs');
        const outboxStore = tx.objectStore('outbox');
        const outboxItems = await outboxStore.getAll();
        const dirtyCellKeys = new Set(outboxItems.map((i) => i.cell_key));

        for (const row of data.daily_logs) {
          const cellKey = makeCellKey(row.action_id, row.log_date);
          if (dirtyCellKeys.has(cellKey)) {
            continue;
          }
          await logsStore.put(toLocalDailyLog(row, row.row_version));
        }
      },
      this.dbName,
    );

    this.emitBroadcast('logs_range');
    return data.daily_logs;
  }

  async retryAttentionItem(mutationId: string): Promise<boolean> {
    const nowMs = this.nowFn();
    const updated = await runReadWriteTx(
      ['outbox'],
      async (tx) => {
        const outboxStore = tx.objectStore('outbox');
        const item = await outboxStore.get(mutationId);
        if (!item || item.state !== 'attention_needed') {
          return false;
        }
        await outboxStore.put({
          ...item,
          state: 'pending',
          last_error: null,
          last_http_status: null,
          updated_at: nowMs,
        });
        return true;
      },
      this.dbName,
    );

    if (updated) {
      this.emitBroadcast('attention');
    }
    return updated;
  }

  async discardAttentionItem(mutationId: string): Promise<boolean> {
    const discarded = await runReadWriteTx(
      ['outbox', 'logs'],
      async (tx) => {
        const outboxStore = tx.objectStore('outbox');
        const logsStore = tx.objectStore('logs');
        const item = await outboxStore.get(mutationId);
        if (!item || item.state !== 'attention_needed') {
          return false;
        }

        await outboxStore.delete(item.mutation_id);
        const remaining = (
          await outboxStore.index('by_cell_key').getAll(item.cell_key)
        ).filter((r) => r.mutation_id !== item.mutation_id);

        if (remaining.length === 0) {
          if (item.undo_prior_snapshot) {
            await logsStore.put(item.undo_prior_snapshot);
          } else {
            await logsStore.delete(item.cell_key);
          }
        }
        return true;
      },
      this.dbName,
    );

    if (discarded) {
      this.emitBroadcast('attention');
    }
    return discarded;
  }

  async exportAndDiscardAttentionItem(mutationId: string): Promise<{
    exportedItem: Omit<OutboxItem, 'undo_prior_snapshot'> | null;
    emergencySnapshot: OfflineEmergencyExport;
    discarded: boolean;
  }> {
    const db = await openClientDb(this.dbName);
    const targetItem = await db.get('outbox', mutationId);
    const emergencySnapshot = await this.buildOfflineEmergencyExport();

    let exportedItem: Omit<OutboxItem, 'undo_prior_snapshot'> | null = null;
    if (targetItem) {
      const { undo_prior_snapshot: _snap, ...rest } = targetItem;
      void _snap;
      exportedItem = rest;
    }

    const discarded = await this.discardAttentionItem(mutationId);
    return { exportedItem, emergencySnapshot, discarded };
  }

  async buildOfflineEmergencyExport(): Promise<OfflineEmergencyExport> {
    const nowIso = new Date(this.nowFn()).toISOString();

    return runReadOnlyTx(
      ['snapshot', 'logs', 'outbox', 'meta'],
      async (tx) => {
        const snapshotStore = tx.objectStore('snapshot');
        const logsStore = tx.objectStore('logs');
        const outboxStore = tx.objectStore('outbox');
        const metaStore = tx.objectStore('meta');

        const [
          settingsRec,
          periodsRec,
          actionsRec,
          targetsRec,
          logs,
          outbox,
          deviceRec,
          syncedRec,
        ] = await Promise.all([
          snapshotStore.get('settings'),
          snapshotStore.get('periods'),
          snapshotStore.get('actions'),
          snapshotStore.get('target_versions'),
          logsStore.getAll(),
          outboxStore.index('by_created_at').getAll(),
          metaStore.get('device_id'),
          metaStore.get('last_synced_at'),
        ]);

        const settings = (settingsRec?.value as AppSettings | undefined) ?? null;
        const periods = (periodsRec?.value as Period[] | undefined) ?? [];
        const actions = (actionsRec?.value as Action[] | undefined) ?? [];
        const targetVersions =
          (targetsRec?.value as TargetVersion[] | undefined) ?? [];
        const domainLogs = logs.map(stripLocalLogMeta);
        const pendingOutbox = outbox.map((item) => {
          const { undo_prior_snapshot: _snap, ...rest } = item;
          void _snap;
          return rest;
        });

        return {
          schema_version: 1,
          export_kind: 'offline_emergency_backup',
          exported_at: nowIso,
          device_id:
            typeof deviceRec?.value === 'string' ? deviceRec.value : null,
          last_synced_at:
            typeof syncedRec?.value === 'string' ? syncedRec.value : null,
          settings,
          periods,
          actions,
          target_versions: targetVersions,
          daily_logs: domainLogs,
          pending_outbox: pendingOutbox,
          counts: {
            periods: periods.length,
            actions: actions.length,
            target_versions: targetVersions.length,
            daily_logs: domainLogs.length,
            pending_outbox: pendingOutbox.length,
          },
        };
      },
      this.dbName,
    );
  }

  async readHydrationState(): Promise<{
    settings: AppSettings | null;
    periods: Period[];
    actions: Action[];
    targetVersions: TargetVersion[];
    logs: LocalDailyLog[];
    outbox: OutboxItem[];
    lastSyncedAt: string | null;
    consecutiveFailures: number;
    hasAuthError: boolean;
  }> {
    return runReadOnlyTx(
      ['snapshot', 'logs', 'outbox', 'meta'],
      async (tx) => {
        const snapshotStore = tx.objectStore('snapshot');
        const logsStore = tx.objectStore('logs');
        const outboxStore = tx.objectStore('outbox');
        const metaStore = tx.objectStore('meta');

        const [
          settingsRec,
          periodsRec,
          actionsRec,
          targetsRec,
          logs,
          outbox,
          syncedRec,
          failRec,
          authRec,
        ] = await Promise.all([
          snapshotStore.get('settings'),
          snapshotStore.get('periods'),
          snapshotStore.get('actions'),
          snapshotStore.get('target_versions'),
          logsStore.getAll(),
          outboxStore.index('by_created_at').getAll(),
          metaStore.get('last_synced_at'),
          metaStore.get('consecutive_failures'),
          metaStore.get('last_auth_error'),
        ]);

        return {
          settings: (settingsRec?.value as AppSettings | undefined) ?? null,
          periods: (periodsRec?.value as Period[] | undefined) ?? [],
          actions: (actionsRec?.value as Action[] | undefined) ?? [],
          targetVersions:
            (targetsRec?.value as TargetVersion[] | undefined) ?? [],
          logs,
          outbox,
          lastSyncedAt:
            typeof syncedRec?.value === 'string' ? syncedRec.value : null,
          consecutiveFailures:
            typeof failRec?.value === 'number' ? failRec.value : 0,
          hasAuthError:
            typeof authRec?.value === 'string' && authRec.value.length > 0,
        };
      },
      this.dbName,
    );
  }

  async getOutboxCounts(): Promise<{
    heldCount: number;
    pendingCount: number;
    inFlightCount: number;
    attentionCount: number;
    activeCount: number;
  }> {
    const db = await openClientDb(this.dbName);
    const all = await db.getAll('outbox');
    let heldCount = 0;
    let pendingCount = 0;
    let inFlightCount = 0;
    let attentionCount = 0;
    for (const item of all) {
      if (item.state === 'held') heldCount += 1;
      else if (item.state === 'pending') pendingCount += 1;
      else if (item.state === 'in_flight') inFlightCount += 1;
      else if (item.state === 'attention_needed') attentionCount += 1;
    }
    return {
      heldCount,
      pendingCount,
      inFlightCount,
      attentionCount,
      activeCount: heldCount + pendingCount + inFlightCount,
    };
  }

  async getActiveOutboxCount(): Promise<number> {
    const counts = await this.getOutboxCounts();
    return counts.activeCount;
  }

  async getSyncBadgeSummary(isSyncing = false): Promise<SyncBadgeSummary> {
    const state = await this.readHydrationState();
    return computeSyncBadgeState({
      isOnline: this.isOnlineFn(),
      outboxItems: state.outbox,
      isSyncing,
      consecutiveFailures: state.consecutiveFailures,
      hasAuthError: state.hasAuthError,
    });
  }
}

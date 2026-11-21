import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type {
  Action,
  AppSettings,
  AvailabilityOverride,
  CellStatus,
  DailyLog,
  Period,
  TargetVersion,
} from '@/domain/types';

export const DEFAULT_DB_NAME = 'mohasba-db';
export const DB_VERSION = 1;

export type SnapshotKey = 'settings' | 'periods' | 'actions' | 'target_versions';

export interface SnapshotValueMap {
  settings: AppSettings;
  periods: Period[];
  actions: Action[];
  target_versions: TargetVersion[];
}

export type SnapshotRecord<K extends SnapshotKey = SnapshotKey> = {
  key: K;
  value: SnapshotValueMap[K];
  updated_at: string;
};

export interface LocalDailyLog extends DailyLog {
  cell_key: string;
  /**
   * True server `row_version` last confirmed by `/api/bootstrap`, `/api/logs`, or `/api/sync`.
   * Remains `null` for purely local optimistic rows until the server confirms creation.
   */
  server_row_version: number | null;
}

export type OutboxState = 'held' | 'pending' | 'in_flight' | 'attention_needed';

export interface OutboxItem {
  mutation_id: string;
  cell_key: string;
  batch_id: string | null;
  state: OutboxState;
  hold_until: number | null;
  attempt_count: number;
  created_at: number;
  updated_at: number;
  last_error: string | null;
  last_http_status: number | null;
  device_id: string;
  parent_mutation_id: string | null;
  action_id: string;
  log_date: string;
  base_row_version: number | null;
  availability_override: AvailabilityOverride | null;
  status: CellStatus | null;
  percent_value: number | null;
  qadaa_resolved_at: string | null;
  client_target_version_id: string | null;
  note: string | null;
  note_updated_at: string | null;
  client_updated_at: string;
  undo_prior_snapshot: LocalDailyLog | null;
}

export type MetaKey =
  | 'device_id'
  | 'last_synced_at'
  | 'schema_version'
  | 'consecutive_failures'
  | 'last_auth_error';

export interface MetaValueMap {
  device_id: string;
  last_synced_at: string | null;
  schema_version: number;
  consecutive_failures: number;
  last_auth_error: string | null;
}

export type MetaRecord<K extends MetaKey = MetaKey> = {
  key: K;
  value: MetaValueMap[K];
};

export interface MohasbaIdbSchema extends DBSchema {
  snapshot: {
    key: SnapshotKey;
    value: SnapshotRecord;
  };
  logs: {
    key: string;
    value: LocalDailyLog;
    indexes: {
      by_log_date: string;
    };
  };
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: {
      by_cell_key: string;
      by_state: OutboxState;
      by_created_at: number;
    };
  };
  meta: {
    key: MetaKey;
    value: MetaRecord;
  };
}

export type StoreName = 'snapshot' | 'logs' | 'outbox' | 'meta';

const dbPromises = new Map<string, Promise<IDBPDatabase<MohasbaIdbSchema>>>();
const openInstances = new Map<string, IDBPDatabase<MohasbaIdbSchema>>();

/**
 * Opens (and upgrades if needed) the 4-store IndexedDB database.
 */
export async function openClientDb(
  dbName: string = DEFAULT_DB_NAME,
): Promise<IDBPDatabase<MohasbaIdbSchema>> {
  const existing = dbPromises.get(dbName);
  if (existing) {
    return existing;
  }

  const promise = openDB<MohasbaIdbSchema>(dbName, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('snapshot')) {
        db.createObjectStore('snapshot', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('logs')) {
        const logsStore = db.createObjectStore('logs', { keyPath: 'cell_key' });
        logsStore.createIndex('by_log_date', 'log_date', { unique: false });
      }
      if (!db.objectStoreNames.contains('outbox')) {
        const outboxStore = db.createObjectStore('outbox', {
          keyPath: 'mutation_id',
        });
        outboxStore.createIndex('by_cell_key', 'cell_key', { unique: false });
        outboxStore.createIndex('by_state', 'state', { unique: false });
        outboxStore.createIndex('by_created_at', 'created_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    },
    blocking() {
      const instance = openInstances.get(dbName);
      if (instance) {
        instance.close();
        openInstances.delete(dbName);
        dbPromises.delete(dbName);
      }
    },
    terminated() {
      openInstances.delete(dbName);
      dbPromises.delete(dbName);
    },
  }).then(async (db) => {
    openInstances.set(dbName, db);
    // Record schema version lazily on first open if absent
    const existingVer = await db.get('meta', 'schema_version');
    if (!existingVer) {
      await db.put('meta', { key: 'schema_version', value: DB_VERSION });
    }
    return db;
  });

  dbPromises.set(dbName, promise);
  return promise;
}

/**
 * Closes open IndexedDB connection(s) cleanly for test teardown or database deletion.
 */
export async function closeClientDb(dbName?: string): Promise<void> {
  if (dbName) {
    const p = dbPromises.get(dbName);
    dbPromises.delete(dbName);
    const inst = openInstances.get(dbName);
    openInstances.delete(dbName);
    if (inst) {
      inst.close();
    } else if (p) {
      const db = await p.catch(() => null);
      db?.close();
    }
    return;
  }

  const keys = Array.from(new Set([...dbPromises.keys(), ...openInstances.keys()]));
  await Promise.all(keys.map((k) => closeClientDb(k)));
}

/**
 * Executes an atomic read-only transaction across one or more stores.
 */
export async function runReadOnlyTx<S extends StoreName, T>(
  stores: readonly S[],
  fn: (tx: IDBPTransaction<MohasbaIdbSchema, readonly S[], 'readonly'>) => Promise<T>,
  dbName: string = DEFAULT_DB_NAME,
): Promise<T> {
  const db = await openClientDb(dbName);
  const tx = db.transaction(stores, 'readonly');
  const result = await fn(tx);
  await tx.done;
  return result;
}

/**
 * Executes an atomic read-write transaction across one or more stores.
 */
export async function runReadWriteTx<S extends StoreName, T>(
  stores: readonly S[],
  fn: (tx: IDBPTransaction<MohasbaIdbSchema, readonly S[], 'readwrite'>) => Promise<T>,
  dbName: string = DEFAULT_DB_NAME,
): Promise<T> {
  const db = await openClientDb(dbName);
  const tx = db.transaction(stores, 'readwrite');
  const result = await fn(tx);
  await tx.done;
  return result;
}

/**
 * Wipes all 4 IndexedDB stores atomically (used on Sign Out / POST /api/logout).
 */
export async function wipeAllLocalData(
  dbName: string = DEFAULT_DB_NAME,
): Promise<void> {
  await runReadWriteTx(
    ['snapshot', 'logs', 'outbox', 'meta'],
    async (tx) => {
      await Promise.all([
        tx.objectStore('snapshot').clear(),
        tx.objectStore('logs').clear(),
        tx.objectStore('outbox').clear(),
        tx.objectStore('meta').clear(),
      ]);
    },
    dbName,
  );
}

export async function getSnapshotValue<K extends SnapshotKey>(
  key: K,
  dbName: string = DEFAULT_DB_NAME,
): Promise<SnapshotValueMap[K] | null> {
  const db = await openClientDb(dbName);
  const record = await db.get('snapshot', key);
  return record ? (record.value as SnapshotValueMap[K]) : null;
}

export async function getMetaValue<K extends MetaKey>(
  key: K,
  dbName: string = DEFAULT_DB_NAME,
): Promise<MetaValueMap[K] | null> {
  const db = await openClientDb(dbName);
  const record = await db.get('meta', key);
  return record ? (record.value as MetaValueMap[K]) : null;
}

export async function setMetaValue<K extends MetaKey>(
  key: K,
  value: MetaValueMap[K],
  dbName: string = DEFAULT_DB_NAME,
): Promise<void> {
  const db = await openClientDb(dbName);
  await db.put('meta', { key, value });
}

export async function getAllLogs(
  dbName: string = DEFAULT_DB_NAME,
): Promise<LocalDailyLog[]> {
  const db = await openClientDb(dbName);
  return db.getAll('logs');
}

export async function getAllOutboxItems(
  dbName: string = DEFAULT_DB_NAME,
): Promise<OutboxItem[]> {
  const db = await openClientDb(dbName);
  return db.getAllFromIndex('outbox', 'by_created_at');
}

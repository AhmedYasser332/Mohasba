'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  addDaysIso,
  diffDaysIso,
  get48hCatchUpItems,
  getOpenQadaaQueue,
  isActionActiveOnDate,
  isPeriodActiveOnDate,
  planDeferToQadaa,
  planMosqueDone,
  planNormalDay,
  planPeriodDone,
  resolveActiveWindow,
  resolveCellAvailability,
  scoreLoggedCell,
  type Action,
  type ActiveWindowResolution,
  type AppSettings,
  type CatchUpItem,
  type DailyLog,
  type NtfySource,
  type Period,
  type QadaaQueueItem,
  type TargetVersion,
  type TemplateLevelId,
  makeCellKey,
} from '@/domain';
import {
  wipeAllLocalData,
  type LocalDailyLog,
  type OutboxItem,
} from '../db/idb';
import {
  applyWaitingServiceWorker,
  isIosNonStandalone,
  registerServiceWorker,
} from '../pwa/register-sw';
import {
  computeBackoffMs,
  computeSyncBadgeState,
  DEFAULT_UNDO_HOLD_MS,
  OutboxEngine,
  SYNC_BROADCAST_CHANNEL,
  type BootstrapPayload,
  type CellMutationInput,
  type DrainBeforeCrudResult,
  type EnqueueResult,
  type FlushResult,
  type OfflineEmergencyExport,
  type SyncBadgeSummary,
  type SyncBroadcastMessage,
  type UndoResult,
} from '../sync/outbox-engine';

export type AuthStatus =
  | 'checking'
  | 'unlocked'
  | 'locked'
  | 'setup_incomplete';

export interface ActiveUndoToast {
  id: string;
  kind: 'single' | 'batch';
  mutationId: string | null;
  batchId: string | null;
  cellCount: number;
  expiresAt: number;
}

export interface CrudResponse<T = unknown> {
  ok: boolean;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: Record<string, unknown>;
  drainResult?: DrainBeforeCrudResult;
}

export interface InitOnboardingPayload {
  mode: 'starter_pack' | 'blank' | 'template';
  level?: TemplateLevelId;
  active_from?: string;
  excluded_period_ids?: string[];
  excluded_action_ids?: string[];
  custom_actions?: Array<{ id?: string; period_id: string; title: string }>;
  ntfy_all_periods_enabled?: boolean;
  settings_patch?: Record<string, unknown>;
}

export interface MergeTemplatePayload {
  level: TemplateLevelId;
  active_from?: string;
  excluded_period_ids?: string[];
  excluded_action_ids?: string[];
}

export interface MohasbaContextValue {
  hydrated: boolean;
  authStatus: AuthStatus;
  isOnline: boolean;
  isSyncing: boolean;
  ntfyConfigured: boolean;
  ntfySource: NtfySource;
  ntfyTopicHint: string | null;
  ntfyHasToken: boolean;
  isIosA2hsPromptVisible: boolean;
  swUpdateAvailable: boolean;
  settings: AppSettings | null;
  periods: Period[];
  actions: Action[];
  targetVersions: TargetVersion[];
  logs: LocalDailyLog[];
  logsByKey: ReadonlyMap<string, LocalDailyLog>;
  outbox: OutboxItem[];
  lastSyncedAt: string | null;
  syncBadge: SyncBadgeSummary;
  activeUndoToast: ActiveUndoToast | null;
  nowMs: number;
  activeWindowResolution: ActiveWindowResolution | null;
  todayIslamicDate: string | null;
  openQadaaQueue: QadaaQueueItem[];
  catchUp48hItems: CatchUpItem[];
  adaptingActionIds: ReadonlySet<string>;
  logCellTap: (
    input: CellMutationInput,
    holdMs?: number,
    showUndoToast?: boolean,
  ) => Promise<EnqueueResult>;
  logCellBatch: (
    inputs: readonly CellMutationInput[],
    holdMs?: number,
    showUndoToast?: boolean,
  ) => Promise<EnqueueResult>;
  logBulkMosqueDone: (periodId: string, logDate: string) => Promise<EnqueueResult>;
  logBulkPeriodDone: (periodId: string, logDate: string) => Promise<EnqueueResult>;
  logBulkNormalDay: (logDate: string) => Promise<EnqueueResult>;
  logBulkDeferToQadaa: (logDate: string) => Promise<EnqueueResult>;
  undoMutation: (mutationId: string) => Promise<UndoResult>;
  undoBatch: (batchId: string) => Promise<UndoResult>;
  undoLastAction: () => Promise<UndoResult>;
  getLastUndoCreatedAt: () => number | null;
  dismissUndoToast: () => void;
  flushOutbox: () => Promise<FlushResult>;
  refreshBootstrap: (options?: { full?: boolean }) => Promise<boolean>;
  fetchLogsRange: (from: string, to: string) => Promise<DailyLog[]>;
  retryAttentionItem: (mutationId: string) => Promise<boolean>;
  discardAttentionItem: (mutationId: string) => Promise<boolean>;
  exportAndDiscardAttentionItem: (mutationId: string) => Promise<{
    exportedItem: Omit<OutboxItem, 'undo_prior_snapshot'> | null;
    emergencySnapshot: OfflineEmergencyExport;
    discarded: boolean;
  }>;
  buildOfflineExport: () => Promise<OfflineEmergencyExport>;
  drainBeforeCrud: () => Promise<DrainBeforeCrudResult>;
  unlockWithPasscode: (passcode: string) => Promise<CrudResponse>;
  initOnboarding: (
    modeOrPayload: 'starter_pack' | 'blank' | InitOnboardingPayload,
    activeFrom?: string,
  ) => Promise<CrudResponse>;
  mergeTemplate: (payload: MergeTemplatePayload) => Promise<CrudResponse>;
  resetWorkspace: () => Promise<CrudResponse>;
  updateSettings: (patch: Record<string, unknown>) => Promise<CrudResponse>;
  testNtfy: () => Promise<CrudResponse>;
  revealNtfyTopicUrl: () => Promise<
    CrudResponse<{ url: string; source: 'db' | 'env' }>
  >;
  createPeriod: (input: Record<string, unknown>) => Promise<CrudResponse>;
  updatePeriod: (
    id: string,
    patch: Record<string, unknown>,
    options?: { skipRefresh?: boolean },
  ) => Promise<CrudResponse>;
  deletePeriod: (
    id: string,
    options?: { force?: boolean },
  ) => Promise<CrudResponse>;
  createAction: (input: Record<string, unknown>) => Promise<CrudResponse>;
  updateAction: (id: string, patch: Record<string, unknown>) => Promise<CrudResponse>;
  deleteAction: (
    id: string,
    options?: { force?: boolean },
  ) => Promise<CrudResponse>;
  createTargetVersion: (input: Record<string, unknown>) => Promise<CrudResponse>;
  updateTargetVersion: (
    id: string,
    patch: Record<string, unknown>,
  ) => Promise<CrudResponse>;
  deleteTargetVersion: (id: string) => Promise<CrudResponse>;
  reorderSchema: (input: Record<string, unknown>) => Promise<CrudResponse>;
  importBackupChunk: (payload: Record<string, unknown>) => Promise<CrudResponse>;
  signOut: () => Promise<{ ok: boolean; errorMessage?: string }>;
  applySwUpdate: () => void;
}

const MohasbaContext = createContext<MohasbaContextValue | null>(null);

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

async function parseApiError(res: Response): Promise<{
  code: string;
  message: string;
  details?: Record<string, unknown>;
}> {
  try {
    const json = (await res.json()) as ApiErrorPayload;
    return {
      code: json.error?.code ?? `HTTP_${res.status}`,
      message: json.error?.message ?? `Request failed (${res.status})`,
      details:
        json.error?.details && typeof json.error.details === 'object'
          ? json.error.details
          : undefined,
    };
  } catch {
    return {
      code: `HTTP_${res.status}`,
      message: `Request failed (${res.status})`,
    };
  }
}

export function MohasbaProvider({
  children,
  dbName,
}: {
  children: React.ReactNode;
  dbName?: string;
}) {
  const [engine] = useState(() => new OutboxEngine({ dbName }));

  const [hydrated, setHydrated] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [ntfyConfigured, setNtfyConfigured] = useState(false);
  const [ntfySource, setNtfySource] = useState<NtfySource>('none');
  const [ntfyTopicHint, setNtfyTopicHint] = useState<string | null>(null);
  const [ntfyHasToken, setNtfyHasToken] = useState(false);
  const [isIosA2hsPromptVisible, setIsIosA2hsPromptVisible] = useState(false);
  const [swRegistration, setSwRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [targetVersions, setTargetVersions] = useState<TargetVersion[]>([]);
  const [logs, setLogs] = useState<LocalDailyLog[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [hasAuthError, setHasAuthError] = useState(false);
  const [activeUndoToast, setActiveUndoToast] = useState<ActiveUndoToast | null>(
    null,
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const sessionEpochRef = useRef(0);
  const bootstrapAbortRef = useRef<AbortController | null>(null);
  const inFlightBootstrapRef = useRef<Promise<boolean> | null>(null);
  const lastUndoTargetRef = useRef<(ActiveUndoToast & { createdAt: number }) | null>(null);

  const syncStateFromIdb = useCallback(async () => {
    const state = await engine.readHydrationState();
    if (!mountedRef.current) return state;

    setSettings(state.settings);
    setPeriods(state.periods);
    setActions(state.actions);
    setTargetVersions(state.targetVersions);
    setLogs(state.logs);
    setOutbox(state.outbox);
    setLastSyncedAt(state.lastSyncedAt);
    setConsecutiveFailures(state.consecutiveFailures);
    setHasAuthError(state.hasAuthError);
    setHydrated(true);
    return state;
  }, [engine]);

  const flushOutbox = useCallback(async (): Promise<FlushResult> => {
    setIsSyncing(true);
    try {
      const res = await engine.flushOutbox({
        releaseAllHolds: false,
        ifAvailableLock: true,
      });
      await syncStateFromIdb();

      if (res.reason === 'auth_required') {
        setAuthStatus('locked');
      } else if (res.reason === 'network_error') {
        const state = await engine.readHydrationState();
        const delayMs = computeBackoffMs(state.consecutiveFailures);
        if (delayMs > 0 && mountedRef.current) {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current && navigator.onLine !== false) {
              void flushOutbox();
            }
          }, delayMs);
        }
      }
      return res;
    } finally {
      if (mountedRef.current) {
        setIsSyncing(false);
      }
    }
  }, [engine, syncStateFromIdb]);

  useEffect(() => {
    if (!hydrated || authStatus !== 'unlocked') return;
    const heldItems = outbox.filter((i) => i.state === 'held');
    if (heldItems.length === 0) return;

    const earliest = Math.min(
      ...heldItems.map((i) => i.hold_until ?? Date.now()),
    );
    const delayMs = Math.max(0, earliest - Date.now()) + 30;
    const timer = setTimeout(() => {
      if (!mountedRef.current) return;
      void flushOutbox();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [authStatus, flushOutbox, hydrated, outbox]);

  useEffect(() => {
    if (!activeUndoToast) return;
    const remainingMs = Math.max(0, activeUndoToast.expiresAt - Date.now()) + 30;
    const timer = setTimeout(() => {
      setActiveUndoToast((prev) =>
        prev && prev.id === activeUndoToast.id ? null : prev,
      );
    }, remainingMs);
    return () => clearTimeout(timer);
  }, [activeUndoToast]);

  const refreshBootstrap = useCallback(
    async (options: { full?: boolean } = {}): Promise<boolean> => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return false;
      }
      const epoch = sessionEpochRef.current;
      bootstrapAbortRef.current?.abort();
      const controller = new AbortController();
      bootstrapAbortRef.current = controller;

      const task = (async (): Promise<boolean> => {
        try {
          const state = await engine.readHydrationState();
          if (epoch !== sessionEpochRef.current || controller.signal.aborted) {
            return false;
          }
          const useDelta =
            !options.full &&
            state.settings !== null &&
            state.lastSyncedAt !== null;
          const url = useDelta
            ? `/api/bootstrap?since=${encodeURIComponent(state.lastSyncedAt!)}`
            : '/api/bootstrap';

          const response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            signal: controller.signal,
          });

          if (epoch !== sessionEpochRef.current || controller.signal.aborted) {
            return false;
          }

          if (response.status === 401) {
            await response.body?.cancel().catch(() => {});
            setAuthStatus('locked');
            return false;
          }
          if (response.status === 503) {
            await response.body?.cancel().catch(() => {});
            setAuthStatus('setup_incomplete');
            return false;
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            return false;
          }

          const payload = (await response.json()) as BootstrapPayload;
          if (epoch !== sessionEpochRef.current || controller.signal.aborted) {
            return false;
          }

          await engine.mergeBootstrapIntoIdb(payload);
          if (epoch !== sessionEpochRef.current) {
            return false;
          }
          if (mountedRef.current) {
            setNtfyConfigured(Boolean(payload.ntfy_configured));
            setNtfySource(
              payload.ntfy_source ?? (payload.ntfy_configured ? 'env' : 'none'),
            );
            setNtfyTopicHint(payload.ntfy_topic_hint ?? null);
            setNtfyHasToken(Boolean(payload.ntfy_has_token));
            setAuthStatus('unlocked');
            setNowMs(Date.now());
          }
          await syncStateFromIdb();
          return true;
        } catch {
          return false;
        }
      })();

      inFlightBootstrapRef.current = task;
      try {
        return await task;
      } finally {
        if (inFlightBootstrapRef.current === task) {
          inFlightBootstrapRef.current = null;
        }
      }
    },
    [engine, syncStateFromIdb],
  );

  useEffect(() => {
    mountedRef.current = true;

    let swHandle: { dispose: () => void } | null = null;
    void registerServiceWorker({
      onUpdateAvailable: (reg) => {
        if (!mountedRef.current) return;
        setSwRegistration(reg);
        setSwUpdateAvailable(true);
      },
      onControllerChange: () => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      },
    }).then((handle) => {
      swHandle = handle;
      if (mountedRef.current && handle.registration) {
        setSwRegistration(handle.registration);
      }
    });

    const boot = async () => {
      await syncStateFromIdb();
      if (mountedRef.current) {
        if (typeof navigator !== 'undefined') {
          setIsOnline(navigator.onLine !== false);
        }
        setIsIosA2hsPromptVisible(isIosNonStandalone());
      }
      await engine.promoteExpiredHolds();

      const ok = await refreshBootstrap();
      if (ok) {
        await flushOutbox();
      } else if (mountedRef.current) {
        // Offline or lie-fi network failure: never leave user stuck on 'checking'
        // (locked / setup_incomplete states are already set explicitly on 401/503)
        setAuthStatus((prev) => (prev === 'checking' ? 'unlocked' : prev));
      }
    };
    void boot();

    const handleOnline = () => {
      setIsOnline(true);
      void (async () => {
        await engine.promoteExpiredHolds();
        const ok = await refreshBootstrap();
        if (ok) {
          await flushOutbox();
        }
      })();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNowMs(Date.now());
        void (async () => {
          await engine.promoteExpiredHolds();
          await flushOutbox();
        })();
      }
    };
    const handlePageHide = () => {
      // Durable IDB-first invariant: promote expired holds only, ZERO keepalive network requests!
      void engine.promoteExpiredHolds();
    };

    const bc =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(SYNC_BROADCAST_CHANNEL)
        : null;
    const handleBroadcast = (ev: MessageEvent<SyncBroadcastMessage>) => {
      if (ev.data?.type === 'idb_updated') {
        void syncStateFromIdb();
      }
    };
    bc?.addEventListener('message', handleBroadcast);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);

    const clockInterval = setInterval(() => {
      if (mountedRef.current) {
        setNowMs(Date.now());
      }
    }, 60_000);

    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      clearInterval(clockInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      bc?.removeEventListener('message', handleBroadcast);
      bc?.close();
      swHandle?.dispose();
    };
  }, [engine, flushOutbox, refreshBootstrap, syncStateFromIdb]);

  useEffect(() => {
    const engineToDispose = engine;
    return () => {
      engineToDispose.dispose();
    };
  }, [engine]);

  const enqueueAndSchedule = useCallback(
    async (
      inputs: readonly CellMutationInput[],
      holdMs: number = DEFAULT_UNDO_HOLD_MS,
      showUndoToast: boolean = false,
    ): Promise<EnqueueResult> => {
      const res = await engine.enqueueCellMutations(inputs, {
        targetVersions,
        holdMs,
      });
      await syncStateFromIdb();

      if (res.items.length > 0 && holdMs > 0) {
        const first = res.items[0]!;
        const now = Date.now();
        const target: ActiveUndoToast = {
          id: res.batchId ?? first.mutation_id,
          kind: res.batchId ? 'batch' : 'single',
          mutationId: res.batchId ? null : first.mutation_id,
          batchId: res.batchId,
          cellCount: res.items.length,
          expiresAt: now + holdMs,
        };
        lastUndoTargetRef.current = { ...target, createdAt: now };
        if (showUndoToast) {
          setActiveUndoToast(target);
        }
      } else if (res.items.length > 0) {
        lastUndoTargetRef.current = null;
        void flushOutbox();
      }

      return res;
    },
    [engine, flushOutbox, syncStateFromIdb, targetVersions],
  );

  const logCellTap = useCallback(
    async (
      input: CellMutationInput,
      holdMs: number = DEFAULT_UNDO_HOLD_MS,
      showUndoToast: boolean = false,
    ): Promise<EnqueueResult> => enqueueAndSchedule([input], holdMs, showUndoToast),
    [enqueueAndSchedule],
  );

  const logCellBatch = useCallback(
    async (
      inputs: readonly CellMutationInput[],
      holdMs: number = DEFAULT_UNDO_HOLD_MS,
      showUndoToast: boolean = false,
    ): Promise<EnqueueResult> => enqueueAndSchedule(inputs, holdMs, showUndoToast),
    [enqueueAndSchedule],
  );

  const logsByKey = useMemo(() => {
    const map = new Map<string, LocalDailyLog>();
    for (const log of logs) {
      map.set(makeCellKey(log.action_id, log.log_date), log);
    }
    return map;
  }, [logs]);

  const enqueuePlannedMutations = useCallback(
    (
      planned: readonly {
        action_id: string;
        log_date: string;
        availability_override: CellMutationInput['availability_override'];
        status: CellMutationInput['status'];
        percent_value: CellMutationInput['percent_value'];
        qadaa_resolved_at: CellMutationInput['qadaa_resolved_at'];
      }[],
      holdMs: number = DEFAULT_UNDO_HOLD_MS,
      showUndoToast: boolean = false,
    ): Promise<EnqueueResult> => {
      const actionsById = new Map(actions.map((a) => [a.id, a]));
      const inputs: CellMutationInput[] = [];
      for (const p of planned) {
        const action = actionsById.get(p.action_id);
        if (!action) continue;
        inputs.push({
          action,
          logDate: p.log_date,
          availability_override: p.availability_override,
          status: p.status,
          percent_value: p.percent_value,
          qadaa_resolved_at: p.qadaa_resolved_at,
        });
      }
      return enqueueAndSchedule(inputs, holdMs, showUndoToast);
    },
    [actions, enqueueAndSchedule],
  );

  const logBulkMosqueDone = useCallback(
    async (periodId: string, logDate: string): Promise<EnqueueResult> => {
      const planned = planMosqueDone({
        periodId,
        logDate,
        actions,
        periods,
        logsByKey,
      });
      return enqueuePlannedMutations(planned, DEFAULT_UNDO_HOLD_MS, false);
    },
    [actions, enqueuePlannedMutations, logsByKey, periods],
  );

  const logBulkPeriodDone = useCallback(
    async (periodId: string, logDate: string): Promise<EnqueueResult> => {
      const planned = planPeriodDone({
        periodId,
        logDate,
        actions,
        periods,
        logsByKey,
      });
      return enqueuePlannedMutations(planned, DEFAULT_UNDO_HOLD_MS, false);
    },
    [actions, enqueuePlannedMutations, logsByKey, periods],
  );

  const logBulkNormalDay = useCallback(
    async (logDate: string): Promise<EnqueueResult> => {
      const planned = planNormalDay({
        logDate,
        actions,
        periods,
        logsByKey,
      });
      return enqueuePlannedMutations(planned);
    },
    [actions, enqueuePlannedMutations, logsByKey, periods],
  );

  const logBulkDeferToQadaa = useCallback(
    async (logDate: string): Promise<EnqueueResult> => {
      if (!settings) {
        return { batchId: null, items: [], logs: [], durationMs: 0 };
      }
      const planned = planDeferToQadaa({
        logDate,
        actions,
        periods,
        settings,
        logsByKey,
        now: Date.now(),
      });
      return enqueuePlannedMutations(planned);
    },
    [actions, enqueuePlannedMutations, logsByKey, periods, settings],
  );

  const undoMutation = useCallback(
    async (mutationId: string): Promise<UndoResult> => {
      const res = await engine.undoMutation(mutationId);
      if (lastUndoTargetRef.current?.mutationId === mutationId) {
        lastUndoTargetRef.current = null;
      }
      setActiveUndoToast((prev) =>
        prev?.mutationId === mutationId ? null : prev,
      );
      await syncStateFromIdb();
      return res;
    },
    [engine, syncStateFromIdb],
  );

  const undoBatch = useCallback(
    async (batchId: string): Promise<UndoResult> => {
      const res = await engine.undoBatch(batchId);
      if (lastUndoTargetRef.current?.batchId === batchId) {
        lastUndoTargetRef.current = null;
      }
      setActiveUndoToast((prev) => (prev?.batchId === batchId ? null : prev));
      await syncStateFromIdb();
      return res;
    },
    [engine, syncStateFromIdb],
  );

  const undoLastAction = useCallback(async (): Promise<UndoResult> => {
    const target = lastUndoTargetRef.current;
    if (!target || Date.now() > target.expiresAt) {
      lastUndoTargetRef.current = null;
      return { undoneCount: 0, cellKeys: [] };
    }
    lastUndoTargetRef.current = null;
    if (target.kind === 'batch' && target.batchId) {
      return undoBatch(target.batchId);
    }
    if (target.mutationId) {
      return undoMutation(target.mutationId);
    }
    return { undoneCount: 0, cellKeys: [] };
  }, [undoBatch, undoMutation]);

  const getLastUndoCreatedAt = useCallback((): number | null => {
    const target = lastUndoTargetRef.current;
    if (!target || Date.now() > target.expiresAt) {
      return null;
    }
    return target.createdAt;
  }, []);

  const dismissUndoToast = useCallback(() => {
    setActiveUndoToast(null);
  }, []);

  const fetchLogsRange = useCallback(
    async (from: string, to: string): Promise<DailyLog[]> => {
      const rows = await engine.fetchAndCacheLogsRange(from, to);
      await syncStateFromIdb();
      return rows;
    },
    [engine, syncStateFromIdb],
  );

  const retryAttentionItem = useCallback(
    async (mutationId: string): Promise<boolean> => {
      const ok = await engine.retryAttentionItem(mutationId);
      await syncStateFromIdb();
      if (ok && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        void flushOutbox();
      }
      return ok;
    },
    [engine, flushOutbox, syncStateFromIdb],
  );

  const discardAttentionItem = useCallback(
    async (mutationId: string): Promise<boolean> => {
      const ok = await engine.discardAttentionItem(mutationId);
      await syncStateFromIdb();
      return ok;
    },
    [engine, syncStateFromIdb],
  );

  const exportAndDiscardAttentionItem = useCallback(
    async (mutationId: string) => {
      const res = await engine.exportAndDiscardAttentionItem(mutationId);
      await syncStateFromIdb();
      return res;
    },
    [engine, syncStateFromIdb],
  );

  const buildOfflineExport = useCallback(
    () => engine.buildOfflineEmergencyExport(),
    [engine],
  );

  const drainBeforeCrud = useCallback(async () => {
    const res = await engine.drainBeforeCrud();
    await syncStateFromIdb();
    lastUndoTargetRef.current = null;
    setActiveUndoToast(null);
    if (res.reason === 'auth_required') {
      setAuthStatus('locked');
    }
    return res;
  }, [engine, syncStateFromIdb]);

  const executeOnlineCrud = useCallback(
    async <T = unknown>(
      url: string,
      method: 'POST' | 'PATCH' | 'DELETE',
      body?: Record<string, unknown>,
      options: { skipDrain?: boolean; skipRefresh?: boolean } = {},
    ): Promise<CrudResponse<T>> => {
      if (!options.skipDrain) {
        const drainResult = await drainBeforeCrud();
        if (!drainResult.ok) {
          return {
            ok: false,
            errorCode:
              drainResult.reason === 'auth_required'
                ? 'UNLOCK_REQUIRED'
                : 'DRAIN_BLOCKED',
            errorMessage:
              drainResult.reason === 'offline'
                ? 'Offline: connect to internet before editing settings or targets.'
                : drainResult.reason === 'auth_required'
                  ? 'Unlock required to sync pending edits.'
                  : 'Pending edits could not finish syncing yet.',
            drainResult,
          };
        }
      }

      try {
        const headers: Record<string, string> = {
          'X-Requested-With': 'fetch',
        };
        if (body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }
        const res = await fetch(url, {
          method,
          headers,
          credentials: 'same-origin',
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (res.status === 401) {
          setAuthStatus('locked');
          const err = await parseApiError(res);
          return {
            ok: false,
            errorCode: err.code,
            errorMessage: err.message,
            errorDetails: err.details,
          };
        }

        if (!res.ok) {
          const err = await parseApiError(res);
          return {
            ok: false,
            errorCode: err.code,
            errorMessage: err.message,
            errorDetails: err.details,
          };
        }

        const data = (await res.json()) as T;
        if (!options.skipRefresh) {
          await refreshBootstrap({ full: true });
        }
        return { ok: true, data };
      } catch {
        return {
          ok: false,
          errorCode: 'NETWORK_ERROR',
          errorMessage: 'Network request failed.',
        };
      }
    },
    [drainBeforeCrud, refreshBootstrap],
  );

  const unlockWithPasscode = useCallback(
    async (passcode: string): Promise<CrudResponse> => {
      try {
        const res = await fetch('/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ passcode }),
        });
        if (!res.ok) {
          const err = await parseApiError(res);
          return { ok: false, errorCode: err.code, errorMessage: err.message };
        }
        const data = await res.json();
        setAuthStatus('unlocked');
        await refreshBootstrap({ full: true });
        await flushOutbox();
        return { ok: true, data };
      } catch {
        return {
          ok: false,
          errorCode: 'NETWORK_ERROR',
          errorMessage: 'Network request failed.',
        };
      }
    },
    [flushOutbox, refreshBootstrap],
  );

  const initOnboarding = useCallback(
    (
      modeOrPayload: 'starter_pack' | 'blank' | InitOnboardingPayload,
      activeFrom?: string,
    ) => {
      const payload =
        typeof modeOrPayload === 'string'
          ? {
              mode: modeOrPayload,
              ...(activeFrom ? { active_from: activeFrom } : {}),
            }
          : modeOrPayload;
      return executeOnlineCrud(
        '/api/bootstrap/init',
        'POST',
        payload as unknown as Record<string, unknown>,
      );
    },
    [executeOnlineCrud],
  );

  const mergeTemplate = useCallback(
    (payload: MergeTemplatePayload) =>
      executeOnlineCrud(
        '/api/bootstrap/merge-template',
        'POST',
        payload as unknown as Record<string, unknown>,
      ),
    [executeOnlineCrud],
  );

  const resetWorkspace = useCallback(async (): Promise<CrudResponse> => {
    try {
      const res = await fetch('/api/bootstrap/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ confirm: 'RESET_WORKSPACE' }),
      });

      if (res.status === 401) {
        const err = await parseApiError(res);
        setAuthStatus('locked');
        setHasAuthError(true);
        return {
          ok: false,
          errorCode: err.code,
          errorMessage: err.message,
          errorDetails: err.details,
        };
      }

      if (!res.ok) {
        const err = await parseApiError(res);
        return {
          ok: false,
          errorCode: err.code,
          errorMessage: err.message,
          errorDetails: err.details,
        };
      }

      const data = await res.json();

      sessionEpochRef.current += 1;
      bootstrapAbortRef.current?.abort();
      if (inFlightBootstrapRef.current) {
        await inFlightBootstrapRef.current.catch(() => false);
      }

      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      await wipeAllLocalData(engine.dbName);

      if (mountedRef.current) {
        setPeriods([]);
        setActions([]);
        setTargetVersions([]);
        setLogs([]);
        setOutbox([]);
        lastUndoTargetRef.current = null;
        setActiveUndoToast(null);
      }

      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const bc = new BroadcastChannel(SYNC_BROADCAST_CHANNEL);
          bc.postMessage({ type: 'idb_updated', reason: 'wipe', ts: Date.now() });
          bc.close();
        } catch {
          // ignore
        }
      }

      await refreshBootstrap({ full: true });
      return { ok: true, data };
    } catch {
      return {
        ok: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'Network request failed.',
      };
    }
  }, [engine.dbName, refreshBootstrap]);

  const updateSettings = useCallback(
    (patch: Record<string, unknown>) =>
      executeOnlineCrud('/api/settings', 'PATCH', patch),
    [executeOnlineCrud],
  );

  const testNtfy = useCallback(
    () => executeOnlineCrud('/api/settings/test-ntfy', 'POST', {}),
    [executeOnlineCrud],
  );

  const revealNtfyTopicUrl = useCallback(
    () =>
      executeOnlineCrud<{ url: string; source: 'db' | 'env' }>(
        '/api/settings/ntfy-reveal',
        'POST',
        undefined,
        { skipDrain: true, skipRefresh: true },
      ),
    [executeOnlineCrud],
  );

  const createPeriod = useCallback(
    (input: Record<string, unknown>) =>
      executeOnlineCrud('/api/periods', 'POST', input),
    [executeOnlineCrud],
  );

  const updatePeriod = useCallback(
    (
      id: string,
      patch: Record<string, unknown>,
      options?: { skipRefresh?: boolean },
    ) =>
      executeOnlineCrud(
        `/api/periods/${encodeURIComponent(id)}`,
        'PATCH',
        patch,
        options,
      ),
    [executeOnlineCrud],
  );

  const deletePeriod = useCallback(
    (id: string, options?: { force?: boolean }) =>
      executeOnlineCrud(
        `/api/periods/${encodeURIComponent(id)}${options?.force ? '?force=true' : ''}`,
        'DELETE',
        options?.force ? { force: true } : undefined,
      ),
    [executeOnlineCrud],
  );

  const createAction = useCallback(
    (input: Record<string, unknown>) =>
      executeOnlineCrud('/api/actions', 'POST', input),
    [executeOnlineCrud],
  );

  const updateAction = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      executeOnlineCrud(`/api/actions/${encodeURIComponent(id)}`, 'PATCH', patch),
    [executeOnlineCrud],
  );

  const deleteAction = useCallback(
    (id: string, options?: { force?: boolean }) =>
      executeOnlineCrud(
        `/api/actions/${encodeURIComponent(id)}${options?.force ? '?force=true' : ''}`,
        'DELETE',
        options?.force ? { force: true } : undefined,
      ),
    [executeOnlineCrud],
  );

  const createTargetVersion = useCallback(
    (input: Record<string, unknown>) =>
      executeOnlineCrud('/api/target-versions', 'POST', input),
    [executeOnlineCrud],
  );

  const updateTargetVersion = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      executeOnlineCrud(
        `/api/target-versions/${encodeURIComponent(id)}`,
        'PATCH',
        patch,
      ),
    [executeOnlineCrud],
  );

  const deleteTargetVersion = useCallback(
    (id: string) =>
      executeOnlineCrud(
        `/api/target-versions/${encodeURIComponent(id)}`,
        'DELETE',
        {},
      ),
    [executeOnlineCrud],
  );

  const reorderSchema = useCallback(
    (input: Record<string, unknown>) =>
      executeOnlineCrud('/api/schema/reorder', 'POST', input),
    [executeOnlineCrud],
  );

  const importBackupChunk = useCallback(
    (payload: Record<string, unknown>) =>
      executeOnlineCrud('/api/import', 'POST', payload),
    [executeOnlineCrud],
  );

  const signOut = useCallback(async (): Promise<{
    ok: boolean;
    errorMessage?: string;
  }> => {
    sessionEpochRef.current += 1;
    bootstrapAbortRef.current?.abort();

    try {
      const res = await fetch('/api/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok && res.status !== 401) {
        const err = await parseApiError(res);
        return { ok: false, errorMessage: err.message };
      }
      await res.body?.cancel().catch(() => {});
    } catch {
      return { ok: false, errorMessage: 'Network request failed.' };
    }

    if (inFlightBootstrapRef.current) {
      await inFlightBootstrapRef.current.catch(() => false);
    }

    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);

    await wipeAllLocalData(engine.dbName);
    if (mountedRef.current) {
      setSettings(null);
      setPeriods([]);
      setActions([]);
      setTargetVersions([]);
      setLogs([]);
      setOutbox([]);
      setLastSyncedAt(null);
      setConsecutiveFailures(0);
      setHasAuthError(false);
      lastUndoTargetRef.current = null;
      setActiveUndoToast(null);
      setNtfyConfigured(false);
      setNtfySource('none');
      setNtfyTopicHint(null);
      setNtfyHasToken(false);
      setAuthStatus('locked');
    }

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel(SYNC_BROADCAST_CHANNEL);
        bc.postMessage({ type: 'idb_updated', reason: 'wipe', ts: Date.now() });
        bc.close();
      } catch {
        // ignore
      }
    }

    return { ok: true };
  }, [engine.dbName]);

  const applySwUpdate = useCallback(() => {
    applyWaitingServiceWorker(swRegistration);
  }, [swRegistration]);

  const syncBadge = useMemo(
    () =>
      computeSyncBadgeState({
        isOnline,
        outboxItems: outbox,
        isSyncing,
        consecutiveFailures,
        hasAuthError,
      }),
    [consecutiveFailures, hasAuthError, isOnline, isSyncing, outbox],
  );

  const activeWindowResolution = useMemo(() => {
    if (!settings) return null;
    return resolveActiveWindow(nowMs, periods, settings);
  }, [nowMs, periods, settings]);

  // Trigger an exact boundary refresh when the next TIME_BOUND window opens or closes
  useEffect(() => {
    if (!activeWindowResolution) return;
    const now = Date.now();
    let earliestBoundary = Infinity;
    for (const win of activeWindowResolution.windows3Day) {
      if (win.startInstant > now && win.startInstant < earliestBoundary) {
        earliestBoundary = win.startInstant;
      }
      if (win.endInstant > now && win.endInstant < earliestBoundary) {
        earliestBoundary = win.endInstant;
      }
    }
    if (!Number.isFinite(earliestBoundary)) return;
    const delay = Math.min(
      2_147_000_000,
      Math.max(50, earliestBoundary - now + 50),
    );
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        setNowMs(Date.now());
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [activeWindowResolution]);

  const todayIslamicDate = activeWindowResolution?.islamicDate ?? null;

  const openQadaaQueue = useMemo(() => {
    if (!todayIslamicDate) return [];
    return getOpenQadaaQueue({
      actions,
      periods,
      targetVersions,
      logs,
      todayIslamicDate,
    });
  }, [actions, logs, periods, targetVersions, todayIslamicDate]);

  const catchUp48hItems = useMemo(() => {
    if (!settings) return [];
    return get48hCatchUpItems({
      actions,
      periods,
      targetVersions,
      logs,
      settings,
      now: nowMs,
    });
  }, [actions, logs, nowMs, periods, settings, targetVersions]);

  const adaptingActionIds = useMemo<ReadonlySet<string>>(() => {
    if (!todayIslamicDate) return new Set<string>();
    const periodsById = new Map(periods.map((p) => [p.id, p]));
    const ids = new Set<string>();

    for (const action of actions) {
      const period = periodsById.get(action.period_id) ?? null;
      if (!isActionActiveOnDate(action, todayIslamicDate)) continue;
      if (period && !isPeriodActiveOnDate(period, todayIslamicDate)) continue;

      const effectiveVersions = targetVersions
        .filter(
          (v) =>
            v.action_id === action.id && v.effective_from <= todayIslamicDate,
        )
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from));

      if (effectiveVersions.length < 2) continue;
      const latestVersion = effectiveVersions[effectiveVersions.length - 1]!;
      if (latestVersion.direction === 'step_down') continue;

      const daysSinceUpgrade = diffDaysIso(
        latestVersion.effective_from,
        todayIslamicDate,
      );
      if (daysSinceUpgrade < 0 || daysSinceUpgrade >= 7) continue;

      let loggedUnderNewCount = 0;
      for (let offset = 0; offset <= daysSinceUpgrade; offset += 1) {
        const d = addDaysIso(latestVersion.effective_from, offset);
        if (!isActionActiveOnDate(action, d)) continue;
        const log = logsByKey.get(makeCellKey(action.id, d));
        if (!resolveCellAvailability(action, log, d).isEnabled) continue;
        if (scoreLoggedCell(log) === null || !log) continue;
        if (
          log.target_version_id === latestVersion.id ||
          log.target_version_id === null
        ) {
          loggedUnderNewCount += 1;
        }
      }

      if (loggedUnderNewCount < 5) {
        ids.add(action.id);
      }
    }

    return ids;
  }, [actions, logsByKey, periods, targetVersions, todayIslamicDate]);

  const value = useMemo<MohasbaContextValue>(
    () => ({
      hydrated,
      authStatus,
      isOnline,
      isSyncing,
      ntfyConfigured,
      ntfySource,
      ntfyTopicHint,
      ntfyHasToken,
      isIosA2hsPromptVisible,
      swUpdateAvailable,
      settings,
      periods,
      actions,
      targetVersions,
      logs,
      logsByKey,
      outbox,
      lastSyncedAt,
      syncBadge,
      activeUndoToast,
      nowMs,
      activeWindowResolution,
      todayIslamicDate,
      openQadaaQueue,
      catchUp48hItems,
      adaptingActionIds,
      logCellTap,
      logCellBatch,
      logBulkMosqueDone,
      logBulkPeriodDone,
      logBulkNormalDay,
      logBulkDeferToQadaa,
      undoMutation,
      undoBatch,
      undoLastAction,
      getLastUndoCreatedAt,
      dismissUndoToast,
      flushOutbox,
      refreshBootstrap,
      fetchLogsRange,
      retryAttentionItem,
      discardAttentionItem,
      exportAndDiscardAttentionItem,
      buildOfflineExport,
      drainBeforeCrud,
      unlockWithPasscode,
      initOnboarding,
      mergeTemplate,
      resetWorkspace,
      updateSettings,
      testNtfy,
      revealNtfyTopicUrl,
      createPeriod,
      updatePeriod,
      deletePeriod,
      createAction,
      updateAction,
      deleteAction,
      createTargetVersion,
      updateTargetVersion,
      deleteTargetVersion,
      reorderSchema,
      importBackupChunk,
      signOut,
      applySwUpdate,
    }),
    [
      actions,
      activeUndoToast,
      activeWindowResolution,
      adaptingActionIds,
      applySwUpdate,
      authStatus,
      buildOfflineExport,
      catchUp48hItems,
      createAction,
      createPeriod,
      createTargetVersion,
      deleteAction,
      deletePeriod,
      deleteTargetVersion,
      discardAttentionItem,
      dismissUndoToast,
      drainBeforeCrud,
      exportAndDiscardAttentionItem,
      fetchLogsRange,
      flushOutbox,
      getLastUndoCreatedAt,
      hydrated,
      importBackupChunk,
      initOnboarding,
      isIosA2hsPromptVisible,
      isOnline,
      isSyncing,
      lastSyncedAt,
      logBulkDeferToQadaa,
      logBulkMosqueDone,
      logBulkNormalDay,
      logBulkPeriodDone,
      logCellBatch,
      logCellTap,
      logs,
      logsByKey,
      mergeTemplate,
      nowMs,
      ntfyConfigured,
      ntfyHasToken,
      ntfySource,
      ntfyTopicHint,
      openQadaaQueue,
      outbox,
      periods,
      refreshBootstrap,
      reorderSchema,
      resetWorkspace,
      retryAttentionItem,
      revealNtfyTopicUrl,
      settings,
      signOut,
      swUpdateAvailable,
      syncBadge,
      targetVersions,
      testNtfy,
      todayIslamicDate,
      undoBatch,
      undoLastAction,
      undoMutation,
      unlockWithPasscode,
      updateAction,
      updatePeriod,
      updateSettings,
      updateTargetVersion,
    ],
  );

  return (
    <MohasbaContext.Provider value={value}>{children}</MohasbaContext.Provider>
  );
}

export function useMohasba(): MohasbaContextValue {
  const ctx = useContext(MohasbaContext);
  if (!ctx) {
    throw new Error('useMohasba must be used inside a MohasbaProvider.');
  }
  return ctx;
}

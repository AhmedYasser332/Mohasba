'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AR_STRINGS,
  SHORTCUT_DEFINITIONS,
  formatShortcutKeycaps,
  matchesShortcutEvent,
  resolveEffectiveShortcuts,
  type ExportSnapshot,
} from '@/domain';
import {
  useMohasba,
  type InitOnboardingPayload,
} from '../store/mohasba-provider';
import {
  CellEditorDialog,
  type CellEditorTarget,
} from './cell-editor-dialog';
import {
  IconAnalytics,
  IconCross,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconKeyboard,
  IconLock,
  IconLogOut,
  IconMatrix,
  IconMoon,
  IconNow,
  IconQadaa,
  IconRefresh,
  IconSettings,
  IconSidebar,
  IconSun,
  IconX,
} from './icons';
import { OnboardingWizard } from './onboarding/onboarding-wizard';
import { Tooltip } from './tooltip';
import { AnalyticsView } from './views/analytics-view';
import { NowView } from './views/now-view';
import { QadaaView } from './views/qadaa-view';
import { SettingsView } from './views/settings-view';
import { WeekView } from './views/week-view';

type AppView = 'now' | 'week' | 'qadaa' | 'analytics' | 'settings';
type ThemeMode = 'light' | 'dark';

interface UrlParamsState {
  view: AppView;
  period: string | null;
  date: string | null;
  tab: string | null;
}

const VALID_VIEWS = new Set<AppView>([
  'now',
  'week',
  'qadaa',
  'analytics',
  'settings',
]);

const NOW_IDLE_SNAP_MS = 20 * 60 * 1000;

function parseUrlParams(search: string): UrlParamsState {
  const params = new URLSearchParams(search);
  const rawView = params.get('view');
  const view: AppView =
    rawView && VALID_VIEWS.has(rawView as AppView)
      ? (rawView as AppView)
      : 'now';
  const rawDate = params.get('date');
  const date =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  return {
    view,
    period: params.get('period'),
    date,
    tab: params.get('tab'),
  };
}

function buildSearchString(state: UrlParamsState): string {
  const params = new URLSearchParams();
  if (state.view !== 'now') {
    params.set('view', state.view);
  }
  if (state.view === 'now') {
    if (state.period) params.set('period', state.period);
    if (state.date) params.set('date', state.date);
  } else if (state.view === 'qadaa' && state.tab) {
    params.set('tab', state.tab);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '/';
}

const NAV_ITEMS: ReadonlyArray<{
  id: AppView;
  mobileLabel: string;
  desktopLabel: string;
}> = [
  { id: 'now', mobileLabel: AR_STRINGS.nav.now, desktopLabel: AR_STRINGS.nav.now },
  {
    id: 'week',
    mobileLabel: 'الجدول',
    desktopLabel: AR_STRINGS.nav.week,
  },
  {
    id: 'qadaa',
    mobileLabel: AR_STRINGS.nav.qadaa,
    desktopLabel: AR_STRINGS.nav.qadaa,
  },
  {
    id: 'analytics',
    mobileLabel: AR_STRINGS.nav.analytics,
    desktopLabel: AR_STRINGS.nav.analytics,
  },
  {
    id: 'settings',
    mobileLabel: AR_STRINGS.nav.settings,
    desktopLabel: AR_STRINGS.nav.settings,
  },
];

function renderNavIcon(id: AppView) {
  switch (id) {
    case 'now':
      return <IconNow />;
    case 'week':
      return <IconMatrix />;
    case 'qadaa':
      return <IconQadaa />;
    case 'analytics':
      return <IconAnalytics />;
    case 'settings':
      return <IconSettings />;
  }
}

function formatLastSynced(iso: string | null): string {
  if (!iso) return 'لم تتم المزامنة بعد';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'لم تتم المزامنة بعد';
  const timeText = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) {
    return `اليوم ${timeText}`;
  }
  const dateText = date.toLocaleDateString('ar-EG', {
    month: 'short',
    day: 'numeric',
  });
  return `${dateText} ${timeText}`;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
}

function subscribeThemeChange(callback: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === 'data-theme') {
        callback();
        break;
      }
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function getThemeSnapshot(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function getThemeServerSnapshot(): ThemeMode {
  return 'light';
}

export function MohasbaAppShell() {
  const {
    hydrated,
    authStatus,
    isOnline,
    isSyncing,
    isIosA2hsPromptVisible,
    swUpdateAvailable,
    settings,
    actions,
    outbox,
    lastSyncedAt,
    syncBadge,
    activeUndoToast,
    todayIslamicDate,
    openQadaaQueue,
    undoMutation,
    undoBatch,
    dismissUndoToast,
    flushOutbox,
    refreshBootstrap,
    retryAttentionItem,
    discardAttentionItem,
    exportAndDiscardAttentionItem,
    buildOfflineExport,
    unlockWithPasscode,
    initOnboarding,
    importBackupChunk,
    signOut,
    applySwUpdate,
  } = useMohasba();

  const [urlState, setUrlState] = useState<UrlParamsState>({
    view: 'now',
    period: null,
    date: null,
    tab: null,
  });
  const theme = useSyncExternalStore(
    subscribeThemeChange,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const [oneGlanceOverride, setOneGlanceOverride] = useState<boolean | null>(null);
  const [userNavigated, setUserNavigated] = useState(false);
  const [hasExplicitInitialUrl, setHasExplicitInitialUrl] = useState(false);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [iosNoticeDismissed, setIosNoticeDismissed] = useState(false);

  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);

  const [cellEditorTarget, setCellEditorTarget] =
    useState<CellEditorTarget | null>(null);
  const [undoLabel, setUndoLabel] = useState<string>(
    AR_STRINGS.street.undoToastMessage,
  );
  const [shellMessage, setShellMessage] = useState<string | null>(null);
  const [signedOutNotice, setSignedOutNotice] = useState(false);

  const syncWrapRef = useRef<HTMLDivElement | null>(null);
  const shortcutsDialogRef = useRef<HTMLDialogElement | null>(null);
  const hiddenAtRef = useRef<number | null>(null);

  const showOnboarding =
    authStatus === 'unlocked' &&
    settings !== null &&
    !settings.onboarding_completed;

  const showWorkspaceViews =
    authStatus === 'unlocked' &&
    settings !== null &&
    settings.onboarding_completed;

  const effectiveShortcuts = useMemo(
    () => resolveEffectiveShortcuts(settings?.keyboard_shortcuts),
    [settings?.keyboard_shortcuts],
  );

  const oneGlanceMode =
    oneGlanceOverride ??
    (showWorkspaceViews && settings?.default_week_mode === 'one_glance');

  const sidebarCollapsed =
    sidebarOverride ??
    (showWorkspaceViews &&
      settings?.default_week_mode === 'one_glance' &&
      typeof window !== 'undefined' &&
      window.innerWidth >= 1024);

  const configuredDefaultHomeView =
    showWorkspaceViews && settings?.default_home_view
      ? settings.default_home_view
      : null;

  const effectiveUrlState = useMemo<UrlParamsState>(() => {
    if (
      !userNavigated &&
      !hasExplicitInitialUrl &&
      configuredDefaultHomeView &&
      VALID_VIEWS.has(configuredDefaultHomeView)
    ) {
      return {
        ...urlState,
        view: configuredDefaultHomeView,
      };
    }
    return urlState;
  }, [
    configuredDefaultHomeView,
    hasExplicitInitialUrl,
    urlState,
    userNavigated,
  ]);

  // Sync URL from window.location.search on mount & popstate (zero useSearchParams!)
  useEffect(() => {
    const syncFromLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const hasParams =
        params.has('view') ||
        params.has('period') ||
        params.has('date') ||
        params.has('tab');
      setHasExplicitInitialUrl(hasParams);
      setUrlState(parseUrlParams(window.location.search));
    };
    const onPopState = () => {
      setUserNavigated(true);
      setShellMessage(null);
      setSignedOutNotice(false);
      syncFromLocation();
    };
    syncFromLocation();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const updateUrlState = useCallback(
    (next: UrlParamsState, mode: 'push' | 'replace' = 'push') => {
      setUserNavigated(true);
      setUrlState(next);
      const target = buildSearchString(next);
      if (mode === 'push') {
        window.history.pushState(null, '', target);
      } else {
        window.history.replaceState(null, '', target);
      }
    },
    [],
  );

  // Sync browser URL quietly when default_home_view activates on bare root '/'
  useEffect(() => {
    if (
      !userNavigated &&
      !hasExplicitInitialUrl &&
      showWorkspaceViews &&
      settings?.default_home_view &&
      settings.default_home_view !== 'now' &&
      VALID_VIEWS.has(settings.default_home_view)
    ) {
      const target = buildSearchString({
        view: settings.default_home_view,
        period: null,
        date: null,
        tab: null,
      });
      window.history.replaceState(null, '', target);
    }
  }, [
    hasExplicitInitialUrl,
    settings?.default_home_view,
    showWorkspaceViews,
    userNavigated,
  ]);

  useEffect(() => {
    const dlg = shortcutsDialogRef.current;
    if (!dlg) return;
    if (shortcutsHelpOpen) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [shortcutsHelpOpen]);

  const handleNavigate = useCallback(
    (view: AppView, tab: string | null = null) => {
      setShellMessage(null);
      setSignedOutNotice(false);
      updateUrlState(
        {
          view,
          period: null,
          date: null,
          tab: view === 'qadaa' ? tab : null,
        },
        'push',
      );
    },
    [updateUrlState],
  );

  const handleSetOneGlance = useCallback((enabled: boolean) => {
    setOneGlanceOverride(enabled);
    if (enabled) {
      setSidebarOverride(true);
    }
  }, []);

  const handleUndoClick = useCallback(async () => {
    if (!activeUndoToast) return;
    if (activeUndoToast.kind === 'batch' && activeUndoToast.batchId) {
      await undoBatch(activeUndoToast.batchId);
    } else if (activeUndoToast.mutationId) {
      await undoMutation(activeUndoToast.mutationId);
    }
    dismissUndoToast();
  }, [activeUndoToast, dismissUndoToast, undoBatch, undoMutation]);

  // Global physical keyboard shortcuts (ignores editable elements & open dialogs)
  useEffect(() => {
    if (!showWorkspaceViews) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (isEditableElement(e.target)) return;
      if (document.querySelector('dialog[open]') !== null) return;

      if (matchesShortcutEvent(e, effectiveShortcuts.toggle_sidebar)) {
        e.preventDefault();
        setSidebarOverride(!(sidebarOverride ?? sidebarCollapsed));
        return;
      }

      if (
        effectiveUrlState.view === 'week' &&
        matchesShortcutEvent(e, effectiveShortcuts.toggle_one_glance)
      ) {
        e.preventDefault();
        handleSetOneGlance(!oneGlanceMode);
        return;
      }

      if (matchesShortcutEvent(e, effectiveShortcuts.nav_now)) {
        e.preventDefault();
        handleNavigate('now');
        return;
      }
      if (matchesShortcutEvent(e, effectiveShortcuts.nav_week)) {
        e.preventDefault();
        handleNavigate('week');
        return;
      }
      if (matchesShortcutEvent(e, effectiveShortcuts.nav_qadaa)) {
        e.preventDefault();
        handleNavigate('qadaa');
        return;
      }
      if (matchesShortcutEvent(e, effectiveShortcuts.nav_analytics)) {
        e.preventDefault();
        handleNavigate('analytics');
        return;
      }
      if (matchesShortcutEvent(e, effectiveShortcuts.nav_settings)) {
        e.preventDefault();
        handleNavigate('settings');
        return;
      }

      if (matchesShortcutEvent(e, effectiveShortcuts.jump_today)) {
        if (effectiveUrlState.view === 'now' && todayIslamicDate) {
          e.preventDefault();
          updateUrlState(
            {
              ...effectiveUrlState,
              view: 'now',
              date: null,
              period: null,
            },
            'replace',
          );
        } else if (effectiveUrlState.view === 'week') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('mohasba:jump-today'));
        }
        return;
      }

      if (matchesShortcutEvent(e, effectiveShortcuts.undo)) {
        if (activeUndoToast) {
          e.preventDefault();
          void handleUndoClick();
        }
        return;
      }

      if (matchesShortcutEvent(e, effectiveShortcuts.open_shortcuts_help)) {
        e.preventDefault();
        setShortcutsHelpOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeUndoToast,
    effectiveShortcuts,
    effectiveUrlState,
    handleNavigate,
    handleSetOneGlance,
    handleUndoClick,
    oneGlanceMode,
    showWorkspaceViews,
    sidebarCollapsed,
    sidebarOverride,
    todayIslamicDate,
    updateUrlState,
  ]);

  // Auto-snap Now view back to today & live prayer window after >20 min backgrounded
  useEffect(() => {
    if (!showWorkspaceViews) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (document.visibilityState === 'visible') {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (
          hiddenAt !== null &&
          Date.now() - hiddenAt >= NOW_IDLE_SNAP_MS &&
          effectiveUrlState.view === 'now' &&
          (effectiveUrlState.date !== null ||
            effectiveUrlState.period !== null) &&
          document.querySelector('dialog[open]') === null
        ) {
          updateUrlState(
            {
              ...effectiveUrlState,
              view: 'now',
              date: null,
              period: null,
            },
            'replace',
          );
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [effectiveUrlState, showWorkspaceViews, updateUrlState]);

  // Close sync popover on outside click or Escape
  useEffect(() => {
    if (!syncPopoverOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        syncWrapRef.current &&
        !syncWrapRef.current.contains(e.target as Node)
      ) {
        setSyncPopoverOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSyncPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [syncPopoverOpen]);

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('mohasba-theme', next);
    } catch {
      // ignore storage errors
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim() || unlocking) return;
    setUnlocking(true);
    setAuthError(null);
    setShellMessage(null);
    setSignedOutNotice(false);
    try {
      const res = await unlockWithPasscode(passcode);
      if (res.ok) {
        setPasscode('');
        setShowPasscode(false);
      } else if (res.errorCode === 'RATE_LIMITED') {
        setAuthError(AR_STRINGS.errors.rateLimited);
      } else {
        setAuthError(res.errorMessage ?? AR_STRINGS.errors.unlockRequired);
      }
    } finally {
      setUnlocking(false);
    }
  };

  const handleOnboardingInit = async (payload: InitOnboardingPayload) => {
    if (onboardingBusy) return;
    setOnboardingBusy(true);
    setOnboardingError(null);
    try {
      const res = await initOnboarding(payload);
      if (!res.ok) {
        setOnboardingError(res.errorMessage ?? AR_STRINGS.errors.genericError);
      } else {
        setUserNavigated(false);
        updateUrlState(
          {
            ...effectiveUrlState,
            view: settings?.default_home_view ?? 'now',
            date: null,
            period: null,
          },
          'replace',
        );
      }
    } finally {
      setOnboardingBusy(false);
    }
  };

  const handleOnboardingImportFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOnboardingBusy(true);
    setOnboardingError(null);
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as Partial<ExportSnapshot>;
      if (parsed.schema_version !== 1 || !parsed.settings) {
        setOnboardingError('ملف النسخة الاحتياطية غير صالح.');
        return;
      }

      const logs = Array.isArray(parsed.daily_logs) ? parsed.daily_logs : [];
      const firstBatch = logs.slice(0, 200);
      const firstRes = await importBackupChunk({
        schema_version: 1,
        settings: {
          ...parsed.settings,
          onboarding_completed: true,
        },
        periods: parsed.periods ?? [],
        actions: parsed.actions ?? [],
        target_versions: parsed.target_versions ?? [],
        daily_logs: firstBatch,
      });

      if (!firstRes.ok) {
        setOnboardingError(
          firstRes.errorMessage ?? AR_STRINGS.errors.genericError,
        );
        return;
      }

      for (let i = 200; i < logs.length; i += 200) {
        const chunk = logs.slice(i, i + 200);
        const chunkRes = await importBackupChunk({
          schema_version: 1,
          daily_logs: chunk,
        });
        if (!chunkRes.ok) {
          setOnboardingError(
            chunkRes.errorMessage ?? AR_STRINGS.errors.genericError,
          );
          return;
        }
      }
      await refreshBootstrap({ full: true });
    } catch {
      setOnboardingError('تعذر قراءة ملف JSON.');
    } finally {
      setOnboardingBusy(false);
      e.target.value = '';
    }
  };

  const handleDownloadEmergencyExport = async () => {
    const data = await buildOfflineExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mohasba-emergency-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAndDiscard = async (mutationId: string) => {
    const res = await exportAndDiscardAttentionItem(mutationId);
    const blob = new Blob([JSON.stringify(res.emergencySnapshot, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mohasba-attention-${mutationId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const attentionItems = useMemo(
    () => outbox.filter((item) => item.state === 'attention_needed'),
    [outbox],
  );
  const actionsById = useMemo(
    () => new Map(actions.map((a) => [a.id, a])),
    [actions],
  );

  const syncLabel = useMemo(() => {
    switch (syncBadge.state) {
      case 'syncing':
        return AR_STRINGS.sync.syncing;
      case 'offline_pending':
        return `${AR_STRINGS.sync.offlineQueued} (${syncBadge.activeCount})`;
      case 'attention_needed':
        return `${AR_STRINGS.sync.attentionNeeded} (${syncBadge.attentionCount})`;
      case 'synced':
      default:
        return AR_STRINGS.sync.synced;
    }
  }, [syncBadge]);

  const activeNavMeta =
    NAV_ITEMS.find((n) => n.id === effectiveUrlState.view) ?? NAV_ITEMS[0]!;
  const qadaaCount = openQadaaQueue.length;
  const isOverviewActive =
    showWorkspaceViews && effectiveUrlState.view === 'week' && oneGlanceMode;
  const effectiveSelectedDate = effectiveUrlState.date ?? todayIslamicDate ?? '';

  const sidebarToggleShortcutText = useMemo(
    () => formatShortcutKeycaps(effectiveShortcuts.toggle_sidebar).join(' + '),
    [effectiveShortcuts.toggle_sidebar],
  );

  const themeTooltipLabel =
    theme === 'light'
      ? AR_STRINGS.app.themeToggleToDark
      : AR_STRINGS.app.themeToggleToLight;

  const lastSyncedLabel = useMemo(
    () => formatLastSynced(lastSyncedAt),
    [lastSyncedAt],
  );

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${
        isOverviewActive ? 'overview-active' : ''
      } ${!showWorkspaceViews ? 'no-chrome' : ''}`}
    >
      {/* Desktop RTL Inline-Start Navigation Rail (Hidden while locked/onboarding) */}
      {showWorkspaceViews && (
        <aside className="desktop-rail" aria-label="التنقل الرئيسي">
          <div className="brand-block">
            <div>
              <h1 className="brand-title">{AR_STRINGS.app.name}</h1>
              <p className="brand-note">محاسبة يومية وأسبوعية</p>
            </div>
            <Tooltip content="طي القائمة" shortcut={sidebarToggleShortcutText}>
              <button
                type="button"
                className="btn btn-icon"
                aria-label="طي القائمة الجانبية"
                onClick={() => setSidebarOverride(true)}
              >
                <IconSidebar />
              </button>
            </Tooltip>
          </div>

          <nav className="rail-nav">
            {NAV_ITEMS.map((item) => {
              const isCurrent = effectiveUrlState.view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="nav-btn"
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => handleNavigate(item.id)}
                >
                  <span className="nav-btn-label">
                    {renderNavIcon(item.id)}
                    <span>{item.desktopLabel}</span>
                  </span>
                  {item.id === 'qadaa' && qadaaCount > 0 && (
                    <span className="count-chip alert nums">{qadaaCount}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="rail-footer">
            <button
              type="button"
              className="btn"
              onClick={() => setShortcutsHelpOpen(true)}
            >
              <IconKeyboard size="sm" />
              <span>خريطة الاختصارات</span>
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void signOut().then((res) => {
                  if (res.ok) {
                    setSignedOutNotice(true);
                    setShellMessage('تم تسجيل الخروج بنجاح.');
                  }
                });
              }}
            >
              <IconLogOut size="sm" />
              <span>{AR_STRINGS.settings.signOutButton}</span>
            </button>
          </div>
        </aside>
      )}

      {/* Main Column */}
      <div className="main-col">
        <header className="top-bar">
          <div className="top-bar-inner">
            <div className="top-bar-start">
              {showWorkspaceViews && (
                <Tooltip content="فتح القائمة" shortcut={sidebarToggleShortcutText}>
                  <button
                    type="button"
                    className="btn btn-icon desktop-sidebar-trigger"
                    aria-label="فتح القائمة الجانبية"
                    onClick={() => setSidebarOverride(false)}
                  >
                    <IconSidebar />
                  </button>
                </Tooltip>
              )}
              <h2 className="page-heading">
                {showWorkspaceViews
                  ? activeNavMeta.desktopLabel
                  : AR_STRINGS.app.name}
              </h2>
            </div>

            <div className="top-bar-end" ref={syncWrapRef}>
              <button
                type="button"
                className="sync-btn"
                data-testid="sync-badge-btn"
                data-sync={syncBadge.state}
                aria-expanded={syncPopoverOpen}
                onClick={() => setSyncPopoverOpen((prev) => !prev)}
              >
                <span className="sync-dot" />
                <span className="sync-label nums">{syncLabel}</span>
              </button>

              <Tooltip content={themeTooltipLabel}>
                <button
                  type="button"
                  className="btn btn-icon"
                  data-testid="theme-toggle-btn"
                  aria-label={themeTooltipLabel}
                  onClick={toggleTheme}
                >
                  {theme === 'light' ? <IconMoon /> : <IconSun />}
                </button>
              </Tooltip>

              {syncPopoverOpen && (
                <div
                  className="sync-popover"
                  role="dialog"
                  aria-label="حالة المزامنة"
                >
                  <div className="sync-popover-head">
                    <strong className="text-sm">حالة المزامنة المحلية</strong>
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label="إغلاق"
                      onClick={() => setSyncPopoverOpen(false)}
                    >
                      <IconCross size="sm" />
                    </button>
                  </div>

                  <div className="sync-popover-body">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-col gap-0.5">
                        <span className="panel-meta nums">
                          الحالة: {syncLabel}
                        </span>
                        <span className="panel-meta nums">
                          آخر مزامنة: {lastSyncedLabel}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        disabled={
                          !isOnline || isSyncing || authStatus !== 'unlocked'
                        }
                        onClick={() => {
                          void flushOutbox();
                        }}
                      >
                        <IconRefresh size="sm" />
                        <span>مزامنة الآن</span>
                      </button>
                    </div>

                    {attentionItems.length === 0 ? (
                      <span className="panel-meta">
                        لا توجد عناصر متعثرة في طابور المزامنة.
                      </span>
                    ) : (
                      attentionItems.map((item) => {
                        const act = actionsById.get(item.action_id);
                        return (
                          <div
                            key={item.mutation_id}
                            className="attention-card"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <strong>{act?.title ?? item.action_id}</strong>
                              <span className="nums">{item.log_date}</span>
                            </div>
                            {item.last_error && (
                              <span className="text-xs">{item.last_error}</span>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                className="btn"
                                onClick={() => {
                                  void retryAttentionItem(item.mutation_id);
                                }}
                              >
                                {AR_STRINGS.sync.retryItem}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => {
                                  void handleExportAndDiscard(item.mutation_id);
                                }}
                              >
                                {AR_STRINGS.sync.exportAndDiscardItem}
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => {
                                  void discardAttentionItem(item.mutation_id);
                                }}
                              >
                                {AR_STRINGS.sync.discardItem}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          className={`workspace ${isOverviewActive ? 'overview-wide' : ''}`}
        >
          {swUpdateAvailable && (
            <div className="notice-bar" role="status">
              <span>{AR_STRINGS.app.updateAvailable}</span>
              <button
                type="button"
                className="btn btn-live"
                onClick={applySwUpdate}
              >
                تحديث الآن
              </button>
            </div>
          )}

          {isIosA2hsPromptVisible && !iosNoticeDismissed && (
            <div className="notice-bar" role="note">
              <div className="flex flex-col gap-1">
                <strong>{AR_STRINGS.sync.iosAddToHomeTitle}</strong>
                <span className="panel-meta">
                  {AR_STRINGS.sync.iosAddToHomeBody}
                </span>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setIosNoticeDismissed(true)}
              >
                إخفاء
              </button>
            </div>
          )}

          {shellMessage && (
            <div
              className="notice-bar"
              data-testid="status-message"
              role="status"
            >
              <span>
                {shellMessage}
                {signedOutNotice && (
                  <span className="sr-only"> signed_out</span>
                )}
              </span>
              <button
                type="button"
                className="btn btn-icon notice-dismiss-btn"
                aria-label="إغلاق التنبيه"
                onClick={() => {
                  setShellMessage(null);
                  setSignedOutNotice(false);
                }}
              >
                <IconX size="sm" />
              </button>
            </div>
          )}

          {/* Setup Incomplete */}
          {authStatus === 'setup_incomplete' && (
            <section className="panel auth-gate-wrap">
              <div className="panel-header">
                <h3 className="panel-title">إعداد الخادم غير مكتمل</h3>
              </div>
              <div className="p-4 flex flex-col gap-3 text-sm">
                <p className="m-0">{AR_STRINGS.errors.setupIncomplete}</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    void refreshBootstrap({ full: true });
                  }}
                >
                  إعادة الفحص
                </button>
              </div>
            </section>
          )}

          {/* Inline Passcode Unlock Gate */}
          {authStatus === 'locked' && (
            <section className="panel auth-gate-wrap">
              <div className="panel-header">
                <h3 className="panel-title flex items-center gap-2">
                  <IconLock size="sm" />
                  <span>{AR_STRINGS.authAndOnboarding.unlockTitle}</span>
                </h3>
              </div>
              <form
                onSubmit={(e) => {
                  void handleUnlockSubmit(e);
                }}
                className="p-4 flex flex-col gap-3"
              >
                <div className="passcode-field-wrap">
                  <input
                    type={showPasscode ? 'text' : 'password'}
                    className="field-input passcode-input"
                    aria-label="رمز الدخول (passcode)"
                    autoComplete="current-password"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="رمز الدخول"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-icon passcode-toggle-btn"
                    aria-label={
                      showPasscode ? 'إخفاء رمز الدخول' : 'إظهار رمز الدخول'
                    }
                    aria-pressed={showPasscode}
                    onClick={() => setShowPasscode((prev) => !prev)}
                  >
                    {showPasscode ? (
                      <IconEyeOff size="sm" />
                    ) : (
                      <IconEye size="sm" />
                    )}
                  </button>
                </div>
                {authError && (
                  <div className="confirm-banner" role="alert">
                    <span>{authError}</span>
                  </div>
                )}
                <button
                  type="submit"
                  className="btn btn-live"
                  disabled={unlocking}
                >
                  {AR_STRINGS.authAndOnboarding.unlockButton}
                </button>
                {outbox.length > 0 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void handleDownloadEmergencyExport();
                    }}
                  >
                    <IconDownload size="sm" />
                    <span>{AR_STRINGS.settings.exportEmergencyButton}</span>
                  </button>
                )}
              </form>
            </section>
          )}

          {/* First-Run Onboarding (2-Step 3-Level Wizard) */}
          {showOnboarding && (
            <OnboardingWizard
              busy={onboardingBusy}
              error={onboardingError}
              onComplete={handleOnboardingInit}
              onImportFile={handleOnboardingImportFile}
            />
          )}

          {/* Hydrating / Offline Empty State */}
          {authStatus === 'checking' && !hydrated && (
            <section className="panel">
              <div className="empty-state">
                <span>جاري تهيئة جدول المحاسبة...</span>
              </div>
            </section>
          )}

          {authStatus === 'unlocked' && settings === null && hydrated && (
            <section className="panel">
              <div className="empty-state">
                <span>
                  {isOnline
                    ? 'جاري تحميل بيانات الجدول...'
                    : 'أنت غير متصل بالإنترنت ولا توجد بيانات محفوظة محلياً بعد.'}
                </span>
              </div>
            </section>
          )}

          {/* 5 Core Views (Eagerly Bundled for Offline Tab Switching) */}
          {showWorkspaceViews && effectiveUrlState.view === 'now' && (
            <NowView
              selectedDate={effectiveSelectedDate}
              onSelectDate={(d) =>
                updateUrlState(
                  {
                    ...effectiveUrlState,
                    view: 'now',
                    date: d === todayIslamicDate ? null : d,
                  },
                  'replace',
                )
              }
              selectedPeriodId={effectiveUrlState.period}
              onSelectPeriodId={(periodId) =>
                updateUrlState(
                  { ...effectiveUrlState, view: 'now', period: periodId },
                  'replace',
                )
              }
              onResetToToday={() =>
                updateUrlState(
                  {
                    ...effectiveUrlState,
                    view: 'now',
                    date: null,
                    period: null,
                  },
                  'replace',
                )
              }
              onNavigateToCatchUp={() => handleNavigate('qadaa', 'catchup')}
              onOpenCellEditor={(target) => setCellEditorTarget(target)}
              onActionFeedback={(msg) => setUndoLabel(msg)}
            />
          )}

          {showWorkspaceViews && effectiveUrlState.view === 'week' && (
            <WeekView
              oneGlanceMode={oneGlanceMode}
              onSetOneGlanceMode={handleSetOneGlance}
              onOpenCellEditor={(target) => setCellEditorTarget(target)}
              onActionFeedback={(msg) => setUndoLabel(msg)}
            />
          )}

          {showWorkspaceViews && effectiveUrlState.view === 'qadaa' && (
            <QadaaView
              activeTab={effectiveUrlState.tab}
              onSelectTab={(tab) =>
                updateUrlState(
                  { ...effectiveUrlState, view: 'qadaa', tab },
                  'replace',
                )
              }
              onOpenCellEditor={(target) => setCellEditorTarget(target)}
              onActionFeedback={(msg) => setUndoLabel(msg)}
            />
          )}

          {showWorkspaceViews && effectiveUrlState.view === 'analytics' && (
            <AnalyticsView />
          )}

          {showWorkspaceViews && effectiveUrlState.view === 'settings' && (
            <SettingsView
              onStatusMessage={(msg) => {
                if (msg === 'signed_out') {
                  setSignedOutNotice(true);
                  setShellMessage('تم تسجيل الخروج بنجاح.');
                } else {
                  setSignedOutNotice(false);
                  setShellMessage(msg);
                }
              }}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (< 1024px, hidden while locked/onboarding) */}
      {showWorkspaceViews && (
        <nav className="mobile-nav" aria-label="التنقل السفلي">
          {NAV_ITEMS.map((item) => {
            const isCurrent = effectiveUrlState.view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className="mobile-nav-btn"
                aria-current={isCurrent ? 'page' : undefined}
                onClick={() => handleNavigate(item.id)}
              >
                {renderNavIcon(item.id)}
                <span>{item.mobileLabel}</span>
                {item.id === 'qadaa' && qadaaCount > 0 && (
                  <span className="mobile-badge nums">{qadaaCount}</span>
                )}
              </button>
            );
          })}
        </nav>
      )}

      {/* Live 5-Second Undo Toast */}
      {activeUndoToast && (
        <div
          key={activeUndoToast.id}
          className="undo-toast"
          data-testid="undo-toast"
          role="status"
          aria-live="polite"
        >
          <div className="undo-toast-body">
            <span>{undoLabel}</span>
            <div className="undo-toast-actions">
              <button
                type="button"
                className="undo-btn"
                data-testid="undo-toast-btn"
                onClick={() => {
                  void handleUndoClick();
                }}
              >
                {AR_STRINGS.street.undoAction}
              </button>
              <button
                type="button"
                className="undo-dismiss-btn"
                aria-label="إغلاق إشعار التراجع"
                onClick={dismissUndoToast}
              >
                <IconX size="sm" />
              </button>
            </div>
          </div>
          <div className="undo-progress" />
        </div>
      )}

      {/* Native <dialog> Cell Editor */}
      <CellEditorDialog
        target={cellEditorTarget}
        onClose={() => setCellEditorTarget(null)}
        onSaved={(msg) => setUndoLabel(msg)}
      />

      {/* Keyboard Shortcuts Quick Reference <dialog> */}
      <dialog
        ref={shortcutsDialogRef}
        className="app-dialog dialog-wide"
        aria-labelledby="shortcuts-help-title"
        onCancel={(e) => {
          e.preventDefault();
          setShortcutsHelpOpen(false);
        }}
        onClick={(e) => {
          if (e.target === shortcutsDialogRef.current) {
            setShortcutsHelpOpen(false);
          }
        }}
      >
        <div className="dialog-head">
          <h3 className="dialog-title flex items-center gap-2" id="shortcuts-help-title">
            <IconKeyboard size="sm" />
            <span>خريطة اختصارات لوحة المفاتيح</span>
          </h3>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="إغلاق"
            onClick={() => setShortcutsHelpOpen(false)}
          >
            <IconCross size="sm" />
          </button>
        </div>
        <div className="dialog-body dialog-body-scroll">
          <div className="shortcuts-help-list">
            {SHORTCUT_DEFINITIONS.map((def) => {
              const binding = effectiveShortcuts[def.id];
              const caps = formatShortcutKeycaps(binding);
              return (
                <div key={def.id} className="shortcut-help-row">
                  <span>{def.labelAr}</span>
                  <span className="kbd-group" dir="ltr">
                    {caps.map((cap, idx) => (
                      <kbd key={`${def.id}-${idx}`} className="kbd-cap nums">
                        {cap}
                      </kbd>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="dialog-foot">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setShortcutsHelpOpen(false);
              handleNavigate('settings');
            }}
          >
            تخصيص الاختصارات
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShortcutsHelpOpen(false)}
          >
            إغلاق
          </button>
        </div>
      </dialog>
    </div>
  );
}

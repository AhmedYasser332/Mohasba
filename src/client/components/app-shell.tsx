'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AR_STRINGS, type ExportSnapshot } from '@/domain';
import { useMohasba } from '../store/mohasba-provider';
import {
  CellEditorDialog,
  type CellEditorTarget,
} from './cell-editor-dialog';
import {
  IconAnalytics,
  IconCross,
  IconDownload,
  IconExpiredAlert,
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
  IconUpload,
} from './icons';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [oneGlanceMode, setOneGlanceMode] = useState(false);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [iosNoticeDismissed, setIosNoticeDismissed] = useState(false);

  const [passcode, setPasscode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [cellEditorTarget, setCellEditorTarget] =
    useState<CellEditorTarget | null>(null);
  const [undoLabel, setUndoLabel] = useState<string>(
    AR_STRINGS.street.undoToastMessage,
  );
  const [shellMessage, setShellMessage] = useState<string | null>(null);

  const syncWrapRef = useRef<HTMLDivElement | null>(null);

  // Sync URL from window.location.search on mount & popstate (zero useSearchParams!)
  useEffect(() => {
    const syncFromLocation = () => {
      setUrlState(parseUrlParams(window.location.search));
    };
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, []);

  // Global physical Ctrl+KeyI shortcut (Ctrl+I / Ctrl+ه) for desktop sidebar toggle
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyI') {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Close sync popover on outside click
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
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [syncPopoverOpen]);

  const updateUrlState = useCallback(
    (next: UrlParamsState, mode: 'push' | 'replace' = 'push') => {
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

  const handleNavigate = (view: AppView, tab: string | null = null) => {
    updateUrlState(
      {
        view,
        period: view === 'now' ? urlState.period : null,
        date: view === 'now' ? urlState.date : null,
        tab: view === 'qadaa' ? tab : null,
      },
      'push',
    );
  };

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('mohasba-theme', next);
    } catch {
      // ignore storage errors
    }
  };

  const handleSetOneGlance = (enabled: boolean) => {
    setOneGlanceMode(enabled);
    if (enabled) {
      setSidebarCollapsed(true);
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim() || unlocking) return;
    setUnlocking(true);
    setAuthError(null);
    setShellMessage(null);
    try {
      const res = await unlockWithPasscode(passcode);
      if (res.ok) {
        setPasscode('');
      } else if (res.errorCode === 'RATE_LIMITED') {
        setAuthError(AR_STRINGS.errors.rateLimited);
      } else {
        setAuthError(res.errorMessage ?? AR_STRINGS.errors.unlockRequired);
      }
    } finally {
      setUnlocking(false);
    }
  };

  const handleOnboardingInit = async (mode: 'starter_pack' | 'blank') => {
    if (onboardingBusy) return;
    setOnboardingBusy(true);
    setOnboardingError(null);
    try {
      const res = await initOnboarding(mode);
      if (!res.ok) {
        setOnboardingError(res.errorMessage ?? AR_STRINGS.errors.genericError);
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
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
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

  const handleUndoClick = async () => {
    if (!activeUndoToast) return;
    if (activeUndoToast.kind === 'batch' && activeUndoToast.batchId) {
      await undoBatch(activeUndoToast.batchId);
    } else if (activeUndoToast.mutationId) {
      await undoMutation(activeUndoToast.mutationId);
    }
    dismissUndoToast();
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
    NAV_ITEMS.find((n) => n.id === urlState.view) ?? NAV_ITEMS[0]!;
  const qadaaCount = openQadaaQueue.length;
  const isOverviewActive = urlState.view === 'week' && oneGlanceMode;
  const effectiveSelectedDate = urlState.date ?? todayIslamicDate ?? '';

  const showOnboarding =
    authStatus === 'unlocked' &&
    settings !== null &&
    !settings.onboarding_completed;

  const showWorkspaceViews =
    authStatus === 'unlocked' &&
    settings !== null &&
    settings.onboarding_completed;

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${
        isOverviewActive ? 'overview-active' : ''
      }`}
    >
      {/* Desktop RTL Inline-Start Navigation Rail */}
      <aside className="desktop-rail" aria-label="التنقل الرئيسي">
        <div className="brand-block">
          <div>
            <h1 className="brand-title">{AR_STRINGS.app.name}</h1>
            <p className="brand-note">محاسبة يومية وأسبوعية</p>
          </div>
          <button
            type="button"
            className="btn btn-icon has-tip"
            data-tip="طي القائمة (Ctrl+I / Ctrl+ه)"
            title={AR_STRINGS.app.sidebarToggleTooltip}
            aria-label="طي القائمة الجانبية"
            onClick={() => setSidebarCollapsed(true)}
          >
            <IconSidebar />
          </button>
        </div>

        <nav className="rail-nav">
          {NAV_ITEMS.map((item) => {
            const isCurrent = urlState.view === item.id;
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

        {authStatus === 'unlocked' && (
          <div className="rail-footer">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void signOut().then((res) => {
                  if (res.ok) setShellMessage('signed_out');
                });
              }}
            >
              <IconLogOut size="sm" />
              <span>{AR_STRINGS.settings.signOutButton}</span>
            </button>
          </div>
        )}
      </aside>

      {/* Main Column */}
      <div className="main-col">
        <header className="top-bar">
          <div className="top-bar-start">
            <button
              type="button"
              className="btn btn-icon desktop-sidebar-trigger has-tip"
              data-tip="فتح القائمة (Ctrl+I / Ctrl+ه)"
              title={AR_STRINGS.app.sidebarToggleTooltip}
              aria-label="فتح القائمة الجانبية"
              onClick={() => setSidebarCollapsed(false)}
            >
              <IconSidebar />
            </button>
            <h2 className="page-heading">{activeNavMeta.desktopLabel}</h2>
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

            <button
              type="button"
              className="btn btn-icon"
              data-testid="theme-toggle-btn"
              aria-label={
                theme === 'light'
                  ? AR_STRINGS.app.themeToggleToDark
                  : AR_STRINGS.app.themeToggleToLight
              }
              title={
                theme === 'light'
                  ? AR_STRINGS.app.themeToggleToDark
                  : AR_STRINGS.app.themeToggleToLight
              }
              onClick={toggleTheme}
            >
              {theme === 'light' ? <IconMoon /> : <IconSun />}
            </button>

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
                    <span className="panel-meta nums">
                      الحالة: {syncLabel}
                    </span>
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
              <span>{shellMessage}</span>
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
                <input
                  type="password"
                  className="field-input"
                  aria-label="passcode"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="رمز الدخول"
                  autoFocus
                />
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

          {/* First-Run Onboarding */}
          {showOnboarding && (
            <section className="panel auth-gate-wrap">
              <div className="panel-header">
                <h3 className="panel-title">
                  {AR_STRINGS.authAndOnboarding.onboardingTitle}
                </h3>
              </div>
              <div className="p-4 flex flex-col gap-3">
                <p className="m-0 panel-meta">
                  اختر طريقة إعداد جدولك للمرة الأولى:
                </p>

                {onboardingError && (
                  <div className="confirm-banner" role="alert">
                    <IconExpiredAlert size="sm" />
                    <span>{onboardingError}</span>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-live"
                  data-testid="onboarding-starter-pack"
                  disabled={onboardingBusy}
                  onClick={() => {
                    void handleOnboardingInit('starter_pack');
                  }}
                >
                  <span>
                    {AR_STRINGS.authAndOnboarding.onboardingStarterPack}
                  </span>
                </button>

                <button
                  type="button"
                  className="btn"
                  disabled={onboardingBusy}
                  onClick={() => importInputRef.current?.click()}
                >
                  <IconUpload size="sm" />
                  <span>
                    {AR_STRINGS.authAndOnboarding.onboardingImportJson}
                  </span>
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    void handleOnboardingImportFile(e);
                  }}
                />

                <button
                  type="button"
                  className="btn"
                  disabled={onboardingBusy}
                  onClick={() => {
                    void handleOnboardingInit('blank');
                  }}
                >
                  <span>{AR_STRINGS.authAndOnboarding.onboardingBlank}</span>
                </button>
              </div>
            </section>
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
          {showWorkspaceViews && urlState.view === 'now' && (
            <NowView
              selectedDate={effectiveSelectedDate}
              onSelectDate={(d) =>
                updateUrlState(
                  { ...urlState, view: 'now', date: d },
                  'replace',
                )
              }
              selectedPeriodId={urlState.period}
              onSelectPeriodId={(periodId) =>
                updateUrlState(
                  { ...urlState, view: 'now', period: periodId },
                  'replace',
                )
              }
              onNavigateToCatchUp={() => handleNavigate('qadaa', 'catchup')}
              onOpenCellEditor={(target) => setCellEditorTarget(target)}
              onActionFeedback={(msg) => setUndoLabel(msg)}
            />
          )}

          {showWorkspaceViews && urlState.view === 'week' && (
            <WeekView
              oneGlanceMode={oneGlanceMode}
              onSetOneGlanceMode={handleSetOneGlance}
              onOpenCellEditor={(target) => setCellEditorTarget(target)}
              onActionFeedback={(msg) => setUndoLabel(msg)}
            />
          )}

          {showWorkspaceViews && urlState.view === 'qadaa' && (
            <QadaaView
              activeTab={urlState.tab}
              onSelectTab={(tab) =>
                updateUrlState(
                  { ...urlState, view: 'qadaa', tab },
                  'replace',
                )
              }
              onOpenCellEditor={(target) => setCellEditorTarget(target)}
              onActionFeedback={(msg) => setUndoLabel(msg)}
            />
          )}

          {showWorkspaceViews && urlState.view === 'analytics' && (
            <AnalyticsView />
          )}

          {showWorkspaceViews && urlState.view === 'settings' && (
            <SettingsView onStatusMessage={(msg) => setShellMessage(msg)} />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (< 1024px) */}
      <nav className="mobile-nav" aria-label="التنقل السفلي">
        {NAV_ITEMS.map((item) => {
          const isCurrent = urlState.view === item.id;
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
    </div>
  );
}

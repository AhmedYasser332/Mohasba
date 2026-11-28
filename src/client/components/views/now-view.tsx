'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AR_STRINGS,
  addDaysIso,
  getIsoDayOfWeek,
  getWeekDates,
  isActionArchivedOnDate,
  isPeriodArchivedOnDate,
  parseIsoDateParts,
  planMosqueDone,
  planPeriodDone,
  resolvePeriodWindowsForDay,
  type Action,
  type Period,
  type ResolvedPeriodWindow,
  type WindowLookupCache,
} from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { ARABIC_NOUN_FORMS, formatArabicCount } from '../../utils/arabic-plural';
import {
  formatArabicDateFull,
  formatHhmmInTz,
  getWeekDotClass,
  resolveCellDisplay,
} from '../cell-display';
import type { CellEditorTarget } from '../cell-editor-dialog';
import {
  EntityContextMenu,
  QuickActionEditDialog,
  QuickPeriodEditDialog,
  type EntityContextMenuItem,
} from '../quick-edit-dialogs';
import {
  IconCheck,
  IconCheckAll,
  IconChevronLeft,
  IconChevronRight,
  IconCross,
  IconExpiredAlert,
  IconMoreDots,
  IconMosque,
  IconQadaa,
} from '../icons';
import { PeriodCountdown } from '../period-countdown';

interface NowViewProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  selectedPeriodId: string | null;
  onSelectPeriodId: (periodId: string | null) => void;
  onResetToToday: () => void;
  onNavigateToCatchUp: () => void;
  onOpenCellEditor: (target: CellEditorTarget) => void;
  onActionFeedback: (message: string, options?: { isError?: boolean }) => void;
}

type RenamingTarget =
  | { kind: 'action'; id: string; originalTitle: string }
  | { kind: 'period'; id: string; originalTitle: string };

interface EntityMenuState {
  position: { x: number; y: number };
  title: string;
  items: EntityContextMenuItem[];
}

const QUICK_PERCENT_STEPS = [25, 50, 75, 100, 0] as const;

export function NowView({
  selectedDate,
  onSelectDate,
  selectedPeriodId,
  onSelectPeriodId,
  onResetToToday,
  onNavigateToCatchUp,
  onOpenCellEditor,
  onActionFeedback,
}: NowViewProps) {
  const {
    settings,
    periods,
    actions,
    targetVersions,
    logsByKey,
    nowMs,
    isOnline,
    activeWindowResolution,
    todayIslamicDate,
    catchUp48hItems,
    adaptingActionIds,
    logCellTap,
    logBulkMosqueDone,
    logBulkPeriodDone,
    updateAction,
    updatePeriod,
  } = useMohasba();

  const periodStripRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameSavingRef = useRef(false);
  const [stripFade, setStripFade] = useState({ start: false, end: false });
  const [renamingTarget, setRenamingTarget] = useState<RenamingTarget | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState('');
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [entityMenu, setEntityMenu] = useState<EntityMenuState | null>(null);

  const periodsById = useMemo(
    () => new Map(periods.map((p) => [p.id, p])),
    [periods],
  );
  const targetVersionsById = useMemo(
    () => new Map(targetVersions.map((v) => [v.id, v])),
    [targetVersions],
  );

  const activeTimePeriods = useMemo(
    () =>
      periods
        .filter((p) => p.side === 'TIME_BOUND' && !isPeriodArchivedOnDate(p, selectedDate))
        .sort((a, b) => a.sort_order - b.sort_order),
    [periods, selectedDate],
  );

  const activeDailyGroups = useMemo(
    () =>
      periods
        .filter((p) => p.side === 'DAILY_GROUP' && !isPeriodArchivedOnDate(p, selectedDate))
        .sort((a, b) => a.sort_order - b.sort_order),
    [periods, selectedDate],
  );

  const liveOpenEntries = useMemo(() => {
    if (
      !activeWindowResolution ||
      !todayIslamicDate ||
      selectedDate !== todayIslamicDate
    ) {
      return [] as Array<{ period: Period; window: ResolvedPeriodWindow }>;
    }
    const allOpen = activeWindowResolution.activeWindows;
    if (allOpen.length === 0) return [];
    const islamicDayMatches = allOpen.filter(
      (w) => w.islamicDate === todayIslamicDate,
    );
    const pool = islamicDayMatches.length > 0 ? islamicDayMatches : allOpen;
    const windowByPeriodId = new Map<string, ResolvedPeriodWindow>();
    for (const w of pool) {
      if (!windowByPeriodId.has(w.periodId)) {
        windowByPeriodId.set(w.periodId, w);
      }
    }
    return activeTimePeriods
      .filter((p) => windowByPeriodId.has(p.id))
      .map((p) => ({ period: p, window: windowByPeriodId.get(p.id)! }));
  }, [
    activeTimePeriods,
    activeWindowResolution,
    selectedDate,
    todayIslamicDate,
  ]);

  const hasMultiLiveTab =
    selectedDate === todayIslamicDate && liveOpenEntries.length > 1;
  const isMultiLiveView = hasMultiLiveTab && selectedPeriodId === null;

  const activePeriod: Period | null = useMemo(() => {
    const allActive = [...activeTimePeriods, ...activeDailyGroups];
    if (selectedPeriodId) {
      const matched = allActive.find((p) => p.id === selectedPeriodId);
      if (matched) return matched;
    }
    if (
      selectedDate === todayIslamicDate &&
      activeWindowResolution?.primaryWindow
    ) {
      const liveMatch = activeTimePeriods.find(
        (p) => p.id === activeWindowResolution.primaryWindow?.periodId,
      );
      if (liveMatch) return liveMatch;
    }
    return activeTimePeriods[0] ?? activeDailyGroups[0] ?? null;
  }, [
    activeDailyGroups,
    activeTimePeriods,
    activeWindowResolution,
    selectedDate,
    selectedPeriodId,
    todayIslamicDate,
  ]);

  const weekDates = useMemo(() => {
    if (!settings) return [selectedDate];
    return getWeekDates(selectedDate, settings.week_start_day);
  }, [selectedDate, settings]);

  const dayWindowsByPeriodId = useMemo(() => {
    if (!settings) return new Map<string, ResolvedPeriodWindow>();
    const resolved = resolvePeriodWindowsForDay(
      selectedDate,
      periods,
      settings,
      nowMs,
      { includeInactive: true },
    );
    return new Map(resolved.map((w) => [w.periodId, w]));
  }, [nowMs, periods, selectedDate, settings]);

  const openLivePeriodIds = useMemo(() => {
    const set = new Set<string>();
    if (!activeWindowResolution) return set;
    for (const w of activeWindowResolution.activeWindows) {
      set.add(w.periodId);
    }
    return set;
  }, [activeWindowResolution]);

  const orderedTabIds = useMemo<Array<string | null>>(
    () => [
      ...(hasMultiLiveTab ? [null] : []),
      ...activeTimePeriods.map((p) => p.id),
      ...activeDailyGroups.map((g) => g.id),
    ],
    [activeDailyGroups, activeTimePeriods, hasMultiLiveTab],
  );

  const startRename = useCallback(
    (kind: 'action' | 'period', id: string, title: string) => {
      if (!isOnline) {
        onActionFeedback('إعادة التسمية متاحة عند الاتصال بالإنترنت فقط', {
          isError: true,
        });
        return;
      }
      if (kind === 'period') {
        const isDisplayed = isMultiLiveView
          ? liveOpenEntries.some((entry) => entry.period.id === id)
          : activePeriod?.id === id;
        if (!isDisplayed) {
          onSelectPeriodId(id);
        }
      }
      renameSavingRef.current = false;
      setRenameDraft(title);
      setRenamingTarget({ kind, id, originalTitle: title });
    },
    [
      activePeriod?.id,
      isMultiLiveView,
      isOnline,
      liveOpenEntries,
      onActionFeedback,
      onSelectPeriodId,
    ],
  );

  const cancelRename = useCallback(() => {
    renameSavingRef.current = true;
    setRenamingTarget(null);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingTarget || renameSavingRef.current) return;
    const target = renamingTarget;
    if (!isOnline) {
      setRenamingTarget(null);
      onActionFeedback('إعادة التسمية متاحة عند الاتصال بالإنترنت فقط', {
        isError: true,
      });
      return;
    }
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === target.originalTitle.trim()) {
      setRenamingTarget(null);
      return;
    }
    renameSavingRef.current = true;
    setRenamingTarget(null);
    const res =
      target.kind === 'action'
        ? await updateAction(target.id, { title: trimmed })
        : await updatePeriod(target.id, { title: trimmed });
    renameSavingRef.current = false;
    if (res.ok) {
      onActionFeedback(`تم تغيير الاسم إلى «${trimmed}»`);
    } else {
      onActionFeedback(res.errorMessage ?? 'تعذر حفظ الاسم الجديد', {
        isError: true,
      });
    }
  }, [
    isOnline,
    onActionFeedback,
    renameDraft,
    renamingTarget,
    updateAction,
    updatePeriod,
  ]);

  useEffect(() => {
    if (!renamingTarget) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renamingTarget, activePeriod?.id, isMultiLiveView]);

  const openActionContextMenuAt = useCallback(
    (position: { x: number; y: number }, action: Action) => {
      setEntityMenu({
        position,
        title: action.title,
        items: [
          {
            id: 'edit-action',
            label: 'تعديل العمل...',
            onSelect: () => setEditingActionId(action.id),
          },
          {
            id: 'rename-action',
            label: 'إعادة تسمية',
            disabled: !isOnline,
            onSelect: () => startRename('action', action.id, action.title),
          },
          {
            id: 'open-cell-editor',
            label: 'تفاصيل وملاحظة اليوم',
            onSelect: () => onOpenCellEditor({ action, logDate: selectedDate }),
          },
        ],
      });
    },
    [isOnline, onOpenCellEditor, selectedDate, startRename],
  );

  const openActionContextMenu = useCallback(
    (e: React.MouseEvent, action: Action) => {
      e.preventDefault();
      e.stopPropagation();
      openActionContextMenuAt({ x: e.clientX, y: e.clientY }, action);
    },
    [openActionContextMenuAt],
  );

  const openPeriodContextMenuAt = useCallback(
    (position: { x: number; y: number }, period: Period) => {
      setEntityMenu({
        position,
        title: period.title,
        items: [
          {
            id: 'edit-period',
            label: 'تعديل الفترة...',
            onSelect: () => setEditingPeriodId(period.id),
          },
          {
            id: 'rename-period',
            label: 'إعادة تسمية',
            disabled: !isOnline,
            onSelect: () => startRename('period', period.id, period.title),
          },
        ],
      });
    },
    [isOnline, startRename],
  );

  const openPeriodContextMenu = useCallback(
    (e: React.MouseEvent, period: Period) => {
      e.preventDefault();
      e.stopPropagation();
      openPeriodContextMenuAt({ x: e.clientX, y: e.clientY }, period);
    },
    [openPeriodContextMenuAt],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (renamingTarget !== null || entityMenu !== null) return;
      if (document.querySelector('dialog[open]') !== null) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.closest(
            'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
          ) !== null)
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onSelectDate(addDaysIso(selectedDate, 1));
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          onSelectDate(addDaysIso(selectedDate, -1));
          return;
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (orderedTabIds.length === 0) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const currentTabId = isMultiLiveView ? null : (activePeriod?.id ?? null);
        const foundIndex = orderedTabIds.indexOf(currentTabId);
        const currentIndex = foundIndex >= 0 ? foundIndex : 0;
        const delta = e.key === 'ArrowLeft' ? 1 : -1;
        const nextIndex = Math.max(
          0,
          Math.min(orderedTabIds.length - 1, currentIndex + delta),
        );
        onSelectPeriodId(orderedTabIds[nextIndex] ?? null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activePeriod?.id,
    entityMenu,
    isMultiLiveView,
    onSelectDate,
    onSelectPeriodId,
    orderedTabIds,
    renamingTarget,
    selectedDate,
  ]);

  const updateStripFade = useCallback(() => {
    const el = periodStripRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 2) {
      setStripFade((prev) =>
        prev.start || prev.end ? { start: false, end: false } : prev,
      );
      return;
    }
    const scrolled = Math.abs(el.scrollLeft);
    const start = scrolled > 4;
    const end = scrolled < maxScroll - 4;
    setStripFade((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, []);

  useEffect(() => {
    const el = periodStripRef.current;
    if (!el) return;
    const activeTab = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (activeTab && typeof activeTab.scrollIntoView === 'function') {
      const reduceMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      activeTab.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
    updateStripFade();
  }, [
    activePeriod?.id,
    isMultiLiveView,
    selectedDate,
    selectedPeriodId,
    updateStripFade,
  ]);

  useEffect(() => {
    updateStripFade();
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', updateStripFade);
    return () => window.removeEventListener('resize', updateStripFade);
  }, [
    activeTimePeriods.length,
    activeDailyGroups.length,
    hasMultiLiveTab,
    updateStripFade,
  ]);

  const editingAction = useMemo(
    () =>
      editingActionId
        ? (actions.find((a) => a.id === editingActionId) ?? null)
        : null,
    [actions, editingActionId],
  );

  const editingPeriod = useMemo(
    () =>
      editingPeriodId
        ? (periods.find((p) => p.id === editingPeriodId) ?? null)
        : null,
    [editingPeriodId, periods],
  );

  if (!settings) {
    return null;
  }

  const windowCache: WindowLookupCache = new Map();

  const handleToggleDone = async (action: Action) => {
    const info = resolveCellDisplay({
      action,
      logDate: selectedDate,
      logsByKey,
      periodsById,
      periods,
      targetVersions,
      targetVersionsById,
      settings,
      nowMs,
      windowCache,
    });

    if (info.state === 'QADAA_DONE' || info.state === 'DISABLED') {
      onOpenCellEditor({ action, logDate: selectedDate });
      return;
    }

    const isClearing = info.state === 'DONE';
    const isDefaultOff = action.default_disabled_days.includes(
      getIsoDayOfWeek(selectedDate),
    );
    await logCellTap({
      action,
      logDate: selectedDate,
      availability_override: isDefaultOff ? 'ENABLED' : null,
      status: isClearing ? null : 'DONE',
      percent_value: null,
      clientTargetVersionId: info.targetVersion?.id ?? null,
    });
    onActionFeedback(
      isClearing
        ? `تم مسح تسجيل ${action.title}`
        : `تم تسجيل ${action.title}`,
    );
  };

  const handleToggleMissed = async (action: Action) => {
    const info = resolveCellDisplay({
      action,
      logDate: selectedDate,
      logsByKey,
      periodsById,
      periods,
      targetVersions,
      targetVersionsById,
      settings,
      nowMs,
      windowCache,
    });

    if (info.state === 'QADAA_DONE' || info.state === 'DISABLED') {
      onOpenCellEditor({ action, logDate: selectedDate });
      return;
    }

    const isClearing = info.state === 'MISSED';
    const isDefaultOff = action.default_disabled_days.includes(
      getIsoDayOfWeek(selectedDate),
    );
    await logCellTap({
      action,
      logDate: selectedDate,
      availability_override: isDefaultOff ? 'ENABLED' : null,
      status: isClearing ? null : 'MISSED',
      percent_value: null,
      clientTargetVersionId: info.targetVersion?.id ?? null,
    });
    onActionFeedback(
      isClearing
        ? `تم مسح تسجيل ${action.title}`
        : `تم تسجيل فوات ${action.title}`,
    );
  };

  const handleQuickPercent = async (action: Action, pct: number) => {
    const info = resolveCellDisplay({
      action,
      logDate: selectedDate,
      logsByKey,
      periodsById,
      periods,
      targetVersions,
      targetVersionsById,
      settings,
      nowMs,
      windowCache,
    });

    if (info.state === 'QADAA_DONE' || info.state === 'DISABLED') {
      onOpenCellEditor({ action, logDate: selectedDate });
      return;
    }

    const isDefaultOff = action.default_disabled_days.includes(
      getIsoDayOfWeek(selectedDate),
    );
    await logCellTap({
      action,
      logDate: selectedDate,
      availability_override: isDefaultOff ? 'ENABLED' : null,
      status: pct === 100 ? 'DONE' : pct === 0 ? 'MISSED' : 'PERCENT',
      percent_value: pct > 0 && pct < 100 ? pct : null,
      clientTargetVersionId: info.targetVersion?.id ?? null,
    });
    onActionFeedback(`تم تسجيل ${pct}% للعمل ${action.title}`);
  };

  const handleBulkMosque = async (periodId: string) => {
    const res = await logBulkMosqueDone(periodId, selectedDate);
    if (res.items.length > 0) {
      onActionFeedback(
        `تم تسجيل ${formatArabicCount(res.items.length, ARABIC_NOUN_FORMS.action)} في المسجد`,
      );
    }
  };

  const handleBulkPeriod = async (periodId: string) => {
    const res = await logBulkPeriodDone(periodId, selectedDate);
    if (res.items.length > 0) {
      onActionFeedback(
        `تم تسجيل الفترة بالكامل (${formatArabicCount(res.items.length, ARABIC_NOUN_FORMS.action)})`,
      );
    }
  };

  const renderActionRow = (action: Action) => {
    const info = resolveCellDisplay({
      action,
      logDate: selectedDate,
      logsByKey,
      periodsById,
      periods,
      targetVersions,
      targetVersionsById,
      settings,
      nowMs,
      windowCache,
    });
    const isDisabled = info.state === 'DISABLED';
    const isExpired = info.state === 'UNLOGGED_EXPIRED';
    const showGrace = adaptingActionIds.has(action.id);
    const isRenamingAction =
      renamingTarget?.kind === 'action' && renamingTarget.id === action.id;

    let doneCount = 0;
    let qadaaCount = 0;
    let percentCount = 0;
    let missedCount = 0;
    let expiredCount = 0;
    const weekDotItems = weekDates.map((d) => {
      const dayDisplay = resolveCellDisplay({
        action,
        logDate: d,
        logsByKey,
        periodsById,
        periods,
        targetVersions,
        targetVersionsById,
        settings,
        nowMs,
        windowCache,
      });
      if (dayDisplay.state === 'DONE') doneCount += 1;
      else if (dayDisplay.state === 'QADAA_DONE') qadaaCount += 1;
      else if (dayDisplay.state === 'PERCENT') percentCount += 1;
      else if (dayDisplay.state === 'MISSED') missedCount += 1;
      else if (dayDisplay.state === 'UNLOGGED_EXPIRED') expiredCount += 1;
      return {
        date: d,
        dotCls: getWeekDotClass(dayDisplay.state),
        dowName: AR_STRINGS.week.weekdaysAr[getIsoDayOfWeek(d)] ?? d,
      };
    });
    const summaryParts: string[] = [];
    if (doneCount > 0) summaryParts.push(`${doneCount} تم`);
    if (qadaaCount > 0) summaryParts.push(`${qadaaCount} قضاء`);
    if (percentCount > 0) summaryParts.push(`${percentCount} نسبة`);
    if (missedCount > 0) summaryParts.push(`${missedCount} فات`);
    if (expiredCount > 0) summaryParts.push(`${expiredCount} غير مسجل`);
    const weekDotsAriaLabel =
      summaryParts.length > 0
        ? `ملخص الأسبوع: ${summaryParts.join('، ')}`
        : 'ملخص الأسبوع: لا توجد سجلات بعد';

    return (
      <div
        key={action.id}
        data-testid={`now-action-${action.id}`}
        className={`action-row ${isDisabled ? 'is-disabled' : ''} ${isExpired ? 'is-expired' : ''}`}
      >
        <div className="action-row-main">
          <div className="action-info">
            <div className="action-title-line">
              {isRenamingAction ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  maxLength={120}
                  className="inline-rename-input"
                  aria-label={`إعادة تسمية ${action.title}`}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      void commitRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelRename();
                    }
                  }}
                  onBlur={() => {
                    void commitRename();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="action-title is-editable-title"
                  title="انقر مرتين لإعادة التسمية، أو بزر الفأرة الأيمن للخيارات"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename('action', action.id, action.title);
                  }}
                  onContextMenu={(e) => openActionContextMenu(e, action)}
                >
                  {action.title}
                </span>
              )}
              {!isRenamingAction && (
                <button
                  type="button"
                  className="window-edit-btn now-action-menu-btn"
                  aria-label={`تعديل وإعادة تسمية ${action.title}`}
                  title="تعديل العمل أو إعادة تسميته"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    openActionContextMenuAt(
                      { x: rect.left + rect.width / 2, y: rect.bottom + 4 },
                      action,
                    );
                  }}
                >
                  <IconMoreDots size="sm" />
                </button>
              )}
              {info.targetVersion && (
                <span className="target-tag nums">
                  {info.targetVersion.target_label}
                </span>
              )}
              {showGrace && (
                <span className="target-tag new-target-tag">
                  {AR_STRINGS.analytics.newTargetBadge}
                </span>
              )}
              {isExpired && (
                <span className="target-tag expired-tag">غير مسجّل</span>
              )}
              {isDisabled && <span className="target-tag">معذور اليوم</span>}
            </div>

            <div className="action-sub-line">
              <span
                className="week-dots"
                role="img"
                aria-label={weekDotsAriaLabel}
              >
                {weekDotItems.map((dot) => (
                  <span
                    key={dot.date}
                    className={`w-dot ${dot.dotCls}`}
                    title={dot.dowName}
                  />
                ))}
              </span>
              {info.note && (
                <span className="row-note-preview" title={info.note}>
                  {info.note}
                </span>
              )}
            </div>
          </div>

          <div className="action-controls">
            {info.state === 'PERCENT' && (
              <span
                className="tap-pct-badge nums"
                aria-label={`نسبة الإنجاز ${info.percentValue ?? 0}%`}
              >
                {info.percentValue ?? 0}%
              </span>
            )}

            <button
              type="button"
              className={`tap-btn ${
                info.state === 'DONE'
                  ? 'active-done'
                  : info.state === 'QADAA_DONE'
                    ? 'active-qadaa'
                    : ''
              }`}
              aria-label={`تسجيل تم للعمل ${action.title}`}
              aria-pressed={info.state === 'DONE' || info.state === 'QADAA_DONE'}
              onClick={() => {
                void handleToggleDone(action);
              }}
            >
              {info.state === 'QADAA_DONE' ? <IconQadaa /> : <IconCheck />}
            </button>

            <button
              type="button"
              className={`tap-btn ${info.state === 'MISSED' ? 'active-missed' : ''}`}
              aria-label={`تسجيل فات للعمل ${action.title}`}
              aria-pressed={info.state === 'MISSED'}
              onClick={() => {
                void handleToggleMissed(action);
              }}
            >
              <IconCross />
            </button>

            <button
              type="button"
              className="tap-btn tap-btn-more"
              aria-label={`خيارات إضافية للعمل ${action.title}`}
              onClick={() => onOpenCellEditor({ action, logDate: selectedDate })}
            >
              <IconMoreDots />
            </button>
          </div>
        </div>

        {action.supports_percentage && !isDisabled && (
          <div className="pct-bar" role="group" aria-label="تحديد النسبة المئوية">
            {QUICK_PERCENT_STEPS.map((val) => {
              const isSelected =
                (val === 100 && info.state === 'DONE') ||
                (val === 0 && info.state === 'MISSED') ||
                (info.state === 'PERCENT' && info.percentValue === val);
              const selectedClass = isSelected
                ? val === 100
                  ? 'selected-done'
                  : val === 0
                    ? 'selected-missed'
                    : 'selected-pct'
                : '';

              return (
                <button
                  key={val}
                  type="button"
                  className={`pct-chip nums ${selectedClass}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    void handleQuickPercent(action, val);
                  }}
                >
                  {val}%
                  {val > 0 && val < 100 && isSelected && (
                    <span
                      className="pct-chip-fill"
                      style={{ width: `${val}%` }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderPeriodPanel = (
    period: Period,
    windowOverride?: ResolvedPeriodWindow | null,
  ) => {
    const periodWindow =
      windowOverride ??
      (period.side === 'TIME_BOUND'
        ? (dayWindowsByPeriodId.get(period.id) ?? null)
        : null);

    const isClosing = Boolean(periodWindow?.isPreExpiry);
    const horizonPct = periodWindow
      ? periodWindow.isExpired
        ? 100
        : periodWindow.isOpen
          ? Math.round(periodWindow.elapsedRatio * 100)
          : 0
      : 0;

    const timeStatusText = periodWindow
      ? periodWindow.isExpired
        ? 'انتهى الوقت'
        : 'قادم'
      : '';

    const periodActions = actions
      .filter(
        (a) =>
          a.period_id === period.id &&
          !isActionArchivedOnDate(a, selectedDate),
      )
      .sort((a, b) => a.sort_order - b.sort_order);

    const boundLeftActions =
      period.side === 'TIME_BOUND'
        ? actions
            .filter(
              (a) =>
                a.bound_time_period_id === period.id &&
                !isActionArchivedOnDate(a, selectedDate),
            )
            .sort((a, b) => a.sort_order - b.sort_order)
        : [];

    const hasMosqueActions = periodActions.some(
      (a) => a.is_mosque_action && !a.supports_percentage,
    );

    const eligibleMosqueCount =
      period.side === 'TIME_BOUND' && hasMosqueActions
        ? planMosqueDone({
            periodId: period.id,
            logDate: selectedDate,
            actions,
            periods,
            logsByKey,
          }).length
        : 0;

    const eligiblePeriodCount =
      period.side === 'TIME_BOUND'
        ? planPeriodDone({
            periodId: period.id,
            logDate: selectedDate,
            actions,
            periods,
            logsByKey,
          }).length
        : 0;

    const isRenamingPeriod =
      renamingTarget?.kind === 'period' && renamingTarget.id === period.id;

    return (
      <section
        key={period.id}
        className="panel"
        data-testid={`now-period-panel-${period.id}`}
        aria-label={`أعمال ${period.title}`}
      >
        <div className="window-header">
          <div className="window-header-start">
            {isRenamingPeriod ? (
              <input
                ref={renameInputRef}
                type="text"
                maxLength={80}
                className="inline-rename-input inline-rename-input-title"
                aria-label={`إعادة تسمية ${period.title}`}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    void commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelRename();
                  }
                }}
                onBlur={() => {
                  void commitRename();
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            ) : (
              <h2
                className="window-title is-editable-title"
                title="انقر مرتين لإعادة التسمية، أو بزر الفأرة الأيمن للخيارات"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename('period', period.id, period.title);
                }}
                onContextMenu={(e) => openPeriodContextMenu(e, period)}
              >
                {period.side === 'TIME_BOUND'
                  ? `فترة ${period.title}`
                  : period.title}
              </h2>
            )}
          </div>

          <div className="window-header-end">
            {periodWindow ? (
              <div className="window-time-meta nums">
                <span dir="ltr">
                  {formatHhmmInTz(
                    periodWindow.startInstant,
                    settings.iana_timezone,
                  )}{' '}
                  -{' '}
                  {formatHhmmInTz(
                    periodWindow.endInstant,
                    settings.iana_timezone,
                  )}
                </span>
                {periodWindow.isOpen ? (
                  <PeriodCountdown
                    endInstant={periodWindow.endInstant}
                    isClosing={isClosing}
                  />
                ) : (
                  <span className="window-countdown">{timeStatusText}</span>
                )}
              </div>
            ) : (
              <span className="panel-meta">
                {formatArabicDateFull(selectedDate)}
              </span>
            )}

            <button
              type="button"
              className="window-edit-btn"
              aria-label={`خيارات الفترة ${period.title}`}
              title={`خيارات الفترة ${period.title}`}
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                openPeriodContextMenuAt(
                  { x: rect.left + rect.width / 2, y: rect.bottom + 6 },
                  period,
                );
              }}
            >
              <IconMoreDots size="sm" />
            </button>
          </div>

          {period.side === 'TIME_BOUND' && (
            <div className="horizon-track" aria-hidden="true">
              <div
                className={`horizon-fill ${isClosing ? 'closing' : ''}`}
                style={{ width: `${horizonPct}%` }}
              />
            </div>
          )}
        </div>

        {period.side === 'TIME_BOUND' && (
          <div
            className={`quick-split ${hasMosqueActions ? '' : 'quick-split-single'}`}
          >
            {hasMosqueActions && (
              <button
                type="button"
                className="btn btn-live"
                data-testid="btn-mosque-done"
                data-period-id={period.id}
                disabled={eligibleMosqueCount === 0}
                onClick={() => {
                  void handleBulkMosque(period.id);
                }}
              >
                <IconMosque size="sm" />
                <span>
                  {eligibleMosqueCount > 0
                    ? `${AR_STRINGS.street.mosqueDoneButton} (${eligibleMosqueCount})`
                    : 'تم تسجيل أعمال المسجد'}
                </span>
              </button>
            )}

            <button
              type="button"
              className={`btn ${hasMosqueActions ? '' : 'btn-live'}`}
              data-testid="btn-period-done"
              data-period-id={period.id}
              disabled={eligiblePeriodCount === 0}
              onClick={() => {
                void handleBulkPeriod(period.id);
              }}
            >
              <IconCheckAll size="sm" />
              <span>
                {eligiblePeriodCount > 0
                  ? `${AR_STRINGS.street.periodDoneButton} (${eligiblePeriodCount})`
                  : 'تم تسجيل الفترة بالكامل'}
              </span>
            </button>
          </div>
        )}

        {periodActions.length === 0 ? (
          <div className="empty-state">
            <span>لا توجد أعمال مفعّلة في هذه الفترة لهذا اليوم</span>
          </div>
        ) : (
          <div className="action-list">
            {periodActions.map(renderActionRow)}
          </div>
        )}

        {boundLeftActions.length > 0 && (
          <>
            <div className="sub-band">
              <span>{AR_STRINGS.street.boundHabitsHeading}</span>
              <span>خارج زر المسجد وإحصاء الفترة</span>
            </div>
            <div className="action-list">
              {boundLeftActions.map(renderActionRow)}
            </div>
          </>
        )}
      </section>
    );
  };

  const isStaleDate = Boolean(
    todayIslamicDate && selectedDate && selectedDate !== todayIslamicDate,
  );

  return (
    <>
      {isStaleDate && (
        <div
          className="stale-date-banner"
          data-testid="stale-date-banner"
          role="region"
          aria-label="تنبيه التاريخ المحدد"
        >
          <span className="stale-date-text">
            أنت تسجّل ليوم <strong>{formatArabicDateFull(selectedDate)}</strong>
          </span>
          <button
            type="button"
            className="btn btn-live"
            data-testid="stale-date-reset-btn"
            onClick={onResetToToday}
          >
            العودة لليوم
          </button>
        </div>
      )}

      <div className="day-strip-bar">
        <button
          type="button"
          className="day-strip-nav-btn"
          aria-label={AR_STRINGS.week.previousWeek}
          onClick={() => onSelectDate(addDaysIso(selectedDate, -7))}
        >
          <IconChevronRight size="sm" />
        </button>

        <section className="day-strip" aria-label="أيام الأسبوع">
          {weekDates.map((d) => {
            const dow = getIsoDayOfWeek(d);
            const { day } = parseIsoDateParts(d);
            const isSelected = d === selectedDate;
            const isToday = d === todayIslamicDate;
            return (
              <button
                key={d}
                type="button"
                className="day-tile"
                aria-pressed={isSelected}
                onClick={() => onSelectDate(d)}
              >
                <span className="day-tile-name">
                  {AR_STRINGS.week.weekdaysAr[dow]}
                </span>
                <span className="day-tile-num nums">{day}</span>
                {isToday ? (
                  <span className="day-tile-dot" title="اليوم" />
                ) : (
                  <span className="day-tile-spacer" />
                )}
              </button>
            );
          })}
        </section>

        <button
          type="button"
          className="day-strip-nav-btn"
          aria-label={AR_STRINGS.week.nextWeek}
          onClick={() => onSelectDate(addDaysIso(selectedDate, 7))}
        >
          <IconChevronLeft size="sm" />
        </button>
      </div>

      {catchUp48hItems.length > 0 && settings.show_catchup_banner !== false && (
        <div
          className="catchup-bar"
          role="region"
          aria-label={AR_STRINGS.street.catchUpBannerTitle}
        >
          <span className="catchup-text">
            <IconExpiredAlert size="sm" />
            <span>
              لديك{' '}
              <strong className="nums">
                {formatArabicCount(catchUp48hItems.length, ARABIC_NOUN_FORMS.cell)}
              </strong>{' '}
              منتهية غير مسجلة خلال آخر 48 ساعة
            </span>
          </span>
          <button
            type="button"
            className="btn"
            onClick={onNavigateToCatchUp}
          >
            {AR_STRINGS.street.catchUpBannerCta}
          </button>
        </div>
      )}

      <div
        className={`period-strip-wrap ${stripFade.start ? 'fade-start' : ''} ${
          stripFade.end ? 'fade-end' : ''
        }`}
      >
        <div
          ref={periodStripRef}
          className="period-strip"
          role="tablist"
          aria-label="فترات اليوم والمجموعات"
          onScroll={updateStripFade}
        >
          {hasMultiLiveTab && (
            <button
              type="button"
              role="tab"
              data-testid="period-pill-live-all"
              className="period-pill period-pill-live-all"
              aria-selected={selectedPeriodId === null}
              onClick={() => onSelectPeriodId(null)}
            >
              <span className="live-indicator" />
              <span className="nums">الآن ({liveOpenEntries.length})</span>
            </button>
          )}

          {activeTimePeriods.map((p) => {
            const isSelected = !isMultiLiveView && activePeriod?.id === p.id;
            const isLive =
              selectedDate === todayIslamicDate && openLivePeriodIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                className="period-pill"
                aria-selected={isSelected}
                onClick={() => onSelectPeriodId(p.id)}
                onContextMenu={(e) => openPeriodContextMenu(e, p)}
              >
                {isLive && <span className="live-indicator" />}
                <span>{p.title}</span>
              </button>
            );
          })}

          {activeTimePeriods.length > 0 && activeDailyGroups.length > 0 && (
            <span className="period-divider" aria-hidden="true" />
          )}

          {activeDailyGroups.map((g) => {
            const isSelected = !isMultiLiveView && activePeriod?.id === g.id;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                className="period-pill"
                aria-selected={isSelected}
                onClick={() => onSelectPeriodId(g.id)}
                onContextMenu={(e) => openPeriodContextMenu(e, g)}
              >
                <span>{g.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isMultiLiveView ? (
        <div className="now-concurrent-stack">
          {liveOpenEntries.map((entry, idx) => (
            <React.Fragment key={entry.period.id}>
              {idx > 0 && (
                <div
                  className="now-concurrent-divider"
                  data-testid="now-concurrent-divider"
                  role="separator"
                >
                  <span className="now-concurrent-divider-rule" aria-hidden="true" />
                  <span className="now-concurrent-divider-label">
                    <span className="live-indicator" aria-hidden="true" />
                    <span>فترة مفتوحة بالتوازي · {entry.period.title}</span>
                  </span>
                  <span className="now-concurrent-divider-rule" aria-hidden="true" />
                </div>
              )}
              {renderPeriodPanel(entry.period, entry.window)}
            </React.Fragment>
          ))}
        </div>
      ) : activePeriod ? (
        renderPeriodPanel(activePeriod)
      ) : (
        <section className="panel">
          <div className="empty-state">
            <span>{AR_STRINGS.street.activeWindowEmpty}</span>
          </div>
        </section>
      )}

      <EntityContextMenu
        position={entityMenu?.position ?? null}
        title={entityMenu?.title}
        items={entityMenu?.items ?? []}
        onClose={() => setEntityMenu(null)}
      />

      <QuickActionEditDialog
        action={editingAction}
        onClose={() => setEditingActionId(null)}
      />

      <QuickPeriodEditDialog
        period={editingPeriod}
        onClose={() => setEditingPeriodId(null)}
      />
    </>
  );
}

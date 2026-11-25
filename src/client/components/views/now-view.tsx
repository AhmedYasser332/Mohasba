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
  formatRemainingMinutes,
  getWeekDotClass,
  resolveCellDisplay,
} from '../cell-display';
import type { CellEditorTarget } from '../cell-editor-dialog';
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

interface NowViewProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  selectedPeriodId: string | null;
  onSelectPeriodId: (periodId: string) => void;
  onNavigateToCatchUp: () => void;
  onOpenCellEditor: (target: CellEditorTarget) => void;
  onActionFeedback: (message: string) => void;
}

const QUICK_PERCENT_STEPS = [25, 50, 75, 100, 0] as const;

export function NowView({
  selectedDate,
  onSelectDate,
  selectedPeriodId,
  onSelectPeriodId,
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
    activeWindowResolution,
    todayIslamicDate,
    catchUp48hItems,
    analytics30d,
    logCellTap,
    logBulkMosqueDone,
    logBulkPeriodDone,
  } = useMohasba();

  const periodStripRef = useRef<HTMLDivElement | null>(null);
  const [stripFade, setStripFade] = useState({ start: false, end: false });

  const periodsById = useMemo(
    () => new Map(periods.map((p) => [p.id, p])),
    [periods],
  );
  const targetVersionsById = useMemo(
    () => new Map(targetVersions.map((v) => [v.id, v])),
    [targetVersions],
  );
  const adaptingActionIds = useMemo(
    () => new Set((analytics30d?.adaptingTargets ?? []).map((t) => t.action.id)),
    [analytics30d],
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

  const periodActions = useMemo(() => {
    if (!activePeriod) return [];
    return actions
      .filter(
        (a) =>
          a.period_id === activePeriod.id &&
          !isActionArchivedOnDate(a, selectedDate),
      )
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [actions, activePeriod, selectedDate]);

  const boundLeftActions = useMemo(() => {
    if (!activePeriod || activePeriod.side !== 'TIME_BOUND') return [];
    return actions
      .filter(
        (a) =>
          a.bound_time_period_id === activePeriod.id &&
          !isActionArchivedOnDate(a, selectedDate),
      )
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [actions, activePeriod, selectedDate]);

  const hasMosqueActions = useMemo(
    () =>
      periodActions.some(
        (a) => a.is_mosque_action && !a.supports_percentage,
      ),
    [periodActions],
  );

  const eligibleMosqueCount = useMemo(() => {
    if (!activePeriod || activePeriod.side !== 'TIME_BOUND' || !hasMosqueActions) {
      return 0;
    }
    return planMosqueDone({
      periodId: activePeriod.id,
      logDate: selectedDate,
      actions,
      periods,
      logsByKey,
    }).length;
  }, [actions, activePeriod, hasMosqueActions, logsByKey, periods, selectedDate]);

  const eligiblePeriodCount = useMemo(() => {
    if (!activePeriod || activePeriod.side !== 'TIME_BOUND') return 0;
    return planPeriodDone({
      periodId: activePeriod.id,
      logDate: selectedDate,
      actions,
      periods,
      logsByKey,
    }).length;
  }, [actions, activePeriod, logsByKey, periods, selectedDate]);

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
  }, [activePeriod?.id, selectedDate, updateStripFade]);

  useEffect(() => {
    updateStripFade();
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', updateStripFade);
    return () => window.removeEventListener('resize', updateStripFade);
  }, [activeTimePeriods.length, activeDailyGroups.length, updateStripFade]);

  if (!settings) {
    return null;
  }

  const windowCache: WindowLookupCache = new Map();
  const activeWindow =
    activePeriod && activePeriod.side === 'TIME_BOUND'
      ? (dayWindowsByPeriodId.get(activePeriod.id) ?? null)
      : null;

  const isClosing = Boolean(activeWindow?.isPreExpiry);
  const horizonPct = activeWindow
    ? activeWindow.isExpired
      ? 100
      : activeWindow.isOpen
        ? Math.round(activeWindow.elapsedRatio * 100)
        : 0
    : 0;

  const timeStatusText = activeWindow
    ? activeWindow.isOpen
      ? formatRemainingMinutes(activeWindow.remainingMinutes)
      : activeWindow.isExpired
        ? 'انتهى الوقت'
        : 'قادم'
    : '';

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

  const handleBulkMosque = async () => {
    if (!activePeriod) return;
    const res = await logBulkMosqueDone(activePeriod.id, selectedDate);
    if (res.items.length > 0) {
      onActionFeedback(
        `تم تسجيل ${formatArabicCount(res.items.length, ARABIC_NOUN_FORMS.action)} في المسجد`,
      );
    }
  };

  const handleBulkPeriod = async () => {
    if (!activePeriod) return;
    const res = await logBulkPeriodDone(activePeriod.id, selectedDate);
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

    return (
      <div
        key={action.id}
        data-testid={`now-action-${action.id}`}
        className={`action-row ${isDisabled ? 'is-disabled' : ''} ${isExpired ? 'is-expired' : ''}`}
      >
        <div className="action-row-main">
          <div className="action-info">
            <div className="action-title-line">
              <span className="action-title">{action.title}</span>
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
              <span className="week-dots" aria-label="حالة أيام الأسبوع">
                {weekDates.map((d) => {
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
                  const dotCls = getWeekDotClass(dayDisplay.state);
                  const dowName =
                    AR_STRINGS.week.weekdaysAr[getIsoDayOfWeek(d)] ?? d;
                  return (
                    <span
                      key={d}
                      className={`w-dot ${dotCls}`}
                      title={dowName}
                    />
                  );
                })}
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

  return (
    <>
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
          {activeTimePeriods.map((p) => {
            const isSelected = activePeriod?.id === p.id;
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
            const isSelected = activePeriod?.id === g.id;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                className="period-pill"
                aria-selected={isSelected}
                onClick={() => onSelectPeriodId(g.id)}
              >
                <span>{g.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activePeriod ? (
        <section className="panel" aria-label="أعمال الفترة">
          <div className="window-header">
            <h3 className="window-title">
              {activePeriod.side === 'TIME_BOUND'
                ? `فترة ${activePeriod.title}`
                : activePeriod.title}
            </h3>

            {activeWindow ? (
              <div className="window-time-meta nums">
                <span dir="ltr">
                  {formatHhmmInTz(
                    activeWindow.startInstant,
                    settings.iana_timezone,
                  )}{' '}
                  -{' '}
                  {formatHhmmInTz(
                    activeWindow.endInstant,
                    settings.iana_timezone,
                  )}
                </span>
                <span
                  className={`window-countdown ${isClosing ? 'closing' : ''}`}
                >
                  {timeStatusText}
                </span>
              </div>
            ) : (
              <span className="panel-meta">
                {formatArabicDateFull(selectedDate)}
              </span>
            )}

            {activePeriod.side === 'TIME_BOUND' && (
              <div className="horizon-track" aria-hidden="true">
                <div
                  className={`horizon-fill ${isClosing ? 'closing' : ''}`}
                  style={{ width: `${horizonPct}%` }}
                />
              </div>
            )}
          </div>

          {activePeriod.side === 'TIME_BOUND' && (
            <div
              className={`quick-split ${hasMosqueActions ? '' : 'quick-split-single'}`}
            >
              {hasMosqueActions && (
                <button
                  type="button"
                  className="btn btn-live"
                  data-testid="btn-mosque-done"
                  disabled={eligibleMosqueCount === 0}
                  onClick={() => {
                    void handleBulkMosque();
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
                disabled={eligiblePeriodCount === 0}
                onClick={() => {
                  void handleBulkPeriod();
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
      ) : (
        <section className="panel">
          <div className="empty-state">
            <span>{AR_STRINGS.street.activeWindowEmpty}</span>
          </div>
        </section>
      )}
    </>
  );
}

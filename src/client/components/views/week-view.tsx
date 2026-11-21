'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AR_STRINGS,
  addDaysIso,
  diffDaysIso,
  getIsoDayOfWeek,
  getWeekDates,
  isActionActiveOnDate,
  isPeriodActiveOnDate,
  parseIsoDateParts,
  planDeferToQadaa,
  planNormalDay,
  resolveActiveTargetVersion,
  resolvePeriodWindowsForDay,
  type Action,
  type EffectiveCellState,
  type Period,
  type ResolvedPeriodWindow,
  type WindowLookupCache,
} from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import {
  computeCellScore,
  formatArabicDateFull,
  formatArabicDateRange,
  formatHhmmInTz,
  getCellStateClass,
  resolveCellDisplay,
} from '../cell-display';
import type { CellEditorTarget } from '../cell-editor-dialog';
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCross,
  IconDash,
  IconQadaa,
} from '../icons';

interface WeekViewProps {
  oneGlanceMode: boolean;
  onSetOneGlanceMode: (enabled: boolean) => void;
  onOpenCellEditor: (target: CellEditorTarget) => void;
  onActionFeedback: (message: string) => void;
}

function renderCellGlyph(state: EffectiveCellState, pct: number | null) {
  switch (state) {
    case 'DONE':
      return <IconCheck size="sm" />;
    case 'MISSED':
      return <IconCross size="sm" />;
    case 'QADAA_DONE':
      return <IconQadaa size="sm" />;
    case 'PERCENT':
      return (
        <>
          <span>{pct ?? 0}%</span>
          <span
            className="m-cell-bar"
            style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
          />
        </>
      );
    case 'DISABLED':
      return <IconDash size="sm" />;
    case 'INACTIVE':
    case 'UNLOGGED_EXPIRED':
    case 'PENDING':
    default:
      return null;
  }
}

export function WeekView({
  oneGlanceMode,
  onSetOneGlanceMode,
  onOpenCellEditor,
  onActionFeedback,
}: WeekViewProps) {
  const {
    settings,
    periods,
    actions,
    targetVersions,
    logsByKey,
    nowMs,
    activeWindowResolution,
    todayIslamicDate,
    isOnline,
    fetchLogsRange,
    logBulkNormalDay,
    logBulkDeferToQadaa,
  } = useMohasba();

  const [weekAnchorDate, setWeekAnchorDate] = useState<string | null>(null);
  const [selectedBulkDate, setSelectedBulkDate] = useState<string | null>(null);
  const [mobileCompactGrid, setMobileCompactGrid] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [loadingWeekRange, setLoadingWeekRange] = useState(false);
  const [normalDialogOpen, setNormalDialogOpen] = useState(false);
  const fetchedRangesRef = useRef<Set<string>>(new Set());
  const normalDialogRef = useRef<HTMLDialogElement | null>(null);

  const effectiveAnchor = weekAnchorDate ?? todayIslamicDate;

  const weekDates = useMemo(() => {
    if (!settings || !effectiveAnchor) return [];
    return getWeekDates(effectiveAnchor, settings.week_start_day);
  }, [effectiveAnchor, settings]);

  const effectiveBulkDate = useMemo(() => {
    if (selectedBulkDate && weekDates.includes(selectedBulkDate)) {
      return selectedBulkDate;
    }
    if (todayIslamicDate && weekDates.includes(todayIslamicDate)) {
      return todayIslamicDate;
    }
    return weekDates[0] ?? todayIslamicDate ?? '';
  }, [selectedBulkDate, todayIslamicDate, weekDates]);

  useEffect(() => {
    if (!todayIslamicDate || weekDates.length === 0 || !isOnline) return;
    const from = weekDates[0]!;
    const to = weekDates[weekDates.length - 1]!;
    const rangeKey = `${from}..${to}`;
    const ageDays = diffDaysIso(from, todayIslamicDate);
    if (ageDays > 80 && !fetchedRangesRef.current.has(rangeKey)) {
      fetchedRangesRef.current.add(rangeKey);
      setLoadingWeekRange(true);
      void fetchLogsRange(from, to).finally(() => {
        setLoadingWeekRange(false);
      });
    }
  }, [fetchLogsRange, isOnline, todayIslamicDate, weekDates]);

  useEffect(() => {
    const dlg = normalDialogRef.current;
    if (!dlg) return;
    if (normalDialogOpen) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [normalDialogOpen]);

  const periodsById = useMemo(
    () => new Map(periods.map((p) => [p.id, p])),
    [periods],
  );
  const targetVersionsById = useMemo(
    () => new Map(targetVersions.map((v) => [v.id, v])),
    [targetVersions],
  );

  const activeGroups = useMemo(() => {
    if (weekDates.length === 0) return { right: [] as Period[], left: [] as Period[] };
    const isVisibleInWeek = (p: Period) =>
      weekDates.some((d) => isPeriodActiveOnDate(p, d));
    const right = periods
      .filter((p) => p.side === 'TIME_BOUND' && isVisibleInWeek(p))
      .sort((a, b) => a.sort_order - b.sort_order);
    const left = periods
      .filter((p) => p.side === 'DAILY_GROUP' && isVisibleInWeek(p))
      .sort((a, b) => a.sort_order - b.sort_order);
    return { right, left };
  }, [periods, weekDates]);

  const actionsByPeriodId = useMemo(() => {
    const map = new Map<string, Action[]>();
    const isVisibleInWeek = (a: Action) =>
      weekDates.some((d) => isActionActiveOnDate(a, d));
    for (const action of [...actions].sort((a, b) => a.sort_order - b.sort_order)) {
      if (!isVisibleInWeek(action)) continue;
      const list = map.get(action.period_id) ?? [];
      list.push(action);
      map.set(action.period_id, list);
    }
    return map;
  }, [actions, weekDates]);

  const todayWindowsByPeriodId = useMemo(() => {
    if (!settings || !todayIslamicDate) {
      return new Map<string, ResolvedPeriodWindow>();
    }
    const resolved = resolvePeriodWindowsForDay(
      todayIslamicDate,
      periods,
      settings,
      nowMs,
    );
    return new Map(resolved.map((w) => [w.periodId, w]));
  }, [nowMs, periods, settings, todayIslamicDate]);

  const livePeriodIds = useMemo(() => {
    const set = new Set<string>();
    for (const w of activeWindowResolution?.activeWindows ?? []) {
      set.add(w.periodId);
    }
    return set;
  }, [activeWindowResolution]);

  const normalDayEligibleCount = useMemo(() => {
    if (!effectiveBulkDate) return 0;
    return planNormalDay({
      logDate: effectiveBulkDate,
      actions,
      periods,
      logsByKey,
    }).length;
  }, [actions, effectiveBulkDate, logsByKey, periods]);

  const deferQadaaEligibleCount = useMemo(() => {
    if (!settings || !effectiveBulkDate) return 0;
    return planDeferToQadaa({
      logDate: effectiveBulkDate,
      actions,
      periods,
      settings,
      logsByKey,
      now: nowMs,
    }).length;
  }, [actions, effectiveBulkDate, logsByKey, nowMs, periods, settings]);

  if (!settings || !todayIslamicDate || weekDates.length === 0) {
    return null;
  }

  const windowCache: WindowLookupCache = new Map();

  const computeWeekRate = (action: Action): string => {
    let sum = 0;
    let count = 0;
    for (const d of weekDates) {
      if (d > todayIslamicDate) continue;
      const display = resolveCellDisplay({
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
      const score = computeCellScore(display.state, display.percentValue);
      if (score !== null) {
        sum += score;
        count += 1;
      }
    }
    return count > 0 ? `${Math.round((sum / count) * 100)}%` : '-';
  };

  const toggleGroup = (periodId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [periodId]: !prev[periodId],
    }));
  };

  const handleDeferToQadaa = async () => {
    if (!effectiveBulkDate || deferQadaaEligibleCount === 0) return;
    const res = await logBulkDeferToQadaa(effectiveBulkDate);
    if (res.items.length > 0) {
      onActionFeedback(
        `تم ترحيل ${res.items.length} خانات منتهية للقضاء`,
      );
    }
  };

  const handleApplyNormalDay = async () => {
    if (!effectiveBulkDate) return;
    const res = await logBulkNormalDay(effectiveBulkDate);
    setNormalDialogOpen(false);
    if (res.items.length > 0) {
      onActionFeedback(`تم تطبيق يوم اعتيادي (${res.items.length} خانات)`);
    }
  };

  const renderStandardGroupRows = (group: Period) => {
    const groupActions = actionsByPeriodId.get(group.id) ?? [];
    if (groupActions.length === 0) return null;
    const isCollapsed = Boolean(collapsedGroups[group.id]);
    const isLive =
      weekDates.includes(todayIslamicDate) && livePeriodIds.has(group.id);
    const liveWin = isLive ? todayWindowsByPeriodId.get(group.id) : undefined;

    return (
      <React.Fragment key={group.id}>
        <tr className="group-row">
          <td colSpan={9}>
            <button
              type="button"
              className="group-toggle"
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(group.id)}
            >
              <span className="group-toggle-start">
                {isCollapsed ? (
                  <IconChevronLeft size="sm" />
                ) : (
                  <IconChevronDown size="sm" />
                )}
                <span>{group.title}</span>
                <span className="panel-meta nums">({groupActions.length})</span>
              </span>

              {liveWin && (
                <span className="panel-meta nums" dir="ltr">
                  {formatHhmmInTz(liveWin.startInstant, settings.iana_timezone)}{' '}
                  -{' '}
                  {formatHhmmInTz(liveWin.endInstant, settings.iana_timezone)}
                </span>
              )}

              {liveWin && (
                <span className="horizon-track" aria-hidden="true">
                  <span
                    className={`horizon-fill ${liveWin.isPreExpiry ? 'closing' : ''}`}
                    style={{ width: `${Math.round(liveWin.elapsedRatio * 100)}%` }}
                  />
                </span>
              )}
            </button>
          </td>
        </tr>

        {!isCollapsed &&
          groupActions.map((action) => {
            const tv = resolveActiveTargetVersion(
              targetVersions,
              action.id,
              effectiveBulkDate,
            );
            return (
              <tr key={action.id} className="data-row">
                <td className="cell-title" title={action.title}>
                  <span>{action.title}</span>
                  {tv && (
                    <span className="target-tag nums ms-2">
                      {tv.target_label}
                    </span>
                  )}
                </td>

                {weekDates.map((d) => {
                  const display = resolveCellDisplay({
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
                  const dowName =
                    AR_STRINGS.week.weekdaysAr[getIsoDayOfWeek(d)] ?? d;
                  return (
                    <td key={d} className="cell-status">
                      <button
                        type="button"
                        className={`m-cell nums ${getCellStateClass(display.state)}`}
                        aria-label={`${action.title} ${dowName}`}
                        onClick={() =>
                          onOpenCellEditor({ action, logDate: d })
                        }
                      >
                        {renderCellGlyph(display.state, display.percentValue)}
                      </button>
                    </td>
                  );
                })}

                <td className="cell-rate nums">{computeWeekRate(action)}</td>
              </tr>
            );
          })}
      </React.Fragment>
    );
  };

  const renderOneGlanceSideTable = (side: 'TIME_BOUND' | 'DAILY_GROUP') => {
    const groups =
      side === 'TIME_BOUND' ? activeGroups.right : activeGroups.left;
    const populatedGroups = groups.filter(
      (g) => (actionsByPeriodId.get(g.id)?.length ?? 0) > 0,
    );

    return (
      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th className="col-period">
                {side === 'TIME_BOUND' ? 'الفترة' : 'المجموعة'}
              </th>
              <th className="col-action">العمل</th>
              {weekDates.map((d) => {
                const { day } = parseIsoDateParts(d);
                const abbr =
                  AR_STRINGS.week.weekdaysShortEn[getIsoDayOfWeek(d)] ?? '';
                const isToday = d === todayIslamicDate;
                return (
                  <th key={d} className={`col-day ${isToday ? 'is-today' : ''}`}>
                    <div
                      dir="ltr"
                      className="flex flex-col items-center leading-tight"
                    >
                      <span className="block text-[10px] leading-tight">
                        {abbr}
                      </span>
                      <span className="block nums text-[10px] leading-tight">
                        {day}
                      </span>
                    </div>
                  </th>
                );
              })}
              <th className="col-rate">%</th>
            </tr>
          </thead>

          <tbody>
            {populatedGroups.map((group, groupIdx) => {
              const groupActions = actionsByPeriodId.get(group.id) ?? [];
              const isLive =
                weekDates.includes(todayIslamicDate) &&
                livePeriodIds.has(group.id);
              const isLastGroup = groupIdx === populatedGroups.length - 1;

              return (
                <React.Fragment key={group.id}>
                  {groupActions.map((action, idx) => {
                    const isLastInGroup = idx === groupActions.length - 1;
                    return (
                      <tr
                        key={action.id}
                        className={`data-row ${isLastInGroup ? 'period-end-row' : ''}`}
                      >
                        {idx === 0 && (
                          <td
                            className={`cell-period ${isLive ? 'is-live-period' : ''}`}
                            rowSpan={groupActions.length}
                          >
                            {group.title}
                          </td>
                        )}
                        <td className="cell-title" title={action.title}>
                          {action.title}
                        </td>
                        {weekDates.map((d) => {
                          const display = resolveCellDisplay({
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
                          const abbr =
                            AR_STRINGS.week.weekdaysShortEn[
                              getIsoDayOfWeek(d)
                            ] ?? d;
                          return (
                            <td key={d} className="cell-status">
                              <button
                                type="button"
                                className={`m-cell nums ${getCellStateClass(display.state)}`}
                                aria-label={`${action.title} ${abbr}`}
                                onClick={() =>
                                  onOpenCellEditor({ action, logDate: d })
                                }
                              >
                                {renderCellGlyph(
                                  display.state,
                                  display.percentValue,
                                )}
                              </button>
                            </td>
                          );
                        })}
                        <td className="cell-rate nums">
                          {computeWeekRate(action)}
                        </td>
                      </tr>
                    );
                  })}
                  {!isLastGroup && (
                    <tr className="period-spacer" aria-hidden="true">
                      <td colSpan={10} />
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <div className="matrix-toolbar">
        <div className="matrix-toolbar-group">
          <button
            type="button"
            className="btn"
            aria-label={AR_STRINGS.week.previousWeek}
            onClick={() =>
              setWeekAnchorDate(addDaysIso(weekDates[0]!, -7))
            }
          >
            <IconChevronRight size="sm" />
            <span>{AR_STRINGS.week.previousWeek}</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => setWeekAnchorDate(todayIslamicDate)}
          >
            {AR_STRINGS.week.todayButton}
          </button>

          <button
            type="button"
            className="btn"
            aria-label={AR_STRINGS.week.nextWeek}
            onClick={() =>
              setWeekAnchorDate(addDaysIso(weekDates[0]!, 7))
            }
          >
            <span>{AR_STRINGS.week.nextWeek}</span>
            <IconChevronLeft size="sm" />
          </button>

          <strong className="text-sm nums">
            أسبوع {formatArabicDateRange(weekDates[0]!, weekDates[6]!)}
          </strong>
          {loadingWeekRange && (
            <span className="panel-meta">جاري تحميل السجلات...</span>
          )}
        </div>

        <div className="matrix-toolbar-group">
          <div className="seg-tabs desktop-only" role="tablist" aria-label="وضع عرض الجدول">
            <button
              type="button"
              role="tab"
              className="seg-tab"
              aria-selected={!oneGlanceMode}
              onClick={() => onSetOneGlanceMode(false)}
            >
              {AR_STRINGS.week.standardMode}
            </button>
            <button
              type="button"
              role="tab"
              className="seg-tab"
              aria-selected={oneGlanceMode}
              onClick={() => onSetOneGlanceMode(true)}
            >
              نظرة واحدة
            </button>
          </div>

          <select
            className="field-select"
            aria-label="اليوم المستهدف للإجراءات الجماعية"
            style={{ width: 'auto', minHeight: '36px' }}
            value={effectiveBulkDate}
            onChange={(e) => setSelectedBulkDate(e.target.value)}
          >
            {weekDates.map((d) => (
              <option key={d} value={d}>
                {formatArabicDateFull(d)}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn"
            data-testid="btn-normal-day"
            onClick={() => setNormalDialogOpen(true)}
          >
            {AR_STRINGS.week.normalDayButton}
          </button>

          <button
            type="button"
            className="btn"
            data-testid="btn-defer-qadaa"
            disabled={deferQadaaEligibleCount === 0}
            onClick={() => {
              void handleDeferToQadaa();
            }}
          >
            {AR_STRINGS.week.deferToQadaaButton}
            {deferQadaaEligibleCount > 0 ? ` (${deferQadaaEligibleCount})` : ''}
          </button>
        </div>
      </div>

      {/* Desktop Matrix: Standard Mode OR One-Glance Side-by-Side */}
      <div className="matrix-desktop-wrap">
        {oneGlanceMode ? (
          <div className="overview-split" data-testid="one-glance-split">
            {renderOneGlanceSideTable('TIME_BOUND')}
            {renderOneGlanceSideTable('DAILY_GROUP')}
          </div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th className="col-action">العمل</th>
                  {weekDates.map((d) => {
                    const { day } = parseIsoDateParts(d);
                    const dowName =
                      AR_STRINGS.week.weekdaysAr[getIsoDayOfWeek(d)] ?? '';
                    const isToday = d === todayIslamicDate;
                    return (
                      <th
                        key={d}
                        className={`col-day ${isToday ? 'is-today' : ''}`}
                      >
                        <span>{dowName}</span>
                        <div className="nums">{day}</div>
                      </th>
                    );
                  })}
                  <th className="col-rate">النسبة</th>
                </tr>
              </thead>

              <tbody>
                <tr className="side-label-row">
                  <td colSpan={9}>{AR_STRINGS.week.rightSideTitle}</td>
                </tr>
                {activeGroups.right.map(renderStandardGroupRows)}

                <tr className="side-divider" aria-hidden="true">
                  <td colSpan={9} />
                </tr>

                <tr className="side-label-row">
                  <td colSpan={9}>{AR_STRINGS.week.leftSideTitle}</td>
                </tr>
                {activeGroups.left.map(renderStandardGroupRows)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile View: WHOOP 7-Day Boxes (Sat..Fri) + Compact Grid Toggle */}
      <div className="matrix-mobile-wrap">
        <div className="seg-tabs" role="tablist" aria-label="عرض الموبايل">
          <button
            type="button"
            role="tab"
            className="seg-tab"
            aria-selected={!mobileCompactGrid}
            onClick={() => setMobileCompactGrid(false)}
          >
            صناديق الأسبوع
          </button>
          <button
            type="button"
            role="tab"
            className="seg-tab"
            aria-selected={mobileCompactGrid}
            onClick={() => setMobileCompactGrid(true)}
          >
            جدول مضغوط
          </button>
        </div>

        {!mobileCompactGrid ? (
          <div className="flex flex-col gap-3">
            {[...activeGroups.right, ...activeGroups.left].map((group) => {
              const groupActions = actionsByPeriodId.get(group.id) ?? [];
              if (groupActions.length === 0) return null;
              const isCollapsed = Boolean(collapsedGroups[group.id]);

              return (
                <section key={group.id} className="panel">
                  <button
                    type="button"
                    className="group-toggle"
                    aria-expanded={!isCollapsed}
                    style={{
                      background: 'var(--bg-subtle)',
                      borderBlockEnd: isCollapsed
                        ? 'none'
                        : '1px solid var(--border-hairline)',
                    }}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span className="group-toggle-start">
                      {isCollapsed ? (
                        <IconChevronLeft size="sm" />
                      ) : (
                        <IconChevronDown size="sm" />
                      )}
                      <span>{group.title}</span>
                    </span>
                    <span className="panel-meta nums">
                      {groupActions.length} أعمال
                    </span>
                  </button>

                  {!isCollapsed &&
                    groupActions.map((action) => (
                      <div key={action.id} className="m-whoop-row">
                        <div className="m-whoop-head">
                          <span className="text-sm font-medium">
                            {action.title}
                          </span>
                          <span className="panel-meta nums">
                            {computeWeekRate(action)}
                          </span>
                        </div>
                        <div className="m-whoop-days">
                          {weekDates.map((d) => {
                            const display = resolveCellDisplay({
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
                            const abbr =
                              AR_STRINGS.week.weekdaysShortEn[
                                getIsoDayOfWeek(d)
                              ] ?? '';
                            return (
                              <button
                                key={d}
                                type="button"
                                className="m-whoop-day"
                                aria-label={`${action.title} ${abbr}`}
                                onClick={() =>
                                  onOpenCellEditor({ action, logDate: d })
                                }
                              >
                                <span className="m-whoop-day-lbl" dir="ltr">
                                  {abbr}
                                </span>
                                <span
                                  className={`m-whoop-box nums ${getCellStateClass(display.state)}`}
                                >
                                  {renderCellGlyph(
                                    display.state,
                                    display.percentValue,
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th className="col-action" style={{ width: '36%' }}>
                    العمل
                  </th>
                  {weekDates.map((d) => {
                    const { day } = parseIsoDateParts(d);
                    const abbr =
                      AR_STRINGS.week.weekdaysShortEn[getIsoDayOfWeek(d)] ?? '';
                    const isToday = d === todayIslamicDate;
                    return (
                      <th
                        key={d}
                        className={`col-day ${isToday ? 'is-today' : ''}`}
                      >
                        <span dir="ltr">{abbr}</span>
                        <div className="nums">{day}</div>
                      </th>
                    );
                  })}
                  <th className="col-rate">%</th>
                </tr>
              </thead>
              <tbody>
                {[...activeGroups.right, ...activeGroups.left].map(
                  renderStandardGroupRows,
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Normal Day Confirmation Dialog */}
      <dialog
        ref={normalDialogRef}
        className="app-dialog"
        aria-labelledby="normal-day-dialog-title"
        onCancel={(e) => {
          e.preventDefault();
          setNormalDialogOpen(false);
        }}
        onClick={(e) => {
          if (e.target === normalDialogRef.current) {
            setNormalDialogOpen(false);
          }
        }}
      >
        <div className="dialog-head">
          <h3 className="dialog-title" id="normal-day-dialog-title">
            {AR_STRINGS.week.normalDayButton}
          </h3>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="إغلاق"
            onClick={() => setNormalDialogOpen(false)}
          >
            <IconCross size="sm" />
          </button>
        </div>

        <div className="dialog-body">
          <p className="m-0">
            سيتم تعبئة{' '}
            <strong className="nums">{normalDayEligibleCount}</strong> خانات
            فارغة فقط ليوم{' '}
            <strong>{formatArabicDateFull(effectiveBulkDate)}</strong> بحالة
            «تم».
          </p>
          <p className="m-0 panel-meta">
            الأعمال الجوهرية والصلوات الفائتة المعلّمة مسبقاً لا تُمسّ ولا
            تُستبدل تلقائياً.
          </p>
        </div>

        <div className="dialog-foot">
          <button
            type="button"
            className="btn"
            onClick={() => setNormalDialogOpen(false)}
          >
            {AR_STRINGS.week.cancel}
          </button>
          <button
            type="button"
            className="btn btn-live"
            disabled={normalDayEligibleCount === 0}
            onClick={() => {
              void handleApplyNormalDay();
            }}
          >
            تطبيق التعبئة
          </button>
        </div>
      </dialog>
    </>
  );
}

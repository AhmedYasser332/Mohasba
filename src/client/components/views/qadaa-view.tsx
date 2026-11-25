'use client';

import React, { useMemo, useState } from 'react';
import {
  AR_STRINGS,
  getIsoDayOfWeek,
  type Action,
  type CatchUpItem,
} from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { ARABIC_NOUN_FORMS, formatArabicCount } from '../../utils/arabic-plural';
import { formatArabicDateFull } from '../cell-display';
import type { CellEditorTarget } from '../cell-editor-dialog';
import { IconCheck, IconCross, IconMoreDots, IconQadaa, IconUndo } from '../icons';

export type QadaaTabId = 'pending' | 'catchup' | 'nonrecoverable';

interface QadaaViewProps {
  activeTab: string | null;
  onSelectTab: (tab: QadaaTabId) => void;
  onOpenCellEditor?: (target: CellEditorTarget) => void;
  onActionFeedback?: (message: string) => void;
}

interface CatchUpPeriodGroup {
  key: string;
  periodTitle: string;
  items: CatchUpItem[];
}

interface CatchUpDateGroup {
  logDate: string;
  totalCount: number;
  periodGroups: CatchUpPeriodGroup[];
}

function normalizeQadaaTab(raw: string | null): QadaaTabId {
  if (raw === 'catchup') return 'catchup';
  if (raw === 'nonrecoverable' || raw === 'non_recoverable') {
    return 'nonrecoverable';
  }
  return 'pending';
}

function formatAgeDays(ageDays: number): string {
  if (ageDays <= 0) return 'اليوم';
  return `${AR_STRINGS.qadaa.ageDaysLabel} ${formatArabicCount(ageDays, ARABIC_NOUN_FORMS.day)}`;
}

export function QadaaView({
  activeTab,
  onSelectTab,
  onOpenCellEditor,
  onActionFeedback,
}: QadaaViewProps) {
  const {
    openQadaaQueue,
    catchUp48hItems,
    nonRecoverableMisses,
    logCellTap,
    logBulkDeferToQadaa,
    undoBatch,
  } = useMohasba();

  const [deferBusy, setDeferBusy] = useState(false);
  const [multiBatchUndoIds, setMultiBatchUndoIds] = useState<string[] | null>(
    null,
  );

  const currentTab = normalizeQadaaTab(activeTab);

  const catchUpGroups = useMemo<CatchUpDateGroup[]>(() => {
    const byDate = new Map<string, CatchUpItem[]>();
    for (const item of catchUp48hItems) {
      const list = byDate.get(item.logDate) ?? [];
      list.push(item);
      byDate.set(item.logDate, list);
    }

    const result: CatchUpDateGroup[] = [];
    for (const [logDate, dateItems] of byDate.entries()) {
      const byPeriod = new Map<string, CatchUpPeriodGroup>();
      for (const item of dateItems) {
        const p = item.governingPeriod ?? item.period;
        const pKey = p?.id ?? '__other__';
        let group = byPeriod.get(pKey);
        if (!group) {
          group = {
            key: `${logDate}::${pKey}`,
            periodTitle: p?.title ?? 'أعمال أخرى',
            items: [],
          };
          byPeriod.set(pKey, group);
        }
        group.items.push(item);
      }
      result.push({
        logDate,
        totalCount: dateItems.length,
        periodGroups: Array.from(byPeriod.values()),
      });
    }
    return result;
  }, [catchUp48hItems]);

  const handleResolveQadaa = async (
    action: Action,
    logDate: string,
    historicalTargetVersionId: string | null,
    existingAvailabilityOverride: 'ENABLED' | 'DISABLED' | null,
    existingNote: string | null,
    existingNoteUpdatedAt: string | null,
  ) => {
    await logCellTap({
      action,
      logDate,
      availability_override: existingAvailabilityOverride,
      status: 'QADAA_DONE',
      percent_value: null,
      qadaa_resolved_at: new Date().toISOString(),
      clientTargetVersionId: historicalTargetVersionId,
      note: existingNote,
      note_updated_at: existingNoteUpdatedAt,
    });
    onActionFeedback?.(`تم القضاء: ${action.title}`);
  };

  const handleCatchUpTap = async (
    action: Action,
    logDate: string,
    status: 'DONE' | 'MISSED',
    targetVersionId: string | null,
    existingNote: string | null,
    existingNoteUpdatedAt: string | null,
  ) => {
    const isDefaultOff = action.default_disabled_days.includes(
      getIsoDayOfWeek(logDate),
    );
    await logCellTap({
      action,
      logDate,
      availability_override: isDefaultOff ? 'ENABLED' : null,
      status,
      percent_value: null,
      clientTargetVersionId: targetVersionId,
      note: existingNote,
      note_updated_at: existingNoteUpdatedAt,
    });
    onActionFeedback?.(
      status === 'DONE'
        ? `تم تسجيل ${action.title}`
        : `تم تسجيل فوات ${action.title}`,
    );
  };

  const handleDeferAllCatchUp = async () => {
    if (deferBusy || catchUp48hItems.length === 0) return;
    setDeferBusy(true);
    setMultiBatchUndoIds(null);
    try {
      const uniqueDates = Array.from(
        new Set(catchUp48hItems.map((item) => item.logDate)),
      );
      const batchIds: string[] = [];
      let totalMoved = 0;

      for (const date of uniqueDates) {
        const res = await logBulkDeferToQadaa(date);
        totalMoved += res.items.length;
        if (res.batchId) {
          batchIds.push(res.batchId);
        }
      }

      if (totalMoved > 0) {
        onActionFeedback?.(
          `تم ترحيل ${formatArabicCount(totalMoved, ARABIC_NOUN_FORMS.cell)} للقضاء`,
        );
        if (batchIds.length > 1) {
          setMultiBatchUndoIds(batchIds);
        }
      }
    } finally {
      setDeferBusy(false);
    }
  };

  const handleUndoMultiDefer = async () => {
    if (!multiBatchUndoIds || multiBatchUndoIds.length === 0) return;
    const ids = [...multiBatchUndoIds];
    setMultiBatchUndoIds(null);
    for (const batchId of ids) {
      await undoBatch(batchId);
    }
    onActionFeedback?.('تم التراجع عن ترحيل الخانات');
  };

  return (
    <section className="panel" aria-label={AR_STRINGS.qadaa.title}>
      <div className="panel-header">
        <h3 className="panel-title">{AR_STRINGS.qadaa.title}</h3>
        <div
          className="seg-tabs"
          role="tablist"
          aria-label="أقسام القضاء والاستدراك"
        >
          <button
            type="button"
            role="tab"
            className="seg-tab"
            data-testid="qadaa-tab-pending"
            aria-selected={currentTab === 'pending'}
            onClick={() => onSelectTab('pending')}
          >
            <span>{AR_STRINGS.qadaa.tabOpenQadaa}</span>
            <span
              className={`count-chip nums ${openQadaaQueue.length > 0 ? 'alert' : ''}`}
            >
              {openQadaaQueue.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            className="seg-tab"
            data-testid="qadaa-tab-catchup"
            aria-selected={currentTab === 'catchup'}
            onClick={() => onSelectTab('catchup')}
          >
            <span>{AR_STRINGS.qadaa.tabCatchUp48h}</span>
            <span className="count-chip nums">{catchUp48hItems.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            className="seg-tab"
            data-testid="qadaa-tab-nonrecoverable"
            aria-selected={currentTab === 'nonrecoverable'}
            onClick={() => onSelectTab('nonrecoverable')}
          >
            <span>{AR_STRINGS.qadaa.tabNonRecoverable}</span>
            <span className="count-chip nums">
              {nonRecoverableMisses.length}
            </span>
          </button>
        </div>
      </div>

      {/* Tab 1: Pending Open Qadaa */}
      {currentTab === 'pending' && (
        <div role="tabpanel" aria-label={AR_STRINGS.qadaa.tabOpenQadaa}>
          {openQadaaQueue.length === 0 ? (
            <div className="empty-state" data-testid="qadaa-empty-pending">
              <span>{AR_STRINGS.qadaa.emptyOpenQadaa}</span>
            </div>
          ) : (
            <div className="action-list">
              {openQadaaQueue.map((item) => (
                <div
                  key={`${item.action.id}::${item.logDate}`}
                  className="qadaa-row"
                  data-testid={`qadaa-pending-item-${item.action.id}-${item.logDate}`}
                >
                  <div className="qadaa-info">
                    <div className="action-title-line">
                      <span className="action-title">{item.action.title}</span>
                      {item.targetLabel && (
                        <span
                          className="target-tag"
                          data-testid="qadaa-historical-target"
                        >
                          {AR_STRINGS.qadaa.originalTargetPrefix}{' '}
                          {item.targetLabel}
                        </span>
                      )}
                    </div>
                    <div className="qadaa-meta-row">
                      {item.period && <span>{item.period.title}</span>}
                      <span>{formatArabicDateFull(item.logDate)}</span>
                      <span className="target-tag nums">
                        {formatAgeDays(item.ageDays)}
                      </span>
                    </div>
                    {item.log.note && (
                      <span className="row-note-preview">{item.log.note}</span>
                    )}
                  </div>

                  <div className="qadaa-actions">
                    <button
                      type="button"
                      className="btn btn-live qadaa-resolve-btn"
                      data-testid={`qadaa-resolve-${item.action.id}-${item.logDate}`}
                      onClick={() => {
                        void handleResolveQadaa(
                          item.action,
                          item.logDate,
                          item.targetVersion?.id ??
                            item.log.target_version_id ??
                            null,
                          item.log.availability_override,
                          item.log.note,
                          item.log.note_updated_at,
                        );
                      }}
                    >
                      <IconQadaa size="sm" />
                      <span>{AR_STRINGS.qadaa.resolveQadaaButton}</span>
                    </button>

                    {onOpenCellEditor && (
                      <button
                        type="button"
                        className="tap-btn tap-btn-more"
                        aria-label={`تعديل تفاصيل ${item.action.title} ليوم ${formatArabicDateFull(item.logDate)}`}
                        onClick={() =>
                          onOpenCellEditor({
                            action: item.action,
                            logDate: item.logDate,
                          })
                        }
                      >
                        <IconMoreDots size="sm" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: 48h Unlogged Catch-Up */}
      {currentTab === 'catchup' && (
        <div role="tabpanel" aria-label={AR_STRINGS.qadaa.tabCatchUp48h}>
          {multiBatchUndoIds && multiBatchUndoIds.length > 0 && (
            <div className="catchup-bulk-bar">
              <span className="panel-meta">تم ترحيل جميع الخانات غير المسجلة للقضاء.</span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void handleUndoMultiDefer();
                }}
              >
                <IconUndo size="sm" />
                <span>تراجع عن الكل</span>
              </button>
            </div>
          )}

          {catchUp48hItems.length === 0 ? (
            <div className="empty-state" data-testid="qadaa-empty-catchup">
              <span>{AR_STRINGS.qadaa.emptyCatchUp}</span>
            </div>
          ) : (
            <>
              <div className="catchup-bulk-bar">
                <span className="panel-meta nums">
                  {formatArabicCount(
                    catchUp48hItems.length,
                    ARABIC_NOUN_FORMS.cell,
                  )}{' '}
                  منتهية غير مسجلة
                </span>
                <button
                  type="button"
                  className="btn"
                  data-testid="qadaa-defer-all-btn"
                  disabled={deferBusy}
                  onClick={() => {
                    void handleDeferAllCatchUp();
                  }}
                >
                  <IconQadaa size="sm" />
                  <span>ترحيل الكل للقضاء</span>
                </button>
              </div>

              {catchUpGroups.map((dateGroup) => (
                <div key={dateGroup.logDate} className="qadaa-group">
                  <div className="qadaa-group-head">
                    <strong>{formatArabicDateFull(dateGroup.logDate)}</strong>
                    <span className="count-chip nums">
                      {formatArabicCount(
                        dateGroup.totalCount,
                        ARABIC_NOUN_FORMS.cell,
                      )}
                    </span>
                  </div>

                  {dateGroup.periodGroups.map((periodGroup) => (
                    <div key={periodGroup.key} className="qadaa-subgroup">
                      <div className="qadaa-subgroup-head">
                        <span>{periodGroup.periodTitle}</span>
                        <span className="panel-meta nums">
                          {formatArabicCount(
                            periodGroup.items.length,
                            ARABIC_NOUN_FORMS.cell,
                          )}
                        </span>
                      </div>

                      <div className="action-list">
                        {periodGroup.items.map((item) => (
                          <div
                            key={`${item.action.id}::${item.logDate}`}
                            className="qadaa-row"
                            data-testid={`qadaa-catchup-item-${item.action.id}-${item.logDate}`}
                          >
                            <div className="qadaa-info">
                              <div className="action-title-line">
                                <span className="action-title">
                                  {item.action.title}
                                </span>
                                {item.targetLabel && (
                                  <span className="target-tag">
                                    {item.targetLabel}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="qadaa-actions">
                              <button
                                type="button"
                                className="tap-btn"
                                data-testid={`catchup-done-${item.action.id}-${item.logDate}`}
                                aria-label={`تسجيل تم للعمل ${item.action.title}`}
                                onClick={() => {
                                  void handleCatchUpTap(
                                    item.action,
                                    item.logDate,
                                    'DONE',
                                    item.targetVersion?.id ?? null,
                                    item.log?.note ?? null,
                                    item.log?.note_updated_at ?? null,
                                  );
                                }}
                              >
                                <IconCheck size="sm" />
                              </button>

                              <button
                                type="button"
                                className="tap-btn"
                                data-testid={`catchup-missed-${item.action.id}-${item.logDate}`}
                                aria-label={`تسجيل فات للعمل ${item.action.title}`}
                                onClick={() => {
                                  void handleCatchUpTap(
                                    item.action,
                                    item.logDate,
                                    'MISSED',
                                    item.targetVersion?.id ?? null,
                                    item.log?.note ?? null,
                                    item.log?.note_updated_at ?? null,
                                  );
                                }}
                              >
                                <IconCross size="sm" />
                              </button>

                              {onOpenCellEditor && (
                                <button
                                  type="button"
                                  className="tap-btn tap-btn-more"
                                  aria-label={`تعديل تفاصيل ${item.action.title} ليوم ${formatArabicDateFull(item.logDate)}`}
                                  onClick={() =>
                                    onOpenCellEditor({
                                      action: item.action,
                                      logDate: item.logDate,
                                    })
                                  }
                                >
                                  <IconMoreDots size="sm" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Tab 3: Non-Recoverable Misses (Awareness) */}
      {currentTab === 'nonrecoverable' && (
        <div role="tabpanel" aria-label={AR_STRINGS.qadaa.tabNonRecoverable}>
          {nonRecoverableMisses.length === 0 ? (
            <div
              className="empty-state"
              data-testid="qadaa-empty-nonrecoverable"
            >
              <span>{AR_STRINGS.qadaa.emptyNonRecoverable}</span>
            </div>
          ) : (
            <div className="action-list">
              {nonRecoverableMisses.map((item) => (
                <div
                  key={`${item.action.id}::${item.logDate}`}
                  className="qadaa-row"
                  data-testid={`qadaa-nonrecoverable-item-${item.action.id}-${item.logDate}`}
                >
                  <div className="qadaa-info">
                    <div className="action-title-line">
                      <span className="action-title">{item.action.title}</span>
                      {item.action.analytics_role === 'core_jamaah' && (
                        <span className="target-tag">
                          {AR_STRINGS.analytics.coreJamaahLabel}
                        </span>
                      )}
                      {item.action.analytics_role === 'core_habit' && (
                        <span className="target-tag">عادة أساسية</span>
                      )}
                    </div>
                    <div className="qadaa-meta-row">
                      {item.period && <span>{item.period.title}</span>}
                      <span>{formatArabicDateFull(item.logDate)}</span>
                      <span className="nums">{formatAgeDays(item.ageDays)}</span>
                    </div>
                    {item.log.note && (
                      <span className="row-note-preview">{item.log.note}</span>
                    )}
                  </div>

                  <div className="qadaa-actions">
                    {onOpenCellEditor && (
                      <button
                        type="button"
                        className="tap-btn tap-btn-more"
                        aria-label={`تعديل تفاصيل ${item.action.title} ليوم ${formatArabicDateFull(item.logDate)}`}
                        onClick={() =>
                          onOpenCellEditor({
                            action: item.action,
                            logDate: item.logDate,
                          })
                        }
                      >
                        <IconMoreDots size="sm" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

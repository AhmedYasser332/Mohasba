'use client';

import React from 'react';
import { AR_STRINGS, getIsoDayOfWeek, type Action } from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { formatArabicDateFull } from '../cell-display';
import type { CellEditorTarget } from '../cell-editor-dialog';
import { IconCheck, IconCross, IconMoreDots, IconQadaa } from '../icons';

export type QadaaTabId = 'pending' | 'catchup' | 'nonrecoverable';

interface QadaaViewProps {
  activeTab: string | null;
  onSelectTab: (tab: QadaaTabId) => void;
  onOpenCellEditor?: (target: CellEditorTarget) => void;
  onActionFeedback?: (message: string) => void;
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
  if (ageDays === 1) return 'منذ يوم واحد';
  if (ageDays === 2) return 'منذ يومين';
  return `${AR_STRINGS.qadaa.ageDaysLabel} ${ageDays} ${AR_STRINGS.qadaa.dayUnit}`;
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
  } = useMohasba();

  const currentTab = normalizeQadaaTab(activeTab);

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

  return (
    <section className="panel" aria-label={AR_STRINGS.qadaa.title}>
      <div className="panel-header">
        <h3 className="panel-title">{AR_STRINGS.qadaa.title}</h3>
        <div className="seg-tabs" role="tablist" aria-label="أقسام القضاء والاستدراك">
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
                      <span className="nums" dir="ltr">
                        ({item.logDate})
                      </span>
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
                        aria-label={`تعديل تفاصيل ${item.action.title} ليوم ${item.logDate}`}
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
          {catchUp48hItems.length === 0 ? (
            <div className="empty-state" data-testid="qadaa-empty-catchup">
              <span>{AR_STRINGS.qadaa.emptyCatchUp}</span>
            </div>
          ) : (
            <div className="action-list">
              {catchUp48hItems.map((item) => (
                <div
                  key={`${item.action.id}::${item.logDate}`}
                  className="qadaa-row"
                  data-testid={`qadaa-catchup-item-${item.action.id}-${item.logDate}`}
                >
                  <div className="qadaa-info">
                    <div className="action-title-line">
                      <span className="action-title">{item.action.title}</span>
                      {item.targetLabel && (
                        <span className="target-tag">{item.targetLabel}</span>
                      )}
                    </div>
                    <div className="qadaa-meta-row">
                      {(item.governingPeriod ?? item.period) && (
                        <span>
                          {(item.governingPeriod ?? item.period)?.title}
                        </span>
                      )}
                      <span>{formatArabicDateFull(item.logDate)}</span>
                      <span className="nums" dir="ltr">
                        ({item.logDate})
                      </span>
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
                        aria-label={`تعديل تفاصيل ${item.action.title} ليوم ${item.logDate}`}
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
                      <span className="nums" dir="ltr">
                        ({item.logDate})
                      </span>
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
                        aria-label={`تعديل تفاصيل ${item.action.title} ليوم ${item.logDate}`}
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

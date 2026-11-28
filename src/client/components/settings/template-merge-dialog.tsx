'use client';

import React, { useId, useMemo, useRef, useState } from 'react';
import {
  TEMPLATE_CATALOG,
  buildTemplateBundle,
  planTemplateMerge,
  type Action,
  type Period,
  type TargetVersion,
  type TemplateLevelId,
} from '@/domain';
import type { MergeTemplatePayload } from '../../store/mohasba-provider';
import {
  ARABIC_NOUN_FORMS,
  formatArabicCount,
} from '../../utils/arabic-plural';
import { buildActionMetaBadges } from '../../utils/template-badges';
import { AppDialog } from '../app-dialog';
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconPlus,
  IconX,
} from '../icons';

interface TemplateMergeDialogProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  activeFromIso: string;
  existingPeriods: readonly Period[];
  existingActions: readonly Action[];
  existingTargetVersionIds: readonly string[];
  onClose: () => void;
  onConfirmMerge: (payload: MergeTemplatePayload) => Promise<void>;
}

export function TemplateMergeDialog({
  open,
  busy,
  error,
  activeFromIso,
  existingPeriods,
  existingActions,
  existingTargetVersionIds,
  onClose,
  onConfirmMerge,
}: TemplateMergeDialogProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const [selectedLevel, setSelectedLevel] = useState<TemplateLevelId>('level_2');
  const [excludedPeriodsByLevel, setExcludedPeriodsByLevel] = useState<
    Record<TemplateLevelId, string[]>
  >({ level_1: [], level_2: [], level_3: [] });
  const [excludedActionsByLevel, setExcludedActionsByLevel] = useState<
    Record<TemplateLevelId, string[]>
  >({ level_1: [], level_2: [], level_3: [] });
  const [expandedPeriodIds, setExpandedPeriodIds] = useState<
    Record<string, boolean>
  >({});
  const [search, setSearch] = useState('');

  // Precompute baseline diff stats per level for the 3 selector cards
  const levelSummaries = useMemo(() => {
    const map = new Map<
      TemplateLevelId,
      { netNewActions: number; skippedActions: number; netNewPeriods: number }
    >();
    if (!open) return map;
    for (const meta of TEMPLATE_CATALOG) {
      const p = planTemplateMerge({
        level: meta.id,
        activeFromIso,
        existingPeriods,
        existingActions,
        existingTargetVersionIds,
      });
      map.set(meta.id, {
        netNewActions: p.newActions.length,
        skippedActions: p.skippedExistingActionsCount,
        netNewPeriods: p.newPeriods.length,
      });
    }
    return map;
  }, [
    open,
    activeFromIso,
    existingPeriods,
    existingActions,
    existingTargetVersionIds,
  ]);

  const excludedPeriodSet = useMemo(
    () => new Set(excludedPeriodsByLevel[selectedLevel]),
    [excludedPeriodsByLevel, selectedLevel],
  );
  const excludedActionSet = useMemo(
    () => new Set(excludedActionsByLevel[selectedLevel]),
    [excludedActionsByLevel, selectedLevel],
  );

  const activePlan = useMemo(
    () =>
      open
        ? planTemplateMerge({
            level: selectedLevel,
            activeFromIso,
            existingPeriods,
            existingActions,
            existingTargetVersionIds,
            excludedPeriodIds: excludedPeriodsByLevel[selectedLevel],
            excludedActionIds: excludedActionsByLevel[selectedLevel],
          })
        : null,
    [
      open,
      selectedLevel,
      activeFromIso,
      existingPeriods,
      existingActions,
      existingTargetVersionIds,
      excludedPeriodsByLevel,
      excludedActionsByLevel,
    ],
  );

  const targetByTemplateActionId = useMemo(() => {
    const map = new Map<string, TargetVersion>();
    if (!open) return map;
    const bundle = buildTemplateBundle(selectedLevel, activeFromIso);
    for (const tv of bundle.targetVersions) {
      map.set(tv.action_id, tv);
    }
    return map;
  }, [open, selectedLevel, activeFromIso]);

  const actionsByTemplatePeriodId = useMemo(() => {
    const map = new Map<string, NonNullable<typeof activePlan>['actionStatuses']>();
    if (!activePlan) return map;
    for (const st of activePlan.actionStatuses) {
      const list = map.get(st.templateAction.period_id) ?? [];
      list.push(st);
      map.set(st.templateAction.period_id, list);
    }
    return map;
  }, [activePlan]);

  const isPeriodExpanded = (periodId: string): boolean => {
    if (search.trim().length > 0) return true;
    return expandedPeriodIds[periodId] ?? false;
  };

  const allExpanded = useMemo(() => {
    if (!activePlan || activePlan.periodStatuses.length === 0) return false;
    return activePlan.periodStatuses.every(
      (ps) => expandedPeriodIds[ps.templatePeriod.id] === true,
    );
  }, [activePlan, expandedPeriodIds]);

  const handleToggleExpandAll = () => {
    if (!activePlan) return;
    const nextVal = !allExpanded;
    const next: Record<string, boolean> = {};
    for (const ps of activePlan.periodStatuses) {
      next[ps.templatePeriod.id] = nextVal;
    }
    setExpandedPeriodIds(next);
  };

  const togglePeriod = (templatePeriodId: string) => {
    setExcludedPeriodsByLevel((prev) => {
      const cur = new Set(prev[selectedLevel]);
      if (cur.has(templatePeriodId)) {
        cur.delete(templatePeriodId);
      } else {
        cur.add(templatePeriodId);
      }
      return { ...prev, [selectedLevel]: Array.from(cur) };
    });
  };

  const toggleAction = (templateActionId: string) => {
    setExcludedActionsByLevel((prev) => {
      const cur = new Set(prev[selectedLevel]);
      if (cur.has(templateActionId)) {
        cur.delete(templateActionId);
      } else {
        cur.add(templateActionId);
      }
      return { ...prev, [selectedLevel]: Array.from(cur) };
    });
  };

  const query = search.trim().toLowerCase();
  const netNewCount = activePlan?.newActions.length ?? 0;
  const netNewPeriodsCount = activePlan?.newPeriods.length ?? 0;
  const skippedCount = activePlan?.skippedExistingActionsCount ?? 0;

  return (
    <AppDialog
      open={open}
      onRequestClose={onClose}
      canDismiss={!busy}
      initialFocusRef={closeBtnRef}
      className="app-dialog app-dialog-wide"
      data-testid="template-merge-dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      {open && activePlan && (
        <div className="merge-dialog-shell">
          <div className="dialog-head">
            <div>
              <h2 id={titleId} className="dialog-title">
                ترقية أو إضافة أعمال من القوالب الـ 3
              </h2>
              <p id={descId} className="panel-meta mt-0.5 mb-0">
                يُضيف الأعمال الجديدة فقط داخل فتراتك الحالية دون مسح أو تعديل أي سجل سابق.
              </p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              className="btn btn-icon"
              aria-label="إغلاق"
              disabled={busy}
              onClick={onClose}
            >
              <IconX size="sm" />
            </button>
          </div>

          <div className="merge-dialog-body">
            {error && (
              <div className="status-note is-error" role="alert">
                {error}
              </div>
            )}

            {/* 3 Level Cards with live diff badge */}
            <div
              className="onboarding-level-grid"
              role="radiogroup"
              aria-label="اختر المستوى للدمج"
            >
              {TEMPLATE_CATALOG.map((meta) => {
                const isSelected = selectedLevel === meta.id;
                const sum = levelSummaries.get(meta.id);
                return (
                  <button
                    key={meta.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    className={`onboarding-level-card ${isSelected ? 'is-selected' : ''}`}
                    data-testid={`merge-level-${meta.id}`}
                    disabled={busy}
                    onClick={() => {
                      setSelectedLevel(meta.id);
                      setSearch('');
                    }}
                  >
                    <div className="onboarding-level-card-top">
                      <strong>{meta.title}</strong>
                      <span className="count-chip nums">
                        {sum && sum.netNewActions > 0
                          ? `+${sum.netNewActions} جديد`
                          : 'مكتمل'}
                      </span>
                    </div>
                    <span className="onboarding-level-subtitle">
                      {meta.subtitle}
                    </span>
                    <div className="onboarding-level-counts nums">
                      <span>
                        {sum?.netNewActions ?? 0} جديد للدمج
                      </span>
                      <span>
                        {sum?.skippedActions ?? 0} موجود بالفعل
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Preview & Filter Controls */}
            <div className="onboarding-preview-card">
              <div className="onboarding-preview-head">
                <div>
                  <strong>معاينة ما سيُضاف لجدولك</strong>
                  <div
                    className="panel-meta nums mt-0.5"
                    data-testid="merge-summary-count"
                  >
                    سيُضاف{' '}
                    {formatArabicCount(netNewCount, ARABIC_NOUN_FORMS.action)}
                    {netNewPeriodsCount > 0
                      ? ` و ${formatArabicCount(netNewPeriodsCount, ARABIC_NOUN_FORMS.section)} جديد`
                      : ' داخل فتراتك الحالية'}
                    {skippedCount > 0
                      ? ` · سيتم تجاهل ${skippedCount} موجود بالفعل`
                      : ''}
                  </div>
                </div>
                <div className="onboarding-preview-tools">
                  <input
                    type="search"
                    className="field-input onboarding-search-input"
                    data-testid="merge-preview-search"
                    placeholder="بحث في أعمال القالب..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-expanded={allExpanded}
                    onClick={handleToggleExpandAll}
                  >
                    {allExpanded ? 'طيّ الكل' : 'توسيع الكل'}
                  </button>
                </div>
              </div>

              <div className="merge-preview-list">
                {activePlan.periodStatuses.map((ps) => {
                  const tp = ps.templatePeriod;
                  const allRowStatuses = actionsByTemplatePeriodId.get(tp.id) ?? [];
                  const filteredStatuses = query
                    ? allRowStatuses.filter(
                        (st) =>
                          st.templateAction.title.toLowerCase().includes(query) ||
                          tp.title.toLowerCase().includes(query),
                      )
                    : allRowStatuses;

                  if (query && filteredStatuses.length === 0) {
                    return null;
                  }

                  const netNewInPeriod = allRowStatuses.filter(
                    (st) => st.matchedExistingAction === null,
                  );
                  const selectedNewInPeriod = netNewInPeriod.filter(
                    (st) =>
                      !excludedPeriodSet.has(tp.id) &&
                      !excludedActionSet.has(st.templateAction.id),
                  );
                  const hasAnyNew = netNewInPeriod.length > 0;
                  const periodChecked =
                    hasAnyNew && !excludedPeriodSet.has(tp.id);
                  const expanded = isPeriodExpanded(tp.id);

                  return (
                    <div
                      key={tp.id}
                      className={`onboarding-period-card ${!hasAnyNew || !periodChecked ? 'is-excluded' : ''}`}
                    >
                      <div className="onboarding-period-head">
                        <label
                          className="onboarding-period-check-wrap"
                          aria-label={`تضمين ${tp.title}`}
                        >
                          <input
                            type="checkbox"
                            checked={periodChecked}
                            disabled={!hasAnyNew || busy}
                            onChange={() => togglePeriod(tp.id)}
                          />
                        </label>

                        <button
                          type="button"
                          className="onboarding-period-disclosure"
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedPeriodIds((prev) => ({
                              ...prev,
                              [tp.id]: !expanded,
                            }))
                          }
                        >
                          <span className="onboarding-period-title-block">
                            <span className="onboarding-period-title">
                              {tp.title}
                            </span>
                            {ps.matchedExistingPeriod ? (
                              <span className="onboarding-period-sub">
                                يدمج داخل: {ps.matchedExistingPeriod.title}
                              </span>
                            ) : hasAnyNew ? (
                              <span className="onboarding-period-sub merge-new-period-note">
                                فترة جديدة ستُضاف للجدول
                              </span>
                            ) : null}
                          </span>

                          <span className="onboarding-period-right">
                            <span className="onboarding-period-count nums">
                              {hasAnyNew
                                ? `+${selectedNewInPeriod.length} / ${netNewInPeriod.length} جديد`
                                : 'موجود بالكامل'}
                            </span>
                            {expanded ? (
                              <IconChevronDown size="sm" />
                            ) : (
                              <IconChevronLeft size="sm" />
                            )}
                          </span>
                        </button>
                      </div>

                      {expanded && (
                        <div className="onboarding-period-body">
                          <div className="onboarding-actions-list">
                            {filteredStatuses.map((st) => {
                              const act = st.templateAction;
                              const isExisting = st.matchedExistingAction !== null;
                              const isChecked =
                                !isExisting &&
                                periodChecked &&
                                !excludedActionSet.has(act.id);
                              const badges = buildActionMetaBadges(
                                act,
                                targetByTemplateActionId,
                              );
                              return (
                                <label
                                  key={act.id}
                                  className={`onboarding-action-row ${isExisting ? 'is-merge-existing' : !isChecked ? 'is-unchecked' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isExisting ? true : isChecked}
                                    disabled={isExisting || !periodChecked || busy}
                                    onChange={() => toggleAction(act.id)}
                                  />
                                  <span className="onboarding-action-title">
                                    {act.title}
                                  </span>
                                  <span className="onboarding-action-badges">
                                    {isExisting ? (
                                      <span className="merge-existing-badge">
                                        <IconCheck size="sm" />
                                        <span>موجود بالفعل</span>
                                      </span>
                                    ) : (
                                      badges.map((b) => (
                                        <span
                                          key={b}
                                          className="onboarding-meta-pill"
                                        >
                                          {b}
                                        </span>
                                      ))
                                    )}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="dialog-foot">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClose}
            >
              إلغاء
            </button>
            <button
              type="button"
              className="btn btn-live"
              data-testid="merge-confirm-btn"
              disabled={busy || netNewCount === 0}
              onClick={() => {
                void onConfirmMerge({
                  level: selectedLevel,
                  active_from: activeFromIso,
                  excluded_period_ids: excludedPeriodsByLevel[selectedLevel],
                  excluded_action_ids: excludedActionsByLevel[selectedLevel],
                });
              }}
            >
              <IconPlus size="sm" />
              <span>
                {busy
                  ? 'جاري الدمج...'
                  : netNewCount === 0
                    ? 'جميع أعمال هذا المستوى موجودة بالفعل'
                    : `إضافة ${formatArabicCount(netNewCount, ARABIC_NOUN_FORMS.action)}`}
              </span>
            </button>
          </div>
        </div>
      )}
    </AppDialog>
  );
}

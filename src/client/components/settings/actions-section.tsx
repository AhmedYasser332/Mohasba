'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AR_STRINGS,
  countOpenQadaaForAction,
  resolveActiveTargetVersion,
  type Action,
  type AnalyticsRole,
} from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import {
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconCross,
  IconEdit,
  IconExpiredAlert,
  IconPlus,
  IconRefresh,
  IconTarget,
} from '../icons';
import { TargetEvolutionDialog } from './target-evolution-dialog';

interface ActionFormState {
  id: string | null;
  title: string;
  period_id: string;
  bound_time_period_id: string;
  default_disabled_days: number[];
  include_in_normal_day_preset: boolean;
  is_mosque_action: boolean;
  is_qadaa_eligible: boolean;
  supports_percentage: boolean;
  analytics_role: AnalyticsRole;
  initial_target_label: string;
  original_is_qadaa_eligible: boolean;
}

const WEEKDAY_OPTIONS: ReadonlyArray<{ day: number; label: string }> = [
  { day: 6, label: 'السبت' },
  { day: 0, label: 'الأحد' },
  { day: 1, label: 'الاثنين' },
  { day: 2, label: 'الثلاثاء' },
  { day: 3, label: 'الأربعاء' },
  { day: 4, label: 'الخميس' },
  { day: 5, label: 'الجمعة' },
];

const ROLE_LABELS: Record<AnalyticsRole, string> = {
  standard: 'عادي / سنن وأذكار',
  core_jamaah: AR_STRINGS.analytics.coreJamaahLabel,
  core_habit: 'عادة أساسية',
};

export function ActionsSection() {
  const {
    periods,
    actions,
    targetVersions,
    logs,
    isOnline,
    todayIslamicDate,
    createAction,
    updateAction,
    reorderSchema,
  } = useMohasba();

  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [form, setForm] = useState<ActionFormState | null>(null);
  const editDialogRef = useRef<HTMLDialogElement | null>(null);

  const [renameTarget, setRenameTarget] = useState<Action | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const renameDialogRef = useRef<HTMLDialogElement | null>(null);

  const [evolveAction, setEvolveAction] = useState<Action | null>(null);

  useEffect(() => {
    const dialog = editDialogRef.current;
    if (!dialog) return;
    if (editDialogOpen && form) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [editDialogOpen, form]);

  useEffect(() => {
    const dialog = renameDialogRef.current;
    if (!dialog) return;
    if (renameTarget) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [renameTarget]);

  const sortedPeriods = useMemo(
    () => [...periods].sort((a, b) => a.sort_order - b.sort_order),
    [periods],
  );

  const timeBoundPeriods = useMemo(
    () =>
      sortedPeriods.filter(
        (p) => p.side === 'TIME_BOUND' && p.archived_at === null,
      ),
    [sortedPeriods],
  );

  const archivedCount = useMemo(
    () => actions.filter((a) => a.archived_at !== null).length,
    [actions],
  );

  const effectiveToday =
    todayIslamicDate ?? new Date().toISOString().slice(0, 10);

  const liveQadaaWarningCount = useMemo(() => {
    if (!form || !form.id) return 0;
    if (!form.original_is_qadaa_eligible || form.is_qadaa_eligible) return 0;
    const actionObj = actions.find((a) => a.id === form.id);
    if (!actionObj) return 0;
    return countOpenQadaaForAction(
      actionObj.id,
      logs,
      effectiveToday,
      actionObj,
    );
  }, [actions, effectiveToday, form, logs]);

  const openCreateDialog = () => {
    const defaultPeriodId =
      sortedPeriods.find((p) => p.archived_at === null)?.id ??
      sortedPeriods[0]?.id ??
      '';
    setFeedback(null);
    setForm({
      id: null,
      title: '',
      period_id: defaultPeriodId,
      bound_time_period_id: '',
      default_disabled_days: [],
      include_in_normal_day_preset: false,
      is_mosque_action: false,
      is_qadaa_eligible: false,
      supports_percentage: false,
      analytics_role: 'standard',
      initial_target_label: '',
      original_is_qadaa_eligible: false,
    });
    setEditDialogOpen(true);
  };

  const openEditDialog = (action: Action) => {
    setFeedback(null);
    setForm({
      id: action.id,
      title: action.title,
      period_id: action.period_id,
      bound_time_period_id: action.bound_time_period_id ?? '',
      default_disabled_days: [...action.default_disabled_days],
      include_in_normal_day_preset: action.include_in_normal_day_preset,
      is_mosque_action: action.is_mosque_action,
      is_qadaa_eligible: action.is_qadaa_eligible,
      supports_percentage: action.supports_percentage,
      analytics_role: action.analytics_role,
      initial_target_label: '',
      original_is_qadaa_eligible: action.is_qadaa_eligible,
    });
    setEditDialogOpen(true);
  };

  const toggleDisabledDay = (day: number) => {
    setForm((prev) => {
      if (!prev) return prev;
      const exists = prev.default_disabled_days.includes(day);
      return {
        ...prev,
        default_disabled_days: exists
          ? prev.default_disabled_days.filter((d) => d !== day)
          : [...prev.default_disabled_days, day],
      };
    });
  };

  const handleSaveAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !isOnline || busy || !form.title.trim() || !form.period_id) {
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      const selectedPeriod = periods.find((p) => p.id === form.period_id);
      const boundId =
        selectedPeriod?.side === 'DAILY_GROUP' && form.bound_time_period_id
          ? form.bound_time_period_id
          : null;

      if (form.id) {
        const res = await updateAction(form.id, {
          title: form.title.trim(),
          period_id: form.period_id,
          bound_time_period_id: boundId,
          default_disabled_days: form.default_disabled_days,
          include_in_normal_day_preset: form.include_in_normal_day_preset,
          is_mosque_action: form.is_mosque_action,
          is_qadaa_eligible: form.is_qadaa_eligible,
          supports_percentage: form.supports_percentage,
          analytics_role: form.analytics_role,
        });
        if (res.ok) {
          setEditDialogOpen(false);
          setFeedback({
            text: `تم تحديث العمل: ${form.title.trim()}`,
            isError: false,
          });
        } else {
          setFeedback({
            text: res.errorMessage ?? 'تعذر تحديث العمل.',
            isError: true,
          });
        }
      } else {
        const siblings = actions.filter((a) => a.period_id === form.period_id);
        const maxSort = siblings.reduce(
          (acc, a) => Math.max(acc, a.sort_order),
          0,
        );
        const initialTargetLabel = form.initial_target_label.trim();
        const res = await createAction({
          title: form.title.trim(),
          period_id: form.period_id,
          bound_time_period_id: boundId,
          sort_order: maxSort + 1,
          default_disabled_days: form.default_disabled_days,
          include_in_normal_day_preset: form.include_in_normal_day_preset,
          is_mosque_action: form.is_mosque_action,
          is_qadaa_eligible: form.is_qadaa_eligible,
          supports_percentage: form.supports_percentage,
          analytics_role: form.analytics_role,
          ...(initialTargetLabel
            ? {
                initial_target: {
                  target_label: initialTargetLabel,
                  direction: 'level_up',
                },
              }
            : {}),
        });
        if (res.ok) {
          setEditDialogOpen(false);
          setFeedback({
            text: `تمت إضافة العمل: ${form.title.trim()}`,
            isError: false,
          });
        } else {
          setFeedback({
            text: res.errorMessage ?? 'تعذر إنشاء العمل.',
            isError: true,
          });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSimpleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !isOnline || busy || !renameTitle.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await updateAction(renameTarget.id, {
        title: renameTitle.trim(),
      });
      if (res.ok) {
        setRenameTarget(null);
        setFeedback({
          text: `تم تعديل الاسم إلى: ${renameTitle.trim()}`,
          isError: false,
        });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر تعديل الاسم.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleMoveAction = async (action: Action, direction: 'up' | 'down') => {
    if (!isOnline || busy) return;
    const siblings = actions
      .filter((a) => a.period_id === action.period_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const idx = siblings.findIndex((a) => a.id === action.id);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= siblings.length) return;

    const reordered = [...siblings];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved!);

    const items = reordered.map((a, i) => ({
      id: a.id,
      sort_order: i + 1,
    }));

    setBusy(true);
    setFeedback(null);
    try {
      const res = await reorderSchema({ target: 'actions', items });
      if (!res.ok) {
        setFeedback({
          text: res.errorMessage ?? 'تعذر إعادة ترتيب الأعمال.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleArchive = async (action: Action) => {
    if (!isOnline || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const isArchived = action.archived_at !== null;
      const res = await updateAction(action.id, {
        archived_at: isArchived ? null : effectiveToday,
      });
      if (res.ok) {
        setFeedback({
          text: isArchived
            ? `تمت استعادة العمل: ${action.title}`
            : `تمت أرشفة العمل: ${action.title}`,
          isError: false,
        });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر تغيير حالة الأرشفة.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const selectedFormPeriod = form
    ? periods.find((p) => p.id === form.period_id)
    : null;

  return (
    <section className="panel" data-testid="settings-actions-section">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">{AR_STRINGS.settings.schemaSectionTitle}</h3>
          <span className="panel-meta nums">
            {actions.filter((a) => a.archived_at === null).length} نشط /{' '}
            {archivedCount} مؤرشف
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {archivedCount > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => setShowArchived((prev) => !prev)}
            >
              {showArchived ? 'إخفاء المؤرشف' : `عرض المؤرشف (${archivedCount})`}
            </button>
          )}
          <button
            type="button"
            className="btn btn-live"
            data-testid="add-action-btn"
            disabled={!isOnline || busy || periods.length === 0}
            onClick={openCreateDialog}
          >
            <IconPlus size="sm" />
            <span>إضافة عمل</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 pb-0">
          <div className={`status-note ${feedback.isError ? 'is-error' : ''}`}>
            {feedback.text}
          </div>
        </div>
      )}

      <div>
        {sortedPeriods.map((period) => {
          const allInPeriod = actions
            .filter((a) => a.period_id === period.id)
            .sort((a, b) => a.sort_order - b.sort_order);
          const visibleInPeriod = showArchived
            ? allInPeriod
            : allInPeriod.filter((a) => a.archived_at === null);

          if (visibleInPeriod.length === 0) return null;

          return (
            <div key={period.id} className="schema-group">
              <div className="schema-group-head">
                <strong>{period.title}</strong>
                <span className="panel-meta nums">
                  {visibleInPeriod.length} أعمال
                </span>
              </div>

              <div>
                {visibleInPeriod.map((action) => {
                  const idxInAll = allInPeriod.findIndex(
                    (a) => a.id === action.id,
                  );
                  const activeTarget = resolveActiveTargetVersion(
                    targetVersions,
                    action.id,
                    effectiveToday,
                  );
                  const isArchived = action.archived_at !== null;

                  return (
                    <div
                      key={action.id}
                      className={`schema-item-row ${isArchived ? 'is-archived' : ''}`}
                      data-testid={`settings-action-${action.id}`}
                    >
                      <div className="schema-item-main">
                        <div className="action-title-line">
                          <span className="action-title">{action.title}</span>
                          {activeTarget && (
                            <span className="target-tag">
                              {activeTarget.target_label}
                            </span>
                          )}
                          {isArchived && (
                            <span className="target-tag">مؤرشف</span>
                          )}
                        </div>
                        <div className="schema-item-meta">
                          {action.is_qadaa_eligible && <span>يُقضى</span>}
                          {action.supports_percentage && <span>نسبة مئوية</span>}
                          {action.is_mosque_action && <span>مسجد</span>}
                          {action.analytics_role !== 'standard' && (
                            <span>{ROLE_LABELS[action.analytics_role]}</span>
                          )}
                        </div>
                      </div>

                      <div className="schema-item-actions">
                        <button
                          type="button"
                          className="btn btn-icon"
                          data-testid={`action-move-up-${action.id}`}
                          aria-label={`تحريك ${action.title} لأعلى`}
                          disabled={!isOnline || busy || idxInAll <= 0}
                          onClick={() => {
                            void handleMoveAction(action, 'up');
                          }}
                        >
                          <IconArrowUp size="sm" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-icon"
                          data-testid={`action-move-down-${action.id}`}
                          aria-label={`تحريك ${action.title} لأسفل`}
                          disabled={
                            !isOnline ||
                            busy ||
                            idxInAll === allInPeriod.length - 1
                          }
                          onClick={() => {
                            void handleMoveAction(action, 'down');
                          }}
                        >
                          <IconArrowDown size="sm" />
                        </button>
                        <button
                          type="button"
                          className="btn"
                          data-testid={`action-rename-${action.id}`}
                          disabled={!isOnline || busy}
                          onClick={() => {
                            setRenameTarget(action);
                            setRenameTitle(action.title);
                          }}
                        >
                          <span>{AR_STRINGS.settings.simpleRenameAction}</span>
                        </button>
                        <button
                          type="button"
                          className="btn"
                          data-testid={`action-evolve-${action.id}`}
                          disabled={!isOnline || busy}
                          onClick={() => setEvolveAction(action)}
                        >
                          <IconTarget size="sm" />
                          <span>{AR_STRINGS.settings.evolveTargetAction}</span>
                        </button>
                        <button
                          type="button"
                          className="btn"
                          data-testid={`action-edit-${action.id}`}
                          disabled={!isOnline || busy}
                          onClick={() => openEditDialog(action)}
                        >
                          <IconEdit size="sm" />
                          <span>خصائص</span>
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={!isOnline || busy}
                          onClick={() => {
                            void handleToggleArchive(action);
                          }}
                        >
                          {isArchived ? (
                            <>
                              <IconRefresh size="sm" />
                              <span>{AR_STRINGS.settings.restoreAction}</span>
                            </>
                          ) : (
                            <>
                              <IconArchive size="sm" />
                              <span>{AR_STRINGS.settings.archiveAction}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Full Edit Action Dialog */}
      <dialog
        ref={editDialogRef}
        className="app-dialog dialog-wide"
        aria-labelledby="action-dialog-title"
        onClose={() => setEditDialogOpen(false)}
      >
        {editDialogOpen && form && (
          <form
            onSubmit={(e) => {
              void handleSaveAction(e);
            }}
          >
            <div className="dialog-head">
              <h3 className="dialog-title" id="action-dialog-title">
                {form.id ? `تعديل خصائص: ${form.title}` : 'إضافة عمل جديد'}
              </h3>
              <button
                type="button"
                className="btn btn-icon"
                aria-label="إغلاق"
                onClick={() => setEditDialogOpen(false)}
              >
                <IconCross size="sm" />
              </button>
            </div>

            <div className="dialog-body dialog-body-scroll">
              <div className="field-grid">
                <label className="field-label">
                  <span>اسم العمل</span>
                  <input
                    type="text"
                    className="field-input"
                    required
                    maxLength={120}
                    value={form.title}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev ? { ...prev, title: e.target.value } : prev,
                      )
                    }
                  />
                </label>

                <label className="field-label">
                  <span>الفترة / المجموعة</span>
                  <select
                    className="field-select"
                    value={form.period_id}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev ? { ...prev, period_id: e.target.value } : prev,
                      )
                    }
                  >
                    {sortedPeriods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="field-grid">
                <label className="field-label">
                  <span>الدور التحليلي</span>
                  <select
                    className="field-select"
                    value={form.analytics_role}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              analytics_role: e.target.value as AnalyticsRole,
                            }
                          : prev,
                      )
                    }
                  >
                    <option value="standard">عادي / سنن وأذكار</option>
                    <option value="core_jamaah">
                      {AR_STRINGS.analytics.coreJamaahLabel}
                    </option>
                    <option value="core_habit">عادة أساسية</option>
                  </select>
                </label>

                {selectedFormPeriod?.side === 'DAILY_GROUP' && (
                  <label className="field-label">
                    <span>ربط بفترة صلاة (اختياري)</span>
                    <select
                      className="field-select"
                      value={form.bound_time_period_id}
                      onChange={(e) =>
                        setForm((prev) =>
                          prev
                            ? { ...prev, bound_time_period_id: e.target.value }
                            : prev,
                        )
                      }
                    >
                      <option value="">بدون ربط بفترة</option>
                      {timeBoundPeriods.map((tp) => (
                        <option key={tp.id} value={tp.id}>
                          {tp.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {!form.id && (
                  <label className="field-label">
                    <span>الهدف الابتدائي (اختياري)</span>
                    <input
                      type="text"
                      className="field-input"
                      maxLength={80}
                      placeholder="مثال: 10 صفحات"
                      value={form.initial_target_label}
                      onChange={(e) =>
                        setForm((prev) =>
                          prev
                            ? { ...prev, initial_target_label: e.target.value }
                            : prev,
                        )
                      }
                    />
                  </label>
                )}
              </div>

              <div className="field-grid">
                <label className="check-row">
                  <input
                    type="checkbox"
                    data-testid="action-qadaa-checkbox"
                    checked={form.is_qadaa_eligible}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? { ...prev, is_qadaa_eligible: e.target.checked }
                          : prev,
                      )
                    }
                  />
                  <span>قابل للقضاء عند الفوات</span>
                </label>

                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={form.supports_percentage}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? { ...prev, supports_percentage: e.target.checked }
                          : prev,
                      )
                    }
                  />
                  <span>يدعم تسجيل نسبة مئوية</span>
                </label>

                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={form.is_mosque_action}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? { ...prev, is_mosque_action: e.target.checked }
                          : prev,
                      )
                    }
                  />
                  <span>ضمن زر تم ما في المسجد</span>
                </label>

                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={form.include_in_normal_day_preset}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              include_in_normal_day_preset: e.target.checked,
                            }
                          : prev,
                      )
                    }
                  />
                  <span>ضمن زر يوم اعتيادي</span>
                </label>
              </div>

              {liveQadaaWarningCount > 0 && (
                <div
                  className="confirm-banner"
                  data-testid="qadaa-disable-warning"
                  role="alert"
                >
                  <div className="flex items-center gap-2">
                    <IconExpiredAlert size="sm" />
                    <span className="nums">
                      {AR_STRINGS.settings.qadaaDisableWarning}{' '}
                      <strong>{liveQadaaWarningCount}</strong>
                    </span>
                  </div>
                </div>
              )}

              <div className="field-label">
                <span>أيام التعطيل الافتراضية (غير مطلوبة عادةً)</span>
                <div className="weekday-chips">
                  {WEEKDAY_OPTIONS.map((opt) => {
                    const active = form.default_disabled_days.includes(opt.day);
                    return (
                      <button
                        key={opt.day}
                        type="button"
                        className={`btn ${active ? 'btn-primary' : ''}`}
                        aria-pressed={active}
                        onClick={() => toggleDisabledDay(opt.day)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="dialog-foot">
              <button
                type="button"
                className="btn"
                onClick={() => setEditDialogOpen(false)}
                disabled={busy}
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="btn btn-live"
                data-testid="action-edit-save"
                disabled={!isOnline || busy}
              >
                حفظ العمل
              </button>
            </div>
          </form>
        )}
      </dialog>

      {/* Simple Rename Dialog */}
      <dialog
        ref={renameDialogRef}
        className="app-dialog"
        aria-labelledby="simple-rename-title"
        onClose={() => setRenameTarget(null)}
      >
        {renameTarget && (
          <form
            onSubmit={(e) => {
              void handleSimpleRenameSubmit(e);
            }}
          >
            <div className="dialog-head">
              <h3 className="dialog-title" id="simple-rename-title">
                {AR_STRINGS.settings.simpleRenameAction}
              </h3>
              <button
                type="button"
                className="btn btn-icon"
                aria-label="إغلاق"
                onClick={() => setRenameTarget(null)}
              >
                <IconCross size="sm" />
              </button>
            </div>
            <div className="dialog-body">
              <span className="panel-meta">
                يغيّر الاسم الظاهر فقط دون إنشاء نسخة هدف جديدة أو فترة تكيّف.
              </span>
              <label className="field-label">
                <span>الاسم الجديد</span>
                <input
                  type="text"
                  className="field-input"
                  required
                  maxLength={120}
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.target.value)}
                />
              </label>
            </div>
            <div className="dialog-foot">
              <button
                type="button"
                className="btn"
                onClick={() => setRenameTarget(null)}
                disabled={busy}
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="btn btn-live"
                disabled={!isOnline || busy}
              >
                حفظ الاسم
              </button>
            </div>
          </form>
        )}
      </dialog>

      {/* Target Evolution Dialog */}
      <TargetEvolutionDialog
        action={evolveAction}
        onClose={() => setEvolveAction(null)}
        onChanged={(msg) => setFeedback({ text: msg, isError: false })}
      />
    </section>
  );
}

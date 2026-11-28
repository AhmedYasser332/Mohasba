'use client';

import React, { useMemo, useState } from 'react';
import {
  type NtfyMode,
  type Period,
  type PeriodSide,
  type PrayerAnchor,
} from '@/domain';
import {
  PointerDragGhost,
  usePointerDnd,
  type PointerDndReorderPayload,
} from '../../hooks/use-pointer-dnd';
import { useMohasba } from '../../store/mohasba-provider';
import { usePersistedBoolean } from '../../utils/disclosure-storage';
import { AppDialog } from '../app-dialog';
import {
  IconArchive,
  IconCross,
  IconEdit,
  IconGripVertical,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '../icons';
import { Tooltip } from '../tooltip';
import {
  DeleteConfirmDialog,
  type DeleteConfirmState,
} from './delete-confirm-dialog';

const ANCHOR_LABELS: ReadonlyArray<{ value: PrayerAnchor; label: string }> = [
  { value: 'FAJR', label: 'الفجر' },
  { value: 'SUNRISE', label: 'الشروق' },
  { value: 'DHUHR', label: 'الظهر' },
  { value: 'ASR', label: 'العصر' },
  { value: 'MAGHRIB', label: 'المغرب' },
  { value: 'ISHA', label: 'العشاء' },
  { value: 'FIXED_TIME', label: 'وقت ثابت' },
];

const SIDE_SECTIONS: ReadonlyArray<{ side: PeriodSide; label: string }> = [
  { side: 'TIME_BOUND', label: 'الفترات الموقوتة' },
  { side: 'DAILY_GROUP', label: 'المجموعات اليومية' },
];

function formatAnchorSummary(period: Period): string {
  if (period.side === 'DAILY_GROUP') return 'مجموعة يومية';
  const startLabel =
    period.start_anchor === 'FIXED_TIME'
      ? (period.start_fixed_hhmm ?? '00:00')
      : (ANCHOR_LABELS.find((a) => a.value === period.start_anchor)?.label ??
          '');
  const endLabel =
    period.end_anchor === 'FIXED_TIME'
      ? (period.end_fixed_hhmm ?? '00:00')
      : (ANCHOR_LABELS.find((a) => a.value === period.end_anchor)?.label ?? '');
  return `من ${startLabel} إلى ${endLabel}`;
}

interface PeriodFormState {
  id: string | null;
  title: string;
  side: PeriodSide;
  start_anchor: PrayerAnchor;
  start_offset_min: number;
  start_fixed_hhmm: string;
  end_anchor: PrayerAnchor;
  end_offset_min: number;
  end_fixed_hhmm: string;
  ntfy_enabled: boolean;
  ntfy_mode: NtfyMode;
  ntfy_offset_min: number;
}

const DEFAULT_FORM: PeriodFormState = {
  id: null,
  title: '',
  side: 'TIME_BOUND',
  start_anchor: 'ISHA',
  start_offset_min: 0,
  start_fixed_hhmm: '21:00',
  end_anchor: 'FAJR',
  end_offset_min: 0,
  end_fixed_hhmm: '23:30',
  ntfy_enabled: true,
  ntfy_mode: 'pre_expiry',
  ntfy_offset_min: 25,
};

export function PeriodsSection() {
  const {
    periods,
    isOnline,
    todayIslamicDate,
    createPeriod,
    updatePeriod,
    deletePeriod,
    reorderSchema,
  } = useMohasba();

  const [showArchived, setShowArchived] = usePersistedBoolean(
    'mohasba.ui.settings-periods-show-archived',
    false,
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<PeriodFormState>(DEFAULT_FORM);

  const sortedPeriods = useMemo(() => {
    return [...periods].sort((a, b) => a.sort_order - b.sort_order);
  }, [periods]);

  const visiblePeriods = useMemo(() => {
    if (showArchived) return sortedPeriods;
    return sortedPeriods.filter((p) => p.archived_at === null);
  }, [showArchived, sortedPeriods]);

  const archivedCount = useMemo(
    () => periods.filter((p) => p.archived_at !== null).length,
    [periods],
  );

  const handleDndReorder = async (payload: PointerDndReorderPayload) => {
    if (!isOnline || busy) return;
    const side = payload.toGroupId as PeriodSide;
    const baseOrder = side === 'TIME_BOUND' ? 1 : 101;
    const archivedTailIds = showArchived
      ? []
      : sortedPeriods
          .filter((p) => p.side === side && p.archived_at !== null)
          .map((p) => p.id);

    const items = [...payload.targetGroupItemIds, ...archivedTailIds].map(
      (id, idx) => ({
        id,
        sort_order: baseOrder + idx,
      }),
    );

    if (items.length === 0) return;

    setBusy(true);
    setFeedback(null);
    try {
      const res = await reorderSchema({ target: 'periods', items });
      if (!res.ok) {
        setFeedback({
          text: res.errorMessage ?? 'تعذر إعادة ترتيب الفترات.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const {
    dragState,
    getHandleProps,
    getItemProps,
    getGroupDropProps,
    liveAnnouncement,
  } = usePointerDnd<Period>({
    items: visiblePeriods,
    getId: (p) => p.id,
    getGroupId: (p) => p.side,
    getLabel: (p) => p.title,
    groupOrder: SIDE_SECTIONS.map((s) => s.side),
    getGroupLabel: (side) =>
      SIDE_SECTIONS.find((s) => s.side === side)?.label ?? '',
    allowCrossGroup: false,
    disabled: !isOnline || busy,
    onReorder: handleDndReorder,
  });

  const openCreateDialog = () => {
    setFeedback(null);
    setForm(DEFAULT_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (period: Period) => {
    setFeedback(null);
    setForm({
      id: period.id,
      title: period.title,
      side: period.side,
      start_anchor: period.start_anchor ?? 'FAJR',
      start_offset_min: period.start_offset_min,
      start_fixed_hhmm: period.start_fixed_hhmm ?? '05:00',
      end_anchor: period.end_anchor ?? 'SUNRISE',
      end_offset_min: period.end_offset_min,
      end_fixed_hhmm: period.end_fixed_hhmm ?? '06:00',
      ntfy_enabled: period.ntfy_enabled,
      ntfy_mode: period.ntfy_mode ?? 'pre_expiry',
      ntfy_offset_min: period.ntfy_offset_min,
    });
    setDialogOpen(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || busy || !form.title.trim()) return;
    setBusy(true);
    setFeedback(null);

    try {
      const isTimeBound = form.side === 'TIME_BOUND';
      const payloadBase = {
        title: form.title.trim(),
        start_anchor: isTimeBound ? form.start_anchor : null,
        start_offset_min: isTimeBound ? Number(form.start_offset_min) || 0 : 0,
        start_fixed_hhmm:
          isTimeBound && form.start_anchor === 'FIXED_TIME'
            ? form.start_fixed_hhmm
            : null,
        end_anchor: isTimeBound ? form.end_anchor : null,
        end_offset_min: isTimeBound ? Number(form.end_offset_min) || 0 : 0,
        end_fixed_hhmm:
          isTimeBound && form.end_anchor === 'FIXED_TIME'
            ? form.end_fixed_hhmm
            : null,
        ntfy_enabled: isTimeBound ? form.ntfy_enabled : false,
        ntfy_mode: isTimeBound ? form.ntfy_mode : null,
        ntfy_offset_min: Math.min(
          180,
          Math.max(1, Number(form.ntfy_offset_min) || 25),
        ),
      };

      let res;
      if (form.id) {
        res = await updatePeriod(form.id, payloadBase);
      } else {
        const sameSide = periods.filter((p) => p.side === form.side);
        const maxOrder = sameSide.reduce(
          (acc, p) => Math.max(acc, p.sort_order),
          form.side === 'TIME_BOUND' ? 0 : 100,
        );
        res = await createPeriod({
          ...payloadBase,
          side: form.side,
          sort_order: maxOrder + 1,
        });
      }

      if (res.ok) {
        setDialogOpen(false);
        setFeedback({
          text: form.id
            ? 'تم تحديث الفترة بنجاح.'
            : 'تمت إضافة الفترة بنجاح.',
          isError: false,
        });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر حفظ الفترة.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleArchive = async (period: Period) => {
    if (!isOnline || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const isArchived = period.archived_at !== null;
      const fallbackDate = new Date().toISOString().slice(0, 10);
      const res = await updatePeriod(period.id, {
        archived_at: isArchived ? null : (todayIslamicDate ?? fallbackDate),
      });
      if (res.ok) {
        setFeedback({
          text: isArchived
            ? `تمت استعادة الفترة: ${period.title}`
            : `تمت أرشفة الفترة: ${period.title}`,
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

  const handleRequestDelete = async (period: Period) => {
    if (!isOnline || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await deletePeriod(period.id, { force: false });
      if (res.ok) {
        setFeedback({
          text: `تم حذف الفترة نهائياً: ${period.title}`,
          isError: false,
        });
        return;
      }
      if (res.errorCode === 'HAS_HISTORY' || res.errorCode === 'HAS_CHILDREN') {
        const actionCount = Number(res.errorDetails?.action_count ?? 0);
        const logCount = Number(res.errorDetails?.log_count ?? 0);
        const boundActionCount = Number(
          res.errorDetails?.bound_action_count ?? 0,
        );
        setDeleteError(null);
        setDeleteConfirm({
          entityType: 'period',
          id: period.id,
          title: period.title,
          isArchived: period.archived_at !== null,
          actionCount,
          logCount,
          boundActionCount,
        });
        return;
      }
      setFeedback({
        text: res.errorMessage ?? 'تعذر حذف الفترة.',
        isError: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmForceDelete = async () => {
    if (!deleteConfirm || !isOnline || busy) return;
    setBusy(true);
    setDeleteError(null);
    setFeedback(null);
    try {
      const res = await deletePeriod(deleteConfirm.id, { force: true });
      if (res.ok) {
        const deletedTitle = deleteConfirm.title;
        setDeleteConfirm(null);
        setDeleteError(null);
        setFeedback({
          text: `تم حذف الفترة نهائياً: ${deletedTitle}`,
          isError: false,
        });
      } else {
        setDeleteError(res.errorMessage ?? 'تعذر حذف الفترة.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveFromDeleteDialog = async () => {
    if (!deleteConfirm) return;
    const period = periods.find((p) => p.id === deleteConfirm.id);
    setDeleteConfirm(null);
    if (period && period.archived_at === null) {
      await handleToggleArchive(period);
    }
  };

  return (
    <div>
      <div className="settings-section-bar">
        <span className="panel-meta">
          اسحب مقبض النقاط الست أو استخدم Alt مع الأسهم لإعادة ترتيب كل جانب
        </span>

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
            data-testid="add-period-btn"
            disabled={!isOnline || busy}
            onClick={openCreateDialog}
          >
            <IconPlus size="sm" />
            <span>إضافة فترة</span>
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

      <div className="sr-only" aria-live="assertive" role="status">
        {liveAnnouncement}
      </div>

      <div>
        {SIDE_SECTIONS.map((sideMeta) => {
          const sidePeriods = visiblePeriods.filter(
            (p) => p.side === sideMeta.side,
          );
          if (sidePeriods.length === 0) return null;

          const groupDropProps = getGroupDropProps(sideMeta.side);

          return (
            <div key={sideMeta.side} className="schema-group" {...groupDropProps}>
              <div className="schema-side-heading">{sideMeta.label}</div>
              <div>
                {sidePeriods.map((period) => {
                  const isArchived = period.archived_at !== null;
                  const itemProps = getItemProps(period.id);
                  const isDragging =
                    itemProps['data-dnd-dragging'] === 'true';
                  const dropPos = itemProps['data-dnd-drop-position'];

                  return (
                    <div
                      key={period.id}
                      {...itemProps}
                      className={[
                        'schema-item-row',
                        isArchived ? 'is-archived' : '',
                        isDragging ? 'is-dragging' : '',
                        dropPos === 'before' ? 'is-drop-before' : '',
                        dropPos === 'after' ? 'is-drop-after' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-testid={`period-row-${period.id}`}
                    >
                      <div className="schema-row-lead">
                        <Tooltip
                          content={
                            isOnline
                              ? 'اسحب لإعادة الترتيب أو استخدم Alt مع الأسهم'
                              : 'إعادة الترتيب متاحة عند الاتصال بالإنترنت فقط'
                          }
                        >
                          <button
                            type="button"
                            className="drag-handle"
                            data-testid={`period-drag-handle-${period.id}`}
                            aria-label={`إعادة ترتيب ${period.title}`}
                            {...getHandleProps(period.id)}
                          >
                            <IconGripVertical size="sm" />
                          </button>
                        </Tooltip>

                        <div className="schema-item-main">
                          <div className="action-title-line">
                            <span className="action-title">{period.title}</span>
                            {isArchived && (
                              <span className="target-tag">مؤرشفة</span>
                            )}
                          </div>
                          <div className="schema-item-meta nums">
                            <span>{formatAnchorSummary(period)}</span>
                            {period.side === 'TIME_BOUND' && (
                              <span>
                                التنبيه:{' '}
                                {period.ntfy_enabled
                                  ? `${period.ntfy_mode === 'post_start' ? 'بعد البداية' : 'قبل الانتهاء'} (${period.ntfy_offset_min} د)`
                                  : 'متوقف'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="schema-item-actions">
                        <button
                          type="button"
                          className="btn"
                          disabled={!isOnline || busy}
                          onClick={() => openEditDialog(period)}
                        >
                          <IconEdit size="sm" />
                          <span>تعديل</span>
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={!isOnline || busy}
                          onClick={() => {
                            void handleToggleArchive(period);
                          }}
                        >
                          {isArchived ? (
                            <>
                              <IconRefresh size="sm" />
                              <span>استعادة</span>
                            </>
                          ) : (
                            <>
                              <IconArchive size="sm" />
                              <span>أرشفة</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          data-testid={`period-delete-${period.id}`}
                          title={
                            isOnline
                              ? `حذف فترة ${period.title}`
                              : 'الحذف متاح عند الاتصال بالإنترنت فقط'
                          }
                          disabled={!isOnline || busy}
                          onClick={() => {
                            void handleRequestDelete(period);
                          }}
                        >
                          <IconTrash size="sm" />
                          <span>حذف</span>
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

      <PointerDragGhost dragState={dragState} />

      {/* Period Create / Edit Dialog */}
      <AppDialog
        open={dialogOpen}
        onRequestClose={() => setDialogOpen(false)}
        className="app-dialog dialog-wide"
        aria-labelledby="period-dialog-title"
      >
        {dialogOpen && (
          <form
            onSubmit={(e) => {
              void handleSaveForm(e);
            }}
          >
            <div className="dialog-head">
              <h2 className="dialog-title" id="period-dialog-title">
                {form.id ? `تعديل فترة: ${form.title}` : 'إضافة فترة جديدة'}
              </h2>
              <button
                type="button"
                className="btn btn-icon"
                aria-label="إغلاق"
                onClick={() => setDialogOpen(false)}
              >
                <IconCross size="sm" />
              </button>
            </div>

            <div className="dialog-body dialog-body-scroll">
              <div className="field-grid">
                <label className="field-label">
                  <span>اسم الفترة</span>
                  <input
                    type="text"
                    className="field-input"
                    required
                    maxLength={80}
                    value={form.title}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, title: e.target.value }))
                    }
                  />
                </label>

                <label className="field-label">
                  <span>النوع</span>
                  <select
                    className="field-select"
                    disabled={form.id !== null}
                    value={form.side}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        side: e.target.value as PeriodSide,
                      }))
                    }
                  >
                    <option value="TIME_BOUND">فترة صلاة موقوتة</option>
                    <option value="DAILY_GROUP">مجموعة يومية</option>
                  </select>
                </label>
              </div>

              {form.side === 'TIME_BOUND' && (
                <>
                  <div className="field-grid-3">
                    <label className="field-label">
                      <span>مرجع البداية</span>
                      <select
                        className="field-select"
                        value={form.start_anchor}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            start_anchor: e.target.value as PrayerAnchor,
                          }))
                        }
                      >
                        {ANCHOR_LABELS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-label">
                      <span>إزاحة البداية (دقيقة)</span>
                      <input
                        type="number"
                        className="field-input nums"
                        min={-360}
                        max={360}
                        value={form.start_offset_min}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            start_offset_min: Number(e.target.value),
                          }))
                        }
                      />
                    </label>

                    {form.start_anchor === 'FIXED_TIME' && (
                      <label className="field-label">
                        <span>وقت البداية الثابت</span>
                        <input
                          type="time"
                          className="field-input nums"
                          required
                          value={form.start_fixed_hhmm}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              start_fixed_hhmm: e.target.value,
                            }))
                          }
                        />
                      </label>
                    )}
                  </div>

                  <div className="field-grid-3">
                    <label className="field-label">
                      <span>مرجع النهاية</span>
                      <select
                        className="field-select"
                        value={form.end_anchor}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            end_anchor: e.target.value as PrayerAnchor,
                          }))
                        }
                      >
                        {ANCHOR_LABELS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-label">
                      <span>إزاحة النهاية (دقيقة)</span>
                      <input
                        type="number"
                        className="field-input nums"
                        min={-360}
                        max={360}
                        value={form.end_offset_min}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            end_offset_min: Number(e.target.value),
                          }))
                        }
                      />
                    </label>

                    {form.end_anchor === 'FIXED_TIME' && (
                      <label className="field-label">
                        <span>وقت النهاية الثابت</span>
                        <input
                          type="time"
                          className="field-input nums"
                          required
                          value={form.end_fixed_hhmm}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              end_fixed_hhmm: e.target.value,
                            }))
                          }
                        />
                      </label>
                    )}
                  </div>

                  <div className="field-grid-3">
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={form.ntfy_enabled}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            ntfy_enabled: e.target.checked,
                          }))
                        }
                      />
                      <span>تفعيل تذكير ntfy</span>
                    </label>

                    <label className="field-label">
                      <span>نمط التذكير</span>
                      <select
                        className="field-select"
                        value={form.ntfy_mode}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            ntfy_mode: e.target.value as NtfyMode,
                          }))
                        }
                      >
                        <option value="pre_expiry">قبل انتهاء الوقت</option>
                        <option value="post_start">بعد دخول الوقت</option>
                      </select>
                    </label>

                    <label className="field-label">
                      <span>المدة (دقيقة)</span>
                      <input
                        type="number"
                        className="field-input nums"
                        min={1}
                        max={180}
                        value={form.ntfy_offset_min}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            ntfy_offset_min: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>
                </>
              )}
            </div>

            <div className="dialog-foot">
              <button
                type="button"
                className="btn"
                onClick={() => setDialogOpen(false)}
                disabled={busy}
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="btn btn-live"
                disabled={!isOnline || busy}
              >
                حفظ الفترة
              </button>
            </div>
          </form>
        )}
      </AppDialog>

      <DeleteConfirmDialog
        target={deleteConfirm}
        busy={busy}
        error={deleteError}
        onClose={() => {
          setDeleteConfirm(null);
          setDeleteError(null);
        }}
        onArchiveInstead={() => {
          void handleArchiveFromDeleteDialog();
        }}
        onConfirmForceDelete={() => {
          void handleConfirmForceDelete();
        }}
      />
    </div>
  );
}

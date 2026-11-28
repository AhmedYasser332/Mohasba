'use client';

import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AR_STRINGS,
  countOpenQadaaForAction,
  resolveActiveTargetVersion,
  type Action,
  type AnalyticsRole,
  type NtfyMode,
  type Period,
  type PeriodSide,
  type PrayerAnchor,
} from '@/domain';
import { useMohasba } from '../store/mohasba-provider';
import { AppDialog } from './app-dialog';
import {
  IconArchive,
  IconCross,
  IconExpiredAlert,
  IconRefresh,
  IconTarget,
  IconTrash,
} from './icons';
import {
  DeleteConfirmDialog,
  type DeleteConfirmState,
} from './settings/delete-confirm-dialog';
import { TargetEvolutionDialog } from './settings/target-evolution-dialog';

const WEEKDAY_OPTIONS: ReadonlyArray<{ day: number; label: string }> = [
  { day: 6, label: 'السبت' },
  { day: 0, label: 'الأحد' },
  { day: 1, label: 'الاثنين' },
  { day: 2, label: 'الثلاثاء' },
  { day: 3, label: 'الأربعاء' },
  { day: 4, label: 'الخميس' },
  { day: 5, label: 'الجمعة' },
];

const ANCHOR_LABELS: ReadonlyArray<{ value: PrayerAnchor; label: string }> = [
  { value: 'FAJR', label: 'الفجر' },
  { value: 'SUNRISE', label: 'الشروق' },
  { value: 'DHUHR', label: 'الظهر' },
  { value: 'ASR', label: 'العصر' },
  { value: 'MAGHRIB', label: 'المغرب' },
  { value: 'ISHA', label: 'العشاء' },
  { value: 'FIXED_TIME', label: 'وقت ثابت' },
];

export interface QuickActionEditDialogProps {
  action: Action | null;
  onClose: () => void;
}

export interface QuickPeriodEditDialogProps {
  period: Period | null;
  onClose: () => void;
}

export interface EntityContextMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface EntityContextMenuProps {
  position: { x: number; y: number } | null;
  title?: string;
  items: readonly EntityContextMenuItem[];
  onClose: () => void;
}

interface ActionEditFormState {
  title: string;
  period_id: string;
  bound_time_period_id: string;
  default_disabled_days: number[];
  include_in_normal_day_preset: boolean;
  is_mosque_action: boolean;
  is_qadaa_eligible: boolean;
  supports_percentage: boolean;
  analytics_role: AnalyticsRole;
}

function QuickActionEditContent({
  action,
  onClose,
}: {
  action: Action;
  onClose: () => void;
}) {
  const {
    periods,
    logs,
    targetVersions,
    isOnline,
    todayIslamicDate,
    updateAction,
    deleteAction,
  } = useMohasba();

  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evolveOpen, setEvolveOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [form, setForm] = useState<ActionEditFormState>(() => ({
    title: action.title,
    period_id: action.period_id,
    bound_time_period_id: action.bound_time_period_id ?? '',
    default_disabled_days: [...action.default_disabled_days],
    include_in_normal_day_preset: action.include_in_normal_day_preset,
    is_mosque_action: action.is_mosque_action,
    is_qadaa_eligible: action.is_qadaa_eligible,
    supports_percentage: action.supports_percentage,
    analytics_role: action.analytics_role,
  }));

  const effectiveToday =
    todayIslamicDate ?? new Date().toISOString().slice(0, 10);

  const sortedPeriods = useMemo(
    () =>
      [...periods]
        .filter((p) => p.archived_at === null || p.id === action.period_id)
        .sort((a, b) => a.sort_order - b.sort_order),
    [action.period_id, periods],
  );

  const timeBoundPeriods = useMemo(
    () =>
      sortedPeriods.filter(
        (p) => p.side === 'TIME_BOUND' && p.archived_at === null,
      ),
    [sortedPeriods],
  );

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === form.period_id) ?? null,
    [form.period_id, periods],
  );

  const activeTarget = useMemo(
    () => resolveActiveTargetVersion(targetVersions, action.id, effectiveToday),
    [action.id, effectiveToday, targetVersions],
  );

  const liveQadaaWarningCount = useMemo(() => {
    if (!action.is_qadaa_eligible || form.is_qadaa_eligible) return 0;
    return countOpenQadaaForAction(action.id, logs, effectiveToday, action);
  }, [action, effectiveToday, form.is_qadaa_eligible, logs]);

  const toggleDisabledDay = (day: number) => {
    setForm((prev) => {
      const exists = prev.default_disabled_days.includes(day);
      return {
        ...prev,
        default_disabled_days: exists
          ? prev.default_disabled_days.filter((d) => d !== day)
          : [...prev.default_disabled_days, day],
      };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || busy || !form.title.trim() || !form.period_id) return;

    setBusy(true);
    setError(null);
    try {
      const boundId =
        selectedPeriod?.side === 'DAILY_GROUP' && form.bound_time_period_id
          ? form.bound_time_period_id
          : null;

      const res = await updateAction(action.id, {
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
        onClose();
      } else {
        setError(res.errorMessage ?? 'تعذر تحديث العمل.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!isOnline || busy) return;
    setBusy(true);
    setError(null);
    try {
      const isArchived = action.archived_at !== null;
      const res = await updateAction(action.id, {
        archived_at: isArchived ? null : effectiveToday,
      });
      if (res.ok) {
        onClose();
      } else {
        setError(res.errorMessage ?? 'تعذر تغيير حالة الأرشفة.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRequestDelete = async () => {
    if (!isOnline || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteAction(action.id, { force: false });
      if (res.ok) {
        onClose();
        return;
      }
      if (res.errorCode === 'HAS_HISTORY') {
        const logCount = Number(res.errorDetails?.log_count ?? 0);
        setDeleteError(null);
        setDeleteConfirm({
          entityType: 'action',
          id: action.id,
          title: action.title,
          isArchived: action.archived_at !== null,
          actionCount: 0,
          logCount,
        });
        return;
      }
      setError(res.errorMessage ?? 'تعذر حذف العمل.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmForceDelete = async () => {
    if (!deleteConfirm || !isOnline || busy) return;
    setBusy(true);
    setDeleteError(null);
    try {
      const res = await deleteAction(deleteConfirm.id, { force: true });
      if (res.ok) {
        setDeleteConfirm(null);
        onClose();
      } else {
        setDeleteError(res.errorMessage ?? 'تعذر حذف العمل.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveFromDeleteDialog = async () => {
    setDeleteConfirm(null);
    if (action.archived_at === null) {
      await handleToggleArchive();
    }
  };

  const isArchived = action.archived_at !== null;

  return (
    <>
      <AppDialog
        open={true}
        onRequestClose={onClose}
        canDismiss={!busy && !deleteConfirm && !evolveOpen}
        className="app-dialog dialog-wide"
        data-testid="quick-action-edit-dialog"
        aria-labelledby={titleId}
      >
        <form
          onSubmit={(e) => {
            void handleSave(e);
          }}
        >
          <div className="dialog-head">
            <h2 className="dialog-title" id={titleId}>
              تعديل العمل: {action.title}
            </h2>
            <button
              type="button"
              className="btn btn-icon"
              aria-label="إغلاق"
              disabled={busy}
              onClick={onClose}
            >
              <IconCross size="sm" />
            </button>
          </div>

          <div className="dialog-body dialog-body-scroll">
            {!isOnline && (
              <div className="status-note" role="status">
                التعديل متاح عند الاتصال بالإنترنت فقط.
              </div>
            )}

            {error && (
              <div className="status-note is-error" role="alert">
                {error}
              </div>
            )}

            <div className="field-grid">
              <label className="field-label">
                <span>اسم العمل</span>
                <input
                  type="text"
                  className="field-input"
                  required
                  maxLength={120}
                  disabled={!isOnline || busy}
                  value={form.title}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                />
              </label>

              <label className="field-label">
                <span>الفترة / المجموعة</span>
                <select
                  className="field-select"
                  disabled={!isOnline || busy}
                  value={form.period_id}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, period_id: e.target.value }))
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
                  disabled={!isOnline || busy}
                  value={form.analytics_role}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      analytics_role: e.target.value as AnalyticsRole,
                    }))
                  }
                >
                  <option value="standard">عادي / سنن وأذكار</option>
                  <option value="core_jamaah">
                    {AR_STRINGS.analytics.coreJamaahLabel}
                  </option>
                  <option value="core_habit">عادة أساسية</option>
                </select>
              </label>

              {selectedPeriod?.side === 'DAILY_GROUP' && (
                <label className="field-label">
                  <span>ربط بفترة صلاة (اختياري)</span>
                  <select
                    className="field-select"
                    disabled={!isOnline || busy}
                    value={form.bound_time_period_id}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        bound_time_period_id: e.target.value,
                      }))
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
            </div>

            <div className="field-grid">
              <label className="check-row">
                <input
                  type="checkbox"
                  disabled={!isOnline || busy}
                  checked={form.is_qadaa_eligible}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      is_qadaa_eligible: e.target.checked,
                    }))
                  }
                />
                <span>قابل للقضاء عند الفوات</span>
              </label>

              <label className="check-row">
                <input
                  type="checkbox"
                  disabled={!isOnline || busy}
                  checked={form.supports_percentage}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      supports_percentage: e.target.checked,
                    }))
                  }
                />
                <span>يدعم تسجيل نسبة مئوية</span>
              </label>

              <label className="check-row">
                <input
                  type="checkbox"
                  disabled={!isOnline || busy}
                  checked={form.is_mosque_action}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      is_mosque_action: e.target.checked,
                    }))
                  }
                />
                <span>ضمن زر تم ما في المسجد</span>
              </label>

              <label className="check-row">
                <input
                  type="checkbox"
                  disabled={!isOnline || busy}
                  checked={form.include_in_normal_day_preset}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      include_in_normal_day_preset: e.target.checked,
                    }))
                  }
                />
                <span>ضمن زر يوم اعتيادي</span>
              </label>
            </div>

            {liveQadaaWarningCount > 0 && (
              <div className="confirm-banner" role="alert">
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
                      disabled={!isOnline || busy}
                      onClick={() => toggleDisabledDay(opt.day)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="quick-edit-target-row">
              <div className="quick-edit-target-info">
                <span className="panel-meta">الهدف الحالي:</span>{' '}
                <strong className="nums">
                  {activeTarget ? activeTarget.target_label : 'غير محدد'}
                </strong>
              </div>
              <button
                type="button"
                className="btn"
                disabled={!isOnline || busy}
                onClick={() => setEvolveOpen(true)}
              >
                <IconTarget size="sm" />
                <span>{AR_STRINGS.settings.evolveTargetAction}</span>
              </button>
            </div>
          </div>

          <div className="dialog-foot quick-edit-dialog-foot">
            <div className="quick-edit-danger-group">
              <button
                type="button"
                className="btn"
                disabled={!isOnline || busy}
                onClick={() => {
                  void handleToggleArchive();
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
              <button
                type="button"
                className="btn btn-danger"
                disabled={!isOnline || busy}
                onClick={() => {
                  void handleRequestDelete();
                }}
              >
                <IconTrash size="sm" />
                <span>حذف نهائي</span>
              </button>
            </div>

            <div className="quick-edit-primary-group">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={onClose}
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="btn btn-live"
                data-testid="quick-action-edit-save"
                disabled={!isOnline || busy || !form.title.trim()}
              >
                حفظ التعديلات
              </button>
            </div>
          </div>
        </form>
      </AppDialog>

      <TargetEvolutionDialog
        action={evolveOpen ? action : null}
        onClose={() => setEvolveOpen(false)}
      />

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
    </>
  );
}

export function QuickActionEditDialog({
  action,
  onClose,
}: QuickActionEditDialogProps): React.JSX.Element | null {
  if (!action) return null;
  return (
    <QuickActionEditContent key={action.id} action={action} onClose={onClose} />
  );
}

interface PeriodEditFormState {
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

function QuickPeriodEditContent({
  period,
  onClose,
}: {
  period: Period;
  onClose: () => void;
}) {
  const { isOnline, todayIslamicDate, updatePeriod, deletePeriod } =
    useMohasba();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [form, setForm] = useState<PeriodEditFormState>(() => ({
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
  }));

  const effectiveToday =
    todayIslamicDate ?? new Date().toISOString().slice(0, 10);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || busy || !form.title.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const isTimeBound = form.side === 'TIME_BOUND';
      const res = await updatePeriod(period.id, {
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
      });

      if (res.ok) {
        onClose();
      } else {
        setError(res.errorMessage ?? 'تعذر حفظ الفترة.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!isOnline || busy) return;
    setBusy(true);
    setError(null);
    try {
      const isArchived = period.archived_at !== null;
      const res = await updatePeriod(period.id, {
        archived_at: isArchived ? null : effectiveToday,
      });
      if (res.ok) {
        onClose();
      } else {
        setError(res.errorMessage ?? 'تعذر تغيير حالة الأرشفة.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRequestDelete = async () => {
    if (!isOnline || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deletePeriod(period.id, { force: false });
      if (res.ok) {
        onClose();
        return;
      }
      if (res.errorCode === 'HAS_HISTORY' || res.errorCode === 'HAS_CHILDREN') {
        setDeleteError(null);
        setDeleteConfirm({
          entityType: 'period',
          id: period.id,
          title: period.title,
          isArchived: period.archived_at !== null,
          actionCount: Number(res.errorDetails?.action_count ?? 0),
          logCount: Number(res.errorDetails?.log_count ?? 0),
          boundActionCount: Number(res.errorDetails?.bound_action_count ?? 0),
        });
        return;
      }
      setError(res.errorMessage ?? 'تعذر حذف الفترة.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmForceDelete = async () => {
    if (!deleteConfirm || !isOnline || busy) return;
    setBusy(true);
    setDeleteError(null);
    try {
      const res = await deletePeriod(deleteConfirm.id, { force: true });
      if (res.ok) {
        setDeleteConfirm(null);
        onClose();
      } else {
        setDeleteError(res.errorMessage ?? 'تعذر حذف الفترة.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveFromDeleteDialog = async () => {
    setDeleteConfirm(null);
    if (period.archived_at === null) {
      await handleToggleArchive();
    }
  };

  const isArchived = period.archived_at !== null;

  return (
    <>
      <AppDialog
        open={true}
        onRequestClose={onClose}
        canDismiss={!busy && !deleteConfirm}
        className="app-dialog dialog-wide"
        data-testid="quick-period-edit-dialog"
        aria-labelledby={titleId}
      >
        <form
          onSubmit={(e) => {
            void handleSave(e);
          }}
        >
          <div className="dialog-head">
            <h2 className="dialog-title" id={titleId}>
              تعديل الفترة: {period.title}
            </h2>
            <button
              type="button"
              className="btn btn-icon"
              aria-label="إغلاق"
              disabled={busy}
              onClick={onClose}
            >
              <IconCross size="sm" />
            </button>
          </div>

          <div className="dialog-body dialog-body-scroll">
            {!isOnline && (
              <div className="status-note" role="status">
                التعديل متاح عند الاتصال بالإنترنت فقط.
              </div>
            )}

            {error && (
              <div className="status-note is-error" role="alert">
                {error}
              </div>
            )}

            <div className="field-grid">
              <label className="field-label">
                <span>اسم الفترة</span>
                <input
                  type="text"
                  className="field-input"
                  required
                  maxLength={80}
                  disabled={!isOnline || busy}
                  value={form.title}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                />
              </label>

              <label className="field-label">
                <span>النوع</span>
                <select className="field-select" disabled value={form.side}>
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
                      disabled={!isOnline || busy}
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
                      disabled={!isOnline || busy}
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
                        disabled={!isOnline || busy}
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
                      disabled={!isOnline || busy}
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
                      disabled={!isOnline || busy}
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
                        disabled={!isOnline || busy}
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
                      disabled={!isOnline || busy}
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
                      disabled={!isOnline || busy}
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
                      disabled={!isOnline || busy}
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

          <div className="dialog-foot quick-edit-dialog-foot">
            <div className="quick-edit-danger-group">
              <button
                type="button"
                className="btn"
                disabled={!isOnline || busy}
                onClick={() => {
                  void handleToggleArchive();
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
              <button
                type="button"
                className="btn btn-danger"
                disabled={!isOnline || busy}
                onClick={() => {
                  void handleRequestDelete();
                }}
              >
                <IconTrash size="sm" />
                <span>حذف نهائي</span>
              </button>
            </div>

            <div className="quick-edit-primary-group">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={onClose}
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="btn btn-live"
                data-testid="quick-period-edit-save"
                disabled={!isOnline || busy || !form.title.trim()}
              >
                حفظ الفترة
              </button>
            </div>
          </div>
        </form>
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
    </>
  );
}

export function QuickPeriodEditDialog({
  period,
  onClose,
}: QuickPeriodEditDialogProps): React.JSX.Element | null {
  if (!period) return null;
  return (
    <QuickPeriodEditContent key={period.id} period={period} onClose={onClose} />
  );
}

export function EntityContextMenu({
  position,
  title,
  items,
  onClose,
}: EntityContextMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !position) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const preferredX =
      position.x - rect.width >= margin ? position.x - rect.width : position.x;
    const clampedX = Math.max(
      margin,
      Math.min(preferredX, vw - rect.width - margin),
    );
    const preferredY =
      position.y + rect.height <= vh - margin
        ? position.y
        : position.y - rect.height;
    const clampedY = Math.max(
      margin,
      Math.min(preferredY, vh - rect.height - margin),
    );
    el.style.left = `${clampedX}px`;
    el.style.top = `${clampedY}px`;
  }, [position, items.length, title]);

  useEffect(() => {
    if (!position) return;
    const firstEnabled = menuRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    firstEnabled?.focus();

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    const onScroll = () => onCloseRef.current();
    const onBlur = () => onCloseRef.current();

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [position]);

  if (!position || items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={title ?? 'خيارات'}
      className="week-context-menu entity-context-menu"
      data-testid="entity-context-menu"
      style={{
        left: `${Math.max(8, position.x - 196)}px`,
        top: `${Math.max(8, position.y)}px`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const enabledButtons = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled)',
          ),
        );
        if (enabledButtons.length === 0) return;
        const currentIdx = enabledButtons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = enabledButtons[(currentIdx + 1) % enabledButtons.length];
          next?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev =
            enabledButtons[
              (currentIdx - 1 + enabledButtons.length) % enabledButtons.length
            ];
          prev?.focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          enabledButtons[0]?.focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          enabledButtons[enabledButtons.length - 1]?.focus();
        } else if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {title && <div className="entity-context-menu-title">{title}</div>}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={`week-context-menu-item ${item.danger ? 'is-missed' : ''}`}
          data-testid={`entity-menu-item-${item.id}`}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onSelect();
          }}
        >
          <span className="week-context-menu-item-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

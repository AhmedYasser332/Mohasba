'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AR_STRINGS,
  isTargetVersionReferenced,
  makeCellKey,
  suggestEvolutionEffectiveDate,
  type Action,
  type TargetDirection,
  type TargetVersion,
} from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { IconCross, IconEdit, IconTrash } from '../icons';

interface TargetEvolutionDialogProps {
  action: Action | null;
  onClose: () => void;
  onChanged?: (message: string) => void;
}

const DIRECTION_LABELS: Record<TargetDirection, string> = {
  level_up: AR_STRINGS.settings.directionLevelUp,
  step_down: AR_STRINGS.settings.directionStepDown,
  adjustment: AR_STRINGS.settings.directionAdjustment,
};

function TargetEvolutionContent({
  action,
  onClose,
  onChanged,
}: {
  action: Action;
  onClose: () => void;
  onChanged?: (message: string) => void;
}) {
  const {
    isOnline,
    todayIslamicDate,
    logs,
    logsByKey,
    targetVersions,
    createTargetVersion,
    updateTargetVersion,
    deleteTargetVersion,
  } = useMohasba();

  const effectiveToday =
    todayIslamicDate ?? new Date().toISOString().slice(0, 10);

  const todayLog = logsByKey.get(makeCellKey(action.id, effectiveToday));
  const suggestedDate = useMemo(
    () => suggestEvolutionEffectiveDate(todayLog, effectiveToday),
    [effectiveToday, todayLog],
  );
  const isDeferredToTomorrow = suggestedDate !== effectiveToday;

  const versions = useMemo(() => {
    return targetVersions
      .filter((v) => v.action_id === action.id)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  }, [action.id, targetVersions]);

  const latestVersion =
    versions.length > 0 ? versions[versions.length - 1]! : null;

  const [effectiveFrom, setEffectiveFrom] = useState(suggestedDate);
  const [targetLabel, setTargetLabel] = useState('');
  const [direction, setDirection] = useState<TargetDirection>('level_up');
  const [targetValue, setTargetValue] = useState('');
  const [targetUnit, setTargetUnit] = useState('');

  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  const startEditVersion = (ver: TargetVersion) => {
    setEditingVersionId(ver.id);
    setEffectiveFrom(ver.effective_from);
    setTargetLabel(ver.target_label);
    setDirection(ver.direction);
    setTargetValue(ver.target_value !== null ? String(ver.target_value) : '');
    setTargetUnit(ver.target_unit ?? '');
    setFeedback(null);
  };

  const resetToCreate = () => {
    setEditingVersionId(null);
    setEffectiveFrom(suggestedDate);
    setTargetLabel('');
    setDirection('level_up');
    setTargetValue('');
    setTargetUnit('');
    setFeedback(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || busy || !targetLabel.trim()) return;

    const parsedVal = targetValue.trim() ? Number(targetValue.trim()) : null;
    if (parsedVal !== null && (!Number.isFinite(parsedVal) || parsedVal <= 0)) {
      setFeedback({
        text: 'القيمة الرقمية للهدف يجب أن تكون موجبة.',
        isError: true,
      });
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      const payload = {
        effective_from: effectiveFrom,
        target_label: targetLabel.trim(),
        direction,
        target_value: parsedVal,
        target_unit: targetUnit.trim() ? targetUnit.trim() : null,
      };

      const res = editingVersionId
        ? await updateTargetVersion(editingVersionId, payload)
        : await createTargetVersion({
            action_id: action.id,
            ...payload,
          });

      if (res.ok) {
        const msg = editingVersionId
          ? `تم تعديل نسخة الهدف: ${payload.target_label}`
          : `تم تطوير الهدف إلى: ${payload.target_label}`;
        onChanged?.(msg);
        onClose();
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر حفظ نسخة الهدف.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (ver: TargetVersion) => {
    if (!isOnline || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await deleteTargetVersion(ver.id);
      if (res.ok) {
        if (editingVersionId === ver.id) {
          resetToCreate();
        }
        setFeedback({
          text: `تم حذف النسخة: ${ver.target_label}`,
          isError: false,
        });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر حذف النسخة.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    >
      <div className="dialog-head">
        <h3 className="dialog-title" id="evolve-target-title">
          {AR_STRINGS.settings.evolveTargetModalTitle}: {action.title}
        </h3>
        <button
          type="button"
          className="btn btn-icon"
          aria-label="إغلاق"
          onClick={onClose}
        >
          <IconCross size="sm" />
        </button>
      </div>

      <div className="dialog-body dialog-body-scroll">
        {latestVersion && (
          <div className="panel-meta nums">
            الهدف الحالي: <strong>{latestVersion.target_label}</strong> (من{' '}
            {latestVersion.effective_from})
          </div>
        )}

        <div className="notice-bar">
          <span className="nums">
            {isDeferredToTomorrow
              ? `خلية اليوم (${effectiveToday}) مسجّلة بالفعل، لذا يبدأ الهدف الجديد افتراضياً من الغد (${suggestedDate}) لحماية سجل اليوم.`
              : `خلية اليوم (${effectiveToday}) فارغة، لذا يبدأ الهدف الجديد افتراضياً من اليوم (${suggestedDate}).`}
          </span>
        </div>

        {feedback && (
          <div className={`status-note ${feedback.isError ? 'is-error' : ''}`}>
            {feedback.text}
          </div>
        )}

        <div className="field-grid">
          <label className="field-label">
            <span>الهدف الجديد</span>
            <input
              type="text"
              className="field-input"
              data-testid="evolve-target-label-input"
              required
              maxLength={80}
              placeholder="مثال: 20 صفحة"
              value={targetLabel}
              onChange={(e) => setTargetLabel(e.target.value)}
            />
          </label>

          <label className="field-label">
            <span>{AR_STRINGS.settings.effectiveFromLabel}</span>
            <input
              type="date"
              className="field-input nums"
              data-testid="evolve-effective-from-input"
              required
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
        </div>

        <div className="field-grid-3">
          <label className="field-label">
            <span>نوع التغيير</span>
            <select
              className="field-select"
              data-testid="evolve-direction-select"
              value={direction}
              onChange={(e) => setDirection(e.target.value as TargetDirection)}
            >
              <option value="level_up">
                {AR_STRINGS.settings.directionLevelUp}
              </option>
              <option value="step_down">
                {AR_STRINGS.settings.directionStepDown}
              </option>
              <option value="adjustment">
                {AR_STRINGS.settings.directionAdjustment}
              </option>
            </select>
          </label>

          <label className="field-label">
            <span>قيمة رقمية (اختياري)</span>
            <input
              type="number"
              className="field-input nums"
              step="any"
              min="0.01"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
            />
          </label>

          <label className="field-label">
            <span>الوحدة (اختياري)</span>
            <input
              type="text"
              className="field-input"
              maxLength={32}
              placeholder="صفحة"
              value={targetUnit}
              onChange={(e) => setTargetUnit(e.target.value)}
            />
          </label>
        </div>

        {editingVersionId && (
          <div>
            <button type="button" className="btn" onClick={resetToCreate}>
              إلغاء تعديل النسخة والعودة لإضافة نسخة جديدة
            </button>
          </div>
        )}

        {/* Version History */}
        <div className="panel">
          <div className="panel-header">
            <strong className="text-xs">سجل نسخ الهدف</strong>
            <span className="panel-meta nums">{versions.length}</span>
          </div>
          {versions.length === 0 ? (
            <div className="p-3 panel-meta">
              لا توجد نسخ أهداف مسجّلة لهذا العمل بعد.
            </div>
          ) : (
            <div className="action-list">
              {versions.map((ver) => {
                const referenced = isTargetVersionReferenced(ver.id, logs);
                return (
                  <div
                    key={ver.id}
                    className="schema-item-row"
                    data-testid={`target-version-row-${ver.id}`}
                  >
                    <div className="schema-item-main">
                      <div className="action-title-line">
                        <strong>{ver.target_label}</strong>
                        <span className="target-tag">
                          {DIRECTION_LABELS[ver.direction]}
                        </span>
                        {referenced && (
                          <span className="target-tag">مرتبط بسجلات</span>
                        )}
                      </div>
                      <div className="schema-item-meta nums">
                        <span>من {ver.effective_from}</span>
                      </div>
                    </div>

                    {!referenced && (
                      <div className="schema-item-actions">
                        <button
                          type="button"
                          className="btn"
                          disabled={!isOnline || busy}
                          onClick={() => startEditVersion(ver)}
                        >
                          <IconEdit size="sm" />
                          <span>تعديل</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={!isOnline || busy}
                          onClick={() => {
                            void handleDelete(ver);
                          }}
                        >
                          <IconTrash size="sm" />
                          <span>حذف</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="dialog-foot">
        <button
          type="button"
          className="btn"
          onClick={onClose}
          disabled={busy}
        >
          إلغاء
        </button>
        <button
          type="submit"
          className="btn btn-live"
          data-testid="evolve-target-save"
          disabled={!isOnline || busy}
        >
          {editingVersionId ? 'حفظ تعديل النسخة' : 'حفظ الهدف الجديد'}
        </button>
      </div>
    </form>
  );
}

export function TargetEvolutionDialog({
  action,
  onClose,
  onChanged,
}: TargetEvolutionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (action) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [action]);

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog dialog-wide"
      aria-labelledby="evolve-target-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      onClose={onClose}
    >
      {action && (
        <TargetEvolutionContent
          key={action.id}
          action={action}
          onClose={onClose}
          onChanged={onChanged}
        />
      )}
    </dialog>
  );
}

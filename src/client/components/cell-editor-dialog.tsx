'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AR_STRINGS,
  getIsoDayOfWeek,
  makeCellKey,
  resolveActiveTargetVersion,
  resolveCellAvailability,
  type Action,
  type AvailabilityOverride,
  type CellStatus,
  type TargetVersion,
} from '@/domain';
import type { LocalDailyLog } from '../db/idb';
import { useMohasba } from '../store/mohasba-provider';
import { formatArabicDateFull } from './cell-display';
import { IconCheck, IconCross, IconDash, IconQadaa } from './icons';

export interface CellEditorTarget {
  action: Action;
  logDate: string;
}

interface CellEditorDialogProps {
  target: CellEditorTarget | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

type EditorChoice =
  | 'DONE'
  | 'MISSED'
  | 'QADAA_DONE'
  | 'PERCENT'
  | 'DISABLED'
  | 'EMPTY';

const PERCENT_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

interface CellEditorContentProps {
  target: CellEditorTarget;
  existingLog: LocalDailyLog | undefined;
  historicalTarget: TargetVersion | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function CellEditorContent({
  target,
  existingLog,
  historicalTarget,
  onClose,
  onSaved,
}: CellEditorContentProps) {
  const { logCellTap } = useMohasba();

  const isDefaultOff = useMemo(() => {
    const dow = getIsoDayOfWeek(target.logDate);
    return target.action.default_disabled_days.includes(dow);
  }, [target]);

  const initialChoice = useMemo<EditorChoice>(() => {
    const availability = resolveCellAvailability(
      target.action,
      existingLog,
      target.logDate,
    );
    if (!availability.isEnabled) return 'DISABLED';
    if (existingLog?.status) return existingLog.status;
    return 'EMPTY';
  }, [existingLog, target]);

  const [choice, setChoice] = useState<EditorChoice>(initialChoice);
  const [percentVal, setPercentVal] = useState<number>(
    existingLog?.status === 'PERCENT' && existingLog.percent_value
      ? existingLog.percent_value
      : 50,
  );
  const [note, setNote] = useState<string>(existingLog?.note ?? '');
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasExistingLoggedStatus = existingLog?.status != null;

  const handleSelectChoice = (next: EditorChoice) => {
    setChoice(next);
    if (next !== 'DISABLED') {
      setConfirmDisableOpen(false);
    }
  };

  const commitSave = async () => {
    if (saving) return;

    if (
      choice === 'DISABLED' &&
      hasExistingLoggedStatus &&
      !confirmDisableOpen
    ) {
      setConfirmDisableOpen(true);
      return;
    }

    setSaving(true);
    try {
      let availabilityOverride: AvailabilityOverride | null = null;
      let status: CellStatus | null = null;
      let pct: number | null = null;

      if (choice === 'DISABLED') {
        availabilityOverride = 'DISABLED';
        status = null;
      } else if (choice === 'EMPTY') {
        availabilityOverride = isDefaultOff ? 'ENABLED' : null;
        status = null;
      } else if (choice === 'PERCENT') {
        availabilityOverride = isDefaultOff ? 'ENABLED' : null;
        if (percentVal >= 100) {
          status = 'DONE';
          pct = null;
        } else if (percentVal <= 0) {
          status = 'MISSED';
          pct = null;
        } else {
          status = 'PERCENT';
          pct = percentVal;
        }
      } else {
        availabilityOverride = isDefaultOff ? 'ENABLED' : null;
        status = choice;
      }

      const trimmedNote = note.trim();
      const nextNote = trimmedNote.length > 0 ? trimmedNote : null;
      const prevNote = existingLog?.note ?? null;
      const noteUpdatedAt =
        nextNote !== prevNote
          ? new Date().toISOString()
          : (existingLog?.note_updated_at ?? null);

      await logCellTap({
        action: target.action,
        logDate: target.logDate,
        availability_override: availabilityOverride,
        status,
        percent_value: pct,
        clientTargetVersionId: historicalTarget?.id ?? null,
        note: nextNote,
        note_updated_at: noteUpdatedAt,
      });

      onSaved(`تم حفظ تعديل ${target.action.title}`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="dialog-head">
        <h3 className="dialog-title" id="cell-editor-title">
          {target.action.title} ({formatArabicDateFull(target.logDate)})
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

      <div className="dialog-body">
        {historicalTarget && (
          <div className="panel-meta nums">
            الهدف الفعال لهذا اليوم:{' '}
            <strong>{historicalTarget.target_label}</strong>
          </div>
        )}

        <div className="state-grid" role="group" aria-label="حالة الخلية">
          <button
            type="button"
            className={`btn ${choice === 'DONE' ? 'btn-live' : ''}`}
            aria-pressed={choice === 'DONE'}
            onClick={() => handleSelectChoice('DONE')}
          >
            <IconCheck size="sm" />
            <span>{AR_STRINGS.statuses.DONE}</span>
          </button>

          <button
            type="button"
            className={`btn ${choice === 'MISSED' ? 'btn-danger' : ''}`}
            aria-pressed={choice === 'MISSED'}
            onClick={() => handleSelectChoice('MISSED')}
          >
            <IconCross size="sm" />
            <span>{AR_STRINGS.statuses.MISSED}</span>
          </button>

          {target.action.is_qadaa_eligible && (
            <button
              type="button"
              className={`btn ${choice === 'QADAA_DONE' ? 'btn-live' : ''}`}
              aria-pressed={choice === 'QADAA_DONE'}
              onClick={() => handleSelectChoice('QADAA_DONE')}
            >
              <IconQadaa size="sm" />
              <span>{AR_STRINGS.statuses.QADAA_DONE}</span>
            </button>
          )}

          <button
            type="button"
            className={`btn ${choice === 'DISABLED' ? 'btn-primary' : ''}`}
            aria-pressed={choice === 'DISABLED'}
            onClick={() => handleSelectChoice('DISABLED')}
          >
            <IconDash size="sm" />
            <span>معذور / تعطيل اليوم</span>
          </button>

          <button
            type="button"
            className={`btn ${choice === 'EMPTY' ? 'btn-primary' : ''}`}
            aria-pressed={choice === 'EMPTY'}
            onClick={() => handleSelectChoice('EMPTY')}
          >
            <span>
              {isDefaultOff
                ? 'تفعيل هذا اليوم (فارغ)'
                : 'مسح الحالة (فارغ)'}
            </span>
          </button>
        </div>

        {target.action.supports_percentage && (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center justify-between gap-2">
              <span>تحديد نسبة مئوية (خطوات 10%)</span>
              <strong className="nums">
                {choice === 'PERCENT'
                  ? `${percentVal}%`
                  : choice === 'DONE'
                    ? '100%'
                    : choice === 'MISSED'
                      ? '0%'
                      : 'غير محدد'}
              </strong>
            </div>

            <input
              type="range"
              min={0}
              max={100}
              step={10}
              aria-label="نسبة الإنجاز"
              value={
                choice === 'DONE'
                  ? 100
                  : choice === 'MISSED'
                    ? 0
                    : choice === 'PERCENT'
                      ? percentVal
                      : 50
              }
              onChange={(e) => {
                const next = Number(e.target.value);
                if (next >= 100) {
                  handleSelectChoice('DONE');
                } else if (next <= 0) {
                  handleSelectChoice('MISSED');
                } else {
                  setPercentVal(next);
                  handleSelectChoice('PERCENT');
                }
              }}
              style={{ accentColor: 'var(--accent-live)' }}
            />

            <div className="pct-steps-grid">
              {PERCENT_STEPS.map((step) => {
                const isSelected =
                  choice === 'PERCENT' && percentVal === step;
                return (
                  <button
                    key={step}
                    type="button"
                    className={`pct-chip nums ${isSelected ? 'selected-pct' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setPercentVal(step);
                      handleSelectChoice('PERCENT');
                    }}
                  >
                    {step}%
                  </button>
                );
              })}
              <button
                type="button"
                className={`pct-chip nums ${choice === 'DONE' ? 'selected-done' : ''}`}
                aria-pressed={choice === 'DONE'}
                onClick={() => handleSelectChoice('DONE')}
              >
                100%
              </button>
            </div>
          </div>
        )}

        {confirmDisableOpen && (
          <div className="confirm-banner" role="alert">
            <span>
              هذا اليوم مسجّل بالفعل. تعطيل اليوم سيمسح الحالة المسجلة
              ويستبعد الخلية من الإحصائيات.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void commitSave();
                }}
                disabled={saving}
              >
                تأكيد التعطيل
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmDisableOpen(false)}
              >
                تراجع عن التعطيل
              </button>
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span>ملاحظة اختيارية</span>
          <textarea
            className="field-textarea"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={AR_STRINGS.street.notePlaceholder}
          />
        </label>
      </div>

      <div className="dialog-foot">
        <button
          type="button"
          className="btn"
          onClick={onClose}
          disabled={saving}
        >
          {AR_STRINGS.week.cancel}
        </button>
        <button
          type="button"
          className="btn btn-live"
          data-testid="cell-editor-save"
          onClick={() => {
            void commitSave();
          }}
          disabled={saving}
        >
          {AR_STRINGS.week.saveChanges}
        </button>
      </div>
    </>
  );
}

export function CellEditorDialog({
  target,
  onClose,
  onSaved,
}: CellEditorDialogProps) {
  const { logsByKey, targetVersions } = useMohasba();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const existingLog: LocalDailyLog | undefined = useMemo(() => {
    if (!target) return undefined;
    return logsByKey.get(makeCellKey(target.action.id, target.logDate));
  }, [logsByKey, target]);

  const historicalTarget: TargetVersion | null = useMemo(() => {
    if (!target) return null;
    if (existingLog?.target_version_id) {
      const exact = targetVersions.find(
        (v) =>
          v.id === existingLog.target_version_id &&
          v.action_id === target.action.id,
      );
      if (exact) return exact;
    }
    return resolveActiveTargetVersion(
      targetVersions,
      target.action.id,
      target.logDate,
    );
  }, [existingLog, target, targetVersions]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [target]);

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      aria-labelledby="cell-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
    >
      {target && (
        <CellEditorContent
          key={`${target.action.id}::${target.logDate}`}
          target={target}
          existingLog={existingLog}
          historicalTarget={historicalTarget}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </dialog>
  );
}

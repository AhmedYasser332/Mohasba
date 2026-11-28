'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  ARABIC_NOUN_FORMS,
  formatArabicCount,
} from '../../utils/arabic-plural';
import {
  IconCheck,
  IconDownload,
  IconExpiredAlert,
  IconTrash,
  IconX,
} from '../icons';

interface WorkspaceResetDialogProps {
  open: boolean;
  busy: boolean;
  exportBusy: boolean;
  error: string | null;
  periodsCount: number;
  actionsCount: number;
  logsCount: number;
  unsyncedCount: number;
  onClose: () => void;
  onDownloadBackup: () => Promise<boolean>;
  onConfirmReset: () => Promise<void>;
}

const CONFIRM_TOKENS = new Set(['تصفير', 'reset']);

export function WorkspaceResetDialog({
  open,
  busy,
  exportBusy,
  error,
  periodsCount,
  actionsCount,
  logsCount,
  unsyncedCount,
  onClose,
  onDownloadBackup,
  onConfirmReset,
}: WorkspaceResetDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const safeActionRef = useRef<HTMLButtonElement | null>(null);
  const pointerDownOutsideRef = useRef(false);
  const titleId = useId();
  const descId = useId();

  const [confirmText, setConfirmText] = useState('');
  const [backupSaved, setBackupSaved] = useState(false);

  const handleClose = () => {
    setConfirmText('');
    setBackupSaved(false);
    onClose();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      safeActionRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  const isOutsideDialog = (e: React.PointerEvent<HTMLDialogElement>): boolean => {
    const dialog = dialogRef.current;
    if (!dialog) return false;
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };

  const confirmMatches = CONFIRM_TOKENS.has(confirmText.trim().toLowerCase());

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      data-testid="workspace-reset-dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) handleClose();
      }}
      onPointerDown={(e) => {
        pointerDownOutsideRef.current = isOutsideDialog(e);
      }}
      onPointerUp={(e) => {
        if (pointerDownOutsideRef.current && isOutsideDialog(e) && !busy) {
          handleClose();
        }
        pointerDownOutsideRef.current = false;
      }}
      onClose={() => {
        if (open && !busy) handleClose();
      }}
    >
      {open && (
        <div>
          <div className="dialog-head">
            <div>
              <h2 id={titleId} className="dialog-title">
                تصفير الجدول والعودة لاختيار المستوى
              </h2>
              <div className="panel-meta mt-0.5">
                إجراء نهائي يعيد فتح شاشة القوالب الـ 3 من البداية
              </div>
            </div>
            <button
              type="button"
              className="btn btn-icon"
              aria-label="إغلاق"
              disabled={busy}
              onClick={handleClose}
            >
              <IconX size="sm" />
            </button>
          </div>

          <div className="dialog-body" id={descId}>
            {error && (
              <div className="status-note is-error" role="alert">
                {error}
              </div>
            )}

            <div className="confirm-banner" role="alert">
              <div className="flex items-start gap-2">
                <IconExpiredAlert size="sm" />
                <span>
                  سيتم مسح{' '}
                  <strong className="nums">
                    {formatArabicCount(periodsCount, ARABIC_NOUN_FORMS.section)}
                  </strong>{' '}
                  و{' '}
                  <strong className="nums">
                    {formatArabicCount(actionsCount, ARABIC_NOUN_FORMS.action)}
                  </strong>{' '}
                  مع جميع السجلات اليومية والأهداف ({logsCount} سجل محلي/محمّل) لإرجاعك لشاشة اختيار المستويات الـ 3.
                </span>
              </div>
              <span className="panel-meta">
                إعدادات المدينة، وقت التجديد، رابط ntfy، والاختصارات تبقى محفوظة كما هي.
              </span>
            </div>

            {unsyncedCount > 0 && (
              <div className="status-note is-error" role="alert">
                لديك {unsyncedCount} تعديل غير متزامن على هذا الجهاز وسيتم مسحها أيضاً عند التصفير.
              </div>
            )}

            <div className="reset-backup-step">
              <span className="pref-heading">
                1. يُنصح بتنزيل نسخة احتياطية قبل التصفير:
              </span>
              <button
                ref={safeActionRef}
                type="button"
                className="btn"
                data-testid="reset-backup-first-btn"
                disabled={busy || exportBusy}
                onClick={() => {
                  void onDownloadBackup().then((ok) => {
                    if (ok) setBackupSaved(true);
                  });
                }}
              >
                {backupSaved ? <IconCheck size="sm" /> : <IconDownload size="sm" />}
                <span>
                  {exportBusy
                    ? 'جاري تنزيل النسخة...'
                    : backupSaved
                      ? 'تم تنزيل النسخة الاحتياطية JSON'
                      : 'تنزيل نسخة احتياطية JSON أولاً'}
                </span>
              </button>
            </div>

            <label className="field-label">
              <span>
                2. اكتب كلمة <strong>تصفير</strong> للتأكيد:
              </span>
              <input
                type="text"
                className="field-input"
                data-testid="reset-confirm-input"
                placeholder="اكتب: تصفير"
                value={confirmText}
                disabled={busy}
                autoComplete="off"
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </label>
          </div>

          <div className="dialog-foot">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={handleClose}
            >
              إلغاء
            </button>
            <button
              type="button"
              className="btn btn-danger"
              data-testid="reset-confirm-submit-btn"
              disabled={busy || !confirmMatches}
              onClick={() => {
                void onConfirmReset().then(() => {
                  setConfirmText('');
                  setBackupSaved(false);
                });
              }}
            >
              <IconTrash size="sm" />
              <span>
                {busy ? 'جاري التصفير...' : 'تصفير والعودة لاختيار المستوى'}
              </span>
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

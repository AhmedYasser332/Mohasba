'use client';

import React, { useId, useRef } from 'react';
import {
  ARABIC_NOUN_FORMS,
  formatArabicCount,
} from '../../utils/arabic-plural';
import { AppDialog } from '../app-dialog';
import { IconArchive, IconExpiredAlert, IconTrash, IconX } from '../icons';

export interface DeleteConfirmState {
  entityType: 'period' | 'action';
  id: string;
  title: string;
  isArchived: boolean;
  actionCount: number;
  logCount: number;
  boundActionCount?: number;
}

interface DeleteConfirmDialogProps {
  target: DeleteConfirmState | null;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onArchiveInstead: () => void;
  onConfirmForceDelete: () => void;
}

/**
 * Smart 2-tier destructive confirmation dialog (native <dialog> + showModal()).
 * Focuses the SAFE action (Archive when history exists, Cancel otherwise) per WCAG / MWG dialog guidance.
 */
export function DeleteConfirmDialog({
  target,
  busy,
  error,
  onClose,
  onArchiveInstead,
  onConfirmForceDelete,
}: DeleteConfirmDialogProps) {
  const safeActionRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const isPeriod = target?.entityType === 'period';
  const hasHistory = (target?.logCount ?? 0) > 0;
  const boundCount = target?.boundActionCount ?? 0;
  const actionCount = target?.actionCount ?? 0;
  const entityWord = isPeriod ? 'الفترة' : 'العمل';
  const logsPossessive = isPeriod ? 'وسجلاتها التاريخية' : 'وسجلاته التاريخية';

  const forceButtonLabel = busy
    ? 'جاري الحذف...'
    : hasHistory
      ? 'حذف نهائي مع كل السجلات'
      : isPeriod
        ? actionCount > 0
          ? 'حذف الفترة والأعمال'
          : 'حذف الفترة وفك الارتباط'
        : 'حذف نهائي';

  return (
    <AppDialog
      open={Boolean(target)}
      onRequestClose={onClose}
      canDismiss={!busy}
      initialFocusRef={safeActionRef}
      className="app-dialog"
      data-testid="delete-confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      {target && (
        <div>
          <div className="dialog-head">
            <div>
              <h2 id={titleId} className="dialog-title">
                {hasHistory
                  ? `تأكيد حذف ${entityWord} ${logsPossessive}`
                  : `تأكيد حذف ${entityWord} نهائياً`}
              </h2>
              <div className="panel-meta mt-0.5">{target.title}</div>
            </div>
            <button
              type="button"
              className="btn btn-icon"
              aria-label="إغلاق"
              disabled={busy}
              onClick={onClose}
            >
              <IconX size="sm" />
            </button>
          </div>

          <div className="dialog-body flex flex-col gap-3">
            <div
              id={descId}
              className="confirm-banner delete-warn-banner"
              role="alert"
            >
              <span className="delete-warn-icon" aria-hidden="true">
                <IconExpiredAlert size="sm" />
              </span>
              <div className="flex flex-col gap-1">
                {hasHistory ? (
                  <>
                    <strong>
                      {isPeriod
                        ? `هذه الفترة تحتوي على ${formatArabicCount(actionCount, ARABIC_NOUN_FORMS.action)} و${formatArabicCount(target.logCount, ARABIC_NOUN_FORMS.logRecord)}.`
                        : `هذا العمل مرتبط بـ ${formatArabicCount(target.logCount, ARABIC_NOUN_FORMS.logRecord)}.`}
                    </strong>
                    <span>
                      {target.isArchived
                        ? `${isPeriod ? 'هذه الفترة مؤرشفة' : 'هذا العمل مؤرشف'} حالياً ويحفظ تاريخك وإحصائياتك. الحذف النهائي سيمسح كل هذه السجلات ولا يمكن التراجع عنه.`
                        : 'نوصي بالأرشفة للحفاظ على تاريخك ونسب الالتزام في التحليلات؛ الحذف النهائي سيمسح كل هذه السجلات ولا يمكن التراجع عنه.'}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>
                      {actionCount > 0 && boundCount > 0
                        ? `هذه الفترة تحتوي على ${formatArabicCount(actionCount, ARABIC_NOUN_FORMS.action)} ومرتبطة بـ ${formatArabicCount(boundCount, ARABIC_NOUN_FORMS.habit)} (بدون سجلات مسجّلة).`
                        : actionCount > 0
                          ? `هذه الفترة تحتوي على ${formatArabicCount(actionCount, ARABIC_NOUN_FORMS.action)} (بدون أي سجلات يومية مسجّلة).`
                          : `هذه الفترة مرتبطة بـ ${formatArabicCount(boundCount, ARABIC_NOUN_FORMS.habit)} سيتم فك ارتباطها الزمني فقط.`}
                    </strong>
                    <span>
                      {actionCount > 0
                        ? 'سيتم حذف الفترة وجميع الأعمال الفارغة بداخلها نهائياً.'
                        : 'سيتم حذف الفترة وفك ارتباط العادات اليومية المرتبطة بها دون حذف تلك العادات.'}
                    </span>
                  </>
                )}
              </div>
            </div>

            {error && (
              <div className="status-note is-error" role="alert">
                {error}
              </div>
            )}
          </div>

          <div className="dialog-foot flex-wrap">
            {hasHistory && !target.isArchived ? (
              <button
                ref={safeActionRef}
                type="button"
                className="btn btn-live"
                data-testid="delete-confirm-archive-btn"
                disabled={busy}
                onClick={onArchiveInstead}
              >
                <IconArchive size="sm" />
                <span>أرشفة (يحفظ تاريخك)</span>
              </button>
            ) : (
              <button
                ref={safeActionRef}
                type="button"
                className="btn"
                data-testid="delete-confirm-cancel-btn"
                disabled={busy}
                onClick={onClose}
              >
                إلغاء
              </button>
            )}

            {hasHistory && !target.isArchived && (
              <button
                type="button"
                className="btn"
                data-testid="delete-confirm-cancel-btn"
                disabled={busy}
                onClick={onClose}
              >
                إلغاء
              </button>
            )}

            {!hasHistory && !target.isArchived && (
              <button
                type="button"
                className="btn"
                data-testid="delete-confirm-archive-btn"
                disabled={busy}
                onClick={onArchiveInstead}
              >
                <IconArchive size="sm" />
                <span>أرشفة بدل الحذف</span>
              </button>
            )}

            <button
              type="button"
              className="btn btn-danger"
              data-testid="delete-confirm-force-btn"
              disabled={busy}
              onClick={onConfirmForceDelete}
            >
              <IconTrash size="sm" />
              <span>{forceButtonLabel}</span>
            </button>
          </div>
        </div>
      )}
    </AppDialog>
  );
}

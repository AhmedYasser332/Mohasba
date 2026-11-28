'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  AR_STRINGS,
  type AuditLogCategory,
  type AuditLogEntry,
  type AuditLogLevel,
  type ExportSnapshot,
} from '@/domain';
import {
  useMohasba,
  type MergeTemplatePayload,
} from '../../store/mohasba-provider';
import {
  IconDownload,
  IconExpiredAlert,
  IconLogOut,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '../icons';
import { TemplateMergeDialog } from './template-merge-dialog';
import { WorkspaceResetDialog } from './workspace-reset-dialog';

interface BackupAuditSectionProps {
  onStatusMessage?: (msg: string) => void;
}

const AUDIT_CATEGORIES: ReadonlyArray<AuditLogCategory> = [
  'SYNC',
  'CRUD',
  'TARGET',
  'CRON',
  'AUTH',
  'EXPORT_IMPORT',
  'SYSTEM',
];

function triggerJsonDownload(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function BackupAuditSection({
  onStatusMessage,
}: BackupAuditSectionProps) {
  const {
    isOnline,
    isIosA2hsPromptVisible,
    periods,
    actions,
    targetVersions,
    logs,
    todayIslamicDate,
    outbox,
    syncBadge,
    buildOfflineExport,
    importBackupChunk,
    mergeTemplate,
    resetWorkspace,
    refreshBootstrap,
    drainBeforeCrud,
    retryAttentionItem,
    discardAttentionItem,
    exportAndDiscardAttentionItem,
    signOut,
  } = useMohasba();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLevel, setAuditLevel] = useState<'' | AuditLogLevel>('');
  const [auditCategory, setAuditCategory] = useState<'' | AuditLogCategory>('');
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const attentionItems = useMemo(
    () => outbox.filter((item) => item.state === 'attention_needed'),
    [outbox],
  );
  const actionsById = useMemo(
    () => new Map(actions.map((a) => [a.id, a])),
    [actions],
  );

  const handleFullOnlineExport = async (): Promise<boolean> => {
    if (!isOnline || exportBusy) return false;
    setExportBusy(true);
    setBackupFeedback(null);
    try {
      await drainBeforeCrud();
      const res = await fetch('/api/export', {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setBackupFeedback({
          text: `تعذر تصدير النسخة الكاملة (HTTP ${res.status}).`,
          isError: true,
        });
        return false;
      }
      const snapshot = (await res.json()) as ExportSnapshot;
      const stamp =
        snapshot.exported_at?.slice(0, 10) ??
        new Date().toISOString().slice(0, 10);
      triggerJsonDownload(`mohasba-backup-${stamp}.json`, snapshot);
      setBackupFeedback({
        text: `تم تصدير النسخة الكاملة (${snapshot.daily_logs.length} سجل).`,
        isError: false,
      });
      return true;
    } catch {
      setBackupFeedback({
        text: 'تعذر الاتصال بالخادم لتصدير النسخة الكاملة.',
        isError: true,
      });
      return false;
    } finally {
      setExportBusy(false);
    }
  };

  const handleConfirmTemplateMerge = async (payload: MergeTemplatePayload) => {
    setMergeBusy(true);
    setMergeError(null);
    try {
      const res = await mergeTemplate(payload);
      if (!res.ok) {
        setMergeError(res.errorMessage ?? 'تعذر دمج أعمال القالب.');
        return;
      }
      const data = res.data as {
        added_actions?: number;
        added_periods?: number;
        skipped_existing_actions?: number;
      };
      const addedActions = data?.added_actions ?? 0;
      const addedPeriods = data?.added_periods ?? 0;
      const skipped = data?.skipped_existing_actions ?? 0;
      const msg =
        addedActions > 0
          ? `تمت إضافة ${addedActions} عملاً جديداً${addedPeriods > 0 ? ` و ${addedPeriods} فترة جديدة` : ''} مع الحفاظ على جميع سجلاتك (تجاهل ${skipped} موجود بالفعل).`
          : 'جميع أعمال هذا القالب موجودة بالفعل في جدولك.';
      setBackupFeedback({ text: msg, isError: false });
      onStatusMessage?.(msg);
      setMergeDialogOpen(false);
    } finally {
      setMergeBusy(false);
    }
  };

  const handleConfirmWorkspaceReset = async () => {
    setResetBusy(true);
    setResetError(null);
    try {
      const res = await resetWorkspace();
      if (!res.ok) {
        setResetError(res.errorMessage ?? 'تعذر تصفير الجدول.');
        return;
      }
      setResetDialogOpen(false);
      onStatusMessage?.('تم تصفير الجدول — اختر المستوى المناسب للبدء من جديد.');
    } finally {
      setResetBusy(false);
    }
  };

  const handleEmergencyExport = async () => {
    const data = await buildOfflineExport();
    triggerJsonDownload(
      `mohasba-emergency-${new Date().toISOString().slice(0, 10)}.json`,
      data,
    );
    setBackupFeedback({
      text: `تم تنزيل نسخة الطوارئ المحلية (${data.daily_logs.length} سجل / ${data.pending_outbox.length} معلق).`,
      isError: false,
    });
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isOnline || importBusy) return;

    setImportBusy(true);
    setBackupFeedback(null);
    setImportProgress('جاري قراءة الملف...');

    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as Partial<ExportSnapshot>;
      if (parsed.schema_version !== 1 || !parsed.settings) {
        setBackupFeedback({
          text: 'ملف النسخة الاحتياطية غير صالح (schema_version !== 1).',
          isError: true,
        });
        return;
      }

      const logs = Array.isArray(parsed.daily_logs) ? parsed.daily_logs : [];
      const firstBatch = logs.slice(0, 200);
      setImportProgress(
        `جاري استيراد البيانات الأساسية (${firstBatch.length} من ${logs.length} سجل)...`,
      );

      const firstRes = await importBackupChunk({
        schema_version: 1,
        settings: {
          ...parsed.settings,
          onboarding_completed: true,
        },
        periods: parsed.periods ?? [],
        actions: parsed.actions ?? [],
        target_versions: parsed.target_versions ?? [],
        daily_logs: firstBatch,
      });

      if (!firstRes.ok) {
        setBackupFeedback({
          text: firstRes.errorMessage ?? 'تعذر استيراد الدفعة الأولى.',
          isError: true,
        });
        return;
      }

      for (let i = 200; i < logs.length; i += 200) {
        const chunk = logs.slice(i, i + 200);
        setImportProgress(
          `جاري استيراد السجلات (${Math.min(i + chunk.length, logs.length)} من ${logs.length})...`,
        );
        const chunkRes = await importBackupChunk({
          schema_version: 1,
          daily_logs: chunk,
        });
        if (!chunkRes.ok) {
          setBackupFeedback({
            text:
              chunkRes.errorMessage ?? 'توقف الاستيراد أثناء معالجة الدفعات.',
            isError: true,
          });
          return;
        }
      }

      await refreshBootstrap({ full: true });
      setBackupFeedback({
        text: `تم الاستيراد بنجاح (${logs.length} سجل).`,
        isError: false,
      });
    } catch {
      setBackupFeedback({
        text: 'تعذر قراءة أو تحليل ملف JSON.',
        isError: true,
      });
    } finally {
      setImportBusy(false);
      setImportProgress(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const fetchAuditLogs = async (
    nextLevel: '' | AuditLogLevel = auditLevel,
    nextCategory: '' | AuditLogCategory = auditCategory,
  ) => {
    if (!isOnline || auditBusy) return;
    setAuditBusy(true);
    setAuditError(null);
    try {
      const params = new URLSearchParams();
      if (nextLevel) params.set('level', nextLevel);
      if (nextCategory) params.set('category', nextCategory);
      params.set('limit', '50');
      const res = await fetch(`/api/audit-logs?${params.toString()}`, {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setAuditError(`تعذر تحميل سجل الأحداث (HTTP ${res.status}).`);
        return;
      }
      const json = (await res.json()) as { audit_logs?: AuditLogEntry[] };
      setAuditLogs(json.audit_logs ?? []);
    } catch {
      setAuditError('تعذر الاتصال بالخادم لقراءة سجل الأحداث.');
    } finally {
      setAuditBusy(false);
    }
  };

  const handleToggleAuditPanel = () => {
    const nextOpen = !auditOpen;
    setAuditOpen(nextOpen);
    if (nextOpen && isOnline) {
      void fetchAuditLogs();
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const res = await signOut();
      if (res.ok) {
        setConfirmSignOut(false);
        onStatusMessage?.('تم تسجيل الخروج بنجاح ومسح البيانات المحلية.');
      } else {
        onStatusMessage?.(res.errorMessage ?? 'تعذر تسجيل الخروج.');
      }
    } finally {
      setSigningOut(false);
    }
  };

  const handleExportAndDiscard = async (mutationId: string) => {
    const res = await exportAndDiscardAttentionItem(mutationId);
    triggerJsonDownload(
      `mohasba-attention-${mutationId.slice(0, 8)}.json`,
      res.emergencySnapshot,
    );
  };

  return (
    <div>
      {/* Backup & Restore */}
      <div className="settings-body">
        <span className="panel-meta">
          النسخة الكاملة أثناء الاتصال ونسخة الطوارئ تعمل دون إنترنت
        </span>

        {backupFeedback && (
          <div
            className={`status-note ${backupFeedback.isError ? 'is-error' : ''}`}
            data-testid="backup-feedback"
            role="status"
          >
            {backupFeedback.text}
          </div>
        )}

        {importProgress && (
          <div className="notice-bar nums" data-testid="import-progress">
            <span>{importProgress}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-live"
            data-testid="export-full-btn"
            disabled={!isOnline || exportBusy}
            onClick={() => {
              void handleFullOnlineExport();
            }}
          >
            <IconDownload size="sm" />
            <span>{AR_STRINGS.settings.exportFullButton}</span>
          </button>

          <button
            type="button"
            className="btn"
            data-testid="export-emergency-btn"
            onClick={() => {
              void handleEmergencyExport();
            }}
          >
            <IconDownload size="sm" />
            <span>{AR_STRINGS.settings.exportEmergencyButton}</span>
          </button>

          <button
            type="button"
            className="btn"
            data-testid="import-json-btn"
            disabled={!isOnline || importBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconUpload size="sm" />
            <span>{AR_STRINGS.settings.importJsonButton}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="import-json-input"
            onChange={(e) => {
              void handleImportFile(e);
            }}
          />
        </div>

        {/* Sync Attention Recovery inside Settings */}
        {attentionItems.length > 0 && (
          <div
            className="flex flex-col gap-2"
            data-testid="settings-attention-panel"
          >
            <strong>
              عناصر مزامنة تحتاج إلى انتباه ({attentionItems.length})
            </strong>
            {attentionItems.map((item) => {
              const act = actionsById.get(item.action_id);
              return (
                <div key={item.mutation_id} className="attention-card">
                  <div className="flex items-center justify-between gap-2">
                    <strong>{act?.title ?? item.action_id}</strong>
                    <span className="nums">{item.log_date}</span>
                  </div>
                  {item.last_error && (
                    <span className="text-xs">{item.last_error}</span>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        void retryAttentionItem(item.mutation_id);
                      }}
                    >
                      {AR_STRINGS.sync.retryItem}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        void handleExportAndDiscard(item.mutation_id);
                      }}
                    >
                      {AR_STRINGS.sync.exportAndDiscardItem}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => {
                        void discardAttentionItem(item.mutation_id);
                      }}
                    >
                      {AR_STRINGS.sync.discardItem}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Templates Level-Up & Safe Workspace Reset */}
      <div
        className="settings-subpanel"
        data-testid="settings-templates-lifecycle-section"
      >
        <div className="settings-subpanel-head">
          <strong className="text-sm">القوالب وإعادة تهيئة الجدول</strong>
        </div>
        <div className="settings-body">
          <div className="lifecycle-action-grid">
            <div className="lifecycle-action-card">
              <div className="pref-toggle-text">
                <span className="pref-heading">
                  ترقية أو إضافة أعمال من القوالب الـ 3 (آمن)
                </span>
                <span className="pref-helper">
                  تقدر تترقّى لمستوى أعلى أو تختار أعمال إضافية من أي مستوى — يُضاف الجديد فقط داخل فتراتك الحالية بدون مسح أو تكرار أي عمل أو سجل سابق.
                </span>
              </div>
              <div>
                <button
                  type="button"
                  className="btn btn-live"
                  data-testid="open-template-merge-btn"
                  disabled={!isOnline}
                  onClick={() => {
                    setMergeError(null);
                    setMergeDialogOpen(true);
                  }}
                >
                  <IconPlus size="sm" />
                  <span>ترقية / إضافة من القوالب</span>
                </button>
              </div>
            </div>

            <div className="lifecycle-action-card is-danger">
              <div className="pref-toggle-text">
                <span className="pref-heading">
                  تصفير الجدول والعودة لاختيار المستوى من الصفر
                </span>
                <span className="pref-helper">
                  يمسح الفترات والأعمال والسجلات الحالية ويفتح لك شاشة اختيار المستويات الـ 3 للتخصيص من البداية، مع الاحتفاظ بإعدادات المدينة و ntfy والاختصارات.
                </span>
              </div>
              <div>
                <button
                  type="button"
                  className="btn btn-danger"
                  data-testid="open-workspace-reset-btn"
                  disabled={!isOnline}
                  onClick={() => {
                    setResetError(null);
                    setResetDialogOpen(true);
                  }}
                >
                  <IconTrash size="sm" />
                  <span>تصفير وإعادة اختيار القالب</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Audit Logs Subpanel */}
      <div className="settings-subpanel" data-testid="settings-audit-section">
        <div className="settings-subpanel-head">
          <div>
            <strong className="text-sm">
              {AR_STRINGS.settings.auditLogsTitle}
            </strong>
            <div className="panel-meta">
              سجل تشخيصي للقراءة فقط دون نصوص الملاحظات الخاصة
            </div>
          </div>
          <button
            type="button"
            className="btn"
            data-testid="toggle-audit-logs-btn"
            aria-expanded={auditOpen}
            onClick={handleToggleAuditPanel}
          >
            <span>{auditOpen ? 'إغلاق السجل' : 'عرض آخر الأحداث'}</span>
          </button>
        </div>

        {auditOpen && (
          <div>
            <div className="settings-body">
              <div className="field-grid-3">
                <label className="field-label">
                  <span>المستوى</span>
                  <select
                    className="field-select"
                    data-testid="audit-level-filter"
                    value={auditLevel}
                    onChange={(e) => {
                      const next = e.target.value as '' | AuditLogLevel;
                      setAuditLevel(next);
                      void fetchAuditLogs(next, auditCategory);
                    }}
                  >
                    <option value="">الكل</option>
                    <option value="INFO">INFO</option>
                    <option value="WARN">WARN</option>
                    <option value="ERROR">ERROR</option>
                  </select>
                </label>

                <label className="field-label">
                  <span>الفئة</span>
                  <select
                    className="field-select"
                    data-testid="audit-category-filter"
                    value={auditCategory}
                    onChange={(e) => {
                      const next = e.target.value as '' | AuditLogCategory;
                      setAuditCategory(next);
                      void fetchAuditLogs(auditLevel, next);
                    }}
                  >
                    <option value="">الكل</option>
                    {AUDIT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-end">
                  <button
                    type="button"
                    className="btn"
                    disabled={!isOnline || auditBusy}
                    onClick={() => {
                      void fetchAuditLogs();
                    }}
                  >
                    <IconRefresh size="sm" />
                    <span>تحديث</span>
                  </button>
                </div>
              </div>

              {auditError && (
                <div className="status-note is-error">{auditError}</div>
              )}
            </div>

            {auditLogs.length === 0 ? (
              <div className="empty-state" data-testid="audit-logs-empty">
                <span>
                  {auditBusy
                    ? 'جاري تحميل الأحداث...'
                    : 'لا توجد أحداث مطابقة للتصفية الحالية.'}
                </span>
              </div>
            ) : (
              <div data-testid="audit-logs-list">
                {auditLogs.map((entry) => (
                  <div key={entry.id} className="audit-log-row">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="target-tag nums">{entry.level}</span>
                        <span className="target-tag nums">
                          {entry.category}
                        </span>
                        <strong className="nums">{entry.event_name}</strong>
                      </div>
                      <span className="panel-meta nums" dir="ltr">
                        {entry.created_at.slice(0, 19).replace('T', ' ')}
                      </span>
                    </div>
                    <span>{entry.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* iOS A2HS Notice + Sign Out */}
      <div className="settings-subpanel" data-testid="settings-account-section">
        <div className="settings-subpanel-head">
          <strong className="text-sm">الجلسة والجهاز</strong>
        </div>
        <div className="settings-body">
          {isIosA2hsPromptVisible && (
            <div className="confirm-banner" role="note">
              <strong>{AR_STRINGS.sync.iosAddToHomeTitle}</strong>
              <span>{AR_STRINGS.sync.iosAddToHomeBody}</span>
            </div>
          )}

          {syncBadge.activeCount > 0 && (
            <div
              className="confirm-banner"
              data-testid="signout-unsynced-warning"
              role="alert"
            >
              <div className="flex items-center gap-2">
                <IconExpiredAlert size="sm" />
                <span>{AR_STRINGS.settings.signOutUnsyncedWarning}</span>
              </div>
              <div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void handleEmergencyExport();
                  }}
                >
                  <IconDownload size="sm" />
                  <span>{AR_STRINGS.settings.exportEmergencyButton}</span>
                </button>
              </div>
            </div>
          )}

          {confirmSignOut ? (
            <div
              className="confirm-banner"
              data-testid="signout-confirm-banner"
              role="alert"
            >
              <span>
                هل تريد تأكيد تسجيل الخروج؟ سيتم إنهاء الجلسة ومسح البيانات المخزنة محلياً على هذا المتصفح.
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-danger"
                  data-testid="signout-confirm-btn"
                  disabled={signingOut}
                  onClick={() => {
                    void handleSignOut();
                  }}
                >
                  <IconLogOut size="sm" />
                  <span>
                    {signingOut
                      ? 'جاري تسجيل الخروج...'
                      : 'تأكيد تسجيل الخروج'}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={signingOut}
                  onClick={() => setConfirmSignOut(false)}
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="panel-meta">
                تسجيل الخروج يمسح البيانات المخزنة محلياً على هذا المتصفح بعد إنهاء الجلسة.
              </span>

              <button
                type="button"
                className="btn btn-danger"
                data-testid="signout-btn"
                disabled={signingOut}
                onClick={() => setConfirmSignOut(true)}
              >
                <IconLogOut size="sm" />
                <span>{AR_STRINGS.settings.signOutButton}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <TemplateMergeDialog
        open={mergeDialogOpen}
        busy={mergeBusy}
        error={mergeError}
        activeFromIso={todayIslamicDate ?? new Date().toISOString().slice(0, 10)}
        existingPeriods={periods}
        existingActions={actions}
        existingTargetVersionIds={targetVersions.map((tv) => tv.id)}
        onClose={() => setMergeDialogOpen(false)}
        onConfirmMerge={handleConfirmTemplateMerge}
      />

      <WorkspaceResetDialog
        open={resetDialogOpen}
        busy={resetBusy}
        exportBusy={exportBusy}
        error={resetError}
        periodsCount={periods.length}
        actionsCount={actions.length}
        logsCount={logs.length}
        unsyncedCount={syncBadge.activeCount}
        onClose={() => setResetDialogOpen(false)}
        onDownloadBackup={handleFullOnlineExport}
        onConfirmReset={handleConfirmWorkspaceReset}
      />
    </div>
  );
}

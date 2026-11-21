'use client';

import React, { useMemo, useState } from 'react';
import { AR_STRINGS, type NtfyMode, type Period } from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { IconBell } from '../icons';

export function NtfySection() {
  const {
    settings,
    periods,
    ntfyConfigured,
    isOnline,
    updateSettings,
    updatePeriod,
    testNtfy,
  } = useMohasba();

  const [masterEnabled, setMasterEnabled] = useState(
    settings?.ntfy_master_enabled ?? false,
  );
  const [quietEnabled, setQuietEnabled] = useState(
    Boolean(settings?.quiet_start_hhmm && settings?.quiet_end_hhmm),
  );
  const [quietStart, setQuietStart] = useState(
    settings?.quiet_start_hhmm ?? '23:00',
  );
  const [quietEnd, setQuietEnd] = useState(
    settings?.quiet_end_hhmm ?? '04:00',
  );
  const [digestEnabled, setDigestEnabled] = useState(
    settings?.digest_enabled ?? true,
  );
  const [digestHhmm, setDigestHhmm] = useState(
    settings?.digest_hhmm ?? '22:30',
  );
  const [backupReminderEnabled, setBackupReminderEnabled] = useState(
    settings?.backup_reminder_enabled ?? true,
  );

  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [testFeedback, setTestFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  const timeBoundPeriods = useMemo(
    () =>
      periods
        .filter((p) => p.side === 'TIME_BOUND' && p.archived_at === null)
        .sort((a, b) => a.sort_order - b.sort_order),
    [periods],
  );

  if (!settings) return null;

  const handleSaveNtfySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || busy) return;

    setBusy(true);
    setFeedback(null);
    try {
      const res = await updateSettings({
        ntfy_master_enabled: masterEnabled,
        quiet_start_hhmm: quietEnabled ? quietStart : null,
        quiet_end_hhmm: quietEnabled ? quietEnd : null,
        digest_enabled: digestEnabled,
        digest_hhmm: digestHhmm,
        backup_reminder_enabled: backupReminderEnabled,
      });

      if (res.ok) {
        setFeedback({
          text: 'تم حفظ إعدادات تنبيهات ntfy بنجاح.',
          isError: false,
        });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر حفظ إعدادات التنبيهات.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTestNtfy = async () => {
    if (!isOnline || testBusy) return;
    setTestBusy(true);
    setTestFeedback(null);
    try {
      const res = await testNtfy();
      if (res.ok) {
        const data = res.data as { ok?: boolean; status?: number } | undefined;
        if (data?.ok) {
          setTestFeedback({
            text: `تم إرسال التنبيه التجريبي بنجاح (HTTP ${data.status ?? 200}).`,
            isError: false,
          });
        } else {
          setTestFeedback({
            text: `تعذر تسليم التنبيه التجريبي (HTTP ${data?.status ?? 500}).`,
            isError: true,
          });
        }
      } else if (res.errorCode === 'NTFY_NOT_CONFIGURED') {
        setTestFeedback({
          text: 'رابط قناة ntfy غير مهيأ في متغيرات الخادم (NTFY_TOPIC_URL).',
          isError: true,
        });
      } else {
        setTestFeedback({
          text: res.errorMessage ?? 'تعذر إرسال التنبيه التجريبي.',
          isError: true,
        });
      }
    } finally {
      setTestBusy(false);
    }
  };

  const handlePeriodNtfyPatch = async (
    period: Period,
    patch: {
      ntfy_enabled?: boolean;
      ntfy_mode?: NtfyMode;
      ntfy_offset_min?: number;
    },
  ) => {
    if (!isOnline || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await updatePeriod(period.id, patch);
      if (!res.ok) {
        setFeedback({
          text: res.errorMessage ?? `تعذر تحديث تنبيه فترة ${period.title}.`,
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" data-testid="settings-ntfy-section">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">{AR_STRINGS.settings.ntfySectionTitle}</h3>
          <span className="panel-meta">
            تذكير ذكي قبل انتهاء الفترة فقط عند وجود أعمال غير مسجّلة
          </span>
        </div>

        <span
          className={`rate-pill ${ntfyConfigured ? 'good' : 'warn'}`}
          data-testid="ntfy-configured-badge"
        >
          {ntfyConfigured ? 'القناة مهيأة على الخادم' : 'القناة غير مهيأة على الخادم'}
        </span>
      </div>

      <form
        className="settings-body"
        onSubmit={(e) => {
          void handleSaveNtfySettings(e);
        }}
      >
        {feedback && (
          <div className={`status-note ${feedback.isError ? 'is-error' : ''}`}>
            {feedback.text}
          </div>
        )}

        {testFeedback && (
          <div
            className={`status-note ${testFeedback.isError ? 'is-error' : ''}`}
            data-testid="ntfy-test-feedback"
            role="status"
          >
            {testFeedback.text}
          </div>
        )}

        <div className="field-grid">
          <label className="check-row">
            <input
              type="checkbox"
              data-testid="ntfy-master-toggle"
              checked={masterEnabled}
              onChange={(e) => setMasterEnabled(e.target.checked)}
            />
            <span>{AR_STRINGS.settings.ntfyMasterToggle}</span>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={backupReminderEnabled}
              onChange={(e) => setBackupReminderEnabled(e.target.checked)}
            />
            <span>تذكير النسخ الاحتياطي نصف الشهري</span>
          </label>
        </div>

        <div className="field-grid-3">
          <label className="check-row">
            <input
              type="checkbox"
              checked={quietEnabled}
              onChange={(e) => setQuietEnabled(e.target.checked)}
            />
            <span>تفعيل ساعات الهدوء</span>
          </label>

          <label className="field-label">
            <span>بداية الهدوء</span>
            <input
              type="time"
              className="field-input nums"
              disabled={!quietEnabled}
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
            />
          </label>

          <label className="field-label">
            <span>نهاية الهدوء</span>
            <input
              type="time"
              className="field-input nums"
              disabled={!quietEnabled}
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(e) => setDigestEnabled(e.target.checked)}
            />
            <span>ملخص الاستدراك الليلي (أعمال غير مسجّلة)</span>
          </label>

          <label className="field-label">
            <span>وقت الملخص الليلي</span>
            <input
              type="time"
              className="field-input nums"
              disabled={!digestEnabled}
              value={digestHhmm}
              onChange={(e) => setDigestHhmm(e.target.value)}
            />
          </label>
        </div>

        <div className="notice-bar">
          <span>
            نص الإشعار: اقترب انتهاء وقت [الفترة]: تذكير بالمحاسبة (تجاهله إن كنت قد سجلت دون إنترنت)
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="btn"
            data-testid="ntfy-test-btn"
            disabled={!isOnline || testBusy}
            onClick={() => {
              void handleTestNtfy();
            }}
          >
            <IconBell size="sm" />
            <span>{AR_STRINGS.settings.ntfyTestButton}</span>
          </button>

          <button
            type="submit"
            className="btn btn-live"
            data-testid="ntfy-save-btn"
            disabled={!isOnline || busy}
          >
            حفظ إعدادات التنبيهات
          </button>
        </div>
      </form>

      {/* Per-Period Quick Customization */}
      {timeBoundPeriods.length > 0 && (
        <div className="schema-group">
          <div className="schema-group-head">
            <strong>تخصيص تنبيه كل فترة</strong>
            <span className="panel-meta">يحفظ مباشرة عند التعديل</span>
          </div>
          <div>
            {timeBoundPeriods.map((period) => (
              <div key={period.id} className="schema-item-row">
                <label className="check-row">
                  <input
                    type="checkbox"
                    disabled={!isOnline || busy}
                    checked={period.ntfy_enabled}
                    onChange={(e) => {
                      void handlePeriodNtfyPatch(period, {
                        ntfy_enabled: e.target.checked,
                      });
                    }}
                  />
                  <span>{period.title}</span>
                </label>

                <div className="schema-item-actions">
                  <select
                    className="field-select"
                    aria-label={`نمط تنبيه ${period.title}`}
                    disabled={!isOnline || busy || !period.ntfy_enabled}
                    value={period.ntfy_mode ?? 'pre_expiry'}
                    onChange={(e) => {
                      void handlePeriodNtfyPatch(period, {
                        ntfy_mode: e.target.value as NtfyMode,
                      });
                    }}
                  >
                    <option value="pre_expiry">قبل الانتهاء</option>
                    <option value="post_start">بعد البداية</option>
                  </select>

                  <input
                    type="number"
                    className="field-input nums"
                    style={{ width: '80px' }}
                    aria-label={`دقائق تنبيه ${period.title}`}
                    min={1}
                    max={180}
                    disabled={!isOnline || busy || !period.ntfy_enabled}
                    value={period.ntfy_offset_min}
                    onChange={(e) => {
                      const next = Math.min(
                        180,
                        Math.max(1, Number(e.target.value) || 25),
                      );
                      void handlePeriodNtfyPatch(period, {
                        ntfy_offset_min: next,
                      });
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

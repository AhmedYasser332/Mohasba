'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AR_STRINGS, type NtfyMode, type NtfySource, type Period } from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { generateSecureNtfyTopicUrl } from '../../utils/presets';
import { IconBell, IconCheck, IconCopy, IconRefresh, IconTrash } from '../icons';

const NTFY_SOURCE_LABELS: Record<NtfySource, string> = {
  db: 'مُعدّ من التطبيق',
  env: 'مُعدّ من الخادم (.env)',
  none: 'غير مُهيّأ',
};

interface NtfyFormDraft {
  masterEnabled?: boolean;
  quietEnabled?: boolean;
  quietStart?: string;
  quietEnd?: string;
  digestEnabled?: boolean;
  digestHhmm?: string;
  backupReminderEnabled?: boolean;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to temporary input copy below
    }
  }
  if (typeof document === 'undefined' || !document.body) return false;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.top = '-9999px';
  input.style.opacity = '0';
  document.body.appendChild(input);
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(input);
  }
}

export function NtfySection() {
  const {
    settings,
    periods,
    ntfyConfigured,
    ntfySource,
    ntfyTopicHint,
    ntfyHasToken,
    isOnline,
    updateSettings,
    updatePeriod,
    refreshBootstrap,
    testNtfy,
    revealNtfyTopicUrl,
  } = useMohasba();

  const [draft, setDraft] = useState<NtfyFormDraft>({});
  const [topicUrlDraft, setTopicUrlDraft] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSavedUrl, setCopiedSavedUrl] = useState(false);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealedFallbackUrl, setRevealedFallbackUrl] = useState<string | null>(
    null,
  );

  useEffect(() => () => setRevealedFallbackUrl(null), []);

  const [offsetDrafts, setOffsetDrafts] = useState<Record<string, string>>({});

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

  const masterEnabled = draft.masterEnabled ?? settings.ntfy_master_enabled;
  const quietEnabled =
    draft.quietEnabled ??
    Boolean(settings.quiet_start_hhmm && settings.quiet_end_hhmm);
  const quietStart = draft.quietStart ?? settings.quiet_start_hhmm ?? '23:00';
  const quietEnd = draft.quietEnd ?? settings.quiet_end_hhmm ?? '04:00';
  const digestEnabled = draft.digestEnabled ?? settings.digest_enabled;
  const digestHhmm = draft.digestHhmm ?? settings.digest_hhmm ?? '22:30';
  const backupReminderEnabled =
    draft.backupReminderEnabled ?? settings.backup_reminder_enabled;

  const handleGenerateTopicUrl = () => {
    const generated = generateSecureNtfyTopicUrl();
    setTopicUrlDraft(generated);
    setCopiedUrl(false);
    setFeedback({
      text: 'تم توليد رابط قناة آمن؛ انسخه للاشتراك في تطبيق ntfy على هاتفك ثم اضغط «حفظ إعدادات التنبيهات».',
      isError: false,
    });
  };

  const handleCopyTopicUrl = async () => {
    const value = topicUrlDraft.trim();
    if (!value) return;
    const copied = await copyTextToClipboard(value);
    if (copied) {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setFeedback({
        text: 'تعذر النسخ التلقائي؛ يمكنك تحديد الرابط ونسخه يدوياً.',
        isError: true,
      });
    }
  };

  const handleCopySavedTopicUrl = async () => {
    if (!ntfyConfigured || !isOnline || revealBusy || busy) return;
    setRevealBusy(true);
    setFeedback(null);
    setRevealedFallbackUrl(null);
    try {
      const revealPromise = revealNtfyTopicUrl();

      if (
        typeof ClipboardItem !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.write === 'function'
      ) {
        try {
          const blobPromise = revealPromise.then((res) => {
            if (!res.ok || !res.data?.url) {
              throw new Error(res.errorMessage ?? 'REVEAL_FAILED');
            }
            return new Blob([res.data.url], { type: 'text/plain' });
          });
          void blobPromise.catch(() => {});
          await navigator.clipboard.write([
            new ClipboardItem({ 'text/plain': blobPromise }),
          ]);
          setCopiedSavedUrl(true);
          setFeedback({
            text: 'تم نسخ الرابط الحالي إلى الحافظة.',
            isError: false,
          });
          setTimeout(() => setCopiedSavedUrl(false), 2500);
          return;
        } catch {
          // Fall through to inspect revealPromise result and legacy fallback
        }
      }

      const res = await revealPromise;
      if (!res.ok || !res.data?.url) {
        setFeedback({
          text:
            res.errorCode === 'NTFY_NOT_CONFIGURED'
              ? 'قناة ntfy غير مهيأة بعد.'
              : (res.errorMessage ?? 'تعذر استرجاع رابط القناة الحالي.'),
          isError: true,
        });
        return;
      }
      const copied = await copyTextToClipboard(res.data.url);
      if (copied) {
        setCopiedSavedUrl(true);
        setFeedback({
          text: 'تم نسخ الرابط الحالي إلى الحافظة.',
          isError: false,
        });
        setTimeout(() => setCopiedSavedUrl(false), 2500);
      } else {
        setRevealedFallbackUrl(res.data.url);
        setFeedback({
          text: 'تعذر النسخ التلقائي؛ تم إظهار الرابط مؤقتاً لتحديده ونسخه يدوياً.',
          isError: false,
        });
      }
    } finally {
      setRevealBusy(false);
    }
  };

  const handleClearSavedTopic = async () => {
    if (!isOnline || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await updateSettings({ ntfy_topic_url: null });
      if (res.ok) {
        setTopicUrlDraft('');
        setRevealedFallbackUrl(null);
        setCopiedSavedUrl(false);
        setFeedback({
          text: 'تم مسح القناة المحفوظة في التطبيق والعودة لإعداد الخادم إن وُجد.',
          isError: false,
        });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر مسح رابط القناة المحفوظة.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClearSavedToken = async () => {
    if (!isOnline || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await updateSettings({ ntfy_access_token: null });
      if (res.ok) {
        setTokenDraft('');
        setFeedback({
          text: 'تم مسح Access Token المحفوظ.',
          isError: false,
        });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر مسح التوكن المحفوظ.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNtfySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || busy) return;

    const trimmedUrl = topicUrlDraft.trim();
    if (trimmedUrl && !trimmedUrl.toLowerCase().startsWith('https://')) {
      setFeedback({
        text: 'يجب أن يبدأ رابط قناة ntfy بـ https:// لأسباب أمنية.',
        isError: true,
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const patch: Record<string, unknown> = {
        ntfy_master_enabled: masterEnabled,
        quiet_start_hhmm: quietEnabled ? quietStart : null,
        quiet_end_hhmm: quietEnabled ? quietEnd : null,
        digest_enabled: digestEnabled,
        digest_hhmm: digestHhmm,
        backup_reminder_enabled: backupReminderEnabled,
      };
      if (trimmedUrl) {
        patch.ntfy_topic_url = trimmedUrl;
      }
      if (tokenDraft.trim()) {
        patch.ntfy_access_token = tokenDraft.trim();
      }

      const res = await updateSettings(patch);

      if (res.ok) {
        setDraft({});
        setTopicUrlDraft('');
        setTokenDraft('');
        setRevealedFallbackUrl(null);
        setCopiedSavedUrl(false);
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
        const status = data?.status ?? 200;
        if (data?.ok) {
          setTestFeedback({
            text: 'تم إرسال التنبيه التجريبي بنجاح (HTTP 200). تحقق من تطبيق ntfy على هاتفك الآن.',
            isError: false,
          });
        } else if (status === 401 || status === 403) {
          setTestFeedback({
            text: `رفض خادم ntfy الإرسال (HTTP ${status}). تحقق من صحة Access Token وصلاحية النشر للقناة.`,
            isError: true,
          });
        } else if (status === 400 || status === 404) {
          setTestFeedback({
            text: `رابط القناة غير صالح أو غير موجود (HTTP ${status}). تأكد أن الرابط ينتهي باسم القناة مثل https://ntfy.sh/your-topic.`,
            isError: true,
          });
        } else {
          setTestFeedback({
            text: `تعذر تسليم التنبيه التجريبي (HTTP ${status}). تحقق من إعدادات الخادم.`,
            isError: true,
          });
        }
      } else if (res.errorCode === 'NTFY_NOT_CONFIGURED') {
        setTestFeedback({
          text: 'قناة ntfy غير مهيأة بعد. أدخل رابط القناة في الخطوة 2 واحفظ الإعدادات أو عرّف NTFY_TOPIC_URL على الخادم.',
          isError: true,
        });
      } else if (res.errorCode === 'VALIDATION_ERROR') {
        setTestFeedback({
          text: 'رابط قناة ntfy غير صالح أو مرفوض أمنياً. يجب استخدام رابط https:// عام خارجي دون عناوين محلية.',
          isError: true,
        });
      } else if (
        res.errorCode === 'NTFY_DISPATCH_FAILED' ||
        res.errorCode === 'NETWORK_ERROR'
      ) {
        setTestFeedback({
          text: 'تعذر الاتصال بخادم ntfy أو انتهت المهلة خلال 5 ثوانٍ. تحقق من الرابط واتصال الخادم بالإنترنت.',
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

  const commitPeriodOffset = (period: Period) => {
    const raw = offsetDrafts[period.id];
    if (raw === undefined) return;
    const parsed = Number(raw);
    const clamped = Math.min(
      180,
      Math.max(1, Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 25),
    );
    setOffsetDrafts((prev) => {
      const next = { ...prev };
      delete next[period.id];
      return next;
    });
    if (clamped !== period.ntfy_offset_min) {
      void handlePeriodNtfyPatch(period, { ntfy_offset_min: clamped });
    }
  };

  const handleToggleAllPeriodsNtfy = async (enabled: boolean) => {
    if (!isOnline || busy) return;
    const targets = timeBoundPeriods.filter((p) => p.ntfy_enabled !== enabled);
    if (targets.length === 0) return;
    setBusy(true);
    setFeedback(null);
    try {
      const results = await Promise.allSettled(
        targets.map((period) =>
          updatePeriod(period.id, { ntfy_enabled: enabled }, { skipRefresh: true }),
        ),
      );
      await refreshBootstrap({ full: true });
      const failedCount = results.filter(
        (r) => r.status === 'rejected' || !r.value.ok,
      ).length;
      if (failedCount > 0) {
        const succeeded = targets.length - failedCount;
        setFeedback({
          text:
            succeeded > 0
              ? `تم تحديث ${succeeded} من ${targets.length} فترات وتعذر تحديث ${failedCount}.`
              : 'تعذر تحديث تنبيهات الفترات.',
          isError: true,
        });
        return;
      }
      setFeedback({
        text: enabled
          ? 'تم تفعيل التنبيهات لجميع الفترات الموقوتة.'
          : 'تم إيقاف التنبيهات لجميع الفترات الموقوتة.',
        isError: false,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="settings-section-bar">
        <span className="panel-meta">
          تذكير ذكي قبل انتهاء الفترة فقط عند وجود أعمال غير مسجّلة
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rate-pill ${ntfyConfigured ? 'good' : 'warn'}`}
            data-testid="ntfy-configured-badge"
          >
            {NTFY_SOURCE_LABELS[ntfySource]}
          </span>
          {ntfyTopicHint && (
            <span
              className="target-tag nums"
              dir="ltr"
              data-testid="ntfy-topic-hint"
            >
              {ntfyTopicHint}
            </span>
          )}
          {ntfyHasToken && (
            <span
              className="target-tag nums"
              data-testid="ntfy-has-token-badge"
            >
              توكن محفوظ ••••••••
            </span>
          )}
        </div>
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

        {/* 3-Step Self-Hoster Setup */}
        <div className="ntfy-steps" aria-label="خطوات ربط ntfy">
          <div className="ntfy-step">
            <span className="ntfy-step-badge nums" aria-hidden="true">
              1
            </span>
            <div className="ntfy-step-content">
              <strong>اشترك في قناة خاصة على تطبيق ntfy في هاتفك</strong>
              <span className="panel-meta">
                ثبّت تطبيق ntfy (Android أو iOS) ثم ولّد رابط قناة طويل غير قابل للتخمين واشترك في اسم القناة داخل التطبيق.
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  data-testid="ntfy-generate-btn"
                  disabled={!isOnline || busy}
                  onClick={handleGenerateTopicUrl}
                >
                  <IconRefresh size="sm" />
                  <span>توليد رابط عشوائي آمن</span>
                </button>
                {topicUrlDraft.trim().length > 0 && (
                  <button
                    type="button"
                    className="btn"
                    data-testid="ntfy-copy-url-btn"
                    onClick={() => {
                      void handleCopyTopicUrl();
                    }}
                  >
                    {copiedUrl ? (
                      <>
                        <IconCheck size="sm" />
                        <span>تم النسخ</span>
                      </>
                    ) : (
                      <>
                        <IconCopy size="sm" />
                        <span>نسخ الرابط</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="ntfy-step">
            <span className="ntfy-step-badge nums" aria-hidden="true">
              2
            </span>
            <div className="ntfy-step-content">
              <strong>أدخل رابط قناة ntfy ورمز الوصول (اختياري)</strong>
              <div className="field-grid">
                <label className="field-label">
                  <span>رابط قناة ntfy (Topic URL)</span>
                  <input
                    type="url"
                    className="field-input nums ntfy-url-input"
                    dir="ltr"
                    data-testid="ntfy-topic-url-input"
                    placeholder={
                      ntfyTopicHint
                        ? `محفوظ (${ntfyTopicHint}) — أدخل رابطاً جديداً للاستبدال`
                        : 'https://ntfy.sh/mohasba-...'
                    }
                    value={topicUrlDraft}
                    onChange={(e) => setTopicUrlDraft(e.target.value)}
                  />
                </label>

                <label className="field-label">
                  <span>Access Token (اختياري للقنوات الخاصة)</span>
                  <input
                    type="password"
                    className="field-input nums"
                    dir="ltr"
                    autoComplete="off"
                    data-testid="ntfy-access-token-input"
                    placeholder={
                      ntfyHasToken
                        ? 'توكن محفوظ •••••••• (أدخل رمزاً جديداً للاستبدال)'
                        : 'tk_...'
                    }
                    value={tokenDraft}
                    onChange={(e) => setTokenDraft(e.target.value)}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {ntfyConfigured && (
                  <button
                    type="button"
                    className="btn"
                    data-testid="ntfy-copy-saved-url-btn"
                    disabled={!isOnline || busy || revealBusy}
                    onClick={() => {
                      void handleCopySavedTopicUrl();
                    }}
                  >
                    {copiedSavedUrl ? (
                      <>
                        <IconCheck size="sm" />
                        <span>تم نسخ الرابط الحالي</span>
                      </>
                    ) : (
                      <>
                        <IconCopy size="sm" />
                        <span>
                          {revealBusy ? 'جاري التحضير...' : 'نسخ الرابط الحالي'}
                        </span>
                      </>
                    )}
                  </button>
                )}
                {ntfySource === 'db' && (
                  <button
                    type="button"
                    className="btn"
                    data-testid="ntfy-clear-topic-btn"
                    disabled={!isOnline || busy}
                    onClick={() => {
                      void handleClearSavedTopic();
                    }}
                  >
                    <IconTrash size="sm" />
                    <span>مسح القناة المحفوظة</span>
                  </button>
                )}
                {ntfyHasToken && (
                  <button
                    type="button"
                    className="btn"
                    data-testid="ntfy-clear-token-btn"
                    disabled={!isOnline || busy}
                    onClick={() => {
                      void handleClearSavedToken();
                    }}
                  >
                    <IconTrash size="sm" />
                    <span>مسح التوكن</span>
                  </button>
                )}
              </div>

              {revealedFallbackUrl && (
                <div
                  className="flex flex-wrap items-center gap-2"
                  data-testid="ntfy-revealed-fallback-wrap"
                >
                  <input
                    type="text"
                    readOnly
                    dir="ltr"
                    className="field-input nums ntfy-url-input flex-1"
                    aria-label="رابط قناة ntfy الحالي"
                    value={revealedFallbackUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setRevealedFallbackUrl(null)}
                  >
                    إخفاء
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="ntfy-step">
            <span className="ntfy-step-badge nums" aria-hidden="true">
              3
            </span>
            <div className="ntfy-step-content">
              <strong>احفظ الإعدادات واضغط «تجربة التنبيه» للتحقق</strong>
              <span className="panel-meta">
                يبقى الرابط السري والتوكن مخفيّين افتراضياً ولا يُضمّنان في ملفات النسخ الاحتياطي، ويمكنك نسخ الرابط عند الحاجة من زر «نسخ الرابط الحالي» أعلاه.
              </span>
            </div>
          </div>
        </div>

        <div className="ntfy-time-row">
          <label className="check-row">
            <input
              type="checkbox"
              data-testid="ntfy-master-toggle"
              checked={masterEnabled}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  masterEnabled: e.target.checked,
                }))
              }
            />
            <span>{AR_STRINGS.settings.ntfyMasterToggle}</span>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={backupReminderEnabled}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  backupReminderEnabled: e.target.checked,
                }))
              }
            />
            <span>تذكير النسخ الاحتياطي نصف الشهري</span>
          </label>
        </div>

        <div className="ntfy-time-row">
          <label className="check-row">
            <input
              type="checkbox"
              checked={quietEnabled}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  quietEnabled: e.target.checked,
                }))
              }
            />
            <span>تفعيل ساعات الهدوء</span>
          </label>

          <label className="field-label ntfy-time-field">
            <span>بداية الهدوء</span>
            <input
              type="time"
              className="field-input nums ntfy-time-input"
              dir="ltr"
              disabled={!quietEnabled}
              value={quietStart}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, quietStart: e.target.value }))
              }
            />
          </label>

          <label className="field-label ntfy-time-field">
            <span>نهاية الهدوء</span>
            <input
              type="time"
              className="field-input nums ntfy-time-input"
              dir="ltr"
              disabled={!quietEnabled}
              value={quietEnd}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, quietEnd: e.target.value }))
              }
            />
          </label>
        </div>

        <div className="ntfy-time-row">
          <label className="check-row">
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  digestEnabled: e.target.checked,
                }))
              }
            />
            <span>ملخص الاستدراك الليلي (أعمال غير مسجّلة)</span>
          </label>

          <label className="field-label ntfy-time-field">
            <span>وقت الملخص الليلي</span>
            <input
              type="time"
              className="field-input nums ntfy-time-input"
              dir="ltr"
              disabled={!digestEnabled}
              value={digestHhmm}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, digestHhmm: e.target.value }))
              }
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
            <span>
              {testBusy
                ? 'جاري الإرسال...'
                : AR_STRINGS.settings.ntfyTestButton}
            </span>
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
        <div className="settings-subpanel">
          <div className="settings-subpanel-head">
            <div className="flex flex-col gap-0.5">
              <strong>تخصيص تنبيه كل فترة</strong>
              <span className="panel-meta">
                يحفظ التغيير عند الخروج من الحقل أو الضغط على Enter
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn"
                data-testid="ntfy-enable-all-periods"
                disabled={
                  !isOnline ||
                  busy ||
                  timeBoundPeriods.every((p) => p.ntfy_enabled)
                }
                onClick={() => {
                  void handleToggleAllPeriodsNtfy(true);
                }}
              >
                تفعيل الكل
              </button>
              <button
                type="button"
                className="btn"
                data-testid="ntfy-disable-all-periods"
                disabled={
                  !isOnline ||
                  busy ||
                  timeBoundPeriods.every((p) => !p.ntfy_enabled)
                }
                onClick={() => {
                  void handleToggleAllPeriodsNtfy(false);
                }}
              >
                إيقاف الكل
              </button>
            </div>
          </div>
          <div>
            {timeBoundPeriods.map((period) => (
              <div key={period.id} className="ntfy-period-row">
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

                <div className="ntfy-period-controls">
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

                  <div className="ntfy-offset-wrap">
                    <input
                      type="number"
                      className="field-input nums ntfy-offset-input"
                      aria-label={`دقائق تنبيه ${period.title}`}
                      min={1}
                      max={180}
                      disabled={!isOnline || busy || !period.ntfy_enabled}
                      value={
                        offsetDrafts[period.id] ??
                        String(period.ntfy_offset_min)
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        setOffsetDrafts((prev) => ({
                          ...prev,
                          [period.id]: val,
                        }));
                      }}
                      onBlur={() => commitPeriodOffset(period)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitPeriodOffset(period);
                        }
                      }}
                    />
                    <span className="panel-meta">دقيقة</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

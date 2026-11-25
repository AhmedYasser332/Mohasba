'use client';

import React, { useState } from 'react';
import type { DefaultHomeView, DefaultWeekMode } from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';

const HOME_VIEW_OPTIONS: ReadonlyArray<{
  value: DefaultHomeView;
  label: string;
}> = [
  { value: 'now', label: 'الآن' },
  { value: 'week', label: 'الجدول الأسبوعي' },
  { value: 'qadaa', label: 'القضاء' },
  { value: 'analytics', label: 'التحليلات' },
];

const WEEK_MODE_OPTIONS: ReadonlyArray<{
  value: DefaultWeekMode;
  label: string;
}> = [
  { value: 'standard', label: 'العرض المريح' },
  { value: 'one_glance', label: 'نظرة واحدة' },
];

export function GeneralPreferencesSection() {
  const { settings, isOnline, updateSettings } = useMohasba();
  const [busy, setBusy] = useState(false);
  const [pendingCatchup, setPendingCatchup] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  if (!settings) return null;

  const commitPatch = async (
    patch: Partial<{
      default_home_view: DefaultHomeView;
      default_week_mode: DefaultWeekMode;
      show_catchup_banner: boolean;
    }>,
    successText: string,
  ) => {
    if (!isOnline || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await updateSettings(patch);
      if (res.ok) {
        setFeedback({ text: successText, isError: false });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر حفظ التفضيلات.',
          isError: true,
        });
      }
    } finally {
      setPendingCatchup(null);
      setBusy(false);
    }
  };

  return (
    <div className="settings-body">
      {feedback && (
        <div
          className={`status-note ${feedback.isError ? 'is-error' : ''}`}
          data-testid="general-prefs-feedback"
          role="status"
        >
          {feedback.text}
        </div>
      )}

      <div className="pref-block">
        <span className="pref-heading" id="default-home-view-label">
          الشاشة الافتراضية عند فتح التطبيق
        </span>
        <div
          className="pref-seg-group"
          role="radiogroup"
          aria-labelledby="default-home-view-label"
        >
          {HOME_VIEW_OPTIONS.map((opt) => {
            const checked = settings.default_home_view === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={checked}
                className="pref-seg-btn"
                data-testid={`pref-home-view-${opt.value}`}
                disabled={!isOnline || busy}
                onClick={() => {
                  if (!checked) {
                    void commitPatch(
                      { default_home_view: opt.value },
                      `تم تعيين «${opt.label}» شاشة افتراضية عند الفتح.`,
                    );
                  }
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <span className="pref-helper">
          تفتح الروابط المباشرة أو تنبيهات ntfy على وجهتها المحددة دائماً، بينما يطبق هذا الخيار عند فتح الصفحة الرئيسية.
        </span>
      </div>

      <div className="pref-block">
        <span className="pref-heading" id="default-week-mode-label">
          وضع عرض الجدول الأسبوعي الافتراضي على الحاسوب
        </span>
        <div
          className="pref-seg-group"
          role="radiogroup"
          aria-labelledby="default-week-mode-label"
        >
          {WEEK_MODE_OPTIONS.map((opt) => {
            const checked = settings.default_week_mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={checked}
                className="pref-seg-btn"
                data-testid={`pref-week-mode-${opt.value}`}
                disabled={!isOnline || busy}
                onClick={() => {
                  if (!checked) {
                    void commitPatch(
                      { default_week_mode: opt.value },
                      `تم تعيين «${opt.label}» وضعاً افتراضياً للجدول الأسبوعي.`,
                    );
                  }
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="pref-toggle-card">
        <input
          type="checkbox"
          data-testid="pref-show-catchup-banner"
          checked={pendingCatchup ?? settings.show_catchup_banner}
          disabled={!isOnline || busy}
          onChange={(e) => {
            const next = e.target.checked;
            setPendingCatchup(next);
            void commitPatch(
              { show_catchup_banner: next },
              next
                ? 'تم تفعيل شريط استدراك الخانات غير المسجلة في شاشة الآن.'
                : 'تم إخفاء شريط الاستدراك من شاشة الآن مع بقاء تبويب الاستدراك في القضاء.',
            );
          }}
        />
        <span className="pref-toggle-text">
          <span className="pref-heading">
            إظهار شريط استدراك الخانات غير المسجلة (48 ساعة) في شاشة الآن
          </span>
          <span className="pref-helper">
            عند إيقاف هذا الشريط تبقى شاشة «الآن» أخف أثناء التسجيل السريع، وتستمر متابعة العناصر المنتهية في شاشة «القضاء» دون تغيير.
          </span>
        </span>
      </label>
    </div>
  );
}

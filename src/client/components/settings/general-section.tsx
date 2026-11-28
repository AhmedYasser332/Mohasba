'use client';

import React, { useState } from 'react';
import type { DefaultHomeView, DefaultWeekMode, EnterKeyMode } from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import {
  DEFAULT_CROSSHAIR_PREFS,
  resetCrosshairPrefs,
  updateCrosshairPrefs,
  useCrosshairPrefs,
  type CrosshairDisplayMode,
  type CrosshairMotionMode,
} from '../../utils/crosshair-prefs';

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

const ENTER_KEY_MODE_OPTIONS: ReadonlyArray<{
  value: EnterKeyMode;
  label: string;
}> = [
  { value: 'editor', label: 'فتح محرر الخانة (الافتراضي)' },
  {
    value: 'move_down',
    label: 'الانتقال للصف التالي (مثل Excel — وF2 لفتح المحرر)',
  },
];

const CROSSHAIR_MODE_OPTIONS: ReadonlyArray<{
  value: CrosshairDisplayMode;
  label: string;
}> = [
  { value: 'both', label: 'الصف والعمود' },
  { value: 'row', label: 'الصف فقط' },
  { value: 'col', label: 'العمود فقط' },
  { value: 'off', label: 'إيقاف' },
];

const CROSSHAIR_MOTION_OPTIONS: ReadonlyArray<{
  value: CrosshairMotionMode;
  label: string;
}> = [
  { value: 'instant', label: 'فوري (0ms) (الافتراضي)' },
  { value: 'smooth', label: 'انزلاق ناعم' },
];

export function GeneralPreferencesSection() {
  const { settings, isOnline, updateSettings } = useMohasba();
  const crosshairPrefs = useCrosshairPrefs();
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
      enter_key_mode: EnterKeyMode;
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

      <div className="pref-block">
        <span className="pref-heading" id="enter-key-mode-label">
          سلوك مفتاح Enter في الجدول الأسبوعي
        </span>
        <div
          className="pref-seg-group"
          role="radiogroup"
          aria-labelledby="enter-key-mode-label"
          data-testid="pref-enter-key-mode"
        >
          {ENTER_KEY_MODE_OPTIONS.map((opt) => {
            const checked = (settings.enter_key_mode ?? 'editor') === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={checked}
                className="pref-seg-btn"
                data-testid={`pref-enter-key-mode-${opt.value}`}
                disabled={!isOnline || busy}
                onClick={() => {
                  if (!checked) {
                    void commitPatch(
                      { enter_key_mode: opt.value },
                      `تم تعيين سلوك مفتاح Enter إلى «${opt.label}».`,
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

      {/* Desktop Weekly Matrix Crosshair Customization (Instant Per-Device Local Prefs) */}
      <div
        className="crosshair-prefs-card"
        data-testid="pref-crosshair-section"
      >
        <div className="crosshair-prefs-head">
          <div className="pref-toggle-text">
            <span className="pref-heading">
              تظليل الصف والعمود في الجدول الأسبوعي (الحاسوب)
            </span>
            <span className="pref-helper">
              تحكم كامل في وضع التظليل، شدة الشفافية، ونعومة الانزلاق — يُحفظ فورياً على هذا الجهاز دون الحاجة للاتصال.
            </span>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="pref-crosshair-reset"
            disabled={
              crosshairPrefs.mode === DEFAULT_CROSSHAIR_PREFS.mode &&
              crosshairPrefs.opacity === DEFAULT_CROSSHAIR_PREFS.opacity &&
              crosshairPrefs.motion === DEFAULT_CROSSHAIR_PREFS.motion &&
              crosshairPrefs.showHeaderIndicator ===
                DEFAULT_CROSSHAIR_PREFS.showHeaderIndicator &&
              crosshairPrefs.showFocusFallback ===
                DEFAULT_CROSSHAIR_PREFS.showFocusFallback &&
              crosshairPrefs.coverPeriodColumn ===
                DEFAULT_CROSSHAIR_PREFS.coverPeriodColumn
            }
            onClick={() => {
              resetCrosshairPrefs();
            }}
          >
            استعادة الافتراضي
          </button>
        </div>

        <div className="crosshair-prefs-grid">
          <div className="crosshair-prefs-controls">
            <div className="pref-block">
              <span className="pref-heading" id="crosshair-mode-label">
                وضع التظليل
              </span>
              <div
                className="pref-seg-group"
                role="radiogroup"
                aria-labelledby="crosshair-mode-label"
              >
                {CROSSHAIR_MODE_OPTIONS.map((opt) => {
                  const checked = crosshairPrefs.mode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      className="pref-seg-btn"
                      data-testid={`pref-crosshair-mode-${opt.value}`}
                      onClick={() => updateCrosshairPrefs({ mode: opt.value })}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {crosshairPrefs.mode !== 'off' && (
              <>
                <div className="pref-block">
                  <div className="crosshair-slider-row">
                    <label
                      htmlFor="crosshair-opacity-range"
                      className="pref-heading"
                    >
                      شدة الشفافية
                    </label>
                    <span
                      className="count-chip nums"
                      data-testid="pref-crosshair-opacity-value"
                    >
                      {crosshairPrefs.opacity}%
                    </span>
                  </div>
                  <input
                    id="crosshair-opacity-range"
                    type="range"
                    min={20}
                    max={220}
                    step={10}
                    value={crosshairPrefs.opacity}
                    data-testid="pref-crosshair-opacity"
                    className="crosshair-range-input"
                    aria-label="شدة شفافية تظليل الصف والعمود"
                    onChange={(e) =>
                      updateCrosshairPrefs({ opacity: Number(e.target.value) })
                    }
                  />
                  <div className="crosshair-range-labels nums">
                    <span>خفيف جداً (20%)</span>
                    <span>متوازن (100%)</span>
                    <span>واضح (220%)</span>
                  </div>
                </div>

                <div className="pref-block">
                  <span className="pref-heading" id="crosshair-motion-label">
                    نعومة الحركة
                  </span>
                  <div
                    className="pref-seg-group"
                    role="radiogroup"
                    aria-labelledby="crosshair-motion-label"
                  >
                    {CROSSHAIR_MOTION_OPTIONS.map((opt) => {
                      const checked = crosshairPrefs.motion === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          className="pref-seg-btn"
                          data-testid={`pref-crosshair-motion-${opt.value}`}
                          onClick={() =>
                            updateCrosshairPrefs({ motion: opt.value })
                          }
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="crosshair-toggles-list">
                  {(crosshairPrefs.mode === 'both' ||
                    crosshairPrefs.mode === 'col') && (
                    <label className="crosshair-mini-toggle">
                      <input
                        type="checkbox"
                        data-testid="pref-crosshair-header-indicator"
                        checked={crosshairPrefs.showHeaderIndicator}
                        onChange={(e) =>
                          updateCrosshairPrefs({
                            showHeaderIndicator: e.target.checked,
                          })
                        }
                      />
                      <span>إظهار شريط وخط التظليل على عنوان اليوم بالأعلى</span>
                    </label>
                  )}

                  <label className="crosshair-mini-toggle">
                    <input
                      type="checkbox"
                      data-testid="pref-crosshair-focus-fallback"
                      checked={crosshairPrefs.showFocusFallback}
                      onChange={(e) =>
                        updateCrosshairPrefs({
                          showFocusFallback: e.target.checked,
                        })
                      }
                    />
                    <span>إبقاء التظليل على الخانة المحددة بعد إبعاد الماوس</span>
                  </label>

                  {(crosshairPrefs.mode === 'both' ||
                    crosshairPrefs.mode === 'row') && (
                    <label className="crosshair-mini-toggle">
                      <input
                        type="checkbox"
                        data-testid="pref-crosshair-cover-period"
                        checked={crosshairPrefs.coverPeriodColumn}
                        onChange={(e) =>
                          updateCrosshairPrefs({
                            coverPeriodColumn: e.target.checked,
                          })
                        }
                      />
                      <span>
                        تمديد تظليل الصف فوق عمود «الفترة» في وضع نظرة واحدة
                      </span>
                    </label>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Live Mini Preview */}
          <div
            className="crosshair-preview-box"
            aria-label="معاينة حية للتظليل"
            style={
              {
                '--crosshair-strength': String(crosshairPrefs.opacity / 100),
              } as React.CSSProperties
            }
          >
            <span className="crosshair-preview-caption">معاينة حية</span>
            <div className="crosshair-preview-table" aria-hidden="true">
              <div className="crosshair-preview-row is-head">
                <span className="cp-cell cp-period">الفترة</span>
                <span className="cp-cell cp-title">العمل</span>
                <span className="cp-cell">سبت</span>
                <span
                  className={`cp-cell ${
                    (crosshairPrefs.mode === 'both' ||
                      crosshairPrefs.mode === 'col') &&
                    crosshairPrefs.showHeaderIndicator
                      ? 'is-head-lit'
                      : ''
                  }`}
                >
                  أحد
                </span>
                <span className="cp-cell">اثنين</span>
              </div>
              {[0, 1, 2].map((rIdx) => {
                const rowLit =
                  rIdx === 1 &&
                  (crosshairPrefs.mode === 'both' ||
                    crosshairPrefs.mode === 'row');
                const colLit =
                  crosshairPrefs.mode === 'both' ||
                  crosshairPrefs.mode === 'col';
                return (
                  <div key={rIdx} className="crosshair-preview-row">
                    <span
                      className={`cp-cell cp-period ${
                        rowLit && crosshairPrefs.coverPeriodColumn
                          ? 'is-row-lit'
                          : ''
                      }`}
                    >
                      {rIdx === 1 ? 'الفجر' : ''}
                    </span>
                    <span
                      className={`cp-cell cp-title ${rowLit ? 'is-row-lit' : ''}`}
                    >
                      {rIdx === 0
                        ? 'السنة'
                        : rIdx === 1
                          ? 'الجماعة'
                          : 'الأذكار'}
                    </span>
                    <span className={`cp-cell ${rowLit ? 'is-row-lit' : ''}`}>
                      <span className="cp-box" />
                    </span>
                    <span
                      className={`cp-cell ${rowLit ? 'is-row-lit' : ''} ${
                        colLit ? 'is-col-lit' : ''
                      }`}
                    >
                      <span className="cp-box is-done">✓</span>
                    </span>
                    <span className={`cp-cell ${rowLit ? 'is-row-lit' : ''}`}>
                      <span className="cp-box" />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

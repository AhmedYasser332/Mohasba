'use client';

import React, { useState } from 'react';
import {
  AR_STRINGS,
  type AsrMadhhab,
  type CalcMethod,
  type PrayerOffsets,
  type RolloverMode,
} from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { CALC_METHODS, CITY_PRESETS } from '../../utils/presets';

interface RolloverFormDraft {
  rolloverMode?: RolloverMode;
  weekStartDay?: number;
  cityName?: string;
  ianaTimezone?: string;
  latitude?: string;
  longitude?: string;
  calcMethod?: CalcMethod;
  asrMadhhab?: AsrMadhhab;
  offsets?: PrayerOffsets;
}

const OFFSET_FIELDS: ReadonlyArray<{
  key: keyof PrayerOffsets;
  label: string;
}> = [
  { key: 'fajr', label: 'إزاحة الفجر (د)' },
  { key: 'sunrise', label: 'إزاحة الشروق (د)' },
  { key: 'dhuhr', label: 'إزاحة الظهر (د)' },
  { key: 'asr', label: 'إزاحة العصر (د)' },
  { key: 'maghrib', label: 'إزاحة المغرب (د)' },
  { key: 'isha', label: 'إزاحة العشاء (د)' },
];

function findMatchingPresetId(params: {
  city_name: string;
  iana_timezone: string;
  latitude: number;
  longitude: number;
  calc_method: CalcMethod;
}): string {
  if (!Number.isFinite(params.latitude) || !Number.isFinite(params.longitude)) {
    return '';
  }
  const match = CITY_PRESETS.find(
    (p) =>
      p.city_name === params.city_name &&
      p.iana_timezone === params.iana_timezone &&
      Math.abs(p.latitude - params.latitude) < 0.0001 &&
      Math.abs(p.longitude - params.longitude) < 0.0001 &&
      p.calc_method === params.calc_method,
  );
  return match?.id ?? '';
}

export function RolloverLocationSection() {
  const { settings, isOnline, updateSettings } = useMohasba();

  const [draft, setDraft] = useState<RolloverFormDraft>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  if (!settings) return null;

  const rolloverMode = draft.rolloverMode ?? settings.rollover_mode;
  const weekStartDay = draft.weekStartDay ?? settings.week_start_day;
  const cityName = draft.cityName ?? settings.city_name;
  const ianaTimezone = draft.ianaTimezone ?? settings.iana_timezone;
  const latitude = draft.latitude ?? String(settings.latitude);
  const longitude = draft.longitude ?? String(settings.longitude);
  const calcMethod = draft.calcMethod ?? settings.calc_method;
  const asrMadhhab = draft.asrMadhhab ?? settings.asr_madhhab;
  const offsets = draft.offsets ?? settings.prayer_offsets;

  const selectedPreset = findMatchingPresetId({
    city_name: cityName,
    iana_timezone: ianaTimezone,
    latitude: Number(latitude),
    longitude: Number(longitude),
    calc_method: calcMethod,
  });

  const applyPreset = (presetId: string) => {
    const preset = CITY_PRESETS.find((c) => c.id === presetId);
    if (!preset) return;
    setDraft((prev) => ({
      ...prev,
      cityName: preset.city_name,
      ianaTimezone: preset.iana_timezone,
      latitude: String(preset.latitude),
      longitude: String(preset.longitude),
      calcMethod: preset.calc_method,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || busy) return;

    const latNum = Number(latitude);
    const lonNum = Number(longitude);
    if (
      !Number.isFinite(latNum) ||
      latNum < -90 ||
      latNum > 90 ||
      !Number.isFinite(lonNum) ||
      lonNum < -180 ||
      lonNum > 180
    ) {
      setFeedback({
        text: 'إحداثيات خط العرض والطول غير صالحة.',
        isError: true,
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const res = await updateSettings({
        rollover_mode: rolloverMode,
        week_start_day: weekStartDay,
        city_name: cityName.trim(),
        iana_timezone: ianaTimezone.trim(),
        latitude: latNum,
        longitude: lonNum,
        calc_method: calcMethod,
        asr_madhhab: asrMadhhab,
        prayer_offsets: offsets,
      });

      if (res.ok) {
        setDraft({});
        setFeedback({
          text: 'تم حفظ إعدادات اليوم المحاسبي والموقع والمواقيت.',
          isError: false,
        });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر حفظ الإعدادات.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="settings-body"
      onSubmit={(e) => {
        void handleSave(e);
      }}
    >
      <span className="panel-meta">
        حساب محلي للمواقيت دون اتصال مع دعم الفوارق اليدوية
      </span>

      {feedback && (
        <div className={`status-note ${feedback.isError ? 'is-error' : ''}`}>
          {feedback.text}
        </div>
      )}

      <div className="field-grid-3">
        <label className="field-label">
          <span>بداية اليوم المحاسبي</span>
          <select
            className="field-select"
            data-testid="settings-rollover-select"
            value={rolloverMode}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                rolloverMode: e.target.value as RolloverMode,
              }))
            }
          >
            <option value="FAJR">{AR_STRINGS.settings.rolloverFajr}</option>
            <option value="MIDNIGHT">
              {AR_STRINGS.settings.rolloverMidnight}
            </option>
          </select>
        </label>

        <label className="field-label">
          <span>بداية الأسبوع</span>
          <select
            className="field-select"
            value={weekStartDay}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                weekStartDay: Number(e.target.value),
              }))
            }
          >
            {AR_STRINGS.week.weekdaysAr.map((name, idx) => (
              <option key={name} value={idx}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          <span>مدينة جاهزة</span>
          <select
            className="field-select"
            data-testid="settings-city-preset-select"
            value={selectedPreset}
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="">اختر مدينة لتعبئة الإحداثيات...</option>
            {CITY_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.city_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field-grid">
        <label className="field-label">
          <span>اسم المدينة</span>
          <input
            type="text"
            className="field-input"
            required
            maxLength={100}
            value={cityName}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, cityName: e.target.value }))
            }
          />
        </label>

        <label className="field-label">
          <span>المنطقة الزمنية (IANA)</span>
          <input
            type="text"
            className="field-input nums"
            dir="ltr"
            required
            maxLength={64}
            value={ianaTimezone}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, ianaTimezone: e.target.value }))
            }
          />
        </label>
      </div>

      <div className="field-grid">
        <label className="field-label">
          <span>خط العرض (Latitude)</span>
          <input
            type="number"
            className="field-input nums"
            dir="ltr"
            step="any"
            min={-90}
            max={90}
            required
            value={latitude}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, latitude: e.target.value }))
            }
          />
        </label>

        <label className="field-label">
          <span>خط الطول (Longitude)</span>
          <input
            type="number"
            className="field-input nums"
            dir="ltr"
            step="any"
            min={-180}
            max={180}
            required
            value={longitude}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, longitude: e.target.value }))
            }
          />
        </label>
      </div>

      <div className="field-grid">
        <label className="field-label">
          <span>طريقة الحساب</span>
          <select
            className="field-select"
            value={calcMethod}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                calcMethod: e.target.value as CalcMethod,
              }))
            }
          >
            {CALC_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          <span>مذهب العصر</span>
          <select
            className="field-select"
            value={asrMadhhab}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                asrMadhhab: e.target.value as AsrMadhhab,
              }))
            }
          >
            <option value="Shafi">الجمهور (الشافعي / المالكي / الحنبلي)</option>
            <option value="Hanafi">الحنفي</option>
          </select>
        </label>
      </div>

      <div className="field-grid-3">
        {OFFSET_FIELDS.map((field) => (
          <label key={field.key} className="field-label">
            <span>{field.label}</span>
            <input
              type="number"
              className="field-input nums"
              min={-180}
              max={180}
              value={offsets[field.key]}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  offsets: {
                    ...(prev.offsets ?? settings.prayer_offsets),
                    [field.key]: Math.min(
                      180,
                      Math.max(-180, Number(e.target.value) || 0),
                    ),
                  },
                }))
              }
            />
          </label>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="btn btn-live"
          data-testid="settings-rollover-save"
          disabled={!isOnline || busy}
        >
          حفظ إعدادات اليوم والمواقيت
        </button>
      </div>
    </form>
  );
}

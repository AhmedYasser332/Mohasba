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

interface CityPreset {
  id: string;
  city_name: string;
  iana_timezone: string;
  latitude: number;
  longitude: number;
  calc_method: CalcMethod;
}

const CITY_PRESETS: ReadonlyArray<CityPreset> = [
  {
    id: 'cairo',
    city_name: 'القاهرة',
    iana_timezone: 'Africa/Cairo',
    latitude: 30.0444,
    longitude: 31.2357,
    calc_method: 'Egyptian',
  },
  {
    id: 'alexandria',
    city_name: 'الإسكندرية',
    iana_timezone: 'Africa/Cairo',
    latitude: 31.2001,
    longitude: 29.9187,
    calc_method: 'Egyptian',
  },
  {
    id: 'makkah',
    city_name: 'مكة المكرمة',
    iana_timezone: 'Asia/Riyadh',
    latitude: 21.4225,
    longitude: 39.8262,
    calc_method: 'UmmAlQura',
  },
  {
    id: 'madinah',
    city_name: 'المدينة المنورة',
    iana_timezone: 'Asia/Riyadh',
    latitude: 24.4672,
    longitude: 39.6112,
    calc_method: 'UmmAlQura',
  },
  {
    id: 'riyadh',
    city_name: 'الرياض',
    iana_timezone: 'Asia/Riyadh',
    latitude: 24.7136,
    longitude: 46.6753,
    calc_method: 'UmmAlQura',
  },
  {
    id: 'dubai',
    city_name: 'دبي',
    iana_timezone: 'Asia/Dubai',
    latitude: 25.2048,
    longitude: 55.2708,
    calc_method: 'Dubai',
  },
  {
    id: 'istanbul',
    city_name: 'إسطنبول',
    iana_timezone: 'Europe/Istanbul',
    latitude: 41.0082,
    longitude: 28.9784,
    calc_method: 'Turkey',
  },
  {
    id: 'london',
    city_name: 'لندن',
    iana_timezone: 'Europe/London',
    latitude: 51.5072,
    longitude: -0.1276,
    calc_method: 'MWL',
  },
];

const CALC_METHODS: ReadonlyArray<{ value: CalcMethod; label: string }> = [
  { value: 'Egyptian', label: 'الهيئة المصرية العامة للمساحة' },
  { value: 'UmmAlQura', label: 'أم القرى' },
  { value: 'MWL', label: 'رابطة العالم الإسلامي' },
  { value: 'ISNA', label: 'الجمعية الإسلامية لأمريكا الشمالية (ISNA)' },
  { value: 'Karachi', label: 'جامعة العلوم الإسلامية بكراتشي' },
  { value: 'Dubai', label: 'دائرة الشؤون الإسلامية بدبي' },
  { value: 'Kuwait', label: 'الكويت' },
  { value: 'Qatar', label: 'قطر' },
  { value: 'Turkey', label: 'رئاسة الشؤون الدينية التركية' },
  { value: 'Singapore', label: 'سنغافورة' },
  { value: 'MoonsightingCommittee', label: 'لجنة تحري الهلال' },
];

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

export function RolloverLocationSection() {
  const { settings, isOnline, updateSettings } = useMohasba();

  const [rolloverMode, setRolloverMode] = useState<RolloverMode>(
    settings?.rollover_mode ?? 'FAJR',
  );
  const [weekStartDay, setWeekStartDay] = useState<number>(
    settings?.week_start_day ?? 6,
  );
  const [cityName, setCityName] = useState(settings?.city_name ?? 'القاهرة');
  const [ianaTimezone, setIanaTimezone] = useState(
    settings?.iana_timezone ?? 'Africa/Cairo',
  );
  const [latitude, setLatitude] = useState(String(settings?.latitude ?? 30.0444));
  const [longitude, setLongitude] = useState(
    String(settings?.longitude ?? 31.2357),
  );
  const [calcMethod, setCalcMethod] = useState<CalcMethod>(
    settings?.calc_method ?? 'Egyptian',
  );
  const [asrMadhhab, setAsrMadhhab] = useState<AsrMadhhab>(
    settings?.asr_madhhab ?? 'Shafi',
  );
  const [offsets, setOffsets] = useState<PrayerOffsets>(
    settings?.prayer_offsets ?? {
      fajr: 0,
      sunrise: 0,
      dhuhr: 0,
      asr: 0,
      maghrib: 0,
      isha: 0,
    },
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  if (!settings) return null;

  const applyPreset = (presetId: string) => {
    const preset = CITY_PRESETS.find((c) => c.id === presetId);
    if (!preset) return;
    setCityName(preset.city_name);
    setIanaTimezone(preset.iana_timezone);
    setLatitude(String(preset.latitude));
    setLongitude(String(preset.longitude));
    setCalcMethod(preset.calc_method);
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
    <section className="panel" data-testid="settings-rollover-section">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">
            {AR_STRINGS.settings.rolloverSectionTitle}
          </h3>
          <span className="panel-meta">
            حساب محلي للمواقيت دون اتصال مع دعم الفوارق اليدوية
          </span>
        </div>
      </div>

      <form
        className="settings-body"
        onSubmit={(e) => {
          void handleSave(e);
        }}
      >
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
              onChange={(e) => setRolloverMode(e.target.value as RolloverMode)}
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
              onChange={(e) => setWeekStartDay(Number(e.target.value))}
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
              defaultValue=""
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="" disabled>
                اختر مدينة لتعبئة الإحداثيات...
              </option>
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
              onChange={(e) => setCityName(e.target.value)}
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
              onChange={(e) => setIanaTimezone(e.target.value)}
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
              onChange={(e) => setLatitude(e.target.value)}
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
              onChange={(e) => setLongitude(e.target.value)}
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="field-label">
            <span>طريقة الحساب</span>
            <select
              className="field-select"
              value={calcMethod}
              onChange={(e) => setCalcMethod(e.target.value as CalcMethod)}
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
              onChange={(e) => setAsrMadhhab(e.target.value as AsrMadhhab)}
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
                  setOffsets((prev) => ({
                    ...prev,
                    [field.key]: Math.min(
                      180,
                      Math.max(-180, Number(e.target.value) || 0),
                    ),
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
    </section>
  );
}

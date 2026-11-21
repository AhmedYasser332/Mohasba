import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  computePrayerTimesForDay,
  diffDaysIso,
  formatLocalIsoDate,
  getIsoDayOfWeek,
  getLocalTimeParts,
  getWeekDates,
  isTimeInQuietHours,
  isWindowExpired,
  resolveActiveWindow,
  resolveIslamicDate,
  resolvePeriodWindowsForDay,
  zonedWallClockToUtc,
  type PrayerSettingsInput,
} from '@/domain/prayer-engine';
import { buildStarterPack, STARTER_PACK_PERIOD_IDS } from '@/domain/starter-pack';
import type { Period } from '@/domain/types';

const CAIRO_SETTINGS: PrayerSettingsInput = {
  rollover_mode: 'FAJR',
  iana_timezone: 'Africa/Cairo',
  latitude: 30.0444,
  longitude: 31.2357,
  calc_method: 'Egyptian',
  asr_madhhab: 'Shafi',
  prayer_offsets: {
    fajr: 0,
    sunrise: 0,
    dhuhr: 0,
    asr: 0,
    maghrib: 0,
    isha: 0,
  },
};

function hhmmInTz(epochMs: number, tz: string): string {
  const parts = getLocalTimeParts(epochMs, tz);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

describe('prayer-engine', () => {
  describe('pure ISO calendar helpers', () => {
    it('adds and diffs calendar days across month/leap boundaries', () => {
      expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
      expect(addDaysIso('2024-02-29', 1)).toBe('2024-03-01');
      expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
      expect(diffDaysIso('2026-01-01', '2026-01-10')).toBe(9);
      expect(diffDaysIso('2026-01-10', '2026-01-01')).toBe(-9);
    });

    it('computes 0=Sun..6=Sat weekday and 7-day week ranges', () => {
      // 2026-11-21 is Saturday (6)
      expect(getIsoDayOfWeek('2026-11-21')).toBe(6);
      expect(getIsoDayOfWeek('2026-11-22')).toBe(0);
      expect(getIsoDayOfWeek('2026-11-27')).toBe(5);

      const satWeek = getWeekDates('2026-11-25', 6);
      expect(satWeek).toEqual([
        '2026-11-21',
        '2026-11-22',
        '2026-11-23',
        '2026-11-24',
        '2026-11-25',
        '2026-11-26',
        '2026-11-27',
      ]);

      const monWeek = getWeekDates('2026-11-22', 1);
      expect(monWeek[0]).toBe('2026-11-16');
      expect(monWeek[6]).toBe('2026-11-22');
    });

    it('formats local ISO date strictly in the configured iana_timezone', () => {
      // 2026-11-21T22:30:00Z is 2026-11-22 00:30 in Africa/Cairo (UTC+2)
      const instant = new Date('2026-11-21T22:30:00.000Z');
      expect(formatLocalIsoDate(instant, 'Africa/Cairo')).toBe('2026-11-22');
      expect(formatLocalIsoDate(instant, 'UTC')).toBe('2026-11-21');
      expect(formatLocalIsoDate(instant, 'America/New_York')).toBe('2026-11-21');
    });
  });

  describe('zonedWallClockToUtc DST transitions', () => {
    it('resolves Egypt spring-forward non-existent gap (2026-04-24 00:30) to first valid instant after jump (01:00 Cairo)', () => {
      // Egypt spring-forward: 2026-04-24 00:00 -> 01:00 (at 2026-04-23T22:00:00Z)
      const resolved = zonedWallClockToUtc('2026-04-24', '00:30', 'Africa/Cairo');
      const parts = getLocalTimeParts(resolved, 'Africa/Cairo');
      expect(parts.isoDate).toBe('2026-04-24');
      expect(parts.hour).toBe(1);
      expect(parts.minute).toBe(0);
      expect(new Date(resolved).toISOString()).toBe('2026-04-23T22:00:00.000Z');
    });

    it('resolves Egypt fall-back repeated overlap (2026-10-29 23:30) to earlier occurrence (UTC+3 = 20:30Z)', () => {
      // Egypt fall-back: 2026-10-29 23:00..23:59 occurs twice (UTC+3 at 20:xxZ, UTC+2 at 21:xxZ)
      const resolved = zonedWallClockToUtc('2026-10-29', '23:30', 'Africa/Cairo');
      expect(new Date(resolved).toISOString()).toBe('2026-10-29T20:30:00.000Z');
      const parts = getLocalTimeParts(resolved, 'Africa/Cairo');
      expect(parts.isoDate).toBe('2026-10-29');
      expect(parts.hour).toBe(23);
      expect(parts.minute).toBe(30);
    });

    it('resolves US spring-forward gap and fall-back overlap deterministically', () => {
      // America/New_York 2026-03-08 02:30 -> 03:00 EDT (07:00Z)
      const nyGap = zonedWallClockToUtc('2026-03-08', '02:30', 'America/New_York');
      expect(new Date(nyGap).toISOString()).toBe('2026-03-08T07:00:00.000Z');

      // America/New_York 2026-11-01 01:30 -> earlier EDT (05:30Z, not 06:30Z)
      const nyOverlap = zonedWallClockToUtc('2026-11-01', '01:30', 'America/New_York');
      expect(new Date(nyOverlap).toISOString()).toBe('2026-11-01T05:30:00.000Z');
    });
  });

  describe('Cairo timetable parity & manual offsets', () => {
    it('matches Egyptian General Authority of Survey Cairo times within +/- 2 min and applies manual offsets', () => {
      const jan15 = computePrayerTimesForDay('2026-01-15', CAIRO_SETTINGS);
      // Authoritative Cairo winter timetable for mid-January (approx 05:20, 06:51, 12:04, 14:58, 17:17, 18:38)
      const expectedJan15 = {
        fajr: '05:20',
        sunrise: '06:51',
        dhuhr: '12:05',
        asr: '14:58',
        maghrib: '17:17',
        isha: '18:38',
      };

      for (const key of [
        'fajr',
        'sunrise',
        'dhuhr',
        'asr',
        'maghrib',
        'isha',
      ] as const) {
        const computed = hhmmInTz(jan15[key], 'Africa/Cairo');
        const diff = Math.abs(
          minutesSinceMidnight(computed) -
            minutesSinceMidnight(expectedJan15[key]),
        );
        expect(diff).toBeLessThanOrEqual(2);
      }

      const jul15 = computePrayerTimesForDay('2026-07-15', CAIRO_SETTINGS);
      expect(hhmmInTz(jul15.fajr, 'Africa/Cairo')).toBe('04:21');
      expect(hhmmInTz(jul15.maghrib, 'Africa/Cairo')).toBe('19:58');

      // Manual offsets
      const withOffsets = computePrayerTimesForDay('2026-01-15', {
        ...CAIRO_SETTINGS,
        prayer_offsets: {
          fajr: 3,
          sunrise: -2,
          dhuhr: 1,
          asr: 0,
          maghrib: 2,
          isha: -4,
        },
      });
      expect(withOffsets.fajr - jan15.fajr).toBe(3 * 60_000);
      expect(withOffsets.sunrise - jan15.sunrise).toBe(-2 * 60_000);
      expect(withOffsets.dhuhr - jan15.dhuhr).toBe(1 * 60_000);
      expect(withOffsets.maghrib - jan15.maghrib).toBe(2 * 60_000);
      expect(withOffsets.isha - jan15.isha).toBe(-4 * 60_000);
    });

    it('computes identical UTC prayer instants regardless of host timezone', () => {
      // Simulate settings in Asia/Riyadh while host may be UTC or EET or America
      const riyadh: PrayerSettingsInput = {
        ...CAIRO_SETTINGS,
        iana_timezone: 'Asia/Riyadh',
        latitude: 24.7136,
        longitude: 46.6753,
        calc_method: 'UmmAlQura',
      };
      const times = computePrayerTimesForDay('2026-05-10', riyadh);
      // Verify instants fall sequentially on 2026-05-10 in Asia/Riyadh
      expect(formatLocalIsoDate(times.fajr, 'Asia/Riyadh')).toBe('2026-05-10');
      expect(times.fajr).toBeLessThan(times.sunrise);
      expect(times.sunrise).toBeLessThan(times.dhuhr);
      expect(times.dhuhr).toBeLessThan(times.asr);
      expect(times.asr).toBeLessThan(times.maghrib);
      expect(times.maghrib).toBeLessThan(times.isha);
    });
  });

  describe('Islamic day rollover (FAJR vs MIDNIGHT), cross-midnight bounds & Horizon Rail', () => {
    const { periods } = buildStarterPack('2026-01-01');

    it('attributes 01:20 AM to D-1 in FAJR mode and flips to D at 04:55 AM post-Fajr', () => {
      // On 2026-04-20 in Cairo, check Fajr time first
      const d = '2026-04-20';
      const prayersD = computePrayerTimesForDay(d, CAIRO_SETTINGS);
      const fajrLocal = hhmmInTz(prayersD.fajr, 'Africa/Cairo');
      expect(fajrLocal < '04:55').toBe(true);

      const at0120 = zonedWallClockToUtc(d, '01:20', 'Africa/Cairo');
      expect(resolveIslamicDate(at0120, CAIRO_SETTINGS)).toBe('2026-04-19');

      const res0120 = resolveActiveWindow(at0120, periods, CAIRO_SETTINGS);
      expect(res0120.islamicDate).toBe('2026-04-19');
      expect(res0120.primaryWindow?.periodId).toBe(
        STARTER_PACK_PERIOD_IDS.ISHA_QIYAM,
      );
      expect(res0120.primaryWindow?.islamicDate).toBe('2026-04-19');
      // Cross-midnight Isha ends at Fajr(2026-04-20), NOT Fajr(2026-04-19)
      expect(res0120.primaryWindow?.endInstant).toBe(prayersD.fajr);
      expect(isWindowExpired(res0120.primaryWindow!, at0120)).toBe(false);

      // At 04:55 AM (post-Fajr), accountability_date flips to D and D-1's Isha is EXPIRED
      const at0455 = zonedWallClockToUtc(d, '04:55', 'Africa/Cairo');
      expect(resolveIslamicDate(at0455, CAIRO_SETTINGS)).toBe('2026-04-20');
      const res0455 = resolveActiveWindow(at0455, periods, CAIRO_SETTINGS);
      expect(res0455.primaryWindow?.periodId).toBe(STARTER_PACK_PERIOD_IDS.FAJR);
      expect(res0455.primaryWindow?.islamicDate).toBe('2026-04-20');
      expect(isWindowExpired(res0120.primaryWindow!, at0455)).toBe(true);
    });

    it('in MIDNIGHT mode, flips date at 00:00 while keeping D-1 Isha open until Fajr(D)', () => {
      const midnightSettings: PrayerSettingsInput = {
        ...CAIRO_SETTINGS,
        rollover_mode: 'MIDNIGHT',
      };
      const d = '2026-04-20';
      const at0120 = zonedWallClockToUtc(d, '01:20', 'Africa/Cairo');
      expect(resolveIslamicDate(at0120, midnightSettings)).toBe('2026-04-20');

      const res0120 = resolveActiveWindow(at0120, periods, midnightSettings);
      expect(res0120.primaryWindow?.periodId).toBe(
        STARTER_PACK_PERIOD_IDS.ISHA_QIYAM,
      );
      expect(res0120.primaryWindow?.islamicDate).toBe('2026-04-19');
      expect(res0120.primaryWindow?.isOpen).toBe(true);
    });

    it('survives 23h spring-forward and 25h fall-back DST nights for Isha cross-midnight window', () => {
      // Egypt spring-forward: night between 2026-04-23 and 2026-04-24 loses 1h
      const springWindows = resolvePeriodWindowsForDay(
        '2026-04-23',
        periods,
        CAIRO_SETTINGS,
      );
      const ishaSpring = springWindows.find(
        (w) => w.periodId === STARTER_PACK_PERIOD_IDS.ISHA_QIYAM,
      )!;
      const ishaSpringStart = computePrayerTimesForDay(
        '2026-04-23',
        CAIRO_SETTINGS,
      ).isha;
      const fajrApr24 = computePrayerTimesForDay('2026-04-24', CAIRO_SETTINGS).fajr;
      expect(ishaSpring.startInstant).toBe(ishaSpringStart);
      expect(ishaSpring.endInstant).toBe(fajrApr24);
      expect(ishaSpring.endInstant).toBeGreaterThan(ishaSpring.startInstant);

      // Egypt fall-back: night between 2026-10-29 and 2026-10-30 gains 1h
      const fallWindows = resolvePeriodWindowsForDay(
        '2026-10-29',
        periods,
        CAIRO_SETTINGS,
      );
      const ishaFall = fallWindows.find(
        (w) => w.periodId === STARTER_PACK_PERIOD_IDS.ISHA_QIYAM,
      )!;
      const fajrOct30 = computePrayerTimesForDay('2026-10-30', CAIRO_SETTINGS).fajr;
      expect(ishaFall.endInstant).toBe(fajrOct30);
      expect(ishaFall.endInstant - ishaFall.startInstant).toBeGreaterThan(
        9 * 3600_000,
      );
    });

    it('computes Horizon Rail elapsedRatio (0..1) and isPreExpiry <= ntfy_offset_min (25m)', () => {
      const fajrPeriod: Period = {
        ...periods[0]!,
        ntfy_mode: 'pre_expiry',
        ntfy_offset_min: 25,
      };
      const prayers = computePrayerTimesForDay('2026-01-15', CAIRO_SETTINGS);
      const duration = prayers.sunrise - prayers.fajr;

      const atMid = prayers.fajr + Math.floor(duration / 2);
      const midWin = resolvePeriodWindowsForDay(
        '2026-01-15',
        [fajrPeriod],
        CAIRO_SETTINGS,
        atMid,
      )[0]!;
      expect(midWin.elapsedRatio).toBeCloseTo(0.5, 2);
      expect(midWin.isPreExpiry).toBe(false);
      expect(midWin.isOpen).toBe(true);

      const at20mLeft = prayers.sunrise - 20 * 60_000;
      const preWin = resolvePeriodWindowsForDay(
        '2026-01-15',
        [fajrPeriod],
        CAIRO_SETTINGS,
        at20mLeft,
      )[0]!;
      expect(preWin.isPreExpiry).toBe(true);
      expect(preWin.remainingMinutes).toBeCloseTo(20, 2);

      const atEnd = prayers.sunrise;
      const expWin = resolvePeriodWindowsForDay(
        '2026-01-15',
        [fajrPeriod],
        CAIRO_SETTINGS,
        atEnd,
      )[0]!;
      expect(expWin.elapsedRatio).toBe(1);
      expect(expWin.isPreExpiry).toBe(false);
      expect(expWin.isExpired).toBe(true);
    });

    it('handles custom FIXED_TIME Qiyam window (01:00 -> FAJR) under FAJR rollover', () => {
      const qiyamPeriod: Period = {
        id: '10000000-0000-4000-8000-000000000099',
        title: 'الليل',
        side: 'TIME_BOUND',
        sort_order: 7,
        start_anchor: 'FIXED_TIME',
        start_offset_min: 0,
        start_fixed_hhmm: '01:00',
        end_anchor: 'FAJR',
        end_offset_min: 0,
        end_fixed_hhmm: null,
        ntfy_enabled: true,
        ntfy_mode: 'pre_expiry',
        ntfy_offset_min: 25,
        active_from: '2026-01-01',
        archived_at: null,
      };
      // For Islamic date 2026-01-15, 01:00 AM Qiyam occurs on civil 2026-01-16
      const win = resolvePeriodWindowsForDay(
        '2026-01-15',
        [qiyamPeriod],
        CAIRO_SETTINGS,
      )[0]!;
      expect(formatLocalIsoDate(win.startInstant, 'Africa/Cairo')).toBe(
        '2026-01-16',
      );
      expect(hhmmInTz(win.startInstant, 'Africa/Cairo')).toBe('01:00');
      expect(win.endInstant).toBe(
        computePrayerTimesForDay('2026-01-16', CAIRO_SETTINGS).fajr,
      );
    });

    it('evaluates overnight quiet hours correctly', () => {
      const settings = {
        iana_timezone: 'Africa/Cairo',
        quiet_start_hhmm: '23:00',
        quiet_end_hhmm: '04:00',
      };
      expect(
        isTimeInQuietHours(
          zonedWallClockToUtc('2026-01-15', '23:30', 'Africa/Cairo'),
          settings,
        ),
      ).toBe(true);
      expect(
        isTimeInQuietHours(
          zonedWallClockToUtc('2026-01-16', '02:00', 'Africa/Cairo'),
          settings,
        ),
      ).toBe(true);
      expect(
        isTimeInQuietHours(
          zonedWallClockToUtc('2026-01-16', '04:00', 'Africa/Cairo'),
          settings,
        ),
      ).toBe(false);
    });
  });
});

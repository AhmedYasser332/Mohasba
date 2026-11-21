import {
  CalculationMethod,
  CalculationParameters,
  Coordinates,
  Madhab,
  PrayerTimes,
} from 'adhan';
import type {
  AppSettings,
  AsrMadhhab,
  CalcMethod,
  Period,
  PrayerAnchor,
  PrayerOffsets,
} from './types';

export type PrayerSettingsInput = Pick<
  AppSettings,
  | 'rollover_mode'
  | 'iana_timezone'
  | 'latitude'
  | 'longitude'
  | 'calc_method'
  | 'asr_madhhab'
  | 'prayer_offsets'
>;

export interface IsoDateParts {
  year: number;
  month: number;
  day: number;
}

export interface LocalTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  isoDate: string;
}

export interface PrayerTimesForDay {
  isoDate: string;
  fajr: number;
  sunrise: number;
  dhuhr: number;
  asr: number;
  maghrib: number;
  isha: number;
}

export interface ResolvedPeriodWindow {
  periodId: string;
  period: Period;
  islamicDate: string;
  startInstant: number;
  endInstant: number;
  elapsedRatio: number;
  remainingMinutes: number;
  isPreExpiry: boolean;
  isOpen: boolean;
  isExpired: boolean;
}

export interface ActiveWindowResolution {
  islamicDate: string;
  civilDate: string;
  windows3Day: ResolvedPeriodWindow[];
  activeWindows: ResolvedPeriodWindow[];
  primaryWindow: ResolvedPeriodWindow | null;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(ianaTimezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(ianaTimezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: ianaTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(ianaTimezone, fmt);
  }
  return fmt;
}

export function parseIsoDateParts(isoDate: string): IsoDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${isoDate}`);
  }
  return { year, month, day };
}

export function formatIsoDateParts(
  year: number,
  month: number,
  day: number,
): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(isoDate: string, deltaDays: number): string {
  const { year, month, day } = parseIsoDateParts(isoDate);
  const utc = Date.UTC(year, month - 1, day + deltaDays);
  const d = new Date(utc);
  return formatIsoDateParts(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
  );
}

export function diffDaysIso(fromIso: string, toIso: string): number {
  const a = parseIsoDateParts(fromIso);
  const b = parseIsoDateParts(toIso);
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / MS_PER_DAY);
}

/** 0 = Sunday .. 6 = Saturday */
export function getIsoDayOfWeek(isoDate: string): number {
  const { year, month, day } = parseIsoDateParts(isoDate);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function getWeekDates(
  anchorIso: string,
  weekStartDay: number,
): string[] {
  const dow = getIsoDayOfWeek(anchorIso);
  const offset = (dow - weekStartDay + 7) % 7;
  const startIso = addDaysIso(anchorIso, -offset);
  const dates: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    dates.push(addDaysIso(startIso, i));
  }
  return dates;
}

export function getLocalTimeParts(
  date: Date | number,
  ianaTimezone: string,
): LocalTimeParts {
  const d = typeof date === 'number' ? new Date(date) : date;
  const parts = getFormatter(ianaTimezone).formatToParts(d);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'second') second = Number(part.value);
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    isoDate: formatIsoDateParts(year, month, day),
  };
}

export function formatLocalIsoDate(
  date: Date | number,
  ianaTimezone: string,
): string {
  return getLocalTimeParts(date, ianaTimezone).isoDate;
}

function localWallClockAsUtcMs(instantMs: number, ianaTimezone: string): number {
  const p = getLocalTimeParts(instantMs, ianaTimezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

function getTzOffsetMs(instantMs: number, ianaTimezone: string): number {
  const flooredSecMs = Math.floor(instantMs / 1000) * 1000;
  return localWallClockAsUtcMs(flooredSecMs, ianaTimezone) - flooredSecMs;
}

function parseHhmm(hhmm: string): { hour: number; minute: number } {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(hhmm);
  if (!match) {
    throw new Error(`Invalid HH:MM time: ${hhmm}`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Two-pass DST-safe wall-clock to UTC epoch milliseconds converter.
 * - Spring-forward non-existent gap: resolves forward to the first valid instant after the jump.
 * - Fall-back repeated overlap: resolves to the earlier (first) occurrence.
 */
export function zonedWallClockToUtc(
  isoDate: string,
  hhmm: string,
  ianaTimezone: string,
): number {
  const { year, month, day } = parseIsoDateParts(isoDate);
  const { hour, minute } = parseHhmm(hhmm);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  // Pass 1 & Pass 2
  const off1 = getTzOffsetMs(targetAsUtc, ianaTimezone);
  const t1 = targetAsUtc - off1;
  const off2 = getTzOffsetMs(t1, ianaTimezone);
  const t2 = targetAsUtc - off2;

  // Check earlier occurrence in case of fall-back overlap
  const offBefore = getTzOffsetMs(t2 - 2 * MS_PER_HOUR, ianaTimezone);
  const tEarly = targetAsUtc - offBefore;

  const matchesEarly =
    localWallClockAsUtcMs(tEarly, ianaTimezone) === targetAsUtc;
  const matchesT2 = localWallClockAsUtcMs(t2, ianaTimezone) === targetAsUtc;

  if (matchesEarly && matchesT2) {
    return Math.min(tEarly, t2);
  }
  if (matchesEarly) {
    return tEarly;
  }
  if (matchesT2) {
    return t2;
  }

  // Spring-forward non-existent gap: binary search for the exact first valid instant >= target
  let loSec = Math.floor((Math.min(t1, t2) - MS_PER_HOUR) / 1000);
  let hiSec = Math.ceil((Math.max(t1, t2) + MS_PER_HOUR) / 1000);
  while (loSec < hiSec) {
    const midSec = Math.floor((loSec + hiSec) / 2);
    if (localWallClockAsUtcMs(midSec * 1000, ianaTimezone) >= targetAsUtc) {
      hiSec = midSec;
    } else {
      loSec = midSec + 1;
    }
  }
  return loSec * 1000;
}

function buildCalculationParameters(
  calcMethod: CalcMethod,
  asrMadhhab: AsrMadhhab,
  offsets: PrayerOffsets,
): CalculationParameters {
  let params: CalculationParameters;
  switch (calcMethod) {
    case 'Egyptian':
      params = CalculationMethod.Egyptian();
      break;
    case 'UmmAlQura':
      params = CalculationMethod.UmmAlQura();
      break;
    case 'MWL':
      params = CalculationMethod.MuslimWorldLeague();
      break;
    case 'ISNA':
      params = CalculationMethod.NorthAmerica();
      break;
    case 'Karachi':
      params = CalculationMethod.Karachi();
      break;
    case 'Dubai':
      params = CalculationMethod.Dubai();
      break;
    case 'Kuwait':
      params = CalculationMethod.Kuwait();
      break;
    case 'Qatar':
      params = CalculationMethod.Qatar();
      break;
    case 'Turkey':
      params = CalculationMethod.Turkey();
      break;
    case 'Singapore':
      params = CalculationMethod.Singapore();
      break;
    case 'MoonsightingCommittee':
      params = CalculationMethod.MoonsightingCommittee();
      break;
  }

  params.madhab = asrMadhhab === 'Hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  params.adjustments.fajr = offsets.fajr;
  params.adjustments.sunrise = offsets.sunrise;
  params.adjustments.dhuhr = offsets.dhuhr;
  params.adjustments.asr = offsets.asr;
  params.adjustments.maghrib = offsets.maghrib;
  params.adjustments.isha = offsets.isha;

  return params;
}

export function computePrayerTimesForDay(
  isoDate: string,
  settings: PrayerSettingsInput,
): PrayerTimesForDay {
  const { year, month, day } = parseIsoDateParts(isoDate);
  // Construct noon Date from iana_timezone calendar parts so host timezone never shifts date parts.
  const noonDate = new Date(year, month - 1, day, 12, 0, 0);
  const coordinates = new Coordinates(settings.latitude, settings.longitude);
  const params = buildCalculationParameters(
    settings.calc_method,
    settings.asr_madhhab,
    settings.prayer_offsets,
  );
  const pt = new PrayerTimes(coordinates, noonDate, params);

  return {
    isoDate,
    fajr: pt.fajr.getTime(),
    sunrise: pt.sunrise.getTime(),
    dhuhr: pt.dhuhr.getTime(),
    asr: pt.asr.getTime(),
    maghrib: pt.maghrib.getTime(),
    isha: pt.isha.getTime(),
  };
}

function toEpochMs(now: Date | number): number {
  return typeof now === 'number' ? now : now.getTime();
}

export function resolveIslamicDate(
  now: Date | number,
  settings: PrayerSettingsInput,
): string {
  const nowMs = toEpochMs(now);
  const civilDate = formatLocalIsoDate(nowMs, settings.iana_timezone);
  if (settings.rollover_mode === 'MIDNIGHT') {
    return civilDate;
  }
  const todayPrayers = computePrayerTimesForDay(civilDate, settings);
  return nowMs < todayPrayers.fajr ? addDaysIso(civilDate, -1) : civilDate;
}

export function resolveIslamicDayEndInstant(
  islamicDate: string,
  settings: PrayerSettingsInput,
): number {
  const nextIso = addDaysIso(islamicDate, 1);
  if (settings.rollover_mode === 'MIDNIGHT') {
    return zonedWallClockToUtc(nextIso, '00:00', settings.iana_timezone);
  }
  return computePrayerTimesForDay(nextIso, settings).fajr;
}

function resolveAnchorInstant(
  isoDate: string,
  anchor: PrayerAnchor,
  offsetMin: number,
  fixedHhmm: string | null,
  prayersForDay: PrayerTimesForDay,
  ianaTimezone: string,
): number {
  let baseMs: number;
  switch (anchor) {
    case 'FAJR':
      baseMs = prayersForDay.fajr;
      break;
    case 'SUNRISE':
      baseMs = prayersForDay.sunrise;
      break;
    case 'DHUHR':
      baseMs = prayersForDay.dhuhr;
      break;
    case 'ASR':
      baseMs = prayersForDay.asr;
      break;
    case 'MAGHRIB':
      baseMs = prayersForDay.maghrib;
      break;
    case 'ISHA':
      baseMs = prayersForDay.isha;
      break;
    case 'FIXED_TIME':
      if (!fixedHhmm) {
        throw new Error('FIXED_TIME anchor requires fixed HH:MM');
      }
      baseMs = zonedWallClockToUtc(isoDate, fixedHhmm, ianaTimezone);
      break;
  }
  return baseMs + offsetMin * MS_PER_MINUTE;
}

export function isWindowExpired(
  window: Pick<ResolvedPeriodWindow, 'endInstant'>,
  now: Date | number,
): boolean {
  return toEpochMs(now) >= window.endInstant;
}

export function resolvePeriodWindowsForDay(
  isoDate: string,
  periods: Period[],
  settings: PrayerSettingsInput,
  now: Date | number = Date.now(),
  options?: { includeInactive?: boolean },
): ResolvedPeriodWindow[] {
  const nowMs = toEpochMs(now);
  const nextIso = addDaysIso(isoDate, 1);
  const prayersD = computePrayerTimesForDay(isoDate, settings);
  const prayersNext = computePrayerTimesForDay(nextIso, settings);
  const includeInactive = options?.includeInactive ?? false;

  const sortedPeriods = [...periods]
    .filter((p) => {
      if (p.side !== 'TIME_BOUND') return false;
      if (includeInactive) return true;
      return (
        isoDate >= p.active_from &&
        (p.archived_at === null || isoDate <= p.archived_at)
      );
    })
    .sort((a, b) => a.sort_order - b.sort_order);

  const windows: ResolvedPeriodWindow[] = [];

  for (const period of sortedPeriods) {
    if (period.start_anchor === null || period.end_anchor === null) {
      continue;
    }

    let startDate = isoDate;
    let startPrayers = prayersD;
    let startInstant = resolveAnchorInstant(
      startDate,
      period.start_anchor,
      period.start_offset_min,
      period.start_fixed_hhmm,
      startPrayers,
      settings.iana_timezone,
    );

    // In FAJR rollover mode, a FIXED_TIME before Fajr(D) (e.g. 01:00 AM Qiyam) occurs on civil D+1.
    if (
      settings.rollover_mode === 'FAJR' &&
      period.start_anchor === 'FIXED_TIME' &&
      startInstant < prayersD.fajr
    ) {
      startDate = nextIso;
      startPrayers = prayersNext;
      startInstant = resolveAnchorInstant(
        startDate,
        period.start_anchor,
        period.start_offset_min,
        period.start_fixed_hhmm,
        startPrayers,
        settings.iana_timezone,
      );
    }

    let endInstant = resolveAnchorInstant(
      startDate,
      period.end_anchor,
      period.end_offset_min,
      period.end_fixed_hhmm,
      startPrayers,
      settings.iana_timezone,
    );

    // Cross-midnight window (e.g. Isha -> Fajr): advance end anchor to D+1.
    if (endInstant <= startInstant) {
      endInstant = resolveAnchorInstant(
        nextIso,
        period.end_anchor,
        period.end_offset_min,
        period.end_fixed_hhmm,
        prayersNext,
        settings.iana_timezone,
      );
    }

    const duration = Math.max(1, endInstant - startInstant);
    const elapsedRatio = Math.min(
      1,
      Math.max(0, (nowMs - startInstant) / duration),
    );
    const remainingMinutes = Math.max(0, (endInstant - nowMs) / MS_PER_MINUTE);
    const preExpiryThreshold =
      period.ntfy_mode === 'pre_expiry' && period.ntfy_offset_min > 0
        ? period.ntfy_offset_min
        : 25;
    const isOpen = nowMs >= startInstant && nowMs < endInstant;
    const isExpired = nowMs >= endInstant;
    const isPreExpiry = isOpen && remainingMinutes <= preExpiryThreshold;

    windows.push({
      periodId: period.id,
      period,
      islamicDate: isoDate,
      startInstant,
      endInstant,
      elapsedRatio,
      remainingMinutes,
      isPreExpiry,
      isOpen,
      isExpired,
    });
  }

  return windows;
}

export function resolveActiveWindow(
  now: Date | number,
  periods: Period[],
  settings: PrayerSettingsInput,
): ActiveWindowResolution {
  const nowMs = toEpochMs(now);
  const civilDate = formatLocalIsoDate(nowMs, settings.iana_timezone);
  const islamicDate = resolveIslamicDate(nowMs, settings);

  const slidingDates = [
    addDaysIso(civilDate, -1),
    civilDate,
    addDaysIso(civilDate, 1),
  ];

  const windows3Day = slidingDates.flatMap((d) =>
    resolvePeriodWindowsForDay(d, periods, settings, nowMs),
  );

  const activeWindows = windows3Day.filter((w) => w.isOpen);

  let primaryWindow: ResolvedPeriodWindow | null = null;
  if (activeWindows.length > 0) {
    const islamicDayActive = activeWindows.filter(
      (w) => w.islamicDate === islamicDate,
    );
    const pool = islamicDayActive.length > 0 ? islamicDayActive : activeWindows;
    primaryWindow =
      [...pool].sort((a, b) => {
        if (a.endInstant !== b.endInstant) {
          return a.endInstant - b.endInstant;
        }
        return a.period.sort_order - b.period.sort_order;
      })[0] ?? null;
  }

  return {
    islamicDate,
    civilDate,
    windows3Day,
    activeWindows,
    primaryWindow,
  };
}

export function isTimeInQuietHours(
  now: Date | number,
  settings: Pick<
    AppSettings,
    'iana_timezone' | 'quiet_start_hhmm' | 'quiet_end_hhmm'
  >,
): boolean {
  if (!settings.quiet_start_hhmm || !settings.quiet_end_hhmm) {
    return false;
  }
  const nowMs = toEpochMs(now);
  const parts = getLocalTimeParts(nowMs, settings.iana_timezone);
  const nowMin = parts.hour * 60 + parts.minute;
  const start = parseHhmm(settings.quiet_start_hhmm);
  const end = parseHhmm(settings.quiet_end_hhmm);
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;

  if (startMin === endMin) {
    return false;
  }
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // Overnight quiet hours (e.g. 23:00 -> 04:00)
  return nowMin >= startMin || nowMin < endMin;
}

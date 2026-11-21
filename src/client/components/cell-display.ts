import {
  AR_STRINGS,
  getEffectiveCellState,
  getIsoDayOfWeek,
  getLocalTimeParts,
  isActionCellExpired,
  makeCellKey,
  parseIsoDateParts,
  resolveActiveTargetVersion,
  resolveCellAvailability,
  type Action,
  type AppSettings,
  type CellAvailability,
  type EffectiveCellState,
  type Period,
  type TargetVersion,
  type WindowLookupCache,
} from '@/domain';
import type { LocalDailyLog } from '../db/idb';

const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

export interface CellDisplayInfo {
  state: EffectiveCellState;
  percentValue: number | null;
  note: string;
  availability: CellAvailability;
  log: LocalDailyLog | undefined;
  targetVersion: TargetVersion | null;
}

export function resolveCellDisplay(params: {
  action: Action;
  logDate: string;
  logsByKey: ReadonlyMap<string, LocalDailyLog>;
  periodsById: ReadonlyMap<string, Period>;
  periods: readonly Period[];
  targetVersions: readonly TargetVersion[];
  targetVersionsById: ReadonlyMap<string, TargetVersion>;
  settings: AppSettings;
  nowMs: number;
  windowCache?: WindowLookupCache;
}): CellDisplayInfo {
  const {
    action,
    logDate,
    logsByKey,
    periodsById,
    periods,
    targetVersions,
    targetVersionsById,
    settings,
    nowMs,
    windowCache,
  } = params;

  const log = logsByKey.get(makeCellKey(action.id, logDate));
  const availability = resolveCellAvailability(action, log, logDate);
  const expired = isActionCellExpired(
    action,
    logDate,
    periodsById,
    periods,
    settings,
    nowMs,
    windowCache,
  );
  const state = getEffectiveCellState(action, log, logDate, expired);

  let targetVersion: TargetVersion | null = null;
  if (log?.target_version_id) {
    const exact = targetVersionsById.get(log.target_version_id);
    if (exact && exact.action_id === action.id) {
      targetVersion = exact;
    }
  }
  if (!targetVersion) {
    targetVersion = resolveActiveTargetVersion(targetVersions, action.id, logDate);
  }

  return {
    state,
    percentValue: log?.status === 'PERCENT' ? (log.percent_value ?? null) : null,
    note: log?.note ?? '',
    availability,
    log,
    targetVersion,
  };
}

export function computeCellScore(
  state: EffectiveCellState,
  percentValue: number | null,
): number | null {
  switch (state) {
    case 'DONE':
      return 1;
    case 'QADAA_DONE':
      return 0.85;
    case 'PERCENT':
      return (percentValue ?? 0) / 100;
    case 'MISSED':
      return 0;
    default:
      return null;
  }
}

export function getCellStateClass(state: EffectiveCellState): string {
  switch (state) {
    case 'DONE':
      return 'st-done';
    case 'MISSED':
      return 'st-missed';
    case 'QADAA_DONE':
      return 'st-qadaa';
    case 'PERCENT':
      return 'st-percent';
    case 'DISABLED':
      return 'st-disabled';
    case 'UNLOGGED_EXPIRED':
      return 'st-expired';
    case 'INACTIVE':
      return 'st-inactive';
    case 'PENDING':
    default:
      return 'st-pending';
  }
}

export function getWeekDotClass(state: EffectiveCellState): string {
  switch (state) {
    case 'DONE':
      return 'done';
    case 'MISSED':
      return 'missed';
    case 'QADAA_DONE':
      return 'qadaa';
    case 'PERCENT':
      return 'percent';
    case 'DISABLED':
    case 'INACTIVE':
      return 'disabled';
    case 'UNLOGGED_EXPIRED':
      return 'expired';
    default:
      return '';
  }
}

export function formatHhmmInTz(instantMs: number, ianaTimezone: string): string {
  const parts = getLocalTimeParts(instantMs, ianaTimezone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function formatArabicDateFull(isoDate: string): string {
  const { month, day } = parseIsoDateParts(isoDate);
  const dow = getIsoDayOfWeek(isoDate);
  const weekdayName = AR_STRINGS.week.weekdaysAr[dow] ?? '';
  const monthName = ARABIC_MONTHS[month - 1] ?? String(month);
  return `${weekdayName} ${day} ${monthName}`;
}

export function formatArabicDateRange(startIso: string, endIso: string): string {
  const s = parseIsoDateParts(startIso);
  const e = parseIsoDateParts(endIso);
  const sMonth = ARABIC_MONTHS[s.month - 1] ?? String(s.month);
  const eMonth = ARABIC_MONTHS[e.month - 1] ?? String(e.month);
  if (s.month === e.month) {
    return `${s.day} إلى ${e.day} ${eMonth}`;
  }
  return `${s.day} ${sMonth} إلى ${e.day} ${eMonth}`;
}

export function formatRemainingMinutes(remainingMinutes: number): string {
  const rounded = Math.max(0, Math.ceil(remainingMinutes));
  if (rounded === 0) return 'أقل من دقيقة';
  if (rounded < 60) return `باقي ${rounded} دقيقة`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (mins === 0) {
    return hours === 1 ? 'باقي ساعة واحدة' : `باقي ${hours} ساعات`;
  }
  return `باقي ${hours} س ${mins} د`;
}

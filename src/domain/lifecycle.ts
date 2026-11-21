import {
  getIsoDayOfWeek,
  isWindowExpired,
  resolveIslamicDayEndInstant,
  resolvePeriodWindowsForDay,
  type PrayerSettingsInput,
  type ResolvedPeriodWindow,
} from './prayer-engine';
import {
  makeCellKey,
  type Action,
  type AvailabilityOverride,
  type CellStatus,
  type DailyLog,
  type EffectiveCellState,
  type Period,
} from './types';

export class DomainRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainRuleError';
    this.code = code;
  }
}

export interface CellAvailability {
  isActive: boolean;
  isEnabled: boolean;
  reason:
    | 'inactive'
    | 'override_enabled'
    | 'override_disabled'
    | 'default_enabled'
    | 'default_disabled';
}

export interface CanonicalizedMutation {
  availability_override: AvailabilityOverride | null;
  status: CellStatus | null;
  percent_value: number | null;
  qadaa_resolved_at: string | null;
}

export interface PlannedCellMutation {
  action_id: string;
  log_date: string;
  availability_override: AvailabilityOverride | null;
  status: CellStatus;
  percent_value: null;
  qadaa_resolved_at: null;
}

export function isActionActiveOnDate(
  action: Pick<Action, 'active_from' | 'archived_at'>,
  logDate: string,
): boolean {
  if (logDate < action.active_from) return false;
  if (action.archived_at !== null && logDate > action.archived_at) return false;
  return true;
}

export function isPeriodActiveOnDate(
  period: Pick<Period, 'active_from' | 'archived_at'>,
  logDate: string,
): boolean {
  if (logDate < period.active_from) return false;
  if (period.archived_at !== null && logDate > period.archived_at) return false;
  return true;
}

export function resolveCellAvailability(
  action: Pick<Action, 'active_from' | 'archived_at' | 'default_disabled_days'>,
  log: Pick<DailyLog, 'availability_override'> | null | undefined,
  logDate: string,
): CellAvailability {
  if (!isActionActiveOnDate(action, logDate)) {
    return { isActive: false, isEnabled: false, reason: 'inactive' };
  }

  if (log?.availability_override === 'ENABLED') {
    return { isActive: true, isEnabled: true, reason: 'override_enabled' };
  }
  if (log?.availability_override === 'DISABLED') {
    return { isActive: true, isEnabled: false, reason: 'override_disabled' };
  }

  const weekday = getIsoDayOfWeek(logDate);
  if (action.default_disabled_days.includes(weekday)) {
    return { isActive: true, isEnabled: false, reason: 'default_disabled' };
  }
  return { isActive: true, isEnabled: true, reason: 'default_enabled' };
}

export function getEffectiveCellState(
  action: Pick<Action, 'active_from' | 'archived_at' | 'default_disabled_days'>,
  log: Pick<DailyLog, 'availability_override' | 'status'> | null | undefined,
  logDate: string,
  isExpired: boolean,
): EffectiveCellState {
  const availability = resolveCellAvailability(action, log, logDate);
  if (!availability.isActive) return 'INACTIVE';
  if (!availability.isEnabled) return 'DISABLED';
  if (log?.status) return log.status;
  return isExpired ? 'UNLOGGED_EXPIRED' : 'PENDING';
}

export function canonicalizeLogMutation(
  action: Pick<
    Action,
    'supports_percentage' | 'is_qadaa_eligible' | 'default_disabled_days'
  >,
  input: {
    availability_override: AvailabilityOverride | null;
    status: CellStatus | null;
    percent_value: number | null;
    qadaa_resolved_at: string | null;
  },
  nowIso: string,
  logDate?: string,
): CanonicalizedMutation {
  if (input.availability_override === 'DISABLED') {
    return {
      availability_override: 'DISABLED',
      status: null,
      percent_value: null,
      qadaa_resolved_at: null,
    };
  }

  let availabilityOverride = input.availability_override;
  if (
    logDate &&
    availabilityOverride === null &&
    input.status !== null &&
    action.default_disabled_days.includes(getIsoDayOfWeek(logDate))
  ) {
    availabilityOverride = 'ENABLED';
  }

  if (input.status === 'PERCENT') {
    if (
      input.percent_value === null ||
      input.percent_value === undefined ||
      !Number.isFinite(input.percent_value) ||
      input.percent_value < 0 ||
      input.percent_value > 100
    ) {
      throw new DomainRuleError(
        'INVALID_PERCENT_VALUE',
        'PERCENT status requires percent_value between 0 and 100.',
      );
    }

    const rounded = Math.round(input.percent_value);
    if (rounded === 100) {
      return {
        availability_override: availabilityOverride,
        status: 'DONE',
        percent_value: null,
        qadaa_resolved_at: null,
      };
    }
    if (rounded === 0) {
      return {
        availability_override: availabilityOverride,
        status: 'MISSED',
        percent_value: null,
        qadaa_resolved_at: null,
      };
    }
    if (!action.supports_percentage) {
      throw new DomainRuleError(
        'PERCENT_NOT_SUPPORTED',
        'Action does not support partial percentage values.',
      );
    }
    return {
      availability_override: availabilityOverride,
      status: 'PERCENT',
      percent_value: rounded,
      qadaa_resolved_at: null,
    };
  }

  if (input.status === 'QADAA_DONE') {
    if (!action.is_qadaa_eligible) {
      throw new DomainRuleError(
        'QADAA_NOT_ELIGIBLE',
        'Action is not eligible for Qadaa resolution.',
      );
    }
    return {
      availability_override: availabilityOverride,
      status: 'QADAA_DONE',
      percent_value: null,
      qadaa_resolved_at: input.qadaa_resolved_at ?? nowIso,
    };
  }

  return {
    availability_override: availabilityOverride,
    status: input.status,
    percent_value: null,
    qadaa_resolved_at: null,
  };
}

export type WindowLookupCache = Map<string, Map<string, ResolvedPeriodWindow>>;

export function buildWindowLookupForDate(
  isoDate: string,
  periods: readonly Period[],
  settings: PrayerSettingsInput,
  now: Date | number,
  cache?: WindowLookupCache,
): Map<string, ResolvedPeriodWindow> {
  const existing = cache?.get(isoDate);
  if (existing) return existing;

  const resolved = resolvePeriodWindowsForDay(
    isoDate,
    [...periods],
    settings,
    now,
    { includeInactive: true },
  );
  const byPeriodId = new Map<string, ResolvedPeriodWindow>();
  for (const w of resolved) {
    byPeriodId.set(w.periodId, w);
  }
  cache?.set(isoDate, byPeriodId);
  return byPeriodId;
}

export function getGoverningWindowForAction(
  action: Pick<Action, 'period_id' | 'bound_time_period_id'>,
  logDate: string,
  periodsById: ReadonlyMap<string, Period>,
  periods: readonly Period[],
  settings: PrayerSettingsInput,
  now: Date | number,
  cache?: WindowLookupCache,
): ResolvedPeriodWindow | null {
  const mainPeriod = periodsById.get(action.period_id);
  let targetPeriodId: string | null = null;
  if (mainPeriod?.side === 'TIME_BOUND') {
    targetPeriodId = mainPeriod.id;
  } else if (action.bound_time_period_id) {
    const bound = periodsById.get(action.bound_time_period_id);
    if (bound?.side === 'TIME_BOUND') {
      targetPeriodId = bound.id;
    }
  }
  if (!targetPeriodId) return null;

  const dateWindows = buildWindowLookupForDate(
    logDate,
    periods,
    settings,
    now,
    cache,
  );
  return dateWindows.get(targetPeriodId) ?? null;
}

export function isActionCellExpired(
  action: Pick<Action, 'period_id' | 'bound_time_period_id'>,
  logDate: string,
  periodsById: ReadonlyMap<string, Period>,
  periods: readonly Period[],
  settings: PrayerSettingsInput,
  now: Date | number,
  cache?: WindowLookupCache,
): boolean {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const window = getGoverningWindowForAction(
    action,
    logDate,
    periodsById,
    periods,
    settings,
    nowMs,
    cache,
  );
  if (window) {
    return isWindowExpired(window, nowMs);
  }
  return nowMs >= resolveIslamicDayEndInstant(logDate, settings);
}

function isEmptyEnabledCell(
  action: Action,
  log: DailyLog | undefined,
  logDate: string,
  periodsById?: ReadonlyMap<string, Period>,
): boolean {
  if (periodsById) {
    const period = periodsById.get(action.period_id);
    if (!period || !isPeriodActiveOnDate(period, logDate)) {
      return false;
    }
  }
  const availability = resolveCellAvailability(action, log, logDate);
  if (!availability.isActive || !availability.isEnabled) {
    return false;
  }
  return log?.status == null;
}

/**
 * Bulk Planner 1: `تم ما في المسجد`
 * Strictly marks `DONE` ONLY on `EMPTY` enabled cells belonging to a `TIME_BOUND` period
 * where `is_mosque_action === true` AND `supports_percentage === false`
 * (never Left-side `DAILY_GROUP` actions even if bound to the period, never `ملئ جدول المحاسبة`,
 * and never overwriting any existing status or `DISABLED` cell).
 */
export function planMosqueDone(params: {
  periodId: string;
  logDate: string;
  actions: readonly Action[];
  periods?: readonly Period[];
  logsByKey: ReadonlyMap<string, DailyLog>;
}): PlannedCellMutation[] {
  const { periodId, logDate, actions, periods, logsByKey } = params;
  const periodsById = periods
    ? new Map(periods.map((p) => [p.id, p]))
    : undefined;

  if (periodsById) {
    const period = periodsById.get(periodId);
    if (
      !period ||
      period.side !== 'TIME_BOUND' ||
      !isPeriodActiveOnDate(period, logDate)
    ) {
      return [];
    }
  }

  const planned: PlannedCellMutation[] = [];
  const sorted = [...actions].sort((a, b) => a.sort_order - b.sort_order);

  for (const action of sorted) {
    if (action.period_id !== periodId) continue;
    if (!action.is_mosque_action || action.supports_percentage) continue;

    const log = logsByKey.get(makeCellKey(action.id, logDate));
    if (!isEmptyEnabledCell(action, log, logDate, periodsById)) continue;

    planned.push({
      action_id: action.id,
      log_date: logDate,
      availability_override: log?.availability_override ?? null,
      status: 'DONE',
      percent_value: null,
      qadaa_resolved_at: null,
    });
  }

  return planned;
}

/**
 * Bulk Planner 2: `تم الفترة بالكامل`
 * Marks all remaining `EMPTY` enabled Right-side (`TIME_BOUND`) items in `periodId` as `DONE`
 * (including 100% for Right-side percentage items and `ملئ جدول المحاسبة` if in that period).
 * Never touches Left-side items (`bound_time_period_id`) and never overwrites non-null/DISABLED cells.
 */
export function planPeriodDone(params: {
  periodId: string;
  logDate: string;
  actions: readonly Action[];
  periods?: readonly Period[];
  logsByKey: ReadonlyMap<string, DailyLog>;
}): PlannedCellMutation[] {
  const { periodId, logDate, actions, periods, logsByKey } = params;
  const periodsById = periods
    ? new Map(periods.map((p) => [p.id, p]))
    : undefined;

  if (periodsById) {
    const period = periodsById.get(periodId);
    if (
      !period ||
      period.side !== 'TIME_BOUND' ||
      !isPeriodActiveOnDate(period, logDate)
    ) {
      return [];
    }
  }

  const planned: PlannedCellMutation[] = [];
  const sorted = [...actions].sort((a, b) => a.sort_order - b.sort_order);

  for (const action of sorted) {
    if (action.period_id !== periodId) continue;

    const log = logsByKey.get(makeCellKey(action.id, logDate));
    if (!isEmptyEnabledCell(action, log, logDate, periodsById)) continue;

    planned.push({
      action_id: action.id,
      log_date: logDate,
      availability_override: log?.availability_override ?? null,
      status: 'DONE',
      percent_value: null,
      qadaa_resolved_at: null,
    });
  }

  return planned;
}

/**
 * Bulk Planner 3: `يوم اعتيادي`
 * Fills only `EMPTY` enabled cells for `logDate` where `include_in_normal_day_preset === true`.
 * Never overwrites existing statuses or `DISABLED` cells.
 */
export function planNormalDay(params: {
  logDate: string;
  actions: readonly Action[];
  periods?: readonly Period[];
  logsByKey: ReadonlyMap<string, DailyLog>;
}): PlannedCellMutation[] {
  const { logDate, actions, periods, logsByKey } = params;
  const periodsById = periods
    ? new Map(periods.map((p) => [p.id, p]))
    : undefined;

  const planned: PlannedCellMutation[] = [];
  const sorted = [...actions].sort((a, b) => a.sort_order - b.sort_order);

  for (const action of sorted) {
    if (!action.include_in_normal_day_preset) continue;

    const log = logsByKey.get(makeCellKey(action.id, logDate));
    if (!isEmptyEnabledCell(action, log, logDate, periodsById)) continue;

    planned.push({
      action_id: action.id,
      log_date: logDate,
      availability_override: log?.availability_override ?? null,
      status: 'DONE',
      percent_value: null,
      qadaa_resolved_at: null,
    });
  }

  return planned;
}

/**
 * Bulk Planner 4: `ترحيل للقضاء`
 * Converts ONLY already-expired `EMPTY` enabled cells for `logDate` into `MISSED`.
 * Never overwrites existing statuses, `DISABLED` cells, or still-open windows.
 */
export function planDeferToQadaa(params: {
  logDate: string;
  actions: readonly Action[];
  periods: readonly Period[];
  settings: PrayerSettingsInput;
  logsByKey: ReadonlyMap<string, DailyLog>;
  now: Date | number;
}): PlannedCellMutation[] {
  const { logDate, actions, periods, settings, logsByKey, now } = params;
  const periodsById = new Map(periods.map((p) => [p.id, p]));
  const windowCache: WindowLookupCache = new Map();

  const planned: PlannedCellMutation[] = [];
  const sorted = [...actions].sort((a, b) => a.sort_order - b.sort_order);

  for (const action of sorted) {
    const log = logsByKey.get(makeCellKey(action.id, logDate));
    if (!isEmptyEnabledCell(action, log, logDate, periodsById)) continue;

    if (
      !isActionCellExpired(
        action,
        logDate,
        periodsById,
        periods,
        settings,
        now,
        windowCache,
      )
    ) {
      continue;
    }

    planned.push({
      action_id: action.id,
      log_date: logDate,
      availability_override: log?.availability_override ?? null,
      status: 'MISSED',
      percent_value: null,
      qadaa_resolved_at: null,
    });
  }

  return planned;
}

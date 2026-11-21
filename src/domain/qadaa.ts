import {
  getGoverningWindowForAction,
  isActionActiveOnDate,
  isActionCellExpired,
  isPeriodActiveOnDate,
  resolveCellAvailability,
  type WindowLookupCache,
} from './lifecycle';
import {
  addDaysIso,
  diffDaysIso,
  resolveIslamicDate,
  resolveIslamicDayEndInstant,
  type PrayerSettingsInput,
} from './prayer-engine';
import { resolveActiveTargetVersion } from './targets';
import {
  makeCellKey,
  type Action,
  type DailyLog,
  type Period,
  type TargetVersion,
} from './types';

export interface QadaaQueueItem {
  action: Action;
  period: Period | null;
  log: DailyLog;
  logDate: string;
  ageDays: number;
  targetVersion: TargetVersion | null;
  targetLabel: string | null;
}

export interface CatchUpItem {
  action: Action;
  period: Period | null;
  governingPeriod: Period | null;
  logDate: string;
  log: DailyLog | null;
  windowEndInstant: number;
  targetVersion: TargetVersion | null;
  targetLabel: string | null;
}

export interface NonRecoverableMissItem {
  action: Action;
  period: Period | null;
  log: DailyLog;
  logDate: string;
  ageDays: number;
  targetVersion: TargetVersion | null;
  targetLabel: string | null;
}

function resolveHistoricalTarget(
  log: Pick<DailyLog, 'target_version_id' | 'log_date'> | null | undefined,
  actionId: string,
  logDate: string,
  targetVersions: readonly TargetVersion[],
  targetVersionsById: ReadonlyMap<string, TargetVersion>,
): TargetVersion | null {
  if (log?.target_version_id) {
    const exact = targetVersionsById.get(log.target_version_id);
    if (exact && exact.action_id === actionId) {
      return exact;
    }
  }
  return resolveActiveTargetVersion(targetVersions, actionId, logDate);
}

/**
 * Global cross-week Qadaa queue (`log_date <= todayIslamicDate`, `status === 'MISSED'`,
 * enabled, `is_qadaa_eligible === true`), paired with original historical `target_version`.
 */
export function getOpenQadaaQueue(params: {
  actions: readonly Action[];
  periods: readonly Period[];
  targetVersions: readonly TargetVersion[];
  logs: readonly DailyLog[];
  todayIslamicDate: string;
}): QadaaQueueItem[] {
  const { actions, periods, targetVersions, logs, todayIslamicDate } = params;
  const actionsById = new Map(actions.map((a) => [a.id, a]));
  const periodsById = new Map(periods.map((p) => [p.id, p]));
  const targetVersionsById = new Map(targetVersions.map((v) => [v.id, v]));

  const items: QadaaQueueItem[] = [];

  for (const log of logs) {
    if (log.status !== 'MISSED') continue;
    if (log.log_date > todayIslamicDate) continue;

    const action = actionsById.get(log.action_id);
    if (!action || !action.is_qadaa_eligible) continue;

    const period = periodsById.get(action.period_id) ?? null;
    if (period && !isPeriodActiveOnDate(period, log.log_date)) continue;

    const availability = resolveCellAvailability(action, log, log.log_date);
    if (!availability.isActive || !availability.isEnabled) continue;

    const targetVersion = resolveHistoricalTarget(
      log,
      action.id,
      log.log_date,
      targetVersions,
      targetVersionsById,
    );

    items.push({
      action,
      period,
      log,
      logDate: log.log_date,
      ageDays: Math.max(0, diffDaysIso(log.log_date, todayIslamicDate)),
      targetVersion,
      targetLabel: targetVersion?.target_label ?? null,
    });
  }

  return items.sort((a, b) => {
    if (a.logDate !== b.logDate) return a.logDate.localeCompare(b.logDate);
    const pOrderA = a.period?.sort_order ?? 999;
    const pOrderB = b.period?.sort_order ?? 999;
    if (pOrderA !== pOrderB) return pOrderA - pOrderB;
    return a.action.sort_order - b.action.sort_order;
  });
}

/**
 * 48h Catch-Up (`استدراك غير مسجّل`):
 * Enabled, active `EMPTY` cells with expired windows within `[yesterday, today]` Islamic days.
 */
export function get48hCatchUpItems(params: {
  actions: readonly Action[];
  periods: readonly Period[];
  targetVersions: readonly TargetVersion[];
  logs: readonly DailyLog[];
  settings: PrayerSettingsInput;
  now: Date | number;
}): CatchUpItem[] {
  const { actions, periods, targetVersions, logs, settings, now } = params;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const todayIslamicDate = resolveIslamicDate(nowMs, settings);
  const yesterdayIslamicDate = addDaysIso(todayIslamicDate, -1);
  const dates = [yesterdayIslamicDate, todayIslamicDate];

  const periodsById = new Map(periods.map((p) => [p.id, p]));
  const logsByKey = new Map(
    logs.map((l) => [makeCellKey(l.action_id, l.log_date), l]),
  );
  const targetVersionsById = new Map(targetVersions.map((v) => [v.id, v]));
  const windowCache: WindowLookupCache = new Map();

  const items: CatchUpItem[] = [];

  for (const logDate of dates) {
    for (const action of actions) {
      const period = periodsById.get(action.period_id) ?? null;
      if (!period || !isPeriodActiveOnDate(period, logDate)) continue;

      const log = logsByKey.get(makeCellKey(action.id, logDate)) ?? null;
      if (log?.status != null) continue;

      const availability = resolveCellAvailability(action, log, logDate);
      if (!availability.isActive || !availability.isEnabled) continue;

      if (
        !isActionCellExpired(
          action,
          logDate,
          periodsById,
          periods,
          settings,
          nowMs,
          windowCache,
        )
      ) {
        continue;
      }

      const govWindow = getGoverningWindowForAction(
        action,
        logDate,
        periodsById,
        periods,
        settings,
        nowMs,
        windowCache,
      );
      const windowEndInstant = govWindow
        ? govWindow.endInstant
        : resolveIslamicDayEndInstant(logDate, settings);
      const governingPeriod = govWindow ? govWindow.period : period;

      const targetVersion = resolveHistoricalTarget(
        log,
        action.id,
        logDate,
        targetVersions,
        targetVersionsById,
      );

      items.push({
        action,
        period,
        governingPeriod,
        logDate,
        log,
        windowEndInstant,
        targetVersion,
        targetLabel: targetVersion?.target_label ?? null,
      });
    }
  }

  return items.sort((a, b) => {
    if (a.logDate !== b.logDate) return a.logDate.localeCompare(b.logDate);
    const pOrderA = a.period?.sort_order ?? 999;
    const pOrderB = b.period?.sort_order ?? 999;
    if (pOrderA !== pOrderB) return pOrderA - pOrderB;
    return a.action.sort_order - b.action.sort_order;
  });
}

/**
 * Non-recoverable misses (`فوات لا يُقضى`): `status === 'MISSED'` where `!action.is_qadaa_eligible`.
 */
export function getNonRecoverableMisses(params: {
  actions: readonly Action[];
  periods: readonly Period[];
  targetVersions: readonly TargetVersion[];
  logs: readonly DailyLog[];
  todayIslamicDate: string;
  lookbackDays?: number | null;
}): NonRecoverableMissItem[] {
  const {
    actions,
    periods,
    targetVersions,
    logs,
    todayIslamicDate,
    lookbackDays = 30,
  } = params;
  const actionsById = new Map(actions.map((a) => [a.id, a]));
  const periodsById = new Map(periods.map((p) => [p.id, p]));
  const targetVersionsById = new Map(targetVersions.map((v) => [v.id, v]));
  const minDate =
    lookbackDays !== null && lookbackDays > 0
      ? addDaysIso(todayIslamicDate, -(lookbackDays - 1))
      : null;

  const items: NonRecoverableMissItem[] = [];

  for (const log of logs) {
    if (log.status !== 'MISSED') continue;
    if (log.log_date > todayIslamicDate) continue;
    if (minDate !== null && log.log_date < minDate) continue;

    const action = actionsById.get(log.action_id);
    if (!action || action.is_qadaa_eligible) continue;

    const period = periodsById.get(action.period_id) ?? null;
    if (period && !isPeriodActiveOnDate(period, log.log_date)) continue;

    const availability = resolveCellAvailability(action, log, log.log_date);
    if (!availability.isActive || !availability.isEnabled) continue;

    const targetVersion = resolveHistoricalTarget(
      log,
      action.id,
      log.log_date,
      targetVersions,
      targetVersionsById,
    );

    items.push({
      action,
      period,
      log,
      logDate: log.log_date,
      ageDays: Math.max(0, diffDaysIso(log.log_date, todayIslamicDate)),
      targetVersion,
      targetLabel: targetVersion?.target_label ?? null,
    });
  }

  return items.sort((a, b) => {
    if (a.logDate !== b.logDate) return b.logDate.localeCompare(a.logDate);
    const pOrderA = a.period?.sort_order ?? 999;
    const pOrderB = b.period?.sort_order ?? 999;
    if (pOrderA !== pOrderB) return pOrderA - pOrderB;
    return a.action.sort_order - b.action.sort_order;
  });
}

/**
 * Counts open Qadaa items for a single action (used to warn before toggling `is_qadaa_eligible` off).
 */
export function countOpenQadaaForAction(
  actionId: string,
  logs: readonly DailyLog[],
  todayIslamicDate: string,
  action?: Pick<Action, 'active_from' | 'archived_at' | 'default_disabled_days'>,
): number {
  let count = 0;
  for (const log of logs) {
    if (log.action_id !== actionId) continue;
    if (log.status !== 'MISSED') continue;
    if (log.log_date > todayIslamicDate) continue;
    if (log.availability_override === 'DISABLED') continue;
    if (action) {
      if (!isActionActiveOnDate(action, log.log_date)) continue;
      if (!resolveCellAvailability(action, log, log.log_date).isEnabled) {
        continue;
      }
    }
    count += 1;
  }
  return count;
}

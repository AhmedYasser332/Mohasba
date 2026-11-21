import {
  isActionActiveOnDate,
  isActionCellExpired,
  isPeriodActiveOnDate,
  resolveCellAvailability,
  type WindowLookupCache,
} from './lifecycle';
import {
  addDaysIso,
  diffDaysIso,
  formatLocalIsoDate,
  type PrayerSettingsInput,
} from './prayer-engine';
import { getOpenQadaaQueue } from './qadaa';
import { buildProgressionTrail } from './targets';
import {
  makeCellKey,
  type Action,
  type DailyLog,
  type Period,
  type TargetDirection,
  type TargetVersion,
} from './types';

export interface MetricsSummary {
  loggedCount: number;
  doneCount: number;
  qadaaCount: number;
  percentCount: number;
  missedCount: number;
  disabledCount: number;
  emptyExpiredCount: number;
  pendingCount: number;
  totalScore: number;
  weightedRate: number | null;
  onTimeRate: number | null;
  qadaaRate: number | null;
  missedRate: number | null;
}

export interface ProgressionVersionStat {
  versionId: string;
  targetLabel: string;
  effectiveFrom: string;
  direction: TargetDirection;
  loggedCount: number;
  consistencyRate: number | null;
}

export interface ActionProgressionTrail {
  actionId: string;
  formattedTrail: string;
  versions: ProgressionVersionStat[];
}

export interface WeakSpotItem {
  action: Action;
  period: Period | null;
  loggedCount: number;
  missedCount: number;
  consistency30d: number;
  progressionTrail: ActionProgressionTrail | null;
}

export interface AdaptingTargetItem {
  action: Action;
  period: Period | null;
  latestVersion: TargetVersion;
  daysSinceUpgrade: number;
  loggedUnderNewCount: number;
  label: 'هدف جديد';
  consistency30d: number | null;
  progressionTrail: ActionProgressionTrail | null;
}

export interface TimeBoundPeriodBreakdown {
  period: Period;
  overall: MetricsSummary;
  coreJamaah: MetricsSummary;
  sunanAndAdhkar: MetricsSummary;
}

export interface DailyGroupBreakdown {
  period: Period;
  overall: MetricsSummary;
}

export interface AnalyticsResult {
  todayIso: string;
  windowDays: 7 | 30;
  weakSpots: WeakSpotItem[];
  adaptingTargets: AdaptingTargetItem[];
  progressionTrails: ActionProgressionTrail[];
  breakdown: {
    timeBoundPeriods: TimeBoundPeriodBreakdown[];
    dailyGroups: DailyGroupBreakdown[];
    timeBoundSummary: {
      overall: MetricsSummary;
      coreJamaah: MetricsSummary;
      sunanAndAdhkar: MetricsSummary;
    };
    dailyGroupSummary: {
      overall: MetricsSummary;
    };
  };
  pulse: {
    qadaa: {
      openQadaaCount: number;
      oldestAgeDays: number | null;
      added7d: number;
      cleared7d: number;
      netVelocity7d: number;
    };
    backlog: {
      logged7d: number;
      unloggedExpired7d: number;
      pending7d: number;
      loggingCoverage7d: number;
    };
    nonRecoverable: {
      coreMisses7d: number;
      totalNonRecoverableMisses7d: number;
    };
  };
}

interface AnalyticsContext {
  periods: readonly Period[];
  actions: readonly Action[];
  targetVersions: readonly TargetVersion[];
  logs: readonly DailyLog[];
  todayIso: string;
  periodsById: ReadonlyMap<string, Period>;
  logsByKey: ReadonlyMap<string, DailyLog>;
  logsByAction: ReadonlyMap<string, DailyLog[]>;
  isExpiredOn: (action: Action, isoDate: string) => boolean;
  settings?: PrayerSettingsInput;
}

interface MutableBucket {
  loggedCount: number;
  doneCount: number;
  qadaaCount: number;
  percentCount: number;
  missedCount: number;
  disabledCount: number;
  emptyExpiredCount: number;
  pendingCount: number;
  totalScore: number;
}

export function scoreLoggedCell(
  log: Pick<DailyLog, 'status' | 'percent_value'> | null | undefined,
): number | null {
  if (!log || log.status === null) return null;
  switch (log.status) {
    case 'DONE':
      return 1.0;
    case 'QADAA_DONE':
      return 0.85;
    case 'PERCENT':
      return (log.percent_value ?? 0) / 100;
    case 'MISSED':
      return 0.0;
  }
}

function createMutableBucket(): MutableBucket {
  return {
    loggedCount: 0,
    doneCount: 0,
    qadaaCount: 0,
    percentCount: 0,
    missedCount: 0,
    disabledCount: 0,
    emptyExpiredCount: 0,
    pendingCount: 0,
    totalScore: 0,
  };
}

function finalizeBucket(b: MutableBucket): MetricsSummary {
  const denom = b.loggedCount;
  return {
    loggedCount: b.loggedCount,
    doneCount: b.doneCount,
    qadaaCount: b.qadaaCount,
    percentCount: b.percentCount,
    missedCount: b.missedCount,
    disabledCount: b.disabledCount,
    emptyExpiredCount: b.emptyExpiredCount,
    pendingCount: b.pendingCount,
    totalScore: b.totalScore,
    weightedRate: denom > 0 ? b.totalScore / denom : null,
    onTimeRate: denom > 0 ? b.doneCount / denom : null,
    qadaaRate: denom > 0 ? b.qadaaCount / denom : null,
    missedRate: denom > 0 ? b.missedCount / denom : null,
  };
}

function recordCellIntoBucket(
  b: MutableBucket,
  log: DailyLog | undefined,
  isEnabled: boolean,
  isExpired: boolean,
): void {
  if (!isEnabled) {
    b.disabledCount += 1;
    return;
  }
  const score = scoreLoggedCell(log);
  if (score === null || !log || log.status === null) {
    if (isExpired) {
      b.emptyExpiredCount += 1;
    } else {
      b.pendingCount += 1;
    }
    return;
  }
  b.loggedCount += 1;
  b.totalScore += score;
  switch (log.status) {
    case 'DONE':
      b.doneCount += 1;
      break;
    case 'QADAA_DONE':
      b.qadaaCount += 1;
      break;
    case 'PERCENT':
      b.percentCount += 1;
      break;
    case 'MISSED':
      b.missedCount += 1;
      break;
  }
}

function makeDateRange(endIso: string, days: number): string[] {
  const result: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    result.push(addDaysIso(endIso, -i));
  }
  return result;
}

function buildActionProgressionStats(
  action: Action,
  targetVersions: readonly TargetVersion[],
  logsForAction: readonly DailyLog[],
): ActionProgressionTrail | null {
  const trail = buildProgressionTrail(targetVersions, action.id);
  if (trail.versions.length < 2) {
    return null;
  }

  const versions: ProgressionVersionStat[] = trail.versions.map((ver, idx) => {
    const nextVer = trail.versions[idx + 1];
    let loggedCount = 0;
    let totalScore = 0;

    for (const log of logsForAction) {
      if (!isActionActiveOnDate(action, log.log_date)) continue;
      if (!resolveCellAvailability(action, log, log.log_date).isEnabled) {
        continue;
      }
      const score = scoreLoggedCell(log);
      if (score === null) continue;

      const belongsToVersion =
        log.target_version_id === ver.id ||
        (log.target_version_id === null &&
          log.log_date >= ver.effective_from &&
          (!nextVer || log.log_date < nextVer.effective_from));

      if (belongsToVersion) {
        loggedCount += 1;
        totalScore += score;
      }
    }

    return {
      versionId: ver.id,
      targetLabel: ver.target_label,
      effectiveFrom: ver.effective_from,
      direction: ver.direction,
      loggedCount,
      consistencyRate: loggedCount >= 5 ? totalScore / loggedCount : null,
    };
  });

  return {
    actionId: action.id,
    formattedTrail: trail.formattedTrail,
    versions,
  };
}

function computeWeakSpotsAndTrails(ctx: AnalyticsContext): {
  weakSpots: WeakSpotItem[];
  adaptingTargets: AdaptingTargetItem[];
  progressionTrails: ActionProgressionTrail[];
} {
  const {
    actions,
    targetVersions,
    todayIso,
    periodsById,
    logsByKey,
    logsByAction,
  } = ctx;
  const dates30d = makeDateRange(todayIso, 30);
  const weakCandidates: WeakSpotItem[] = [];
  const adaptingTargets: AdaptingTargetItem[] = [];
  const progressionTrails: ActionProgressionTrail[] = [];

  for (const action of actions) {
    const period = periodsById.get(action.period_id) ?? null;
    const actionLogs = logsByAction.get(action.id) ?? [];
    const progressionTrail = buildActionProgressionStats(
      action,
      targetVersions,
      actionLogs,
    );
    if (progressionTrail) {
      progressionTrails.push(progressionTrail);
    }

    if (!isActionActiveOnDate(action, todayIso)) continue;
    if (period && !isPeriodActiveOnDate(period, todayIso)) continue;

    let loggedCount = 0;
    let missedCount = 0;
    let totalScore = 0;

    for (const d of dates30d) {
      if (!isActionActiveOnDate(action, d)) continue;
      if (period && !isPeriodActiveOnDate(period, d)) continue;
      const log = logsByKey.get(makeCellKey(action.id, d));
      if (!resolveCellAvailability(action, log, d).isEnabled) continue;
      const score = scoreLoggedCell(log);
      if (score === null || !log || log.status === null) continue;
      loggedCount += 1;
      totalScore += score;
      if (log.status === 'MISSED') missedCount += 1;
    }

    const consistency30d = loggedCount > 0 ? totalScore / loggedCount : null;

    // Post-upgrade adaptation guard ("هدف جديد"): <= 7 days & < 5 logged days (unless step_down)
    const effectiveVersions = targetVersions
      .filter((v) => v.action_id === action.id && v.effective_from <= todayIso)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from));

    let isAdaptingNewTarget = false;
    if (effectiveVersions.length >= 2) {
      const latestVersion = effectiveVersions[effectiveVersions.length - 1]!;
      if (latestVersion.direction !== 'step_down') {
        const daysSinceUpgrade = diffDaysIso(
          latestVersion.effective_from,
          todayIso,
        );
        let loggedUnderNewCount = 0;
        for (const d of dates30d) {
          if (d < latestVersion.effective_from) continue;
          if (!isActionActiveOnDate(action, d)) continue;
          const log = logsByKey.get(makeCellKey(action.id, d));
          if (!resolveCellAvailability(action, log, d).isEnabled) continue;
          if (scoreLoggedCell(log) === null || !log) continue;
          if (
            log.target_version_id === latestVersion.id ||
            log.target_version_id === null
          ) {
            loggedUnderNewCount += 1;
          }
        }

        if (
          daysSinceUpgrade >= 0 &&
          daysSinceUpgrade < 7 &&
          loggedUnderNewCount < 5
        ) {
          isAdaptingNewTarget = true;
          adaptingTargets.push({
            action,
            period,
            latestVersion,
            daysSinceUpgrade,
            loggedUnderNewCount,
            label: 'هدف جديد',
            consistency30d,
            progressionTrail,
          });
        }
      }
    }

    if (isAdaptingNewTarget) continue;

    // Cold-start: >= 5 logged days, or >= 2 for actions active <= 2 days/week (disabled >= 5 days)
    const minColdStart = action.default_disabled_days.length >= 5 ? 2 : 5;
    if (
      loggedCount >= minColdStart &&
      consistency30d !== null &&
      consistency30d < 0.85
    ) {
      weakCandidates.push({
        action,
        period,
        loggedCount,
        missedCount,
        consistency30d,
        progressionTrail,
      });
    }
  }

  const weakSpots = weakCandidates
    .sort((a, b) => {
      if (Math.abs(a.consistency30d - b.consistency30d) > 1e-9) {
        return a.consistency30d - b.consistency30d;
      }
      if (a.missedCount !== b.missedCount) {
        return b.missedCount - a.missedCount;
      }
      const coreRankA =
        !a.action.is_qadaa_eligible && a.action.analytics_role !== 'standard'
          ? 0
          : 1;
      const coreRankB =
        !b.action.is_qadaa_eligible && b.action.analytics_role !== 'standard'
          ? 0
          : 1;
      if (coreRankA !== coreRankB) return coreRankA - coreRankB;
      return a.action.sort_order - b.action.sort_order;
    })
    .slice(0, 5);

  return { weakSpots, adaptingTargets, progressionTrails };
}

function computeSideBreakdown(
  ctx: AnalyticsContext,
  windowDays: 7 | 30,
): AnalyticsResult['breakdown'] {
  const { periods, actions, todayIso, logsByKey, isExpiredOn } = ctx;
  const datesBreakdown = makeDateRange(todayIso, windowDays);
  const sortedPeriods = [...periods].sort((a, b) => a.sort_order - b.sort_order);

  const tbOverallSummary = createMutableBucket();
  const tbCoreJamaahSummary = createMutableBucket();
  const tbSunanSummary = createMutableBucket();
  const dgOverallSummary = createMutableBucket();

  const timeBoundPeriods: TimeBoundPeriodBreakdown[] = [];
  const dailyGroups: DailyGroupBreakdown[] = [];

  for (const period of sortedPeriods) {
    const activeAnyDay = datesBreakdown.some((d) =>
      isPeriodActiveOnDate(period, d),
    );
    if (!activeAnyDay) continue;

    const periodActions = actions.filter((a) => a.period_id === period.id);

    if (period.side === 'TIME_BOUND') {
      const pOverall = createMutableBucket();
      const pCore = createMutableBucket();
      const pSunan = createMutableBucket();

      for (const action of periodActions) {
        for (const d of datesBreakdown) {
          if (!isPeriodActiveOnDate(period, d)) continue;
          if (!isActionActiveOnDate(action, d)) continue;
          const log = logsByKey.get(makeCellKey(action.id, d));
          const avail = resolveCellAvailability(action, log, d);
          const expired =
            avail.isEnabled && log?.status == null
              ? isExpiredOn(action, d)
              : false;

          recordCellIntoBucket(pOverall, log, avail.isEnabled, expired);
          recordCellIntoBucket(tbOverallSummary, log, avail.isEnabled, expired);

          if (action.analytics_role === 'core_jamaah') {
            recordCellIntoBucket(pCore, log, avail.isEnabled, expired);
            recordCellIntoBucket(
              tbCoreJamaahSummary,
              log,
              avail.isEnabled,
              expired,
            );
          } else {
            recordCellIntoBucket(pSunan, log, avail.isEnabled, expired);
            recordCellIntoBucket(tbSunanSummary, log, avail.isEnabled, expired);
          }
        }
      }

      timeBoundPeriods.push({
        period,
        overall: finalizeBucket(pOverall),
        coreJamaah: finalizeBucket(pCore),
        sunanAndAdhkar: finalizeBucket(pSunan),
      });
    } else {
      const gOverall = createMutableBucket();

      for (const action of periodActions) {
        for (const d of datesBreakdown) {
          if (!isPeriodActiveOnDate(period, d)) continue;
          if (!isActionActiveOnDate(action, d)) continue;
          const log = logsByKey.get(makeCellKey(action.id, d));
          const avail = resolveCellAvailability(action, log, d);
          const expired =
            avail.isEnabled && log?.status == null
              ? isExpiredOn(action, d)
              : false;

          recordCellIntoBucket(gOverall, log, avail.isEnabled, expired);
          recordCellIntoBucket(dgOverallSummary, log, avail.isEnabled, expired);
        }
      }

      dailyGroups.push({
        period,
        overall: finalizeBucket(gOverall),
      });
    }
  }

  return {
    timeBoundPeriods,
    dailyGroups,
    timeBoundSummary: {
      overall: finalizeBucket(tbOverallSummary),
      coreJamaah: finalizeBucket(tbCoreJamaahSummary),
      sunanAndAdhkar: finalizeBucket(tbSunanSummary),
    },
    dailyGroupSummary: {
      overall: finalizeBucket(dgOverallSummary),
    },
  };
}

function computePulse(ctx: AnalyticsContext): AnalyticsResult['pulse'] {
  const {
    periods,
    actions,
    targetVersions,
    logs,
    todayIso,
    periodsById,
    logsByKey,
    isExpiredOn,
    settings,
  } = ctx;

  const openQueue = getOpenQadaaQueue({
    actions,
    periods,
    targetVersions,
    logs,
    todayIslamicDate: todayIso,
  });
  const oldestAgeDays =
    openQueue.length > 0
      ? Math.max(...openQueue.map((item) => item.ageDays))
      : null;

  const dates7d = makeDateRange(todayIso, 7);
  const start7d = dates7d[0]!;
  const actionsById = new Map(actions.map((a) => [a.id, a]));

  let added7d = 0;
  let cleared7d = 0;

  for (const log of logs) {
    const action = actionsById.get(log.action_id);
    if (!action || !action.is_qadaa_eligible) continue;
    const period = periodsById.get(action.period_id);
    if (period && !isPeriodActiveOnDate(period, log.log_date)) continue;
    if (!resolveCellAvailability(action, log, log.log_date).isEnabled) continue;

    if (
      (log.status === 'MISSED' || log.status === 'QADAA_DONE') &&
      log.log_date >= start7d &&
      log.log_date <= todayIso
    ) {
      added7d += 1;
    }

    if (log.status === 'QADAA_DONE' && log.qadaa_resolved_at !== null) {
      const resolvedMs = Date.parse(log.qadaa_resolved_at);
      if (Number.isFinite(resolvedMs)) {
        const resolvedDate = settings?.iana_timezone
          ? formatLocalIsoDate(resolvedMs, settings.iana_timezone)
          : log.qadaa_resolved_at.slice(0, 10);
        if (resolvedDate >= start7d && resolvedDate <= todayIso) {
          cleared7d += 1;
        }
      }
    }
  }

  let logged7d = 0;
  let unloggedExpired7d = 0;
  let pending7d = 0;
  let coreMisses7d = 0;
  let totalNonRecoverableMisses7d = 0;

  for (const action of actions) {
    const period = periodsById.get(action.period_id);
    for (const d of dates7d) {
      if (period && !isPeriodActiveOnDate(period, d)) continue;
      if (!isActionActiveOnDate(action, d)) continue;
      const log = logsByKey.get(makeCellKey(action.id, d));
      const avail = resolveCellAvailability(action, log, d);
      if (!avail.isEnabled) continue;

      if (log?.status != null) {
        logged7d += 1;
        if (log.status === 'MISSED' && !action.is_qadaa_eligible) {
          totalNonRecoverableMisses7d += 1;
          if (
            action.analytics_role === 'core_jamaah' ||
            action.analytics_role === 'core_habit'
          ) {
            coreMisses7d += 1;
          }
        }
      } else if (isExpiredOn(action, d)) {
        unloggedExpired7d += 1;
      } else {
        pending7d += 1;
      }
    }
  }

  const coverageDenom = logged7d + unloggedExpired7d;
  const loggingCoverage7d = coverageDenom > 0 ? logged7d / coverageDenom : 1;

  return {
    qadaa: {
      openQadaaCount: openQueue.length,
      oldestAgeDays,
      added7d,
      cleared7d,
      netVelocity7d: added7d - cleared7d,
    },
    backlog: {
      logged7d,
      unloggedExpired7d,
      pending7d,
      loggingCoverage7d,
    },
    nonRecoverable: {
      coreMisses7d,
      totalNonRecoverableMisses7d,
    },
  };
}

/**
 * Computes all 3 deterministic MVP Analytics insights:
 * 1. Top Weakest Spots (`<85%`, cold-start `>=5`/`>=2`, 7d/5-log `هدف جديد` guard, progression trail)
 * 2. Isolated `TIME_BOUND` vs `DAILY_GROUP` breakdown (`7d` or `30d`) with `core_jamaah` vs Sunan split
 * 3. Qadaa velocity, Anti-`مراكمة` logging coverage, and non-recoverable core misses
 */
export function computeAnalytics(params: {
  periods: readonly Period[];
  actions: readonly Action[];
  targetVersions: readonly TargetVersion[];
  logs: readonly DailyLog[];
  todayIso: string;
  windowDays?: 7 | 30;
  now?: Date | number;
  settings?: PrayerSettingsInput;
}): AnalyticsResult {
  const {
    periods,
    actions,
    targetVersions,
    logs,
    todayIso,
    windowDays = 7,
    now,
    settings,
  } = params;

  const periodsById = new Map(periods.map((p) => [p.id, p]));
  const logsByKey = new Map(
    logs.map((l) => [makeCellKey(l.action_id, l.log_date), l]),
  );
  const logsByAction = new Map<string, DailyLog[]>();
  for (const log of logs) {
    const arr = logsByAction.get(log.action_id);
    if (arr) arr.push(log);
    else logsByAction.set(log.action_id, [log]);
  }

  const windowCache: WindowLookupCache = new Map();
  const isExpiredOn = (action: Action, d: string): boolean => {
    if (settings && now !== undefined) {
      return isActionCellExpired(
        action,
        d,
        periodsById,
        periods,
        settings,
        now,
        windowCache,
      );
    }
    return d < todayIso;
  };

  const ctx: AnalyticsContext = {
    periods,
    actions,
    targetVersions,
    logs,
    todayIso,
    periodsById,
    logsByKey,
    logsByAction,
    isExpiredOn,
    settings,
  };

  const { weakSpots, adaptingTargets, progressionTrails } =
    computeWeakSpotsAndTrails(ctx);
  const breakdown = computeSideBreakdown(ctx, windowDays);
  const pulse = computePulse(ctx);

  return {
    todayIso,
    windowDays,
    weakSpots,
    adaptingTargets,
    progressionTrails,
    breakdown,
    pulse,
  };
}

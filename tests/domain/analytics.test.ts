import { describe, expect, it } from 'vitest';
import { computeAnalytics } from '@/domain/analytics';
import { addDaysIso } from '@/domain/prayer-engine';
import {
  buildStarterPack,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
  STARTER_PACK_TARGET_IDS,
} from '@/domain/starter-pack';
import type { DailyLog, TargetVersion } from '@/domain/types';

function makeLog(
  actionId: string,
  logDate: string,
  overrides: Partial<DailyLog> = {},
): DailyLog {
  return {
    action_id: actionId,
    log_date: logDate,
    availability_override: null,
    status: 'DONE',
    percent_value: null,
    qadaa_resolved_at: null,
    target_version_id: null,
    note: null,
    note_updated_at: null,
    row_version: 1,
    last_mutation_id: null,
    last_device_id: null,
    client_updated_at: `${logDate}T12:00:00.000Z`,
    ...overrides,
  };
}

describe('analytics (3 Lean Insights)', () => {
  const { periods, actions, targetVersions } = buildStarterPack('2026-10-01');
  const todayIso = '2026-11-21';

  it('strictly isolates TIME_BOUND vs DAILY_GROUP, separates core_jamaah from Sunan, and excludes EMPTY_EXPIRED & DISABLED from denominator', () => {
    const logs: DailyLog[] = [];
    // Over last 7 days [2026-11-15 .. 2026-11-21]:
    // ISHA_JAMAAH (core_jamaah in ISHA_QIYAM): 5 DONE, 1 MISSED, 1 DISABLED -> weighted = 5/6
    // ISHA_BADIYAH (standard in ISHA_QIYAM): 6 DONE, 0 MISSED, 1 EMPTY (day 2026-11-20 = EMPTY_EXPIRED) -> weighted = 6/6 = 1.0!
    // ADHKAR_SLEEP (DAILY_GROUP bound to ISHA_QIYAM): 7 MISSED -> MUST NOT pollute ISHA_QIYAM!
    for (let i = 0; i < 7; i += 1) {
      const d = addDaysIso(todayIso, -i);
      if (i === 0) {
        logs.push(
          makeLog(STARTER_PACK_ACTION_IDS.ISHA_JAMAAH, d, {
            availability_override: 'DISABLED',
            status: null,
          }),
        );
      } else if (i === 1) {
        logs.push(
          makeLog(STARTER_PACK_ACTION_IDS.ISHA_JAMAAH, d, { status: 'MISSED' }),
        );
      } else {
        logs.push(
          makeLog(STARTER_PACK_ACTION_IDS.ISHA_JAMAAH, d, { status: 'DONE' }),
        );
      }

      if (i !== 1) {
        logs.push(
          makeLog(STARTER_PACK_ACTION_IDS.ISHA_BADIYAH, d, { status: 'DONE' }),
        );
      }

      logs.push(
        makeLog(STARTER_PACK_ACTION_IDS.ADHKAR_SLEEP, d, { status: 'MISSED' }),
      );
    }

    const scopedActions = actions.filter(
      (a) =>
        a.id === STARTER_PACK_ACTION_IDS.ISHA_JAMAAH ||
        a.id === STARTER_PACK_ACTION_IDS.ISHA_BADIYAH ||
        a.id === STARTER_PACK_ACTION_IDS.ADHKAR_SLEEP,
    );

    const res = computeAnalytics({
      periods,
      actions: scopedActions,
      targetVersions,
      logs,
      todayIso,
      windowDays: 7,
    });

    const ishaBreakdown = res.breakdown.timeBoundPeriods.find(
      (b) => b.period.id === STARTER_PACK_PERIOD_IDS.ISHA_QIYAM,
    )!;
    // coreJamaah has 6 logged days (1 DISABLED excluded) -> 5/6
    expect(ishaBreakdown.coreJamaah.loggedCount).toBe(6);
    expect(ishaBreakdown.coreJamaah.disabledCount).toBe(1);
    expect(ishaBreakdown.coreJamaah.weightedRate).toBeCloseTo(5 / 6, 4);

    // sunanAndAdhkar has 6 DONE + 1 EMPTY_EXPIRED -> EMPTY_EXPIRED excluded, so weighted = 1.0!
    // And ADHKAR_SLEEP (7 MISSED) did NOT leak into ISHA_QIYAM!
    expect(ishaBreakdown.sunanAndAdhkar.loggedCount).toBe(6);
    expect(ishaBreakdown.sunanAndAdhkar.emptyExpiredCount).toBe(1);
    expect(ishaBreakdown.sunanAndAdhkar.weightedRate).toBe(1);

    // Instead ADHKAR_SLEEP lives strictly inside GROUP_ADHKAR
    const adhkarGroup = res.breakdown.dailyGroups.find(
      (g) => g.period.id === STARTER_PACK_PERIOD_IDS.GROUP_ADHKAR,
    )!;
    expect(adhkarGroup.overall.missedCount).toBe(7);
    expect(adhkarGroup.overall.weightedRate).toBe(0);
  });

  it('enforces cold-start thresholds (>=5 normal vs >=2 for >=4 disabled days/week)', () => {
    const logs: DailyLog[] = [
      // FAJR_FARD has only 4 logged days (< 5 cold-start) -> must NOT appear in weakSpots
      makeLog(STARTER_PACK_ACTION_IDS.FAJR_FARD, '2026-11-18', {
        status: 'MISSED',
      }),
      makeLog(STARTER_PACK_ACTION_IDS.FAJR_FARD, '2026-11-19', {
        status: 'MISSED',
      }),
      makeLog(STARTER_PACK_ACTION_IDS.FAJR_FARD, '2026-11-20', {
        status: 'MISSED',
      }),
      makeLog(STARTER_PACK_ACTION_IDS.FAJR_FARD, '2026-11-21', {
        status: 'MISSED',
      }),

      // FASTING_MON_THU is disabled 5 days/week (>=4) -> 2 logged days meets cold-start!
      makeLog(STARTER_PACK_ACTION_IDS.FASTING_MON_THU, '2026-11-16', {
        status: 'MISSED',
      }),
      makeLog(STARTER_PACK_ACTION_IDS.FASTING_MON_THU, '2026-11-19', {
        status: 'MISSED',
      }),

      // HABIT_NO_SNOOZE has 5 logged days -> meets cold-start!
      makeLog(STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE, '2026-11-17', {
        status: 'MISSED',
      }),
      makeLog(STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE, '2026-11-18', {
        status: 'MISSED',
      }),
      makeLog(STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE, '2026-11-19', {
        status: 'DONE',
      }),
      makeLog(STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE, '2026-11-20', {
        status: 'DONE',
      }),
      makeLog(STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE, '2026-11-21', {
        status: 'DONE',
      }),
    ];

    const res = computeAnalytics({
      periods,
      actions,
      targetVersions,
      logs,
      todayIso,
    });

    const weakIds = res.weakSpots.map((w) => w.action.id);
    expect(weakIds).not.toContain(STARTER_PACK_ACTION_IDS.FAJR_FARD);
    expect(weakIds).toContain(STARTER_PACK_ACTION_IDS.FASTING_MON_THU);
    expect(weakIds).toContain(STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE);
  });

  it('suppresses Weak Spot ranking with "هدف جديد" adaptation guard (<7d and <5 logs after level_up) and builds progression trail', () => {
    const quranV2: TargetVersion = {
      id: '30000000-0000-4000-8000-000000000099',
      action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
      effective_from: '2026-11-18', // 3 days before todayIso (2026-11-21)
      target_label: '20 صفحة',
      target_value: 20,
      target_unit: 'صفحة',
      direction: 'level_up',
    };

    const logs: DailyLog[] = [];
    // 6 historical logs under v1 (all DONE)
    for (let i = 10; i >= 5; i -= 1) {
      const d = addDaysIso(todayIso, -i);
      logs.push(
        makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, d, {
          status: 'DONE',
          target_version_id: STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
        }),
      );
    }
    // 3 low logs under v2 (< 5 logs and < 7 days since 2026-11-18)
    for (const d of ['2026-11-18', '2026-11-19', '2026-11-20']) {
      logs.push(
        makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, d, {
          status: 'MISSED',
          target_version_id: quranV2.id,
        }),
      );
    }

    const res = computeAnalytics({
      periods,
      actions,
      targetVersions: [...targetVersions, quranV2],
      logs,
      todayIso,
    });

    expect(res.weakSpots.map((w) => w.action.id)).not.toContain(
      STARTER_PACK_ACTION_IDS.QURAN_WIRD,
    );
    expect(res.adaptingTargets).toHaveLength(1);
    expect(res.adaptingTargets[0]?.label).toBe('هدف جديد');
    expect(res.adaptingTargets[0]?.action.id).toBe(
      STARTER_PACK_ACTION_IDS.QURAN_WIRD,
    );
    expect(res.adaptingTargets[0]?.progressionTrail?.formattedTrail).toBe(
      '10 صفحات ← 20 صفحة',
    );
    expect(
      res.adaptingTargets[0]?.progressionTrail?.versions[0]?.consistencyRate,
    ).toBe(1);
    // v2 has only 3 logs (< 5), so consistencyRate is null until 5 logs accumulate
    expect(
      res.adaptingTargets[0]?.progressionTrail?.versions[1]?.consistencyRate,
    ).toBeNull();

    // When direction is 'step_down', adaptation guard does NOT suppress Weak Spot ranking
    const stepDownVersion: TargetVersion = {
      ...quranV2,
      direction: 'step_down',
      target_label: '5 صفحات',
      target_value: 5,
    };
    const resStepDown = computeAnalytics({
      periods,
      actions,
      targetVersions: [...targetVersions, stepDownVersion],
      logs,
      todayIso,
    });
    expect(resStepDown.adaptingTargets).toHaveLength(0);
    expect(resStepDown.weakSpots.map((w) => w.action.id)).toContain(
      STARTER_PACK_ACTION_IDS.QURAN_WIRD,
    );
  });

  it('computes Insight 3 Qadaa velocity, Anti-مراكمة coverage, and non-recoverable core misses', () => {
    const logs: DailyLog[] = [
      // Old open Qadaa (11 days old)
      makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-10', {
        status: 'MISSED',
      }),
      // Cleared during the last 7 days (originally missed 2026-11-05, resolved 2026-11-20)
      makeLog(STARTER_PACK_ACTION_IDS.FAJR_FARD, '2026-11-05', {
        status: 'QADAA_DONE',
        qadaa_resolved_at: '2026-11-20T08:00:00.000Z',
      }),
      // Added in last 7 days
      makeLog(STARTER_PACK_ACTION_IDS.DHUHR_FARD, '2026-11-19', {
        status: 'MISSED',
      }),
      // Non-recoverable core miss in last 7 days
      makeLog(STARTER_PACK_ACTION_IDS.FAJR_JAMAAH, '2026-11-20', {
        status: 'MISSED',
      }),
      makeLog(STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE, '2026-11-20', {
        status: 'MISSED',
      }),
    ];

    const res = computeAnalytics({
      periods,
      actions,
      targetVersions,
      logs,
      todayIso,
    });

    expect(res.pulse.qadaa.openQadaaCount).toBe(2);
    expect(res.pulse.qadaa.oldestAgeDays).toBe(11);
    expect(res.pulse.qadaa.added7d).toBe(1);
    expect(res.pulse.qadaa.cleared7d).toBe(1);
    expect(res.pulse.qadaa.netVelocity7d).toBe(0);

    expect(res.pulse.nonRecoverable.coreMisses7d).toBe(2);
    expect(res.pulse.backlog.logged7d).toBe(3);
    expect(res.pulse.backlog.unloggedExpired7d).toBeGreaterThan(0);
    expect(res.pulse.backlog.loggingCoverage7d).toBeGreaterThan(0);
    expect(res.pulse.backlog.loggingCoverage7d).toBeLessThan(1);
  });

  it('excludes unlogged pre-active_from days from analytics denominators even when pre-active_from days can be logged freely', () => {
    const wednesdayActive = '2026-11-18';
    const scopedBundle = buildStarterPack(wednesdayActive);
    const fajrFard = scopedBundle.actions.find(
      (a) => a.id === STARTER_PACK_ACTION_IDS.FAJR_FARD,
    )!;
    // Today is Friday 2026-11-20 (active days in 7d window: 18, 19, 20; pre-active_from: 14, 15, 16, 17).
    // User backfilled 2026-11-16 (DONE) and left 14, 15, 17 unlogged; logged 18, 19, 20 DONE.
    const logs: DailyLog[] = [
      makeLog(fajrFard.id, '2026-11-16', { status: 'DONE' }),
      makeLog(fajrFard.id, '2026-11-18', { status: 'DONE' }),
      makeLog(fajrFard.id, '2026-11-19', { status: 'DONE' }),
      makeLog(fajrFard.id, '2026-11-20', { status: 'DONE' }),
      // Future pre-marked day 2026-11-21
      makeLog(fajrFard.id, '2026-11-21', { status: 'MISSED' }),
    ];

    const res = computeAnalytics({
      periods: scopedBundle.periods,
      actions: [fajrFard],
      targetVersions: scopedBundle.targetVersions,
      logs,
      todayIso: '2026-11-20',
      windowDays: 7,
    });

    expect(res.pulse.backlog.logged7d).toBe(3);
    expect(res.pulse.backlog.unloggedExpired7d).toBe(0);
    expect(res.pulse.backlog.loggingCoverage7d).toBe(1);
    expect(res.breakdown.timeBoundSummary.overall.loggedCount).toBe(3);
    expect(res.breakdown.timeBoundSummary.overall.emptyExpiredCount).toBe(0);
    expect(res.breakdown.timeBoundSummary.overall.weightedRate).toBe(1);
    expect(res.pulse.qadaa.openQadaaCount).toBe(0);
  });
});

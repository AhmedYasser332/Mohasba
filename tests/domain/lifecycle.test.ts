import { describe, expect, it } from 'vitest';
import {
  canonicalizeLogMutation,
  DomainRuleError,
  getEffectiveCellState,
  planDeferToQadaa,
  planMosqueDone,
  planNormalDay,
  planPeriodDone,
  resolveCellAvailability,
} from '@/domain/lifecycle';
import {
  computePrayerTimesForDay,
  zonedWallClockToUtc,
  type PrayerSettingsInput,
} from '@/domain/prayer-engine';
import {
  buildStarterPack,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
} from '@/domain/starter-pack';
import { makeCellKey, type Action, type DailyLog } from '@/domain/types';

const SETTINGS: PrayerSettingsInput = {
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

function makeLog(
  actionId: string,
  logDate: string,
  overrides: Partial<DailyLog> = {},
): DailyLog {
  return {
    action_id: actionId,
    log_date: logDate,
    availability_override: null,
    status: null,
    percent_value: null,
    qadaa_resolved_at: null,
    target_version_id: null,
    note: null,
    note_updated_at: null,
    row_version: 1,
    last_mutation_id: null,
    last_device_id: null,
    client_updated_at: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('lifecycle & bulk planners', () => {
  const { periods, actions } = buildStarterPack('2026-11-01');

  describe('two-layer cell availability', () => {
    const fridayKahf = actions.find(
      (a) => a.id === STARTER_PACK_ACTION_IDS.FRIDAY_KAHF_AND_SUNAN,
    )!;

    it('respects active_from and archived_at bounds', () => {
      const archivedAction: Action = {
        ...fridayKahf,
        active_from: '2026-11-05',
        archived_at: '2026-11-15',
      };
      expect(
        resolveCellAvailability(archivedAction, null, '2026-11-04').isActive,
      ).toBe(false);
      expect(
        resolveCellAvailability(archivedAction, null, '2026-11-16').isActive,
      ).toBe(false);
      expect(
        getEffectiveCellState(archivedAction, null, '2026-11-04', true),
      ).toBe('INACTIVE');
    });

    it('applies explicit override over default_disabled_days', () => {
      // 2026-11-21 is Saturday (6); Friday Kahf is disabled on Saturday by default
      expect(
        resolveCellAvailability(fridayKahf, null, '2026-11-21').isEnabled,
      ).toBe(false);
      expect(
        getEffectiveCellState(fridayKahf, null, '2026-11-21', false),
      ).toBe('DISABLED');

      // Explicit ENABLED override enables it
      const enabledLog = makeLog(fridayKahf.id, '2026-11-21', {
        availability_override: 'ENABLED',
      });
      expect(
        resolveCellAvailability(fridayKahf, enabledLog, '2026-11-21').isEnabled,
      ).toBe(true);
      expect(
        getEffectiveCellState(fridayKahf, enabledLog, '2026-11-21', false),
      ).toBe('PENDING');

      // Explicit DISABLED overrides an active Friday (2026-11-27)
      const disabledFriday = makeLog(fridayKahf.id, '2026-11-27', {
        availability_override: 'DISABLED',
      });
      expect(
        resolveCellAvailability(fridayKahf, disabledFriday, '2026-11-27')
          .isEnabled,
      ).toBe(false);
    });
  });

  describe('5-state canonicalization & transition guards', () => {
    const quran = actions.find(
      (a) => a.id === STARTER_PACK_ACTION_IDS.QURAN_WIRD,
    )!;
    const fajrJamaah = actions.find(
      (a) => a.id === STARTER_PACK_ACTION_IDS.FAJR_JAMAAH,
    )!;
    const nowIso = '2026-11-21T12:00:00.000Z';

    it('canonicalizes 100% -> DONE and 0% -> MISSED', () => {
      const done = canonicalizeLogMutation(
        quran,
        {
          availability_override: null,
          status: 'PERCENT',
          percent_value: 100,
          qadaa_resolved_at: null,
        },
        nowIso,
      );
      expect(done.status).toBe('DONE');
      expect(done.percent_value).toBeNull();

      const missed = canonicalizeLogMutation(
        quran,
        {
          availability_override: null,
          status: 'PERCENT',
          percent_value: 0,
          qadaa_resolved_at: null,
        },
        nowIso,
      );
      expect(missed.status).toBe('MISSED');
      expect(missed.percent_value).toBeNull();

      const partial = canonicalizeLogMutation(
        quran,
        {
          availability_override: null,
          status: 'PERCENT',
          percent_value: 50,
          qadaa_resolved_at: null,
        },
        nowIso,
      );
      expect(partial.status).toBe('PERCENT');
      expect(partial.percent_value).toBe(50);
    });

    it('rejects partial percentage when supports_percentage=false and QADAA_DONE when is_qadaa_eligible=false', () => {
      expect(() =>
        canonicalizeLogMutation(
          fajrJamaah,
          {
            availability_override: null,
            status: 'PERCENT',
            percent_value: 50,
            qadaa_resolved_at: null,
          },
          nowIso,
        ),
      ).toThrowError(DomainRuleError);

      expect(() =>
        canonicalizeLogMutation(
          fajrJamaah,
          {
            availability_override: null,
            status: 'QADAA_DONE',
            percent_value: null,
            qadaa_resolved_at: nowIso,
          },
          nowIso,
        ),
      ).toThrowError(DomainRuleError);
    });

    it('stamps qadaa_resolved_at on QADAA_DONE and clears it on exit or DISABLED', () => {
      const qadaa = canonicalizeLogMutation(
        quran,
        {
          availability_override: null,
          status: 'QADAA_DONE',
          percent_value: null,
          qadaa_resolved_at: null,
        },
        nowIso,
      );
      expect(qadaa.status).toBe('QADAA_DONE');
      expect(qadaa.qadaa_resolved_at).toBe(nowIso);

      const reverted = canonicalizeLogMutation(
        quran,
        {
          availability_override: null,
          status: 'DONE',
          percent_value: null,
          qadaa_resolved_at: nowIso,
        },
        nowIso,
      );
      expect(reverted.qadaa_resolved_at).toBeNull();

      const disabled = canonicalizeLogMutation(
        quran,
        {
          availability_override: 'DISABLED',
          status: 'DONE',
          percent_value: null,
          qadaa_resolved_at: nowIso,
        },
        nowIso,
      );
      expect(disabled.availability_override).toBe('DISABLED');
      expect(disabled.status).toBeNull();
      expect(disabled.percent_value).toBeNull();
      expect(disabled.qadaa_resolved_at).toBeNull();
    });
  });

  describe('4 non-overwriting bulk planners', () => {
    const logDate = '2026-11-21'; // Saturday

    it('planMosqueDone strictly selects TIME_BOUND mosque actions (excluding Left-side bound items & evening accounting & existing/disabled)', () => {
      // Bound Left-side action with is_mosque_action=true added to verify exclusion!
      const rogueBoundLeftAction: Action = {
        id: '20000000-0000-4000-8000-000000000999',
        period_id: STARTER_PACK_PERIOD_IDS.GROUP_DAILY_HABITS,
        bound_time_period_id: STARTER_PACK_PERIOD_IDS.ISHA_QIYAM,
        title: 'المشي إلى المسجد',
        sort_order: 99,
        is_mosque_action: true,
        is_qadaa_eligible: false,
        supports_percentage: false,
        include_in_normal_day_preset: false,
        analytics_role: 'standard',
        default_disabled_days: [],
        active_from: '2026-11-01',
        archived_at: null,
      };

      const logsByKey = new Map<string, DailyLog>([
        [
          makeCellKey(STARTER_PACK_ACTION_IDS.ISHA_JAMAAH, logDate),
          makeLog(STARTER_PACK_ACTION_IDS.ISHA_JAMAAH, logDate, {
            status: 'MISSED',
          }),
        ],
        [
          makeCellKey(STARTER_PACK_ACTION_IDS.ISHA_BADIYAH, logDate),
          makeLog(STARTER_PACK_ACTION_IDS.ISHA_BADIYAH, logDate, {
            availability_override: 'DISABLED',
          }),
        ],
      ]);

      const planned = planMosqueDone({
        periodId: STARTER_PACK_PERIOD_IDS.ISHA_QIYAM,
        logDate,
        actions: [...actions, rogueBoundLeftAction],
        periods,
        logsByKey,
      });

      const plannedIds = planned.map((p) => p.action_id);
      // Only ISHA_FARD is EMPTY + enabled + mosque + non-percent in ISHA_QIYAM
      expect(plannedIds).toEqual([STARTER_PACK_ACTION_IDS.ISHA_FARD]);
      // Excludes non-mosque evening accounting & witr/qiyam, excludes MISSED jamaah, DISABLED badiyah, and bound Left-side action
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.ISHA_FILL_MOHASBA);
      expect(plannedIds).not.toContain(rogueBoundLeftAction.id);
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.ISHA_JAMAAH);
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.ISHA_BADIYAH);
    });

    it('planPeriodDone fills all remaining EMPTY enabled Right-side items including accounting & percentage without overwriting', () => {
      const logsByKey = new Map<string, DailyLog>([
        [
          makeCellKey(STARTER_PACK_ACTION_IDS.ISHA_FARD, logDate),
          makeLog(STARTER_PACK_ACTION_IDS.ISHA_FARD, logDate, { status: 'DONE' }),
        ],
        [
          makeCellKey(STARTER_PACK_ACTION_IDS.ISHA_QIYAM, logDate),
          makeLog(STARTER_PACK_ACTION_IDS.ISHA_QIYAM, logDate, {
            status: 'PERCENT',
            percent_value: 50,
          }),
        ],
        [
          makeCellKey(STARTER_PACK_ACTION_IDS.ISHA_WITR, logDate),
          makeLog(STARTER_PACK_ACTION_IDS.ISHA_WITR, logDate, {
            availability_override: 'DISABLED',
          }),
        ],
      ]);

      const planned = planPeriodDone({
        periodId: STARTER_PACK_PERIOD_IDS.ISHA_QIYAM,
        logDate,
        actions,
        periods,
        logsByKey,
      });

      const plannedIds = planned.map((p) => p.action_id);
      expect(plannedIds).toEqual([
        STARTER_PACK_ACTION_IDS.ISHA_JAMAAH,
        STARTER_PACK_ACTION_IDS.ISHA_BADIYAH,
        STARTER_PACK_ACTION_IDS.ISHA_FILL_MOHASBA,
      ]);
      // Never touches bound Left-side ADHKAR_SLEEP
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.ADHKAR_SLEEP);
    });

    it('planNormalDay strictly selects include_in_normal_day_preset=true and excludes core habits & existing/disabled cells', () => {
      const logsByKey = new Map<string, DailyLog>([
        [
          makeCellKey(STARTER_PACK_ACTION_IDS.FAJR_SUNNAH, logDate),
          makeLog(STARTER_PACK_ACTION_IDS.FAJR_SUNNAH, logDate, {
            status: 'MISSED',
          }),
        ],
      ]);

      const planned = planNormalDay({
        logDate,
        actions,
        periods,
        logsByKey,
      });

      const plannedIds = planned.map((p) => p.action_id);
      // Excludes core habits & Fard & Friday-only items on Saturday
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.FAJR_FARD);
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.FAJR_JAMAAH);
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE);
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.ISHA_FILL_MOHASBA);
      expect(plannedIds).not.toContain(
        STARTER_PACK_ACTION_IDS.FRIDAY_KAHF_AND_SUNAN,
      );
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.FAJR_SUNNAH);
      // Includes normal day preset Sunan/Adhkar/Quran
      expect(plannedIds).toContain(STARTER_PACK_ACTION_IDS.FAJR_ADHKAR);
      expect(plannedIds).toContain(STARTER_PACK_ACTION_IDS.QURAN_WIRD);
    });

    it('planDeferToQadaa converts ONLY already-expired EMPTY enabled cells to MISSED', () => {
      // Midday on 2026-11-21 (just after Dhuhr): Fajr & Dhuha are expired; Dhuhr/Asr/Maghrib/Isha & unbound Left-side are NOT expired yet
      const prayers = computePrayerTimesForDay(logDate, SETTINGS);
      const afterDhuhr = prayers.dhuhr + 15 * 60_000;

      const logsByKey = new Map<string, DailyLog>([
        [
          makeCellKey(STARTER_PACK_ACTION_IDS.FAJR_FARD, logDate),
          makeLog(STARTER_PACK_ACTION_IDS.FAJR_FARD, logDate, { status: 'DONE' }),
        ],
        [
          makeCellKey(STARTER_PACK_ACTION_IDS.DHUHA_PRAYER, logDate),
          makeLog(STARTER_PACK_ACTION_IDS.DHUHA_PRAYER, logDate, {
            availability_override: 'DISABLED',
          }),
        ],
      ]);

      const planned = planDeferToQadaa({
        logDate,
        actions,
        periods,
        settings: SETTINGS,
        logsByKey,
        now: afterDhuhr,
      });

      const plannedIds = planned.map((p) => p.action_id);
      expect(planned.every((p) => p.status === 'MISSED')).toBe(true);
      // Remaining Fajr items + bound HABIT_NO_SNOOZE (bound to Fajr) + bound ADHKAR_MORNING (bound to Dhuha) expired!
      expect(plannedIds).toContain(STARTER_PACK_ACTION_IDS.FAJR_JAMAAH);
      expect(plannedIds).toContain(STARTER_PACK_ACTION_IDS.FAJR_SUNNAH);
      expect(plannedIds).toContain(STARTER_PACK_ACTION_IDS.FAJR_ADHKAR);
      expect(plannedIds).toContain(STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE);
      expect(plannedIds).toContain(STARTER_PACK_ACTION_IDS.ADHKAR_MORNING);
      // Already logged DONE or DISABLED are NOT overwritten
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.FAJR_FARD);
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.DHUHA_PRAYER);
      // Open periods / unbound daily habits are NOT deferred
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.DHUHR_FARD);
      expect(plannedIds).not.toContain(STARTER_PACK_ACTION_IDS.QURAN_WIRD);

      // Next morning post-Fajr (2026-11-22 06:00), all 2026-11-21 windows are expired
      const nextMorning = zonedWallClockToUtc(
        '2026-11-22',
        '06:00',
        'Africa/Cairo',
      );
      const nextPlanned = planDeferToQadaa({
        logDate,
        actions,
        periods,
        settings: SETTINGS,
        logsByKey,
        now: nextMorning,
      });
      expect(nextPlanned.map((p) => p.action_id)).toContain(
        STARTER_PACK_ACTION_IDS.QURAN_WIRD,
      );
    });
  });
});

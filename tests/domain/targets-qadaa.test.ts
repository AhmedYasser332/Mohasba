import { describe, expect, it } from 'vitest';
import { computePrayerTimesForDay, type PrayerSettingsInput } from '@/domain/prayer-engine';
import {
  countOpenQadaaForAction,
  get48hCatchUpItems,
  getNonRecoverableMisses,
  getOpenQadaaQueue,
} from '@/domain/qadaa';
import {
  buildStarterPack,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_TARGET_IDS,
} from '@/domain/starter-pack';
import {
  buildProgressionTrail,
  isTargetVersionReferenced,
  resolveActiveTargetVersion,
  suggestEvolutionEffectiveDate,
} from '@/domain/targets';
import type { DailyLog, TargetVersion } from '@/domain/types';

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

describe('targets & qadaa', () => {
  const { periods, actions, targetVersions: starterTargets } =
    buildStarterPack('2026-11-01');

  const quranV1 = starterTargets.find(
    (v) => v.id === STARTER_PACK_TARGET_IDS.QURAN_WIRD_V1,
  )!;
  const quranV2: TargetVersion = {
    id: '30000000-0000-4000-8000-000000000099',
    action_id: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
    effective_from: '2026-11-15',
    target_label: '20 صفحة',
    target_value: 20,
    target_unit: 'صفحة',
    direction: 'level_up',
  };
  const allTargets = [quranV1, quranV2];

  describe('Target Evolution rules', () => {
    it('resolves active target version by latest effective_from <= isoDate', () => {
      expect(
        resolveActiveTargetVersion(
          allTargets,
          STARTER_PACK_ACTION_IDS.QURAN_WIRD,
          '2026-11-10',
        )?.target_label,
      ).toBe('10 صفحات');
      expect(
        resolveActiveTargetVersion(
          allTargets,
          STARTER_PACK_ACTION_IDS.QURAN_WIRD,
          '2026-11-15',
        )?.target_label,
      ).toBe('20 صفحة');
      expect(
        resolveActiveTargetVersion(
          allTargets,
          STARTER_PACK_ACTION_IDS.QURAN_WIRD,
          '2026-10-31',
        ),
      ).toBeNull();
    });

    it('defaults effective_from to D when today is EMPTY, or D+1 when today already has a log', () => {
      expect(suggestEvolutionEffectiveDate(null, '2026-11-21')).toBe(
        '2026-11-21',
      );
      expect(
        suggestEvolutionEffectiveDate(
          makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-21', {
            status: null,
            note: 'note only',
          }),
          '2026-11-21',
        ),
      ).toBe('2026-11-21');
      expect(
        suggestEvolutionEffectiveDate(
          makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-21', {
            status: 'DONE',
          }),
          '2026-11-21',
        ),
      ).toBe('2026-11-22');
      expect(
        suggestEvolutionEffectiveDate(
          makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-21', {
            availability_override: 'DISABLED',
          }),
          '2026-11-21',
        ),
      ).toBe('2026-11-22');
    });

    it('detects referenced target versions and builds chronological progression trail', () => {
      const logs = [
        makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-10', {
          status: 'DONE',
          target_version_id: quranV1.id,
        }),
      ];
      expect(isTargetVersionReferenced(quranV1.id, logs)).toBe(true);
      expect(isTargetVersionReferenced(quranV2.id, logs)).toBe(false);

      const trail = buildProgressionTrail(
        allTargets,
        STARTER_PACK_ACTION_IDS.QURAN_WIRD,
      );
      expect(trail.formattedTrail).toBe('10 صفحات ← 20 صفحة');
      expect(trail.latest?.id).toBe(quranV2.id);
    });
  });

  describe('Qadaa Queue, Cross-Upgrade Fairness, 48h Catch-Up & Non-Recoverable Misses', () => {
    it('preserves Day D original target (10 صفحات) in Cross-Upgrade Qadaa Queue after upgrading to 20 صفحة', () => {
      // Missed on 2026-11-10 (under 10 صفحات), upgraded on 2026-11-15 (20 صفحة), viewed on 2026-11-21
      const logs: DailyLog[] = [
        makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-10', {
          status: 'MISSED',
          target_version_id: quranV1.id,
        }),
        // Also test fallback when target_version_id is null on historical log
        makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-12', {
          status: 'MISSED',
          target_version_id: null,
        }),
        // Missed under new version
        makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-18', {
          status: 'MISSED',
          target_version_id: quranV2.id,
        }),
        // Disabled miss is excluded
        makeLog(STARTER_PACK_ACTION_IDS.FAJR_FARD, '2026-11-11', {
          status: null,
          availability_override: 'DISABLED',
        }),
        // Non-recoverable miss (FAJR_JAMAAH) MUST NOT enter Qadaa Queue
        makeLog(STARTER_PACK_ACTION_IDS.FAJR_JAMAAH, '2026-11-19', {
          status: 'MISSED',
        }),
      ];

      const queue = getOpenQadaaQueue({
        actions,
        periods,
        targetVersions: allTargets,
        logs,
        todayIslamicDate: '2026-11-21',
      });

      expect(queue).toHaveLength(3);
      expect(queue[0]?.logDate).toBe('2026-11-10');
      expect(queue[0]?.targetLabel).toBe('10 صفحات');
      expect(queue[0]?.ageDays).toBe(11);

      expect(queue[1]?.logDate).toBe('2026-11-12');
      expect(queue[1]?.targetLabel).toBe('10 صفحات');

      expect(queue[2]?.logDate).toBe('2026-11-18');
      expect(queue[2]?.targetLabel).toBe('20 صفحة');

      expect(
        countOpenQadaaForAction(
          STARTER_PACK_ACTION_IDS.QURAN_WIRD,
          logs,
          '2026-11-21',
        ),
      ).toBe(3);
    });

    it('surfaces non-recoverable misses separately in getNonRecoverableMisses', () => {
      const logs: DailyLog[] = [
        makeLog(STARTER_PACK_ACTION_IDS.FAJR_JAMAAH, '2026-11-19', {
          status: 'MISSED',
        }),
        makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-18', {
          status: 'MISSED',
        }),
      ];
      const nonRec = getNonRecoverableMisses({
        actions,
        periods,
        targetVersions: allTargets,
        logs,
        todayIslamicDate: '2026-11-21',
      });
      expect(nonRec).toHaveLength(1);
      expect(nonRec[0]?.action.id).toBe(STARTER_PACK_ACTION_IDS.FAJR_JAMAAH);
    });

    it('collects only enabled EMPTY expired items from yesterday and today in 48h Catch-Up', () => {
      const today = '2026-11-21'; // Saturday
      const yesterday = '2026-11-20'; // Friday
      const prayersToday = computePrayerTimesForDay(today, SETTINGS);
      const afterDhuhrToday = prayersToday.dhuhr + 10 * 60_000;

      // Mark Fajr Fard on today as DONE so it does NOT show in catch-up
      const logs: DailyLog[] = [
        makeLog(STARTER_PACK_ACTION_IDS.FAJR_FARD, today, { status: 'DONE' }),
      ];

      const catchUp = get48hCatchUpItems({
        actions,
        periods,
        targetVersions: allTargets,
        logs,
        settings: SETTINGS,
        now: afterDhuhrToday,
      });

      const todayIds = catchUp
        .filter((i) => i.logDate === today)
        .map((i) => i.action.id);
      const yesterdayIds = catchUp
        .filter((i) => i.logDate === yesterday)
        .map((i) => i.action.id);

      // Today's Fajr & Dhuha expired, Dhuhr is still open, FAJR_FARD was logged DONE
      expect(todayIds).not.toContain(STARTER_PACK_ACTION_IDS.FAJR_FARD);
      expect(todayIds).toContain(STARTER_PACK_ACTION_IDS.FAJR_JAMAAH);
      expect(todayIds).toContain(STARTER_PACK_ACTION_IDS.DHUHA_PRAYER);
      expect(todayIds).not.toContain(STARTER_PACK_ACTION_IDS.DHUHR_FARD);
      // Today is Saturday, so Friday-only item is DISABLED and excluded
      expect(todayIds).not.toContain(
        STARTER_PACK_ACTION_IDS.FRIDAY_KAHF_AND_SUNAN,
      );

      // Yesterday was Friday: Friday Kahf IS enabled and expired, while Dhuhr Qabliyah is default-disabled on Friday
      expect(yesterdayIds).toContain(
        STARTER_PACK_ACTION_IDS.FRIDAY_KAHF_AND_SUNAN,
      );
      expect(yesterdayIds).not.toContain(STARTER_PACK_ACTION_IDS.DHUHR_QABLIYAH);
    });

    it('keeps pre-active_from cells out of 48h Catch-Up and Qadaa Queue even when editable', () => {
      const wednesdayActive = buildStarterPack('2026-11-21');
      const prayersToday = computePrayerTimesForDay('2026-11-21', SETTINGS);
      const afterDhuhrToday = prayersToday.dhuhr + 10 * 60_000;

      // Yesterday (2026-11-20) is before active_from (2026-11-21), even with an explicit MISSED log
      const logs: DailyLog[] = [
        makeLog(STARTER_PACK_ACTION_IDS.QURAN_WIRD, '2026-11-20', {
          status: 'MISSED',
        }),
      ];

      const catchUp = get48hCatchUpItems({
        actions: wednesdayActive.actions,
        periods: wednesdayActive.periods,
        targetVersions: wednesdayActive.targetVersions,
        logs,
        settings: SETTINGS,
        now: afterDhuhrToday,
      });
      expect(catchUp.some((item) => item.logDate === '2026-11-20')).toBe(false);

      const qadaaQueue = getOpenQadaaQueue({
        actions: wednesdayActive.actions,
        periods: wednesdayActive.periods,
        targetVersions: wednesdayActive.targetVersions,
        logs,
        todayIslamicDate: '2026-11-21',
      });
      expect(qadaaQueue).toHaveLength(0);
    });
  });
});

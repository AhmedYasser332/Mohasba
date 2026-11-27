import { describe, expect, it } from 'vitest';
import {
  ActionSchema,
  PeriodSchema,
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
  STARTER_PACK_TARGET_IDS,
  TEMPLATE_CATALOG,
  TargetVersionSchema,
  buildTemplateBundle,
  customizeTemplateBundle,
} from '@/domain';

describe('3-Level Islamic Accountability Templates (domain)', () => {
  it('validates all 3 levels against strict Zod schemas with zero UUID collisions', () => {
    const legacyIds = new Set<string>([
      ...Object.values(STARTER_PACK_PERIOD_IDS),
      ...Object.values(STARTER_PACK_ACTION_IDS),
      ...Object.values(STARTER_PACK_TARGET_IDS),
    ]);
    const allTemplateIds = new Set<string>();

    expect(TEMPLATE_CATALOG).toHaveLength(3);

    for (const meta of TEMPLATE_CATALOG) {
      const bundle = buildTemplateBundle(meta.id, '2026-11-01');
      expect(bundle.periods).toHaveLength(meta.periodCount);
      expect(bundle.actions).toHaveLength(meta.actionCount);

      const periodIds = new Set<string>();
      for (const p of bundle.periods) {
        expect(() => PeriodSchema.parse(p)).not.toThrow();
        expect(legacyIds.has(p.id)).toBe(false);
        expect(allTemplateIds.has(p.id)).toBe(false);
        allTemplateIds.add(p.id);
        periodIds.add(p.id);
      }

      const actionIds = new Set<string>();
      for (const a of bundle.actions) {
        expect(() => ActionSchema.parse(a)).not.toThrow();
        expect(periodIds.has(a.period_id)).toBe(true);
        if (a.bound_time_period_id) {
          expect(periodIds.has(a.bound_time_period_id)).toBe(true);
        }
        expect(legacyIds.has(a.id)).toBe(false);
        expect(allTemplateIds.has(a.id)).toBe(false);
        allTemplateIds.add(a.id);
        actionIds.add(a.id);
      }

      for (const tv of bundle.targetVersions) {
        expect(() => TargetVersionSchema.parse(tv)).not.toThrow();
        expect(actionIds.has(tv.action_id)).toBe(true);
        expect(legacyIds.has(tv.id)).toBe(false);
        expect(allTemplateIds.has(tv.id)).toBe(false);
        allTemplateIds.add(tv.id);
      }
    }
  });

  it('encodes accurate smart defaults for cadence, mosque, qadaa, percentage & targets', () => {
    const l1 = buildTemplateBundle('level_1', '2026-11-01');
    const l2 = buildTemplateBundle('level_2', '2026-11-01');
    const l3 = buildTemplateBundle('level_3', '2026-11-01');

    // Level 1: Friday-only actions, Mon/Thu fasting, Sat/Thu knowledge class, Quran targets
    const l1Fasting = l1.actions.find((a) => a.title.includes('صيام'));
    expect(l1Fasting?.default_disabled_days).toEqual([0, 2, 3, 5, 6]);

    const l1Knowledge = l1.actions.find((a) => a.title.includes('حضور دروس العلم'));
    expect(l1Knowledge?.default_disabled_days).toEqual([0, 1, 2, 3, 5]);
    expect(l1Knowledge?.is_qadaa_eligible).toBe(true);

    const l1Kahf = l1.actions.find((a) => a.title === 'سورة الكهف');
    expect(l1Kahf?.default_disabled_days).toEqual([0, 1, 2, 3, 4, 6]);

    const l1QuranRead = l1.actions.find((a) => a.title === 'قراءة القرآن');
    expect(l1QuranRead?.is_qadaa_eligible).toBe(true);
    expect(l1QuranRead?.supports_percentage).toBe(true);
    const l1QuranTarget = l1.targetVersions.find((tv) => tv.action_id === l1QuranRead?.id);
    expect(l1QuranTarget?.target_label).toBe('ستة أرباع');

    // Level 2: includes الدعاء بين الأذانين, تكبيرة الإحرام, التهليل, الدعوة, الدعاء عند صعود الإمام
    expect(l2.actions.some((a) => a.title.includes('تكبيرة الإحرام'))).toBe(true);
    expect(l2.actions.some((a) => a.title.includes('الدعوة'))).toBe(true);
    expect(l2.actions.some((a) => a.title === 'الدعاء عند صعود الإمام')).toBe(true);

    // Level 3: includes التبكير, الصف الأول, الخشوع والتدبر (%), زيارة القبور (Friday only)
    const l3Khushu = l3.actions.find((a) => a.title === 'الخشوع والتدبر (الفجر)');
    expect(l3Khushu?.supports_percentage).toBe(true);
    expect(l3Khushu?.is_mosque_action).toBe(true);
    const l3Graves = l3.actions.find((a) => a.title === 'زيارة القبور');
    expect(l3Graves?.default_disabled_days).toEqual([0, 1, 2, 3, 4, 6]);
  });

  it('customizeTemplateBundle cascades period exclusion, clears orphan bound FKs, inherits Friday cadence, and toggles ntfy globally', () => {
    const base = buildTemplateBundle('level_1', '2026-11-01');
    const fajrPeriod = base.periods.find((p) => p.title === 'الفجر')!;
    const fridayPeriod = base.periods.find((p) => p.title === 'وظائف الجمعة')!;
    const dhuhrFard = base.actions.find((a) => a.title === 'الجماعة الأولى (الظهر)')!;
    const customId = '99999999-0000-4000-8000-000000000001';

    const custom = customizeTemplateBundle({
      level: 'level_1',
      activeFromIso: '2026-11-01',
      excludedPeriodIds: [fajrPeriod.id],
      excludedActionIds: [dhuhrFard.id],
      customActions: [
        { id: customId, period_id: fridayPeriod.id, title: 'صدقة الجمعة' },
        {
          id: '99999999-0000-4000-8000-000000000002',
          period_id: fajrPeriod.id,
          title: 'يجب تجاهله لأن فترته محذوفة',
        },
      ],
      ntfyAllPeriodsEnabled: false,
    });

    // Excluded period & its actions are removed
    expect(custom.periods.some((p) => p.id === fajrPeriod.id)).toBe(false);
    expect(custom.actions.some((a) => a.period_id === fajrPeriod.id)).toBe(false);
    // Excluded single action is removed
    expect(custom.actions.some((a) => a.id === dhuhrFard.id)).toBe(false);
    // Orphan bound_time_period_id pointing to excluded Fajr is nulled out cleanly
    const wakeAdhkar = custom.actions.find((a) => a.title === 'أذكار الاستيقاظ');
    expect(wakeAdhkar).toBeDefined();
    expect(wakeAdhkar?.bound_time_period_id).toBeNull();
    // Custom action inside Friday group automatically inherits Friday-only disabled days
    const customFriday = custom.actions.find((a) => a.id === customId);
    expect(customFriday?.title).toBe('صدقة الجمعة');
    expect(customFriday?.default_disabled_days).toEqual([0, 1, 2, 3, 4, 6]);
    // Global ntfy toggle applied to all kept TIME_BOUND periods
    expect(
      custom.periods
        .filter((p) => p.side === 'TIME_BOUND')
        .every((p) => p.ntfy_enabled === false),
    ).toBe(true);
  });
});

import { z } from 'zod';
import type { StarterPackBundle } from './starter-pack';
import type {
  Action,
  AnalyticsRole,
  Period,
  PeriodSide,
  PrayerAnchor,
  TargetVersion,
} from './types';

export const TemplateLevelIdSchema = z.enum(['level_1', 'level_2', 'level_3']);
export type TemplateLevelId = z.infer<typeof TemplateLevelIdSchema>;

export interface TemplateMetadata {
  id: TemplateLevelId;
  title: string;
  subtitle: string;
  description: string;
  badge: string;
  periodCount: number;
  actionCount: number;
}

interface PeriodSeed {
  key: string;
  title: string;
  side: PeriodSide;
  start_anchor?: PrayerAnchor | null;
  start_offset_min?: number;
  end_anchor?: PrayerAnchor | null;
  end_offset_min?: number;
  ntfy_offset_min?: number;
}

interface ActionSeed {
  periodKey: string;
  boundPeriodKey?: string;
  title: string;
  mosque?: boolean;
  qadaa?: boolean;
  percent?: boolean;
  normalDay?: boolean;
  role?: AnalyticsRole;
  disabledDays?: number[];
  target?: {
    label: string;
    value?: number | null;
    unit?: string | null;
  };
}

interface LevelBlueprint {
  prefix: '1' | '2' | '3';
  periods: readonly PeriodSeed[];
  actions: readonly ActionSeed[];
}

const DISABLED_EXCEPT_FRIDAY: number[] = [0, 1, 2, 3, 4, 6];
const DISABLED_EXCEPT_MON_THU: number[] = [0, 2, 3, 5, 6];
const DISABLED_EXCEPT_SAT_THU: number[] = [0, 1, 2, 3, 5];
const DISABLED_ON_FRIDAY: number[] = [5];

function makeTemplateUuid(
  kind: '1' | '2' | '3',
  levelPrefix: '1' | '2' | '3',
  index: number,
): string {
  const suffix = String(index).padStart(12, '0');
  return `${kind}${levelPrefix}000000-0000-4000-8000-${suffix}`;
}

function buildFromBlueprint(
  blueprint: LevelBlueprint,
  activeFromIso: string,
): StarterPackBundle {
  const periodIdByKey = new Map<string, string>();
  let timeOrder = 1;
  let dailyOrder = 101;

  const periods: Period[] = blueprint.periods.map((p, idx) => {
    const id = makeTemplateUuid('1', blueprint.prefix, idx + 1);
    periodIdByKey.set(p.key, id);
    const isTime = p.side === 'TIME_BOUND';
    const sort_order = isTime ? timeOrder++ : dailyOrder++;
    return {
      id,
      title: p.title,
      side: p.side,
      sort_order,
      start_anchor: isTime ? (p.start_anchor ?? 'FAJR') : null,
      start_offset_min: isTime ? (p.start_offset_min ?? 0) : 0,
      start_fixed_hhmm: null,
      end_anchor: isTime ? (p.end_anchor ?? 'SUNRISE') : null,
      end_offset_min: isTime ? (p.end_offset_min ?? 0) : 0,
      end_fixed_hhmm: null,
      ntfy_enabled: isTime,
      ntfy_mode: isTime ? 'pre_expiry' : null,
      ntfy_offset_min: p.ntfy_offset_min ?? 25,
      active_from: activeFromIso,
      archived_at: null,
    };
  });

  const actionSortByPeriod = new Map<string, number>();
  const targetVersions: TargetVersion[] = [];
  let targetCounter = 0;

  const actions: Action[] = blueprint.actions.map((a, idx) => {
    const periodId = periodIdByKey.get(a.periodKey);
    if (!periodId) {
      throw new Error(`Unknown template periodKey: ${a.periodKey}`);
    }
    const boundId = a.boundPeriodKey
      ? (periodIdByKey.get(a.boundPeriodKey) ?? null)
      : null;
    const nextOrder = (actionSortByPeriod.get(a.periodKey) ?? 0) + 1;
    actionSortByPeriod.set(a.periodKey, nextOrder);

    const actionId = makeTemplateUuid('2', blueprint.prefix, idx + 1);

    if (a.target) {
      targetCounter += 1;
      targetVersions.push({
        id: makeTemplateUuid('3', blueprint.prefix, targetCounter),
        action_id: actionId,
        effective_from: activeFromIso,
        target_label: a.target.label,
        target_value: a.target.value ?? null,
        target_unit: a.target.unit ?? null,
        direction: 'level_up',
      });
    }

    return {
      id: actionId,
      period_id: periodId,
      bound_time_period_id: boundId,
      title: a.title,
      sort_order: nextOrder,
      is_mosque_action: Boolean(a.mosque),
      is_qadaa_eligible: Boolean(a.qadaa),
      supports_percentage: Boolean(a.percent),
      include_in_normal_day_preset: Boolean(a.normalDay),
      analytics_role: a.role ?? 'standard',
      default_disabled_days: a.disabledDays ? [...a.disabledDays] : [],
      active_from: activeFromIso,
      archived_at: null,
    };
  });

  return { periods, actions, targetVersions };
}

/**
 * Level 1 — جدول سنة أولى (التأسيس)
 * Faithful to `_جدول_سنة_أولى_ورقة_المحاسبة`.
 */
const LEVEL_1_BLUEPRINT: LevelBlueprint = {
  prefix: '1',
  periods: [
    { key: 'fajr', title: 'الفجر', side: 'TIME_BOUND', start_anchor: 'FAJR', end_anchor: 'SUNRISE' },
    { key: 'morning', title: 'الصباح', side: 'TIME_BOUND', start_anchor: 'SUNRISE', start_offset_min: 15, end_anchor: 'DHUHR', end_offset_min: -10 },
    { key: 'dhuhr', title: 'الظهر', side: 'TIME_BOUND', start_anchor: 'DHUHR', end_anchor: 'ASR' },
    { key: 'asr', title: 'العصر', side: 'TIME_BOUND', start_anchor: 'ASR', end_anchor: 'MAGHRIB' },
    { key: 'evening', title: 'المساء', side: 'TIME_BOUND', start_anchor: 'ASR', start_offset_min: 15, end_anchor: 'MAGHRIB' },
    { key: 'maghrib', title: 'المغرب', side: 'TIME_BOUND', start_anchor: 'MAGHRIB', end_anchor: 'ISHA' },
    { key: 'isha', title: 'العشاء', side: 'TIME_BOUND', start_anchor: 'ISHA', end_anchor: 'FAJR' },
    { key: 'night', title: 'الليل', side: 'TIME_BOUND', start_anchor: 'ISHA', start_offset_min: 60, end_anchor: 'FAJR', ntfy_offset_min: 30 },
    { key: 'quran', title: 'القرآن', side: 'DAILY_GROUP' },
    { key: 'adhkar_bound', title: 'الأذكار المقيدة', side: 'DAILY_GROUP' },
    { key: 'study_work', title: 'العلم والعمل والبر', side: 'DAILY_GROUP' },
    { key: 'fasting', title: 'الصيام', side: 'DAILY_GROUP' },
    { key: 'friday', title: 'وظائف الجمعة', side: 'DAILY_GROUP' },
  ],
  actions: [
    // الفجر
    { periodKey: 'fajr', title: 'السنة القبلية (الفجر)', mosque: true, qadaa: true, normalDay: true },
    { periodKey: 'fajr', title: 'الجماعة الأولى (الفجر)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'fajr', title: 'أذكار بعد صلاة الفجر', mosque: true, normalDay: true },
    // الصباح
    { periodKey: 'morning', title: 'أذكار الصباح', qadaa: true, normalDay: true },
    // الظهر
    {
      periodKey: 'dhuhr',
      title: 'السنة القبلية (الظهر)',
      mosque: true,
      qadaa: true,
      normalDay: true,
      disabledDays: DISABLED_ON_FRIDAY,
      target: { label: '4 ركعات', value: 4, unit: 'ركعة' },
    },
    { periodKey: 'dhuhr', title: 'الجماعة الأولى (الظهر)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'dhuhr', title: 'أذكار بعد صلاة الظهر', mosque: true, normalDay: true },
    { periodKey: 'dhuhr', title: 'السنة البعدية (الظهر)', mosque: true, qadaa: true, normalDay: true },
    // العصر
    { periodKey: 'asr', title: 'الجماعة الأولى (العصر)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'asr', title: 'أذكار بعد صلاة العصر', mosque: true, normalDay: true },
    // المساء
    { periodKey: 'evening', title: 'أذكار المساء', qadaa: true, normalDay: true },
    // المغرب
    { periodKey: 'maghrib', title: 'الجماعة الأولى (المغرب)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'maghrib', title: 'أذكار بعد صلاة المغرب', mosque: true, normalDay: true },
    { periodKey: 'maghrib', title: 'السنة البعدية (المغرب)', mosque: true, qadaa: true, normalDay: true },
    // العشاء
    { periodKey: 'isha', title: 'الجماعة الأولى (العشاء)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'isha', title: 'أذكار بعد صلاة العشاء', mosque: true, normalDay: true },
    { periodKey: 'isha', title: 'السنة البعدية (العشاء)', mosque: true, qadaa: true, normalDay: true },
    // الليل
    {
      periodKey: 'night',
      title: 'قيام الليل',
      qadaa: true,
      normalDay: true,
      target: { label: 'ركعتان', value: 2, unit: 'ركعة' },
    },
    {
      periodKey: 'night',
      title: 'ورد قيام الليل',
      qadaa: true,
      percent: true,
      target: { label: 'ربعان', value: 2, unit: 'ربع' },
    },
    { periodKey: 'night', title: 'صلاة الوتر', qadaa: true, normalDay: true },
    // القرآن
    {
      periodKey: 'quran',
      title: 'حفظ القرآن',
      qadaa: true,
      percent: true,
      target: { label: 'نصف صفحة', value: 0.5, unit: 'صفحة' },
    },
    {
      periodKey: 'quran',
      title: 'قراءة القرآن',
      qadaa: true,
      percent: true,
      target: { label: 'ستة أرباع', value: 6, unit: 'ربع' },
    },
    // الأذكار المقيدة
    { periodKey: 'adhkar_bound', boundPeriodKey: 'fajr', title: 'أذكار الاستيقاظ', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الخلاء', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار لبس الثوب وخلعه', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الوضوء', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار دخول المنزل والخروج', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار المسجد (دخول وخروج)', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار المشي إلى المسجد', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الأكل والشرب', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الركوب', normalDay: true },
    { periodKey: 'adhkar_bound', boundPeriodKey: 'night', title: 'أذكار النوم', normalDay: true },
    // العلم والعمل والبر
    {
      periodKey: 'study_work',
      title: 'حضور دروس العلم (السبت والخميس)',
      qadaa: true,
      disabledDays: DISABLED_EXCEPT_SAT_THU,
    },
    { periodKey: 'study_work', title: 'مذاكرة دروس العلم', qadaa: true, percent: true },
    { periodKey: 'study_work', title: 'بر الوالدين', normalDay: true, role: 'core_habit' },
    {
      periodKey: 'study_work',
      title: 'مذاكرة الدراسة أو إتقان العمل الدنيوي',
      percent: true,
      role: 'core_habit',
      target: { label: '5 ساعات', value: 5, unit: 'ساعة' },
    },
    // الصيام
    {
      periodKey: 'fasting',
      title: 'صيام الإثنين والخميس',
      disabledDays: DISABLED_EXCEPT_MON_THU,
    },
    // وظائف الجمعة
    { periodKey: 'friday', title: 'سنن الفطرة', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'الغسل', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'الطيب', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'السواك', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'التبكير للجمعة', disabledDays: DISABLED_EXCEPT_FRIDAY },
    { periodKey: 'friday', title: 'سورة الكهف', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    {
      periodKey: 'friday',
      title: 'الصلاة على النبي ﷺ (الجمعة)',
      disabledDays: DISABLED_EXCEPT_FRIDAY,
      normalDay: true,
      target: { label: '100 مرة', value: 100, unit: 'مرة' },
    },
  ],
};

/**
 * Level 2 — جدول سنة (2) و (3) (المتوسط)
 * Faithful to the uploaded `سنة (2) و (3)` PDF.
 */
const LEVEL_2_BLUEPRINT: LevelBlueprint = {
  prefix: '2',
  periods: [
    { key: 'fajr', title: 'الصبح', side: 'TIME_BOUND', start_anchor: 'FAJR', end_anchor: 'SUNRISE' },
    { key: 'morning', title: 'الصباح', side: 'TIME_BOUND', start_anchor: 'SUNRISE', start_offset_min: 15, end_anchor: 'DHUHR', end_offset_min: -10 },
    { key: 'dhuhr', title: 'الظهر', side: 'TIME_BOUND', start_anchor: 'DHUHR', end_anchor: 'ASR' },
    { key: 'asr', title: 'العصر', side: 'TIME_BOUND', start_anchor: 'ASR', end_anchor: 'MAGHRIB' },
    { key: 'evening', title: 'المساء', side: 'TIME_BOUND', start_anchor: 'ASR', start_offset_min: 15, end_anchor: 'MAGHRIB' },
    { key: 'maghrib', title: 'المغرب', side: 'TIME_BOUND', start_anchor: 'MAGHRIB', end_anchor: 'ISHA' },
    { key: 'isha', title: 'العشاء', side: 'TIME_BOUND', start_anchor: 'ISHA', end_anchor: 'FAJR' },
    { key: 'night', title: 'الليل', side: 'TIME_BOUND', start_anchor: 'ISHA', start_offset_min: 60, end_anchor: 'FAJR', ntfy_offset_min: 30 },
    { key: 'quran', title: 'القرآن', side: 'DAILY_GROUP' },
    { key: 'adhkar_bound', title: 'الأذكار المقيدة', side: 'DAILY_GROUP' },
    { key: 'study_work', title: 'العلم والعمل والدعوة', side: 'DAILY_GROUP' },
    { key: 'fasting', title: 'الصيام', side: 'DAILY_GROUP' },
    { key: 'friday', title: 'وظائف الجمعة', side: 'DAILY_GROUP' },
  ],
  actions: [
    // الصبح
    { periodKey: 'fajr', title: 'السنة القبلية (الفجر)', mosque: true, qadaa: true, normalDay: true },
    { periodKey: 'fajr', title: 'الدعاء بين الأذانين (الفجر)', mosque: true },
    { periodKey: 'fajr', title: 'تكبيرة الإحرام (الفجر)', mosque: true },
    { periodKey: 'fajr', title: 'الجماعة الأولى (الفجر)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'fajr', title: 'أذكار بعد صلاة الفجر', mosque: true, normalDay: true },
    // الصباح
    { periodKey: 'morning', title: 'أذكار الصباح', qadaa: true, normalDay: true },
    {
      periodKey: 'morning',
      title: 'التهليل',
      qadaa: true,
      target: { label: '100 مرة', value: 100, unit: 'مرة' },
    },
    { periodKey: 'morning', title: 'صلاة الضحى', normalDay: true },
    // الظهر
    {
      periodKey: 'dhuhr',
      title: 'السنة القبلية (الظهر)',
      mosque: true,
      qadaa: true,
      normalDay: true,
      disabledDays: DISABLED_ON_FRIDAY,
      target: { label: '4 ركعات', value: 4, unit: 'ركعة' },
    },
    { periodKey: 'dhuhr', title: 'الدعاء بين الأذانين (الظهر)', mosque: true },
    { periodKey: 'dhuhr', title: 'تكبيرة الإحرام (الظهر)', mosque: true },
    { periodKey: 'dhuhr', title: 'الجماعة الأولى (الظهر)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'dhuhr', title: 'أذكار بعد صلاة الظهر', mosque: true, normalDay: true },
    { periodKey: 'dhuhr', title: 'السنة البعدية (الظهر)', mosque: true, qadaa: true, normalDay: true },
    // العصر
    { periodKey: 'asr', title: 'الدعاء بين الأذانين (العصر)', mosque: true },
    { periodKey: 'asr', title: 'تكبيرة الإحرام (العصر)', mosque: true },
    { periodKey: 'asr', title: 'الجماعة الأولى (العصر)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'asr', title: 'أذكار بعد صلاة العصر', mosque: true, normalDay: true },
    // المساء
    { periodKey: 'evening', title: 'أذكار المساء', qadaa: true, normalDay: true },
    // المغرب
    { periodKey: 'maghrib', title: 'الدعاء بين الأذانين (المغرب)', mosque: true },
    { periodKey: 'maghrib', title: 'تكبيرة الإحرام (المغرب)', mosque: true },
    { periodKey: 'maghrib', title: 'الجماعة الأولى (المغرب)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'maghrib', title: 'أذكار بعد صلاة المغرب', mosque: true, normalDay: true },
    { periodKey: 'maghrib', title: 'السنة البعدية (المغرب)', mosque: true, qadaa: true, normalDay: true },
    // العشاء
    { periodKey: 'isha', title: 'الدعاء بين الأذانين (العشاء)', mosque: true },
    { periodKey: 'isha', title: 'تكبيرة الإحرام (العشاء)', mosque: true },
    { periodKey: 'isha', title: 'الجماعة الأولى (العشاء)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'isha', title: 'أذكار بعد صلاة العشاء', mosque: true, normalDay: true },
    { periodKey: 'isha', title: 'السنة البعدية (العشاء)', mosque: true, qadaa: true, normalDay: true },
    // الليل
    {
      periodKey: 'night',
      title: 'قيام الليل',
      qadaa: true,
      normalDay: true,
      target: { label: 'ركعتان', value: 2, unit: 'ركعة' },
    },
    {
      periodKey: 'night',
      title: 'ورد قيام الليل',
      qadaa: true,
      percent: true,
      target: { label: 'حزب', value: 1, unit: 'حزب' },
    },
    { periodKey: 'night', title: 'صلاة الوتر', qadaa: true, normalDay: true },
    // القرآن
    {
      periodKey: 'quran',
      title: 'حفظ القرآن',
      qadaa: true,
      percent: true,
      target: { label: 'صفحة', value: 1, unit: 'صفحة' },
    },
    {
      periodKey: 'quran',
      title: 'قراءة القرآن',
      qadaa: true,
      percent: true,
      target: { label: 'جزء', value: 1, unit: 'جزء' },
    },
    // الأذكار المقيدة
    { periodKey: 'adhkar_bound', boundPeriodKey: 'fajr', title: 'أذكار الاستيقاظ', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الخلاء', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار لبس الثوب وخلعه', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الوضوء', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار دخول المنزل والخروج', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار المسجد (دخول وخروج)', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار المشي إلى المسجد', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الأكل والشرب', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الركوب', normalDay: true },
    { periodKey: 'adhkar_bound', boundPeriodKey: 'night', title: 'أذكار النوم', normalDay: true },
    {
      periodKey: 'adhkar_bound',
      title: 'الاستغفار',
      qadaa: true,
      normalDay: true,
      target: { label: '100 مرة', value: 100, unit: 'مرة' },
    },
    // العلم والعمل والدعوة
    {
      periodKey: 'study_work',
      title: 'حضور دروس العلم (السبت والخميس)',
      qadaa: true,
      disabledDays: DISABLED_EXCEPT_SAT_THU,
    },
    { periodKey: 'study_work', title: 'مذاكرة دروس العلم', qadaa: true, percent: true },
    { periodKey: 'study_work', title: 'بر الوالدين', normalDay: true, role: 'core_habit' },
    {
      periodKey: 'study_work',
      title: 'مذاكرة الدراسة أو إتقان العمل الدنيوي',
      percent: true,
      role: 'core_habit',
      target: { label: '5 ساعات', value: 5, unit: 'ساعة' },
    },
    { periodKey: 'study_work', title: 'الدعوة إلى الله', role: 'core_habit' },
    // الصيام
    {
      periodKey: 'fasting',
      title: 'صيام الإثنين والخميس',
      disabledDays: DISABLED_EXCEPT_MON_THU,
    },
    // وظائف الجمعة
    { periodKey: 'friday', title: 'سنن الفطرة', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'الغسل', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'لبس أفضل الثياب', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'الطيب', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'السواك', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'التبكير للجمعة', disabledDays: DISABLED_EXCEPT_FRIDAY },
    { periodKey: 'friday', title: 'سورة الكهف', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    {
      periodKey: 'friday',
      title: 'الصلاة على النبي ﷺ (الجمعة)',
      disabledDays: DISABLED_EXCEPT_FRIDAY,
      normalDay: true,
      target: { label: '100 مرة', value: 100, unit: 'مرة' },
    },
    { periodKey: 'friday', title: 'الدعاء عند صعود الإمام', disabledDays: DISABLED_EXCEPT_FRIDAY },
    { periodKey: 'friday', title: 'الدعاء قبل المغرب (الجمعة)', disabledDays: DISABLED_EXCEPT_FRIDAY },
  ],
};

/**
 * Level 3 — الجدول المتقدم الشامل
 * Faithful to every row in the user's Level 3 CSV sheet.
 */
const LEVEL_3_BLUEPRINT: LevelBlueprint = {
  prefix: '3',
  periods: [
    { key: 'fajr', title: 'الصبح', side: 'TIME_BOUND', start_anchor: 'FAJR', end_anchor: 'SUNRISE' },
    { key: 'morning', title: 'أذكار الصباح والضحى', side: 'TIME_BOUND', start_anchor: 'SUNRISE', start_offset_min: 15, end_anchor: 'DHUHR', end_offset_min: -10 },
    { key: 'dhuhr', title: 'الظهر', side: 'TIME_BOUND', start_anchor: 'DHUHR', end_anchor: 'ASR' },
    { key: 'asr', title: 'العصر', side: 'TIME_BOUND', start_anchor: 'ASR', end_anchor: 'MAGHRIB' },
    { key: 'evening', title: 'أذكار المساء', side: 'TIME_BOUND', start_anchor: 'ASR', start_offset_min: 15, end_anchor: 'MAGHRIB' },
    { key: 'maghrib', title: 'المغرب', side: 'TIME_BOUND', start_anchor: 'MAGHRIB', end_anchor: 'ISHA' },
    { key: 'isha', title: 'العشاء', side: 'TIME_BOUND', start_anchor: 'ISHA', end_anchor: 'FAJR' },
    { key: 'night', title: 'الليل', side: 'TIME_BOUND', start_anchor: 'ISHA', start_offset_min: 60, end_anchor: 'FAJR', ntfy_offset_min: 30 },
    { key: 'dua', title: 'الدعاء', side: 'DAILY_GROUP' },
    { key: 'quran', title: 'القرآن', side: 'DAILY_GROUP' },
    { key: 'adhkar_bound', title: 'الأذكار المقيدة والمطلقة', side: 'DAILY_GROUP' },
    { key: 'character_daily', title: 'العبادات والآداب اليومية', side: 'DAILY_GROUP' },
    { key: 'knowledge_accountability', title: 'الدعوة والعلم والمحاسبة', side: 'DAILY_GROUP' },
    { key: 'friday', title: 'وظائف الجمعة', side: 'DAILY_GROUP' },
  ],
  actions: [
    // الصبح (11)
    { periodKey: 'fajr', title: 'التبكير (الفجر)', mosque: true },
    { periodKey: 'fajr', title: 'أذكار الأذان (الفجر)', mosque: true },
    { periodKey: 'fajr', title: 'الدعاء بين الأذانين (الفجر)', mosque: true },
    { periodKey: 'fajr', title: 'السنة القبلية (الفجر)', mosque: true, qadaa: true, normalDay: true },
    { periodKey: 'fajr', title: 'الدعاء الخاص (الفجر)' },
    { periodKey: 'fajr', title: 'السواك (الفجر)', mosque: true },
    { periodKey: 'fajr', title: 'الجماعة الأولى (الفجر)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'fajr', title: 'تكبيرة الإحرام (الفجر)', mosque: true },
    { periodKey: 'fajr', title: 'الصف الأول (الفجر)', mosque: true },
    { periodKey: 'fajr', title: 'أذكار بعد صلاة الفجر', mosque: true, normalDay: true },
    { periodKey: 'fajr', title: 'الخشوع والتدبر (الفجر)', mosque: true, percent: true },
    // أذكار الصباح والضحى (4)
    { periodKey: 'morning', title: 'أذكار الصباح بخشوع', qadaa: true, normalDay: true, percent: true },
    { periodKey: 'morning', title: 'التهليل (صباحاً)', qadaa: true },
    { periodKey: 'morning', title: 'الجلوس إلى الشروق', mosque: true },
    { periodKey: 'morning', title: 'صلاة الضحى', normalDay: true },
    // الظهر (11)
    { periodKey: 'dhuhr', title: 'التبكير (الظهر)', mosque: true },
    { periodKey: 'dhuhr', title: 'أذكار الأذان (الظهر)', mosque: true },
    { periodKey: 'dhuhr', title: 'الدعاء بين الأذانين (الظهر)', mosque: true },
    { periodKey: 'dhuhr', title: 'السنة القبلية (الظهر)', mosque: true, qadaa: true, normalDay: true, disabledDays: DISABLED_ON_FRIDAY },
    { periodKey: 'dhuhr', title: 'السواك (الظهر)', mosque: true },
    { periodKey: 'dhuhr', title: 'الجماعة الأولى (الظهر)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'dhuhr', title: 'تكبيرة الإحرام (الظهر)', mosque: true },
    { periodKey: 'dhuhr', title: 'الصف الأول (الظهر)', mosque: true },
    { periodKey: 'dhuhr', title: 'أذكار بعد صلاة الظهر', mosque: true, normalDay: true },
    { periodKey: 'dhuhr', title: 'السنة البعدية (الظهر)', mosque: true, qadaa: true, normalDay: true },
    { periodKey: 'dhuhr', title: 'الخشوع والتدبر (الظهر)', mosque: true, percent: true },
    // العصر (10)
    { periodKey: 'asr', title: 'التبكير (العصر)', mosque: true },
    { periodKey: 'asr', title: 'أذكار الأذان (العصر)', mosque: true },
    { periodKey: 'asr', title: 'الدعاء بين الأذانين (العصر)', mosque: true },
    { periodKey: 'asr', title: 'السنة القبلية (العصر)', mosque: true },
    { periodKey: 'asr', title: 'السواك (العصر)', mosque: true },
    { periodKey: 'asr', title: 'الجماعة الأولى (العصر)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'asr', title: 'تكبيرة الإحرام (العصر)', mosque: true },
    { periodKey: 'asr', title: 'الصف الأول (العصر)', mosque: true },
    { periodKey: 'asr', title: 'أذكار بعد صلاة العصر', mosque: true, normalDay: true },
    { periodKey: 'asr', title: 'الخشوع والتدبر (العصر)', mosque: true, percent: true },
    // أذكار المساء (3)
    { periodKey: 'evening', title: 'أذكار المساء بخشوع', qadaa: true, normalDay: true, percent: true },
    { periodKey: 'evening', title: 'التهليل (مساءً)', qadaa: true },
    { periodKey: 'evening', title: 'ذكر الغروب' },
    // المغرب (13)
    { periodKey: 'maghrib', title: 'دعاء الغروب' },
    { periodKey: 'maghrib', title: 'التبكير (المغرب)', mosque: true },
    { periodKey: 'maghrib', title: 'أذكار الأذان (المغرب)', mosque: true },
    { periodKey: 'maghrib', title: 'الدعاء بين الأذانين (المغرب)', mosque: true },
    { periodKey: 'maghrib', title: 'السنة القبلية (المغرب)', mosque: true },
    { periodKey: 'maghrib', title: 'السواك (المغرب)', mosque: true },
    { periodKey: 'maghrib', title: 'الجماعة الأولى (المغرب)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'maghrib', title: 'تكبيرة الإحرام (المغرب)', mosque: true },
    { periodKey: 'maghrib', title: 'الصف الأول (المغرب)', mosque: true },
    { periodKey: 'maghrib', title: 'أذكار بعد صلاة المغرب', mosque: true, normalDay: true },
    { periodKey: 'maghrib', title: 'السنة البعدية (المغرب)', mosque: true, qadaa: true, normalDay: true },
    { periodKey: 'maghrib', title: 'دعاء خاص (المغرب)' },
    { periodKey: 'maghrib', title: 'الخشوع والتدبر (المغرب)', mosque: true, percent: true },
    // العشاء (11)
    { periodKey: 'isha', title: 'التبكير (العشاء)', mosque: true },
    { periodKey: 'isha', title: 'أذكار الأذان (العشاء)', mosque: true },
    { periodKey: 'isha', title: 'الدعاء بين الأذانين (العشاء)', mosque: true },
    { periodKey: 'isha', title: 'السنة القبلية (العشاء)', mosque: true },
    { periodKey: 'isha', title: 'السواك (العشاء)', mosque: true },
    { periodKey: 'isha', title: 'الجماعة الأولى (العشاء)', mosque: true, role: 'core_jamaah' },
    { periodKey: 'isha', title: 'تكبيرة الإحرام (العشاء)', mosque: true },
    { periodKey: 'isha', title: 'الصف الأول (العشاء)', mosque: true },
    { periodKey: 'isha', title: 'أذكار بعد صلاة العشاء', mosque: true, normalDay: true },
    { periodKey: 'isha', title: 'السنة البعدية (العشاء)', mosque: true, qadaa: true, normalDay: true },
    { periodKey: 'isha', title: 'الخشوع والتدبر (العشاء)', mosque: true, percent: true },
    // الليل (5)
    { periodKey: 'night', title: 'قيام الليل (عدد الركعات)', qadaa: true, percent: true },
    { periodKey: 'night', title: 'ورد الليل', qadaa: true, percent: true },
    { periodKey: 'night', title: 'صلاة الوتر', qadaa: true, normalDay: true },
    { periodKey: 'night', title: 'ذكر بعد الوتر', normalDay: true },
    { periodKey: 'night', title: 'الاستغفار بالأسحار' },
    // الدعاء (4)
    { periodKey: 'dua', title: 'الدعاء للنفس', normalDay: true },
    { periodKey: 'dua', title: 'الدعاء للمشايخ', normalDay: true },
    { periodKey: 'dua', title: 'الدعاء للإخوة', normalDay: true },
    { periodKey: 'dua', title: 'الدعاء للمسلمين', normalDay: true },
    // القرآن (2)
    { periodKey: 'quran', title: 'تلاوة وتدبر القرآن', qadaa: true, percent: true },
    { periodKey: 'quran', title: 'مراجعة وحفظ القرآن', qadaa: true, percent: true },
    // الأذكار المقيدة والمطلقة (15)
    { periodKey: 'adhkar_bound', boundPeriodKey: 'fajr', title: 'أذكار الاستيقاظ', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الخلاء', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الوضوء', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار لبس الثوب وخلعه', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار دخول المنزل والخروج', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الركوب', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار المشي إلى المسجد', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار دخول المسجد والخروج', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'أذكار الأكل والشرب', normalDay: true },
    { periodKey: 'adhkar_bound', boundPeriodKey: 'night', title: 'أذكار النوم', normalDay: true },
    { periodKey: 'adhkar_bound', title: 'استغفار المجلس' },
    { periodKey: 'adhkar_bound', title: 'كفارة المجلس' },
    { periodKey: 'adhkar_bound', title: 'ذكر من تعارّ من الليل' },
    { periodKey: 'adhkar_bound', title: 'الاستغفار المطلق', normalDay: true },
    {
      periodKey: 'adhkar_bound',
      title: 'الصلاة على النبي ﷺ',
      normalDay: true,
      target: { label: '100 مرة', value: 100, unit: 'مرة' },
    },
    // العبادات والآداب اليومية (11)
    { periodKey: 'character_daily', title: 'بر الوالدين', normalDay: true, role: 'core_habit' },
    { periodKey: 'character_daily', title: 'صلة الرحم' },
    { periodKey: 'character_daily', title: 'أداء الحقوق' },
    { periodKey: 'character_daily', title: 'ترك آفات اللسان', percent: true, role: 'core_habit' },
    { periodKey: 'character_daily', title: 'ترك فضول النظر', percent: true, role: 'core_habit' },
    { periodKey: 'character_daily', title: 'معالجة القلب', percent: true, role: 'core_habit' },
    { periodKey: 'character_daily', title: 'الصيام', disabledDays: DISABLED_EXCEPT_MON_THU },
    { periodKey: 'character_daily', title: 'الصدقة' },
    { periodKey: 'character_daily', title: 'صلاة الاستخارة' },
    { periodKey: 'character_daily', title: 'المحافظة على الوضوء', percent: true },
    { periodKey: 'character_daily', boundPeriodKey: 'night', title: 'الوضوء للنوم', normalDay: true },
    // الدعوة والعلم والمحاسبة (6)
    { periodKey: 'knowledge_accountability', title: 'الدعوة إلى الله' },
    { periodKey: 'knowledge_accountability', title: 'العلم الدنيوي', percent: true },
    { periodKey: 'knowledge_accountability', title: 'العلم الشرعي (حضور)', qadaa: true },
    { periodKey: 'knowledge_accountability', title: 'العلم الشرعي (مذاكرة)', qadaa: true, percent: true },
    { periodKey: 'knowledge_accountability', boundPeriodKey: 'night', title: 'المحاسبة اليومية', normalDay: true },
    { periodKey: 'knowledge_accountability', boundPeriodKey: 'night', title: 'التوبة', normalDay: true },
    // وظائف الجمعة (12)
    { periodKey: 'friday', title: 'زيارة القبور', disabledDays: DISABLED_EXCEPT_FRIDAY },
    { periodKey: 'friday', title: 'سنن الفطرة', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'الغسل', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'لبس أفضل الثياب', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'الطيب', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'السواك (الجمعة)', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'اختيار المسجد الأفضل', disabledDays: DISABLED_EXCEPT_FRIDAY },
    { periodKey: 'friday', title: 'التبكير للجمعة', disabledDays: DISABLED_EXCEPT_FRIDAY },
    { periodKey: 'friday', title: 'الدعاء عند صعود الإمام', disabledDays: DISABLED_EXCEPT_FRIDAY },
    { periodKey: 'friday', title: 'الدعاء بعد العصر (الجمعة)', disabledDays: DISABLED_EXCEPT_FRIDAY },
    { periodKey: 'friday', title: 'سورة الكهف', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
    { periodKey: 'friday', title: 'الصلاة على النبي ﷺ (الجمعة)', disabledDays: DISABLED_EXCEPT_FRIDAY, normalDay: true },
  ],
};

const BLUEPRINTS: Record<TemplateLevelId, LevelBlueprint> = {
  level_1: LEVEL_1_BLUEPRINT,
  level_2: LEVEL_2_BLUEPRINT,
  level_3: LEVEL_3_BLUEPRINT,
};

export const TEMPLATE_CATALOG: readonly TemplateMetadata[] = [
  {
    id: 'level_1',
    title: 'المستوى الأول — التأسيس',
    subtitle: 'جدول سنة أولى',
    description:
      'الأساس المتين: الجماعة الأولى والسنن الرواتب، أذكار الصباح والمساء والأذكار المقيدة، ورد القرآن، العلم والبر، ووظائف الجمعة.',
    badge: 'موصى به للبداية',
    periodCount: LEVEL_1_BLUEPRINT.periods.length,
    actionCount: LEVEL_1_BLUEPRINT.actions.length,
  },
  {
    id: 'level_2',
    title: 'المستوى الثاني — المتوسط',
    subtitle: 'جدول سنة (2) و (3)',
    description:
      'يرتقي بالتفاصيل: الدعاء بين الأذانين، تكبيرة الإحرام، التهليل والضحى، الاستغفار، الدعوة، ووظائف الجمعة الكاملة.',
    badge: 'متوازن',
    periodCount: LEVEL_2_BLUEPRINT.periods.length,
    actionCount: LEVEL_2_BLUEPRINT.actions.length,
  },
  {
    id: 'level_3',
    title: 'المستوى الثالث — المتقدم',
    subtitle: 'الجدول التفصيلي الشامل',
    description:
      'محاسبة دقيقة شاملة: التبكير والصف الأول والسواك والخشوع في كل صلاة، الدعاء، الآداب اليومية، العلم الشرعي، وكل وظائف الجمعة.',
    badge: 'شامل',
    periodCount: LEVEL_3_BLUEPRINT.periods.length,
    actionCount: LEVEL_3_BLUEPRINT.actions.length,
  },
] as const;

export function buildTemplateBundle(
  level: TemplateLevelId,
  activeFromIso = '2026-01-01',
): StarterPackBundle {
  return buildFromBlueprint(BLUEPRINTS[level], activeFromIso);
}

export interface CustomOnboardingAction {
  id: string;
  period_id: string;
  title: string;
}

/**
 * Pure domain filter/customizer shared by the Onboarding Preview and POST /api/bootstrap/init.
 * Ensures zero orphan actions, zero broken bound_time_period_id FKs, and clean sequential sort orders.
 */
export function customizeTemplateBundle(params: {
  level: TemplateLevelId;
  activeFromIso: string;
  excludedPeriodIds?: readonly string[];
  excludedActionIds?: readonly string[];
  customActions?: readonly CustomOnboardingAction[];
  ntfyAllPeriodsEnabled?: boolean;
}): StarterPackBundle {
  const base = buildTemplateBundle(params.level, params.activeFromIso);
  const excludedPeriods = new Set(params.excludedPeriodIds ?? []);
  const excludedActions = new Set(params.excludedActionIds ?? []);

  let timeOrder = 1;
  let dailyOrder = 101;
  const keptPeriods: Period[] = [];
  const keptPeriodIds = new Set<string>();

  for (const period of base.periods) {
    if (excludedPeriods.has(period.id)) continue;
    keptPeriodIds.add(period.id);
    const isTime = period.side === 'TIME_BOUND';
    keptPeriods.push({
      ...period,
      sort_order: isTime ? timeOrder++ : dailyOrder++,
      ntfy_enabled:
        isTime && params.ntfyAllPeriodsEnabled !== undefined
          ? params.ntfyAllPeriodsEnabled
          : period.ntfy_enabled,
    });
  }

  // Detect uniform default_disabled_days per period (e.g., Friday-only group) so quick-added
  // custom actions inside that group inherit the group's weekly cadence automatically.
  const uniformDisabledByPeriod = new Map<string, number[]>();
  for (const period of keptPeriods) {
    const templateInPeriod = base.actions.filter((a) => a.period_id === period.id);
    if (templateInPeriod.length === 0) continue;
    const firstKey = templateInPeriod[0]!.default_disabled_days.join(',');
    if (
      firstKey !== '' &&
      templateInPeriod.every((a) => a.default_disabled_days.join(',') === firstKey)
    ) {
      uniformDisabledByPeriod.set(period.id, [...templateInPeriod[0]!.default_disabled_days]);
    }
  }

  const keptActions: Action[] = [];
  const keptActionIds = new Set<string>();
  const sortOrderByPeriod = new Map<string, number>();

  for (const action of base.actions) {
    if (!keptPeriodIds.has(action.period_id) || excludedActions.has(action.id)) {
      continue;
    }
    const nextOrder = (sortOrderByPeriod.get(action.period_id) ?? 0) + 1;
    sortOrderByPeriod.set(action.period_id, nextOrder);
    keptActionIds.add(action.id);
    keptActions.push({
      ...action,
      sort_order: nextOrder,
      bound_time_period_id:
        action.bound_time_period_id && keptPeriodIds.has(action.bound_time_period_id)
          ? action.bound_time_period_id
          : null,
    });
  }

  for (const custom of params.customActions ?? []) {
    const trimmed = custom.title.trim();
    if (!trimmed || !keptPeriodIds.has(custom.period_id)) continue;
    const nextOrder = (sortOrderByPeriod.get(custom.period_id) ?? 0) + 1;
    sortOrderByPeriod.set(custom.period_id, nextOrder);
    keptActionIds.add(custom.id);
    keptActions.push({
      id: custom.id,
      period_id: custom.period_id,
      bound_time_period_id: null,
      title: trimmed.slice(0, 120),
      sort_order: nextOrder,
      is_mosque_action: false,
      is_qadaa_eligible: false,
      supports_percentage: false,
      include_in_normal_day_preset: false,
      analytics_role: 'standard',
      default_disabled_days: uniformDisabledByPeriod.get(custom.period_id) ?? [],
      active_from: params.activeFromIso,
      archived_at: null,
    });
  }

  const keptTargetVersions = base.targetVersions.filter((tv) =>
    keptActionIds.has(tv.action_id),
  );

  return {
    periods: keptPeriods,
    actions: keptActions,
    targetVersions: keptTargetVersions,
  };
}

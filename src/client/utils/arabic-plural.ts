export interface ArabicCountForms {
  zero?: string;
  one: string;
  two: string;
  few: string;
  many: string;
}

export const ARABIC_NOUN_FORMS = {
  cell: {
    zero: '0 خانات',
    one: 'خانة واحدة',
    two: 'خانتان',
    few: 'خانات',
    many: 'خانة',
  },
  day: {
    zero: 'اليوم',
    one: 'يوم واحد',
    two: 'يومان',
    few: 'أيام',
    many: 'يوماً',
  },
  action: {
    zero: '0 أعمال',
    one: 'عمل واحد',
    two: 'عملان',
    few: 'أعمال',
    many: 'عملاً',
  },
  section: {
    zero: '0 أقسام',
    one: 'قسم واحد',
    two: 'قسمان',
    few: 'أقسام',
    many: 'قسماً',
  },
  logRecord: {
    zero: '0 سجلات تاريخية',
    one: 'سجل تاريخي واحد',
    two: 'سجلان تاريخيان',
    few: 'سجلات تاريخية',
    many: 'سجلاً تاريخياً',
  },
  habit: {
    zero: '0 عادات يومية',
    one: 'عادة يومية واحدة',
    two: 'عادتان يوميتان',
    few: 'عادات يومية',
    many: 'عادة يومية',
  },
} as const satisfies Record<string, ArabicCountForms>;

/**
 * Formats an integer with proper Modern Standard Arabic singular/dual/plural noun agreement.
 */
export function formatArabicCount(
  count: number,
  forms: ArabicCountForms,
): string {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return forms.zero ?? `0 ${forms.few}`;
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const mod100 = n % 100;
  if (mod100 >= 3 && mod100 <= 10) {
    return `${n} ${forms.few}`;
  }
  return `${n} ${forms.many}`;
}

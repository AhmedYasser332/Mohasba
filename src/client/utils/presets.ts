import type { CalcMethod } from '@/domain';

export interface CityPreset {
  id: string;
  city_name: string;
  iana_timezone: string;
  latitude: number;
  longitude: number;
  calc_method: CalcMethod;
}

export const CITY_PRESETS: readonly CityPreset[] = [
  {
    id: 'cairo',
    city_name: 'القاهرة',
    iana_timezone: 'Africa/Cairo',
    latitude: 30.0444,
    longitude: 31.2357,
    calc_method: 'Egyptian',
  },
  {
    id: 'alexandria',
    city_name: 'الإسكندرية',
    iana_timezone: 'Africa/Cairo',
    latitude: 31.2001,
    longitude: 29.9187,
    calc_method: 'Egyptian',
  },
  {
    id: 'makkah',
    city_name: 'مكة المكرمة',
    iana_timezone: 'Asia/Riyadh',
    latitude: 21.4225,
    longitude: 39.8262,
    calc_method: 'UmmAlQura',
  },
  {
    id: 'madinah',
    city_name: 'المدينة المنورة',
    iana_timezone: 'Asia/Riyadh',
    latitude: 24.4672,
    longitude: 39.6112,
    calc_method: 'UmmAlQura',
  },
  {
    id: 'riyadh',
    city_name: 'الرياض',
    iana_timezone: 'Asia/Riyadh',
    latitude: 24.7136,
    longitude: 46.6753,
    calc_method: 'UmmAlQura',
  },
  {
    id: 'dubai',
    city_name: 'دبي',
    iana_timezone: 'Asia/Dubai',
    latitude: 25.2048,
    longitude: 55.2708,
    calc_method: 'Dubai',
  },
  {
    id: 'istanbul',
    city_name: 'إسطنبول',
    iana_timezone: 'Europe/Istanbul',
    latitude: 41.0082,
    longitude: 28.9784,
    calc_method: 'Turkey',
  },
  {
    id: 'london',
    city_name: 'لندن',
    iana_timezone: 'Europe/London',
    latitude: 51.5072,
    longitude: -0.1276,
    calc_method: 'MWL',
  },
] as const;

export const CALC_METHODS: ReadonlyArray<{ value: CalcMethod; label: string }> = [
  { value: 'Egyptian', label: 'الهيئة المصرية العامة للمساحة' },
  { value: 'UmmAlQura', label: 'أم القرى' },
  { value: 'MWL', label: 'رابطة العالم الإسلامي' },
  { value: 'ISNA', label: 'الجمعية الإسلامية لأمريكا الشمالية (ISNA)' },
  { value: 'Karachi', label: 'جامعة العلوم الإسلامية بكراتشي' },
  { value: 'Dubai', label: 'دائرة الشؤون الإسلامية بدبي' },
  { value: 'Kuwait', label: 'الكويت' },
  { value: 'Qatar', label: 'قطر' },
  { value: 'Turkey', label: 'رئاسة الشؤون الدينية التركية' },
  { value: 'Singapore', label: 'سنغافورة' },
  { value: 'MoonsightingCommittee', label: 'لجنة تحري الهلال' },
];

export function generateSecureNtfyTopicUrl(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `https://ntfy.sh/mohasba-${hex}`;
}

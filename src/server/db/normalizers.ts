import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Action,
  AppSettings,
  Period,
  TargetVersion,
} from '@/domain/types';

export function normalizeAppSettingsRow(
  row: Record<string, unknown>,
): AppSettings {
  return {
    id: 1,
    rollover_mode: row.rollover_mode as AppSettings['rollover_mode'],
    iana_timezone: String(row.iana_timezone),
    city_name: String(row.city_name),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    calc_method: row.calc_method as AppSettings['calc_method'],
    asr_madhhab: row.asr_madhhab as AppSettings['asr_madhhab'],
    prayer_offsets: row.prayer_offsets as AppSettings['prayer_offsets'],
    week_start_day: Number(row.week_start_day),
    ntfy_master_enabled: Boolean(row.ntfy_master_enabled),
    quiet_start_hhmm:
      row.quiet_start_hhmm === null || row.quiet_start_hhmm === undefined
        ? null
        : String(row.quiet_start_hhmm),
    quiet_end_hhmm:
      row.quiet_end_hhmm === null || row.quiet_end_hhmm === undefined
        ? null
        : String(row.quiet_end_hhmm),
    digest_enabled: Boolean(row.digest_enabled),
    digest_hhmm: String(row.digest_hhmm),
    backup_reminder_enabled: Boolean(row.backup_reminder_enabled),
    onboarding_completed: Boolean(row.onboarding_completed),
    last_pruned_date:
      row.last_pruned_date === null || row.last_pruned_date === undefined
        ? null
        : String(row.last_pruned_date),
    created_at:
      row.created_at === undefined ? undefined : String(row.created_at),
    updated_at:
      row.updated_at === undefined ? undefined : String(row.updated_at),
  };
}

export function normalizePeriodRow(row: Record<string, unknown>): Period {
  return {
    id: String(row.id),
    title: String(row.title),
    side: row.side as Period['side'],
    sort_order: Number(row.sort_order),
    start_anchor:
      (row.start_anchor as Period['start_anchor']) ?? null,
    start_offset_min: Number(row.start_offset_min ?? 0),
    start_fixed_hhmm:
      row.start_fixed_hhmm === null || row.start_fixed_hhmm === undefined
        ? null
        : String(row.start_fixed_hhmm),
    end_anchor: (row.end_anchor as Period['end_anchor']) ?? null,
    end_offset_min: Number(row.end_offset_min ?? 0),
    end_fixed_hhmm:
      row.end_fixed_hhmm === null || row.end_fixed_hhmm === undefined
        ? null
        : String(row.end_fixed_hhmm),
    ntfy_enabled: Boolean(row.ntfy_enabled),
    ntfy_mode: (row.ntfy_mode as Period['ntfy_mode']) ?? null,
    ntfy_offset_min: Number(row.ntfy_offset_min ?? 25),
    active_from: String(row.active_from),
    archived_at:
      row.archived_at === null || row.archived_at === undefined
        ? null
        : String(row.archived_at),
    created_at:
      row.created_at === undefined ? undefined : String(row.created_at),
    updated_at:
      row.updated_at === undefined ? undefined : String(row.updated_at),
  };
}

export function normalizeActionRow(row: Record<string, unknown>): Action {
  const disabledRaw = Array.isArray(row.default_disabled_days)
    ? row.default_disabled_days.map((d) => Number(d))
    : [];
  return {
    id: String(row.id),
    period_id: String(row.period_id),
    bound_time_period_id:
      row.bound_time_period_id === null ||
      row.bound_time_period_id === undefined
        ? null
        : String(row.bound_time_period_id),
    title: String(row.title),
    sort_order: Number(row.sort_order),
    is_mosque_action: Boolean(row.is_mosque_action),
    is_qadaa_eligible: Boolean(row.is_qadaa_eligible),
    supports_percentage: Boolean(row.supports_percentage),
    include_in_normal_day_preset: Boolean(row.include_in_normal_day_preset),
    analytics_role: row.analytics_role as Action['analytics_role'],
    default_disabled_days: disabledRaw,
    active_from: String(row.active_from),
    archived_at:
      row.archived_at === null || row.archived_at === undefined
        ? null
        : String(row.archived_at),
    created_at:
      row.created_at === undefined ? undefined : String(row.created_at),
    updated_at:
      row.updated_at === undefined ? undefined : String(row.updated_at),
  };
}

export function normalizeTargetVersionRow(
  row: Record<string, unknown>,
): TargetVersion {
  return {
    id: String(row.id),
    action_id: String(row.action_id),
    effective_from: String(row.effective_from),
    target_label: String(row.target_label),
    target_value:
      row.target_value === null || row.target_value === undefined
        ? null
        : Number(row.target_value),
    target_unit:
      row.target_unit === null || row.target_unit === undefined
        ? null
        : String(row.target_unit),
    direction: row.direction as TargetVersion['direction'],
    created_at:
      row.created_at === undefined ? undefined : String(row.created_at),
  };
}

export async function fetchAppSettings(
  supabase: SupabaseClient,
): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed loading app_settings: ${error?.message ?? 'missing singleton row'}`,
    );
  }
  return normalizeAppSettingsRow(data as Record<string, unknown>);
}

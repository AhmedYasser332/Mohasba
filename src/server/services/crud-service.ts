import type { SupabaseClient } from '@supabase/supabase-js';
import { parseIsoDateParts, resolveIslamicDate } from '@/domain/prayer-engine';
import { countOpenQadaaForAction } from '@/domain/qadaa';
import {
  ActionSchema,
  AnalyticsRoleSchema,
  AsrMadhhabSchema,
  AuditLogCategorySchema,
  AuditLogLevelSchema,
  CalcMethodSchema,
  DefaultHomeViewSchema,
  DefaultWeekModeSchema,
  EnterKeyModeSchema,
  HhmmSchema,
  IsoDateSchema,
  KeyboardShortcutsMapSchema,
  NtfyModeSchema,
  PeriodSchema,
  PeriodSideSchema,
  PrayerAnchorSchema,
  PrayerOffsetsSchema,
  RolloverModeSchema,
  TargetDirectionSchema,
  WeekdaySchema,
  type Action,
  type AppSettings,
  type AuditLogEntry,
  type NtfyStatusMeta,
  type Period,
  type TargetVersion,
} from '@/domain/types';
import { z } from 'zod';
import type { RuntimeConfig } from '../config';
import {
  buildNtfyStatusMeta,
  extractNtfySecretsFromRow,
  fetchAppSettings,
  normalizeActionRow,
  normalizeAppSettingsRow,
  normalizePeriodRow,
  normalizeTargetVersionRow,
} from '../db/normalizers';
import { fetchAllDailyLogsKeyset } from '../db/pagination';
import { ServiceError } from '../errors';
import { writeAuditLog } from '../observability/logger';
import { validateNtfyTopicUrl } from '../security/ntfy-url';
import { assertValidIanaTimezone } from '../validation';

function validateCalendarIsoDate(iso: string, fieldName: string): void {
  try {
    parseIsoDateParts(iso);
  } catch {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      `Invalid calendar date for ${fieldName}: ${iso}`,
    );
  }
}

export const SettingsPatchSchema = z
  .object({
    rollover_mode: RolloverModeSchema.optional(),
    iana_timezone: z.string().trim().min(1).max(64).optional(),
    city_name: z.string().trim().min(1).max(100).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    calc_method: CalcMethodSchema.optional(),
    asr_madhhab: AsrMadhhabSchema.optional(),
    prayer_offsets: PrayerOffsetsSchema.optional(),
    week_start_day: z.number().int().min(0).max(6).optional(),
    ntfy_master_enabled: z.boolean().optional(),
    quiet_start_hhmm: HhmmSchema.nullable().optional(),
    quiet_end_hhmm: HhmmSchema.nullable().optional(),
    digest_enabled: z.boolean().optional(),
    digest_hhmm: HhmmSchema.optional(),
    backup_reminder_enabled: z.boolean().optional(),
    show_catchup_banner: z.boolean().optional(),
    default_home_view: DefaultHomeViewSchema.optional(),
    default_week_mode: DefaultWeekModeSchema.optional(),
    enter_key_mode: EnterKeyModeSchema.optional(),
    keyboard_shortcuts: KeyboardShortcutsMapSchema.optional(),
    ntfy_topic_url: z.string().nullable().optional(),
    ntfy_access_token: z.string().nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one settings field must be provided.',
  });

export async function updateSettings(params: {
  supabase: SupabaseClient;
  config?: RuntimeConfig;
  patch: z.infer<typeof SettingsPatchSchema>;
  requestId: string;
}): Promise<{ settings: AppSettings } & NtfyStatusMeta> {
  const { supabase, config, patch, requestId } = params;

  if (patch.iana_timezone) {
    assertValidIanaTimezone(patch.iana_timezone);
  }

  const { ntfy_topic_url, ntfy_access_token, ...safePatch } = patch;
  const dbPatch: Record<string, unknown> = {
    ...safePatch,
    updated_at: new Date().toISOString(),
  };

  if (ntfy_topic_url !== undefined) {
    if (ntfy_topic_url === null || ntfy_topic_url.trim() === '') {
      dbPatch.ntfy_topic_url = null;
    } else {
      const urlCheck = validateNtfyTopicUrl(ntfy_topic_url);
      if (!urlCheck.ok) {
        throw new ServiceError(400, 'VALIDATION_ERROR', urlCheck.reason);
      }
      dbPatch.ntfy_topic_url = urlCheck.url;
    }
  }

  if (ntfy_access_token !== undefined) {
    if (ntfy_access_token === null || ntfy_access_token === '') {
      dbPatch.ntfy_access_token = null;
    } else {
      const trimmedToken = ntfy_access_token.trim();
      if (
        trimmedToken.length < 1 ||
        trimmedToken.length > 500 ||
        !/^[\x21-\x7E]+$/.test(trimmedToken)
      ) {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          'ntfy access token must be 1..500 visible ASCII characters without whitespace or control characters.',
        );
      }
      dbPatch.ntfy_access_token = trimmedToken;
    }
  }

  const { data, error } = await supabase
    .from('app_settings')
    .update(dbPatch)
    .eq('id', 1)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed updating app_settings: ${error?.message ?? 'missing row'}`,
    );
  }

  const row = data as Record<string, unknown>;
  const { ntfyTopicUrlDb, ntfyAccessTokenDb } = extractNtfySecretsFromRow(row);
  const ntfyMeta = buildNtfyStatusMeta({
    ntfyTopicUrlDb,
    ntfyAccessTokenDb,
    envTopicUrl: config?.ntfyTopicUrl ?? null,
  });

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'CRUD',
    event_name: 'settings_updated',
    request_id: requestId,
    entity_type: 'app_settings',
    entity_id: '1',
    summary: 'Updated application settings.',
    context: { updated_fields: Object.keys(patch) },
  });

  return {
    settings: normalizeAppSettingsRow(row),
    ...ntfyMeta,
  };
}

export const CreatePeriodInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(80),
  side: PeriodSideSchema,
  sort_order: z.number().int().default(0),
  start_anchor: PrayerAnchorSchema.nullable().default(null),
  start_offset_min: z.number().int().min(-360).max(360).default(0),
  start_fixed_hhmm: HhmmSchema.nullable().default(null),
  end_anchor: PrayerAnchorSchema.nullable().default(null),
  end_offset_min: z.number().int().min(-360).max(360).default(0),
  end_fixed_hhmm: HhmmSchema.nullable().default(null),
  ntfy_enabled: z.boolean().default(true),
  ntfy_mode: NtfyModeSchema.nullable().default('pre_expiry'),
  ntfy_offset_min: z.number().int().min(1).max(180).default(25),
  active_from: IsoDateSchema.optional(),
});

export async function createPeriod(params: {
  supabase: SupabaseClient;
  input: z.infer<typeof CreatePeriodInputSchema>;
  requestId: string;
}): Promise<{ period: Period }> {
  const { supabase, input, requestId } = params;
  const settings = await fetchAppSettings(supabase);
  const activeFrom =
    input.active_from ?? resolveIslamicDate(Date.now(), settings);
  validateCalendarIsoDate(activeFrom, 'active_from');

  const candidate: Period = {
    id: input.id ?? crypto.randomUUID(),
    title: input.title,
    side: input.side,
    sort_order: input.sort_order,
    start_anchor: input.side === 'DAILY_GROUP' ? null : input.start_anchor,
    start_offset_min: input.start_offset_min,
    start_fixed_hhmm:
      input.side === 'DAILY_GROUP' ? null : input.start_fixed_hhmm,
    end_anchor: input.side === 'DAILY_GROUP' ? null : input.end_anchor,
    end_offset_min: input.end_offset_min,
    end_fixed_hhmm: input.side === 'DAILY_GROUP' ? null : input.end_fixed_hhmm,
    ntfy_enabled: input.ntfy_enabled,
    ntfy_mode: input.ntfy_mode,
    ntfy_offset_min: input.ntfy_offset_min,
    active_from: activeFrom,
    archived_at: null,
  };

  const validated = PeriodSchema.safeParse(candidate);
  if (!validated.success) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      'Invalid period configuration.',
      validated.error.flatten(),
    );
  }

  const { data, error } = await supabase
    .from('periods')
    .insert(validated.data)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed creating period: ${error?.message ?? 'unknown'}`);
  }

  const period = normalizePeriodRow(data as Record<string, unknown>);

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'CRUD',
    event_name: 'period_created',
    request_id: requestId,
    entity_type: 'period',
    entity_id: period.id,
    summary: `Created period (${period.side}).`,
    context: { side: period.side },
  });

  return { period };
}

export const UpdatePeriodInputSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    sort_order: z.number().int().optional(),
    start_anchor: PrayerAnchorSchema.nullable().optional(),
    start_offset_min: z.number().int().min(-360).max(360).optional(),
    start_fixed_hhmm: HhmmSchema.nullable().optional(),
    end_anchor: PrayerAnchorSchema.nullable().optional(),
    end_offset_min: z.number().int().min(-360).max(360).optional(),
    end_fixed_hhmm: HhmmSchema.nullable().optional(),
    ntfy_enabled: z.boolean().optional(),
    ntfy_mode: NtfyModeSchema.nullable().optional(),
    ntfy_offset_min: z.number().int().min(1).max(180).optional(),
    archived_at: IsoDateSchema.nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one period field must be provided.',
  });

export async function updatePeriod(params: {
  supabase: SupabaseClient;
  id: string;
  patch: z.infer<typeof UpdatePeriodInputSchema>;
  requestId: string;
}): Promise<{ period: Period }> {
  const { supabase, id, patch, requestId } = params;

  if (patch.archived_at) {
    validateCalendarIsoDate(patch.archived_at, 'archived_at');
  }

  const { data: existingRow, error: fetchErr } = await supabase
    .from('periods')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Failed loading period: ${fetchErr.message}`);
  }
  if (!existingRow) {
    throw new ServiceError(404, 'NOT_FOUND', `Period ${id} not found.`);
  }

  const existing = normalizePeriodRow(existingRow as Record<string, unknown>);
  const merged: Period = {
    ...existing,
    ...patch,
  };

  const validated = PeriodSchema.safeParse(merged);
  if (!validated.success) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      'Invalid period update.',
      validated.error.flatten(),
    );
  }

  const { data: updatedRow, error: updateErr } = await supabase
    .from('periods')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updateErr || !updatedRow) {
    throw new Error(
      `Failed updating period: ${updateErr?.message ?? 'unknown'}`,
    );
  }

  const period = normalizePeriodRow(updatedRow as Record<string, unknown>);

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'CRUD',
    event_name: 'period_updated',
    request_id: requestId,
    entity_type: 'period',
    entity_id: period.id,
    summary: `Updated period ${period.id}.`,
    context: { updated_fields: Object.keys(patch) },
  });

  return { period };
}

export const CreateActionInputSchema = z.object({
  id: z.string().uuid().optional(),
  period_id: z.string().uuid(),
  bound_time_period_id: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(120),
  sort_order: z.number().int().default(0),
  is_mosque_action: z.boolean().default(false),
  is_qadaa_eligible: z.boolean().default(false),
  supports_percentage: z.boolean().default(false),
  include_in_normal_day_preset: z.boolean().default(false),
  analytics_role: AnalyticsRoleSchema.default('standard'),
  default_disabled_days: z.array(WeekdaySchema).default([]),
  active_from: IsoDateSchema.optional(),
  initial_target: z
    .object({
      id: z.string().uuid().optional(),
      effective_from: IsoDateSchema.optional(),
      target_label: z.string().trim().min(1).max(80),
      target_value: z.number().positive().nullable().default(null),
      target_unit: z.string().trim().min(1).max(32).nullable().default(null),
      direction: TargetDirectionSchema.default('level_up'),
    })
    .optional(),
});

export async function createAction(params: {
  supabase: SupabaseClient;
  input: z.infer<typeof CreateActionInputSchema>;
  requestId: string;
}): Promise<{ action: Action; target_version: TargetVersion | null }> {
  const { supabase, input, requestId } = params;
  const settings = await fetchAppSettings(supabase);
  const activeFrom =
    input.active_from ?? resolveIslamicDate(Date.now(), settings);
  validateCalendarIsoDate(activeFrom, 'active_from');

  const initialTargetEffectiveFrom = input.initial_target
    ? (input.initial_target.effective_from ?? activeFrom)
    : null;
  if (initialTargetEffectiveFrom !== null) {
    validateCalendarIsoDate(
      initialTargetEffectiveFrom,
      'initial_target.effective_from',
    );
  }

  const { data: periodRow, error: periodErr } = await supabase
    .from('periods')
    .select('id, side')
    .eq('id', input.period_id)
    .maybeSingle();

  if (periodErr) {
    throw new Error(`Failed verifying period_id: ${periodErr.message}`);
  }
  if (!periodRow) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      `period_id ${input.period_id} does not exist.`,
    );
  }

  if (periodRow.side === 'TIME_BOUND' && input.bound_time_period_id !== null) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      'bound_time_period_id is only allowed for DAILY_GROUP actions.',
    );
  }

  if (input.bound_time_period_id) {
    const { data: boundRow, error: boundErr } = await supabase
      .from('periods')
      .select('id, side')
      .eq('id', input.bound_time_period_id)
      .maybeSingle();
    if (boundErr) {
      throw new Error(
        `Failed verifying bound_time_period_id: ${boundErr.message}`,
      );
    }
    if (!boundRow || boundRow.side !== 'TIME_BOUND') {
      throw new ServiceError(
        400,
        'VALIDATION_ERROR',
        'bound_time_period_id must reference an existing TIME_BOUND period.',
      );
    }
  }

  const candidateAction: Action = {
    id: input.id ?? crypto.randomUUID(),
    period_id: input.period_id,
    bound_time_period_id:
      periodRow.side === 'TIME_BOUND' ? null : input.bound_time_period_id,
    title: input.title,
    sort_order: input.sort_order,
    is_mosque_action: input.is_mosque_action,
    is_qadaa_eligible: input.is_qadaa_eligible,
    supports_percentage: input.supports_percentage,
    include_in_normal_day_preset: input.include_in_normal_day_preset,
    analytics_role: input.analytics_role,
    default_disabled_days: Array.from(new Set(input.default_disabled_days)),
    active_from: activeFrom,
    archived_at: null,
  };

  const validated = ActionSchema.safeParse(candidateAction);
  if (!validated.success) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      'Invalid action payload.',
      validated.error.flatten(),
    );
  }

  const { data: insertedAction, error: insertErr } = await supabase
    .from('actions')
    .insert(validated.data)
    .select('*')
    .single();

  if (insertErr || !insertedAction) {
    throw new Error(
      `Failed creating action: ${insertErr?.message ?? 'unknown'}`,
    );
  }

  const action = normalizeActionRow(insertedAction as Record<string, unknown>);
  let targetVersion: TargetVersion | null = null;

  if (input.initial_target && initialTargetEffectiveFrom !== null) {
    const { data: tvData, error: tvErr } = await supabase
      .from('target_versions')
      .insert({
        id: input.initial_target.id ?? crypto.randomUUID(),
        action_id: action.id,
        effective_from: initialTargetEffectiveFrom,
        target_label: input.initial_target.target_label,
        target_value: input.initial_target.target_value,
        target_unit: input.initial_target.target_unit,
        direction: input.initial_target.direction,
      })
      .select('*')
      .single();

    if (tvErr || !tvData) {
      await supabase.from('actions').delete().eq('id', action.id);
      throw new Error(
        `Failed creating initial target_version: ${tvErr?.message ?? 'unknown'}`,
      );
    }
    targetVersion = normalizeTargetVersionRow(
      tvData as Record<string, unknown>,
    );
  }

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'CRUD',
    event_name: 'action_created',
    request_id: requestId,
    entity_type: 'action',
    entity_id: action.id,
    summary: `Created action ${action.id}.`,
    context: {
      period_id: action.period_id,
      has_initial_target: Boolean(targetVersion),
    },
  });

  return { action, target_version: targetVersion };
}

export const UpdateActionInputSchema = z
  .object({
    period_id: z.string().uuid().optional(),
    bound_time_period_id: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(120).optional(),
    sort_order: z.number().int().optional(),
    is_mosque_action: z.boolean().optional(),
    is_qadaa_eligible: z.boolean().optional(),
    supports_percentage: z.boolean().optional(),
    include_in_normal_day_preset: z.boolean().optional(),
    analytics_role: AnalyticsRoleSchema.optional(),
    default_disabled_days: z.array(WeekdaySchema).optional(),
    archived_at: IsoDateSchema.nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one action field must be provided.',
  });

export async function updateAction(params: {
  supabase: SupabaseClient;
  id: string;
  patch: z.infer<typeof UpdateActionInputSchema>;
  requestId: string;
}): Promise<{ action: Action; open_qadaa_warning_count?: number }> {
  const { supabase, id, patch, requestId } = params;

  if (patch.archived_at) {
    validateCalendarIsoDate(patch.archived_at, 'archived_at');
  }

  const [{ data: existingRow, error: fetchErr }, settings] = await Promise.all([
    supabase.from('actions').select('*').eq('id', id).maybeSingle(),
    fetchAppSettings(supabase),
  ]);

  if (fetchErr) {
    throw new Error(`Failed loading action: ${fetchErr.message}`);
  }
  if (!existingRow) {
    throw new ServiceError(404, 'NOT_FOUND', `Action ${id} not found.`);
  }

  const existing = normalizeActionRow(existingRow as Record<string, unknown>);

  const targetPeriodId = patch.period_id ?? existing.period_id;
  const { data: targetPeriodRow, error: pErr } = await supabase
    .from('periods')
    .select('id, side')
    .eq('id', targetPeriodId)
    .maybeSingle();
  if (pErr) throw new Error(`Failed verifying period_id: ${pErr.message}`);
  if (!targetPeriodRow) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      `period_id ${targetPeriodId} does not exist.`,
    );
  }

  const isTargetTimeBound = targetPeriodRow.side === 'TIME_BOUND';
  if (
    isTargetTimeBound &&
    patch.bound_time_period_id !== undefined &&
    patch.bound_time_period_id !== null
  ) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      'bound_time_period_id is only allowed for DAILY_GROUP actions.',
    );
  }

  if (
    patch.bound_time_period_id !== undefined &&
    patch.bound_time_period_id !== null
  ) {
    const { data: bRow, error: bErr } = await supabase
      .from('periods')
      .select('id, side')
      .eq('id', patch.bound_time_period_id)
      .maybeSingle();
    if (bErr) {
      throw new Error(`Failed verifying bound_time_period_id: ${bErr.message}`);
    }
    if (!bRow || bRow.side !== 'TIME_BOUND') {
      throw new ServiceError(
        400,
        'VALIDATION_ERROR',
        'bound_time_period_id must reference an existing TIME_BOUND period.',
      );
    }
  }

  const normalizedPatch = {
    ...patch,
    ...(isTargetTimeBound && existing.bound_time_period_id !== null
      ? { bound_time_period_id: null }
      : {}),
    ...(patch.default_disabled_days !== undefined
      ? { default_disabled_days: Array.from(new Set(patch.default_disabled_days)) }
      : {}),
  };

  const merged: Action = {
    ...existing,
    ...normalizedPatch,
  };

  const validated = ActionSchema.safeParse(merged);
  if (!validated.success) {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      'Invalid action update.',
      validated.error.flatten(),
    );
  }

  let openQadaaWarningCount: number | undefined;
  if (
    existing.is_qadaa_eligible === true &&
    patch.is_qadaa_eligible === false
  ) {
    const missedLogs = await fetchAllDailyLogsKeyset(supabase, (q) =>
      q.eq('action_id', id).eq('status', 'MISSED'),
    );
    const todayIslamic = resolveIslamicDate(Date.now(), settings);
    openQadaaWarningCount = countOpenQadaaForAction(
      id,
      missedLogs,
      todayIslamic,
      merged,
    );
  }

  const { data: updatedRow, error: updateErr } = await supabase
    .from('actions')
    .update({
      ...normalizedPatch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updateErr || !updatedRow) {
    throw new Error(
      `Failed updating action: ${updateErr?.message ?? 'unknown'}`,
    );
  }

  const action = normalizeActionRow(updatedRow as Record<string, unknown>);

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'CRUD',
    event_name: 'action_updated',
    request_id: requestId,
    entity_type: 'action',
    entity_id: action.id,
    summary: `Updated action ${action.id}.`,
    context: {
      updated_fields: Object.keys(patch),
      ...(openQadaaWarningCount !== undefined
        ? { open_qadaa_warning_count: openQadaaWarningCount }
        : {}),
    },
  });

  return {
    action,
    ...(openQadaaWarningCount !== undefined
      ? { open_qadaa_warning_count: openQadaaWarningCount }
      : {}),
  };
}

export const CreateTargetVersionInputSchema = z.object({
  id: z.string().uuid().optional(),
  action_id: z.string().uuid(),
  effective_from: IsoDateSchema,
  target_label: z.string().trim().min(1).max(80),
  target_value: z.number().positive().nullable().default(null),
  target_unit: z.string().trim().min(1).max(32).nullable().default(null),
  direction: TargetDirectionSchema.default('level_up'),
});

export async function createTargetVersion(params: {
  supabase: SupabaseClient;
  input: z.infer<typeof CreateTargetVersionInputSchema>;
  requestId: string;
}): Promise<{ target_version: TargetVersion }> {
  const { supabase, input, requestId } = params;
  validateCalendarIsoDate(input.effective_from, 'effective_from');

  const { data: actionRow, error: actionErr } = await supabase
    .from('actions')
    .select('id')
    .eq('id', input.action_id)
    .maybeSingle();

  if (actionErr) {
    throw new Error(`Failed verifying action_id: ${actionErr.message}`);
  }
  if (!actionRow) {
    throw new ServiceError(
      404,
      'NOT_FOUND',
      `Action ${input.action_id} not found.`,
    );
  }

  const { data, error } = await supabase
    .from('target_versions')
    .insert({
      id: input.id ?? crypto.randomUUID(),
      action_id: input.action_id,
      effective_from: input.effective_from,
      target_label: input.target_label,
      target_value: input.target_value,
      target_unit: input.target_unit,
      direction: input.direction,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ServiceError(
        409,
        'DUPLICATE_EFFECTIVE_DATE',
        `A target version already exists for action ${input.action_id} on ${input.effective_from}.`,
      );
    }
    throw new Error(`Failed creating target_version: ${error.message}`);
  }

  const targetVersion = normalizeTargetVersionRow(
    data as Record<string, unknown>,
  );

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'TARGET',
    event_name: 'target_version_created',
    request_id: requestId,
    entity_type: 'target_version',
    entity_id: targetVersion.id,
    summary: `Created target version effective ${targetVersion.effective_from}.`,
    context: {
      action_id: targetVersion.action_id,
      effective_from: targetVersion.effective_from,
      direction: targetVersion.direction,
    },
  });

  return { target_version: targetVersion };
}

export const UpdateTargetVersionInputSchema = z
  .object({
    effective_from: IsoDateSchema.optional(),
    target_label: z.string().trim().min(1).max(80).optional(),
    target_value: z.number().positive().nullable().optional(),
    target_unit: z.string().trim().min(1).max(32).nullable().optional(),
    direction: TargetDirectionSchema.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one target_version field must be provided.',
  });

async function assertTargetVersionUnreferenced(
  supabase: SupabaseClient,
  targetVersionId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select('action_id')
    .eq('target_version_id', targetVersionId)
    .limit(1);

  if (error) {
    throw new Error(
      `Failed checking target_version references: ${error.message}`,
    );
  }
  if (data && data.length > 0) {
    throw new ServiceError(
      409,
      'TARGET_VERSION_REFERENCED',
      'Cannot modify or delete a target version referenced by existing logs.',
    );
  }
}

export async function updateTargetVersion(params: {
  supabase: SupabaseClient;
  id: string;
  patch: z.infer<typeof UpdateTargetVersionInputSchema>;
  requestId: string;
}): Promise<{ target_version: TargetVersion }> {
  const { supabase, id, patch, requestId } = params;

  if (patch.effective_from) {
    validateCalendarIsoDate(patch.effective_from, 'effective_from');
  }

  const { data: existingRow, error: fetchErr } = await supabase
    .from('target_versions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Failed loading target_version: ${fetchErr.message}`);
  }
  if (!existingRow) {
    throw new ServiceError(404, 'NOT_FOUND', `Target version ${id} not found.`);
  }

  await assertTargetVersionUnreferenced(supabase, id);

  const { data, error } = await supabase
    .from('target_versions')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new ServiceError(
        409,
        'DUPLICATE_EFFECTIVE_DATE',
        'A target version already exists on that effective_from date.',
      );
    }
    throw new Error(`Failed updating target_version: ${error.message}`);
  }

  const targetVersion = normalizeTargetVersionRow(
    data as Record<string, unknown>,
  );

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'TARGET',
    event_name: 'target_version_updated',
    request_id: requestId,
    entity_type: 'target_version',
    entity_id: targetVersion.id,
    summary: `Updated unreferenced target version ${targetVersion.id}.`,
    context: { updated_fields: Object.keys(patch) },
  });

  return { target_version: targetVersion };
}

export async function deleteTargetVersion(params: {
  supabase: SupabaseClient;
  id: string;
  requestId: string;
}): Promise<{ ok: true; id: string }> {
  const { supabase, id, requestId } = params;

  const { data: existingRow, error: fetchErr } = await supabase
    .from('target_versions')
    .select('id, action_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Failed loading target_version: ${fetchErr.message}`);
  }
  if (!existingRow) {
    throw new ServiceError(404, 'NOT_FOUND', `Target version ${id} not found.`);
  }

  await assertTargetVersionUnreferenced(supabase, id);

  const { error } = await supabase
    .from('target_versions')
    .delete()
    .eq('id', id);

  if (error) {
    if (error.code === '23503') {
      throw new ServiceError(
        409,
        'TARGET_VERSION_REFERENCED',
        'Cannot delete a target version referenced by existing logs.',
      );
    }
    throw new Error(`Failed deleting target_version: ${error.message}`);
  }

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'TARGET',
    event_name: 'target_version_deleted',
    request_id: requestId,
    entity_type: 'target_version',
    entity_id: id,
    summary: `Deleted unreferenced target version ${id}.`,
    context: { action_id: existingRow.action_id },
  });

  return { ok: true, id };
}

export async function deleteAction(params: {
  supabase: SupabaseClient;
  id: string;
  force?: boolean;
  requestId: string;
}): Promise<{ ok: true; id: string; deleted_logs_count: number }> {
  const { supabase, id, force = false, requestId } = params;

  const { data: rpcRaw, error: rpcErr } = await supabase.rpc(
    'delete_action_atomic',
    {
      p_action_id: id,
      p_force: force,
    },
  );

  if (rpcErr || !rpcRaw || typeof rpcRaw !== 'object') {
    throw new Error(
      `Failed atomic action deletion: ${rpcErr?.message ?? 'empty RPC payload'}`,
    );
  }

  const rpc = rpcRaw as {
    outcome?: string;
    log_count?: number;
    deleted_logs_count?: number;
    title?: string;
    period_id?: string;
  };

  if (rpc.outcome === 'not_found') {
    throw new ServiceError(404, 'NOT_FOUND', `Action ${id} not found.`);
  }

  if (rpc.outcome === 'has_history') {
    const logCount = Number(rpc.log_count ?? 0);
    throw new ServiceError(
      409,
      'HAS_HISTORY',
      `Action has ${logCount} logged entries. Archive it to keep history or confirm permanent deletion.`,
      {
        entity_type: 'action',
        action_id: id,
        log_count: logCount,
      },
    );
  }

  const deletedLogsCount = Number(rpc.deleted_logs_count ?? 0);

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'CRUD',
    event_name: 'action_deleted',
    request_id: requestId,
    entity_type: 'action',
    entity_id: id,
    summary: `Permanently deleted action "${String(rpc.title ?? id)}" (${deletedLogsCount} logs removed).`,
    context: {
      forced: force,
      deleted_logs_count: deletedLogsCount,
      period_id: rpc.period_id ?? null,
    },
  });

  return { ok: true, id, deleted_logs_count: deletedLogsCount };
}

export async function deletePeriod(params: {
  supabase: SupabaseClient;
  id: string;
  force?: boolean;
  requestId: string;
}): Promise<{
  ok: true;
  id: string;
  deleted_actions_count: number;
  deleted_logs_count: number;
  unbound_actions_count: number;
}> {
  const { supabase, id, force = false, requestId } = params;

  const { data: rpcRaw, error: rpcErr } = await supabase.rpc(
    'delete_period_atomic',
    {
      p_period_id: id,
      p_force: force,
    },
  );

  if (rpcErr || !rpcRaw || typeof rpcRaw !== 'object') {
    throw new Error(
      `Failed atomic period deletion: ${rpcErr?.message ?? 'empty RPC payload'}`,
    );
  }

  const rpc = rpcRaw as {
    outcome?: string;
    action_count?: number;
    log_count?: number;
    bound_action_count?: number;
    deleted_actions_count?: number;
    deleted_logs_count?: number;
    unbound_actions_count?: number;
    title?: string;
    side?: string;
  };

  if (rpc.outcome === 'not_found') {
    throw new ServiceError(404, 'NOT_FOUND', `Period ${id} not found.`);
  }

  if (rpc.outcome === 'has_history' || rpc.outcome === 'has_children') {
    const actionCount = Number(rpc.action_count ?? 0);
    const logCount = Number(rpc.log_count ?? 0);
    const boundActionCount = Number(rpc.bound_action_count ?? 0);
    const code = logCount > 0 ? 'HAS_HISTORY' : 'HAS_CHILDREN';
    throw new ServiceError(
      409,
      code,
      logCount > 0
        ? `Period has ${actionCount} actions and ${logCount} logged entries. Archive it to keep history or confirm permanent deletion.`
        : `Period has ${actionCount} actions and ${boundActionCount} linked habits. Confirm permanent deletion to continue.`,
      {
        entity_type: 'period',
        period_id: id,
        action_count: actionCount,
        log_count: logCount,
        bound_action_count: boundActionCount,
      },
    );
  }

  const deletedActionsCount = Number(rpc.deleted_actions_count ?? 0);
  const deletedLogsCount = Number(rpc.deleted_logs_count ?? 0);
  const unboundActionsCount = Number(rpc.unbound_actions_count ?? 0);

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'CRUD',
    event_name: 'period_deleted',
    request_id: requestId,
    entity_type: 'period',
    entity_id: id,
    summary: `Permanently deleted period "${String(rpc.title ?? id)}" (${deletedActionsCount} actions, ${deletedLogsCount} logs removed, ${unboundActionsCount} habits unbound).`,
    context: {
      forced: force,
      side: rpc.side ?? null,
      deleted_actions_count: deletedActionsCount,
      deleted_logs_count: deletedLogsCount,
      unbound_actions_count: unboundActionsCount,
    },
  });

  return {
    ok: true,
    id,
    deleted_actions_count: deletedActionsCount,
    deleted_logs_count: deletedLogsCount,
    unbound_actions_count: unboundActionsCount,
  };
}

export const ReorderSchemaInputSchema = z.object({
  target: z.enum(['periods', 'actions']),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        sort_order: z.number().int().min(0).max(32767),
        period_id: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(300)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      { message: 'Duplicate item ids are not allowed.' },
    ),
});

export async function reorderSchema(params: {
  supabase: SupabaseClient;
  input: z.infer<typeof ReorderSchemaInputSchema>;
  requestId: string;
}): Promise<{ updated_count: number; failed_ids: string[] }> {
  const { supabase, input, requestId } = params;
  const nowIso = new Date().toISOString();

  const periodSideById = new Map<string, Period['side']>();
  if (input.target === 'actions') {
    const distinctPeriodIds = Array.from(
      new Set(
        input.items
          .map((item) => item.period_id)
          .filter((pid): pid is string => pid !== undefined),
      ),
    );
    if (distinctPeriodIds.length > 0) {
      const { data: periodRows, error: periodErr } = await supabase
        .from('periods')
        .select('id, side')
        .in('id', distinctPeriodIds);
      if (periodErr) {
        throw new Error(
          `Failed verifying target period_ids: ${periodErr.message}`,
        );
      }
      for (const row of periodRows ?? []) {
        periodSideById.set(String(row.id), row.side as Period['side']);
      }
      for (const pid of distinctPeriodIds) {
        if (!periodSideById.has(pid)) {
          throw new ServiceError(
            400,
            'VALIDATION_ERROR',
            `Target period_id ${pid} does not exist.`,
          );
        }
      }
    }
  }

  let updatedCount = 0;
  const failedIds: string[] = [];
  const CHUNK_SIZE = 10;

  for (let i = 0; i < input.items.length; i += CHUNK_SIZE) {
    const chunk = input.items.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (item) => {
        const updatePayload: Record<string, unknown> = {
          sort_order: item.sort_order,
          updated_at: nowIso,
        };
        if (input.target === 'actions' && item.period_id !== undefined) {
          updatePayload.period_id = item.period_id;
          if (periodSideById.get(item.period_id) === 'TIME_BOUND') {
            updatePayload.bound_time_period_id = null;
          }
        }

        const { data, error } = await supabase
          .from(input.target)
          .update(updatePayload)
          .eq('id', item.id)
          .select('id')
          .maybeSingle();

        return error || !data ? item.id : null;
      }),
    );

    for (const failedId of results) {
      if (failedId === null) {
        updatedCount += 1;
      } else {
        failedIds.push(failedId);
      }
    }
  }

  await writeAuditLog(supabase, {
    level: failedIds.length > 0 ? 'WARN' : 'INFO',
    category: 'CRUD',
    event_name: 'schema_reordered',
    request_id: requestId,
    entity_type: input.target,
    summary: `Reordered ${input.target}: ${updatedCount} updated, ${failedIds.length} failed.`,
    context: {
      target: input.target,
      updated_count: updatedCount,
      failed_ids: failedIds,
    },
  });

  return { updated_count: updatedCount, failed_ids: failedIds };
}

export const ListAuditLogsQuerySchema = z.object({
  level: AuditLogLevelSchema.optional(),
  category: AuditLogCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listAuditLogs(params: {
  supabase: SupabaseClient;
  level?: z.infer<typeof AuditLogLevelSchema>;
  category?: z.infer<typeof AuditLogCategorySchema>;
  limit?: number;
}): Promise<{ audit_logs: AuditLogEntry[] }> {
  const { supabase, level, category } = params;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);

  let query = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (level) {
    query = query.eq('level', level);
  }
  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed reading audit_logs: ${error.message}`);
  }

  return {
    audit_logs: (data ?? []) as AuditLogEntry[],
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDaysIso,
  parseIsoDateParts,
  resolveIslamicDate,
} from '@/domain/prayer-engine';
import { buildStarterPack } from '@/domain/starter-pack';
import {
  buildTemplateBundle,
  customizeTemplateBundle,
  planTemplateMerge,
  type TemplateLevelId,
} from '@/domain/templates';
import {
  makeCellKey,
  type Action,
  type AppSettings,
  type DailyLog,
  type NtfySource,
  type Period,
  type TargetVersion,
} from '@/domain/types';
import type { z } from 'zod';
import type { RuntimeConfig } from '../config';
import {
  buildNtfyStatusMeta,
  fetchAppSettings,
  fetchAppSettingsWithNtfySecrets,
  normalizeActionRow,
  normalizeAppSettingsRow,
  normalizePeriodRow,
  normalizeTargetVersionRow,
} from '../db/normalizers';
import { fetchAllDailyLogsKeyset } from '../db/pagination';
import { ServiceError } from '../errors';
import { writeAuditLog } from '../observability/logger';
import { updateSettings, type SettingsPatchSchema } from './crud-service';

export interface BootstrapResponse {
  server_now: string;
  ntfy_configured: boolean;
  ntfy_source: NtfySource;
  ntfy_topic_hint: string | null;
  ntfy_has_token: boolean;
  settings: AppSettings;
  periods: Period[];
  actions: Action[];
  target_versions: TargetVersion[];
  daily_logs: DailyLog[];
}

export async function getBootstrap(params: {
  config: RuntimeConfig;
  supabase: SupabaseClient;
  since?: string | null;
}): Promise<BootstrapResponse> {
  const { config, supabase, since } = params;

  let sinceMs: number | null = null;
  if (since !== undefined && since !== null && since.trim() !== '') {
    const parsed = Date.parse(since);
    if (!Number.isFinite(parsed)) {
      throw new ServiceError(
        400,
        'VALIDATION_ERROR',
        'Invalid since timestamp parameter.',
      );
    }
    sinceMs = parsed;
  }

  const serverNow = new Date().toISOString();

  const [settingsResult, periodsRes, actionsRes, targetsRes] = await Promise.all([
    fetchAppSettingsWithNtfySecrets(supabase),
    supabase
      .from('periods')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('actions')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('target_versions')
      .select('*')
      .order('effective_from', { ascending: true })
      .order('id', { ascending: true }),
  ]);
  const { settings, ntfyTopicUrlDb, ntfyAccessTokenDb } = settingsResult;

  if (periodsRes.error) {
    throw new Error(`Failed loading periods: ${periodsRes.error.message}`);
  }
  if (actionsRes.error) {
    throw new Error(`Failed loading actions: ${actionsRes.error.message}`);
  }
  if (targetsRes.error) {
    throw new Error(
      `Failed loading target_versions: ${targetsRes.error.message}`,
    );
  }

  const periods = (periodsRes.data ?? []).map((r) =>
    normalizePeriodRow(r as Record<string, unknown>),
  );
  const actions = (actionsRes.data ?? []).map((r) =>
    normalizeActionRow(r as Record<string, unknown>),
  );
  const target_versions = (targetsRes.data ?? []).map((r) =>
    normalizeTargetVersionRow(r as Record<string, unknown>),
  );

  let daily_logs: DailyLog[];

  if (sinceMs !== null) {
    // Delta mode: apply 5-minute safety overlap to eliminate clock-skew / in-flight transaction misses.
    const overlapIso = new Date(sinceMs - 5 * 60 * 1000).toISOString();
    daily_logs = await fetchAllDailyLogsKeyset(supabase, (q) =>
      q.gte('updated_at', overlapIso),
    );
  } else {
    // Full mode: complete 90-day window + ALL open Qadaa rows (including >90d), deduplicated.
    const todayIslamic = resolveIslamicDate(Date.now(), settings);
    const cutoff90d = addDaysIso(todayIslamic, -90);

    const [recentLogs, openQadaaLogs] = await Promise.all([
      fetchAllDailyLogsKeyset(supabase, (q) => q.gte('log_date', cutoff90d)),
      fetchAllDailyLogsKeyset(supabase, (q) =>
        q
          .eq('status', 'MISSED')
          .or('availability_override.is.null,availability_override.neq.DISABLED'),
      ),
    ]);

    const dedup = new Map<string, DailyLog>();
    for (const log of recentLogs) {
      dedup.set(makeCellKey(log.action_id, log.log_date), log);
    }
    for (const log of openQadaaLogs) {
      dedup.set(makeCellKey(log.action_id, log.log_date), log);
    }

    daily_logs = Array.from(dedup.values()).sort((a, b) => {
      if (a.log_date !== b.log_date) {
        return a.log_date.localeCompare(b.log_date);
      }
      return a.action_id.localeCompare(b.action_id);
    });
  }

  const ntfyMeta = buildNtfyStatusMeta({
    ntfyTopicUrlDb,
    ntfyAccessTokenDb,
    envTopicUrl: config.ntfyTopicUrl,
  });

  return {
    server_now: serverNow,
    ...ntfyMeta,
    settings,
    periods,
    actions,
    target_versions,
    daily_logs,
  };
}

async function deriveDeterministicCustomUuid(seed: string): Promise<string> {
  const bytes = new TextEncoder().encode(seed);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const h = new Uint8Array(hashBuffer).slice(0, 16);
  // Stamp RFC-4122 v4 version (4) and variant (10xx) bits
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x40;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type BootstrapInitMode = 'starter_pack' | 'blank' | 'template';

export async function initStarterPack(params: {
  supabase: SupabaseClient;
  config?: RuntimeConfig;
  mode: BootstrapInitMode;
  level?: TemplateLevelId;
  excludedPeriodIds?: readonly string[];
  excludedActionIds?: readonly string[];
  customActions?: ReadonlyArray<{ id?: string; period_id: string; title: string }>;
  ntfyAllPeriodsEnabled?: boolean;
  settingsPatch?: z.infer<typeof SettingsPatchSchema>;
  requestId: string;
  activeFromIso?: string;
}): Promise<{
  ok: true;
  already_completed: boolean;
  onboarding_completed: true;
  mode: BootstrapInitMode;
  level?: TemplateLevelId;
  settings: AppSettings;
}> {
  const {
    supabase,
    config,
    mode,
    level,
    excludedPeriodIds,
    excludedActionIds,
    customActions,
    ntfyAllPeriodsEnabled,
    settingsPatch,
    requestId,
    activeFromIso,
  } = params;
  let settings = await fetchAppSettings(supabase);

  if (settings.onboarding_completed) {
    return {
      ok: true,
      already_completed: true,
      onboarding_completed: true,
      mode,
      ...(level ? { level } : {}),
      settings,
    };
  }

  // Validate active_from calendar date & template bundle BEFORE any DB mutation
  if (activeFromIso !== undefined) {
    try {
      parseIsoDateParts(activeFromIso);
    } catch {
      throw new ServiceError(
        400,
        'VALIDATION_ERROR',
        `Invalid calendar date for active_from: ${activeFromIso}`,
      );
    }
  }

  const resolvedLevel: TemplateLevelId = level ?? 'level_1';
  const effectiveActiveFrom =
    activeFromIso ??
    resolveIslamicDate(Date.now(), {
      ...settings,
      ...(settingsPatch?.iana_timezone
        ? { iana_timezone: settingsPatch.iana_timezone }
        : {}),
      ...(settingsPatch?.latitude !== undefined
        ? { latitude: settingsPatch.latitude }
        : {}),
      ...(settingsPatch?.longitude !== undefined
        ? { longitude: settingsPatch.longitude }
        : {}),
      ...(settingsPatch?.calc_method
        ? { calc_method: settingsPatch.calc_method }
        : {}),
      ...(settingsPatch?.rollover_mode
        ? { rollover_mode: settingsPatch.rollover_mode }
        : {}),
    });

  let preparedBundle: ReturnType<typeof buildStarterPack> | null = null;

  if (mode === 'template') {
    const baseTemplate = buildTemplateBundle(resolvedLevel, effectiveActiveFrom);
    const excludedPeriods = new Set(excludedPeriodIds ?? []);
    const keptTemplatePeriodIds = new Set(
      baseTemplate.periods
        .filter((p) => !excludedPeriods.has(p.id))
        .map((p) => p.id),
    );

    const resolvedCustomActions: Array<{
      id: string;
      period_id: string;
      title: string;
    }> = [];

    for (let idx = 0; idx < (customActions ?? []).length; idx += 1) {
      const item = customActions![idx]!;
      if (!keptTemplatePeriodIds.has(item.period_id)) {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          `custom_actions[${idx}].period_id (${item.period_id}) is not an active period in template "${resolvedLevel}".`,
        );
      }
      const id =
        item.id ??
        (await deriveDeterministicCustomUuid(
          `mohasba:custom:${resolvedLevel}:${item.period_id}:${idx}:${item.title.trim()}`,
        ));
      resolvedCustomActions.push({
        id,
        period_id: item.period_id,
        title: item.title.trim(),
      });
    }

    preparedBundle = customizeTemplateBundle({
      level: resolvedLevel,
      activeFromIso: effectiveActiveFrom,
      excludedPeriodIds,
      excludedActionIds,
      customActions: resolvedCustomActions,
      ntfyAllPeriodsEnabled,
    });

    if (preparedBundle.periods.length === 0 || preparedBundle.actions.length === 0) {
      throw new ServiceError(
        400,
        'VALIDATION_ERROR',
        'Template selection must retain at least 1 period and 1 action. Use mode "blank" to start empty.',
      );
    }
  } else if (mode === 'starter_pack') {
    preparedBundle = buildStarterPack(effectiveActiveFrom);
  }

  // Apply and validate any optional Step 2 settings patch BEFORE seeding schema rows
  if (settingsPatch && Object.keys(settingsPatch).length > 0) {
    const updatedSettingsRes = await updateSettings({
      supabase,
      config,
      patch: settingsPatch,
      requestId,
    });
    settings = updatedSettingsRes.settings;
  }

  let seededPeriodsCount = 0;
  let seededActionsCount = 0;

  if (preparedBundle) {
    seededPeriodsCount = preparedBundle.periods.length;
    seededActionsCount = preparedBundle.actions.length;

    if (preparedBundle.periods.length > 0) {
      const { error: pErr } = await supabase
        .from('periods')
        .upsert(preparedBundle.periods, { onConflict: 'id', ignoreDuplicates: true });
      if (pErr) {
        throw new Error(`Template periods seed failed: ${pErr.message}`);
      }
    }

    if (preparedBundle.actions.length > 0) {
      const { error: aErr } = await supabase
        .from('actions')
        .upsert(preparedBundle.actions, { onConflict: 'id', ignoreDuplicates: true });
      if (aErr) {
        throw new Error(`Template actions seed failed: ${aErr.message}`);
      }
    }

    if (preparedBundle.targetVersions.length > 0) {
      const { error: tErr } = await supabase
        .from('target_versions')
        .upsert(preparedBundle.targetVersions, {
          onConflict: 'id',
          ignoreDuplicates: true,
        });
      if (tErr) {
        throw new Error(
          `Template target_versions seed failed: ${tErr.message}`,
        );
      }
    }
  }

  const { data: updatedRow, error: sErr } = await supabase
    .from('app_settings')
    .update({
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select('*')
    .single();

  if (sErr || !updatedRow) {
    throw new Error(
      `Failed completing onboarding flag: ${sErr?.message ?? 'missing row'}`,
    );
  }

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'CRUD',
    event_name: 'onboarding_initialized',
    request_id: requestId,
    entity_type: 'app_settings',
    entity_id: '1',
    summary:
      mode === 'template'
        ? `Initialized onboarding with template ${level ?? 'level_1'} (${seededPeriodsCount} periods, ${seededActionsCount} actions).`
        : `Initialized onboarding in ${mode} mode.`,
    context: {
      mode,
      level: level ?? null,
      periods_count: seededPeriodsCount,
      actions_count: seededActionsCount,
      custom_actions_count: customActions?.length ?? 0,
    },
  });

  return {
    ok: true,
    already_completed: false,
    onboarding_completed: true,
    mode,
    ...(level ? { level } : {}),
    settings: normalizeAppSettingsRow(updatedRow as Record<string, unknown>),
  };
}

export interface MergeTemplateResult {
  ok: true;
  level: TemplateLevelId;
  added_periods: number;
  added_actions: number;
  added_target_versions: number;
  skipped_existing_actions: number;
  matched_existing_periods: number;
}

/**
 * Non-destructively merges net-new periods/actions/targets from a template level
 * into an already-initialized workspace while preserving 100% of existing logs,
 * actions, targets, and periods.
 */
export async function mergeTemplateIntoWorkspace(params: {
  supabase: SupabaseClient;
  level: TemplateLevelId;
  excludedPeriodIds?: readonly string[];
  excludedActionIds?: readonly string[];
  activeFromIso?: string;
  requestId: string;
}): Promise<MergeTemplateResult> {
  const {
    supabase,
    level,
    excludedPeriodIds,
    excludedActionIds,
    activeFromIso,
    requestId,
  } = params;

  const settings = await fetchAppSettings(supabase);
  if (!settings.onboarding_completed) {
    throw new ServiceError(
      409,
      'CONFLICT',
      'Workspace is not initialized yet. Use /api/bootstrap/init first.',
    );
  }

  if (activeFromIso !== undefined) {
    try {
      parseIsoDateParts(activeFromIso);
    } catch {
      throw new ServiceError(
        400,
        'VALIDATION_ERROR',
        `Invalid calendar date for active_from: ${activeFromIso}`,
      );
    }
  }

  const effectiveActiveFrom =
    activeFromIso ?? resolveIslamicDate(Date.now(), settings);

  const [periodsRes, actionsRes, targetsRes] = await Promise.all([
    supabase
      .from('periods')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('actions')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase.from('target_versions').select('id'),
  ]);

  if (periodsRes.error) {
    throw new Error(`Failed loading periods for merge: ${periodsRes.error.message}`);
  }
  if (actionsRes.error) {
    throw new Error(`Failed loading actions for merge: ${actionsRes.error.message}`);
  }
  if (targetsRes.error) {
    throw new Error(
      `Failed loading target_versions for merge: ${targetsRes.error.message}`,
    );
  }

  const existingPeriods = (periodsRes.data ?? []).map((r) =>
    normalizePeriodRow(r as Record<string, unknown>),
  );
  const existingActions = (actionsRes.data ?? []).map((r) =>
    normalizeActionRow(r as Record<string, unknown>),
  );
  const existingTargetVersionIds = (targetsRes.data ?? [])
    .map((r) => String((r as Record<string, unknown>).id ?? ''))
    .filter(Boolean);

  const plan = planTemplateMerge({
    level,
    activeFromIso: effectiveActiveFrom,
    existingPeriods,
    existingActions,
    existingTargetVersionIds,
    excludedPeriodIds,
    excludedActionIds,
    generateId: () => crypto.randomUUID(),
  });

  if (plan.newPeriods.length > 0) {
    const { error: pErr } = await supabase.from('periods').insert(plan.newPeriods);
    if (pErr) {
      throw new Error(`Template merge periods insert failed: ${pErr.message}`);
    }
  }

  if (plan.newActions.length > 0) {
    const { error: aErr } = await supabase.from('actions').insert(plan.newActions);
    if (aErr) {
      throw new Error(`Template merge actions insert failed: ${aErr.message}`);
    }
  }

  if (plan.newTargetVersions.length > 0) {
    const { error: tErr } = await supabase
      .from('target_versions')
      .insert(plan.newTargetVersions);
    if (tErr) {
      throw new Error(
        `Template merge target_versions insert failed: ${tErr.message}`,
      );
    }
  }

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'CRUD',
    event_name: 'template_merged',
    request_id: requestId,
    entity_type: 'app_settings',
    entity_id: '1',
    summary: `Merged template ${level}: +${plan.newPeriods.length} periods, +${plan.newActions.length} actions (skipped ${plan.skippedExistingActionsCount} existing).`,
    context: {
      level,
      added_periods: plan.newPeriods.length,
      added_actions: plan.newActions.length,
      added_target_versions: plan.newTargetVersions.length,
      skipped_existing_actions: plan.skippedExistingActionsCount,
      matched_existing_periods: plan.matchedExistingPeriodsCount,
    },
  });

  return {
    ok: true,
    level,
    added_periods: plan.newPeriods.length,
    added_actions: plan.newActions.length,
    added_target_versions: plan.newTargetVersions.length,
    skipped_existing_actions: plan.skippedExistingActionsCount,
    matched_existing_periods: plan.matchedExistingPeriodsCount,
  };
}

export interface ResetWorkspaceResult {
  ok: true;
  onboarding_completed: false;
  settings: AppSettings;
}

/**
 * Safely resets schedule & log tables so the user can re-run the 3-Level Onboarding Wizard
 * from a clean slate while preserving device/location/ntfy/UI settings and audit logs.
 */
export async function resetWorkspaceForOnboarding(params: {
  supabase: SupabaseClient;
  requestId: string;
}): Promise<ResetWorkspaceResult> {
  const { supabase, requestId } = params;

  // Delete in strict child-to-parent FK order
  const deleteSteps: Array<{ table: string; notNullCol: string }> = [
    { table: 'daily_logs', notNullCol: 'action_id' },
    { table: 'target_versions', notNullCol: 'id' },
    { table: 'actions', notNullCol: 'id' },
    { table: 'reminder_dispatches', notNullCol: 'id' },
    { table: 'periods', notNullCol: 'id' },
    { table: 'applied_mutations', notNullCol: 'mutation_id' },
  ];

  for (const step of deleteSteps) {
    const { error } = await supabase
      .from(step.table)
      .delete()
      .not(step.notNullCol, 'is', null);
    if (error) {
      throw new Error(
        `Workspace reset failed clearing ${step.table}: ${error.message}`,
      );
    }
  }

  const { data: updatedRow, error: sErr } = await supabase
    .from('app_settings')
    .update({
      onboarding_completed: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select('*')
    .single();

  if (sErr || !updatedRow) {
    throw new Error(
      `Workspace reset failed updating onboarding flag: ${sErr?.message ?? 'missing row'}`,
    );
  }

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'SYSTEM',
    event_name: 'workspace_reset',
    request_id: requestId,
    entity_type: 'app_settings',
    entity_id: '1',
    summary:
      'Reset workspace schedule and logs to return to 3-level onboarding wizard (preferences preserved).',
    context: { preserved_settings: true },
  });

  return {
    ok: true,
    onboarding_completed: false,
    settings: normalizeAppSettingsRow(updatedRow as Record<string, unknown>),
  };
}

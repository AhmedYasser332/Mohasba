import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysIso, resolveIslamicDate } from '@/domain/prayer-engine';
import { buildStarterPack } from '@/domain/starter-pack';
import {
  makeCellKey,
  type Action,
  type AppSettings,
  type DailyLog,
  type Period,
  type TargetVersion,
} from '@/domain/types';
import type { RuntimeConfig } from '../config';
import {
  fetchAppSettings,
  normalizeActionRow,
  normalizeAppSettingsRow,
  normalizePeriodRow,
  normalizeTargetVersionRow,
} from '../db/normalizers';
import { fetchAllDailyLogsKeyset } from '../db/pagination';
import { ServiceError } from '../errors';
import { writeAuditLog } from '../observability/logger';

export interface BootstrapResponse {
  server_now: string;
  ntfy_configured: boolean;
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

  const [settings, periodsRes, actionsRes, targetsRes] = await Promise.all([
    fetchAppSettings(supabase),
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

  return {
    server_now: serverNow,
    ntfy_configured: Boolean(config.ntfyTopicUrl),
    settings,
    periods,
    actions,
    target_versions,
    daily_logs,
  };
}

export async function initStarterPack(params: {
  supabase: SupabaseClient;
  mode: 'starter_pack' | 'blank';
  requestId: string;
  activeFromIso?: string;
}): Promise<{
  ok: true;
  already_completed: boolean;
  onboarding_completed: true;
  mode: 'starter_pack' | 'blank';
  settings: AppSettings;
}> {
  const { supabase, mode, requestId, activeFromIso } = params;
  const settings = await fetchAppSettings(supabase);

  if (settings.onboarding_completed) {
    return {
      ok: true,
      already_completed: true,
      onboarding_completed: true,
      mode,
      settings,
    };
  }

  if (mode === 'starter_pack') {
    const bundle = buildStarterPack(activeFromIso);

    const { error: pErr } = await supabase
      .from('periods')
      .upsert(bundle.periods, { onConflict: 'id', ignoreDuplicates: true });
    if (pErr) {
      throw new Error(`Starter pack periods seed failed: ${pErr.message}`);
    }

    const { error: aErr } = await supabase
      .from('actions')
      .upsert(bundle.actions, { onConflict: 'id', ignoreDuplicates: true });
    if (aErr) {
      throw new Error(`Starter pack actions seed failed: ${aErr.message}`);
    }

    const { error: tErr } = await supabase
      .from('target_versions')
      .upsert(bundle.targetVersions, {
        onConflict: 'id',
        ignoreDuplicates: true,
      });
    if (tErr) {
      throw new Error(
        `Starter pack target_versions seed failed: ${tErr.message}`,
      );
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
    summary: `Initialized onboarding in ${mode} mode.`,
    context: { mode },
  });

  return {
    ok: true,
    already_completed: false,
    onboarding_completed: true,
    mode,
    settings: normalizeAppSettingsRow(updatedRow as Record<string, unknown>),
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveImportMerge } from '@/domain/conflict';
import { parseIsoDateParts } from '@/domain/prayer-engine';
import {
  ActionSchema,
  AsrMadhhabSchema,
  AvailabilityOverrideSchema,
  CalcMethodSchema,
  CellStatusSchema,
  DefaultHomeViewSchema,
  DefaultWeekModeSchema,
  EnterKeyModeSchema,
  HhmmSchema,
  IsoDateSchema,
  KeyboardShortcutsMapSchema,
  PeriodSchema,
  PrayerOffsetsSchema,
  RolloverModeSchema,
  TargetVersionSchema,
  makeCellKey,
  type Action,
  type DailyLog,
  type ExportSnapshot,
  type TargetVersion,
} from '@/domain/types';
import { z } from 'zod';
import {
  fetchAppSettings,
  normalizeActionRow,
  normalizePeriodRow,
  normalizeTargetVersionRow,
} from '../db/normalizers';
import { fetchAllDailyLogsKeyset, normalizeDailyLogRow } from '../db/pagination';
import { ServiceError } from '../errors';
import { writeAuditLog } from '../observability/logger';

export async function buildFullExport(params: {
  supabase: SupabaseClient;
}): Promise<ExportSnapshot> {
  const { supabase } = params;

  const [settings, periodsRes, actionsRes, targetsRes, daily_logs] =
    await Promise.all([
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
      fetchAllDailyLogsKeyset(supabase),
    ]);

  if (periodsRes.error) {
    throw new Error(`Export failed loading periods: ${periodsRes.error.message}`);
  }
  if (actionsRes.error) {
    throw new Error(`Export failed loading actions: ${actionsRes.error.message}`);
  }
  if (targetsRes.error) {
    throw new Error(
      `Export failed loading target_versions: ${targetsRes.error.message}`,
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

  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    settings,
    periods,
    actions,
    target_versions,
    daily_logs,
    counts: {
      periods: periods.length,
      actions: actions.length,
      target_versions: target_versions.length,
      daily_logs: daily_logs.length,
    },
  };
}

const ImportSettingsSchema = z
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
    onboarding_completed: z.boolean().optional(),
    show_catchup_banner: z.boolean().optional(),
    default_home_view: DefaultHomeViewSchema.optional(),
    default_week_mode: DefaultWeekModeSchema.optional(),
    enter_key_mode: EnterKeyModeSchema.optional(),
    keyboard_shortcuts: KeyboardShortcutsMapSchema.optional(),
  })
  .optional();

const ImportDailyLogSchema = z.object({
  action_id: z.string().uuid(),
  log_date: IsoDateSchema,
  availability_override: AvailabilityOverrideSchema.nullable().default(null),
  status: CellStatusSchema.nullable().default(null),
  percent_value: z.number().int().min(0).max(100).nullable().default(null),
  qadaa_resolved_at: z.string().nullable().default(null),
  target_version_id: z.string().uuid().nullable().default(null),
  note: z.string().max(2000).nullable().default(null),
  note_updated_at: z.string().nullable().default(null),
  client_updated_at: z.string(),
});

export const ImportChunkInputSchema = z.object({
  schema_version: z.literal(1),
  settings: ImportSettingsSchema,
  periods: z.array(PeriodSchema).optional(),
  actions: z.array(ActionSchema).optional(),
  target_versions: z.array(TargetVersionSchema).optional(),
  daily_logs: z.array(ImportDailyLogSchema).max(200).optional(),
});

export async function processImportChunk(params: {
  supabase: SupabaseClient;
  input: z.infer<typeof ImportChunkInputSchema>;
  requestId: string;
}): Promise<{
  ok: true;
  imported: {
    periods: number;
    actions: number;
    target_versions: number;
    daily_logs: number;
    created: number;
    updated: number;
    skipped: number;
  };
}> {
  const { supabase, input, requestId } = params;
  const serverNow = new Date().toISOString();

  // 1. Settings
  if (input.settings && Object.keys(input.settings).length > 0) {
    const { error } = await supabase
      .from('app_settings')
      .update({
        ...input.settings,
        updated_at: serverNow,
      })
      .eq('id', 1);
    if (error) {
      throw new Error(`Import failed updating settings: ${error.message}`);
    }
  }

  // 2. Periods
  let periodsCount = 0;
  if (input.periods && input.periods.length > 0) {
    const { error } = await supabase
      .from('periods')
      .upsert(input.periods, { onConflict: 'id' });
    if (error) {
      throw new Error(`Import failed upserting periods: ${error.message}`);
    }
    periodsCount = input.periods.length;
  }

  // 3. Actions
  let actionsCount = 0;
  if (input.actions && input.actions.length > 0) {
    const { error } = await supabase
      .from('actions')
      .upsert(input.actions, { onConflict: 'id' });
    if (error) {
      throw new Error(`Import failed upserting actions: ${error.message}`);
    }
    actionsCount = input.actions.length;
  }

  // 4. Target Versions (match by UUID first, then by (action_id, effective_from))
  let targetsCount = 0;
  const targetIdRemap = new Map<string, string>();
  if (input.target_versions && input.target_versions.length > 0) {
    const tvActionIds = Array.from(
      new Set(input.target_versions.map((tv) => tv.action_id)),
    );
    const { data: existingTvRows, error: existingTvErr } = await supabase
      .from('target_versions')
      .select('*')
      .in('action_id', tvActionIds);

    if (existingTvErr) {
      throw new Error(
        `Import failed reading target_versions: ${existingTvErr.message}`,
      );
    }

    const existingTvs = (existingTvRows ?? []).map((r) =>
      normalizeTargetVersionRow(r as Record<string, unknown>),
    );
    const byId = new Map(existingTvs.map((tv) => [tv.id, tv]));
    const byActionDate = new Map(
      existingTvs.map((tv) => [`${tv.action_id}|${tv.effective_from}`, tv]),
    );

    const toInsertOrUpsert: TargetVersion[] = [];
    for (const incomingTv of input.target_versions) {
      const sameId = byId.get(incomingTv.id);
      if (sameId) {
        if (sameId.action_id !== incomingTv.action_id) {
          throw new ServiceError(
            400,
            'INVALID_TARGET_VERSION',
            `Target version ${incomingTv.id} belongs to a different action on server.`,
          );
        }
        targetIdRemap.set(incomingTv.id, sameId.id);
        continue;
      }

      const sameActionDate = byActionDate.get(
        `${incomingTv.action_id}|${incomingTv.effective_from}`,
      );
      if (sameActionDate) {
        targetIdRemap.set(incomingTv.id, sameActionDate.id);
        continue;
      }

      toInsertOrUpsert.push(incomingTv);
      byId.set(incomingTv.id, incomingTv);
      byActionDate.set(
        `${incomingTv.action_id}|${incomingTv.effective_from}`,
        incomingTv,
      );
    }

    if (toInsertOrUpsert.length > 0) {
      const { error: tvUpsertErr } = await supabase
        .from('target_versions')
        .upsert(toInsertOrUpsert, { onConflict: 'id' });
      if (tvUpsertErr) {
        throw new Error(
          `Import failed inserting target_versions: ${tvUpsertErr.message}`,
        );
      }
      targetsCount = toInsertOrUpsert.length;
    }
  }

  // 5. Daily Logs (<= 200 per chunk, resolved via domain/conflict.ts without applied_mutations)
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let logsCount = 0;

  if (input.daily_logs && input.daily_logs.length > 0) {
    const logActionIds = Array.from(
      new Set(input.daily_logs.map((l) => l.action_id)),
    );
    const logDates = Array.from(new Set(input.daily_logs.map((l) => l.log_date)));

    const [actionsRes, targetsRes, existingLogsRes] = await Promise.all([
      supabase.from('actions').select('*').in('id', logActionIds),
      supabase
        .from('target_versions')
        .select('*')
        .in('action_id', logActionIds),
      supabase
        .from('daily_logs')
        .select('*')
        .in('action_id', logActionIds)
        .in('log_date', logDates),
    ]);

    if (actionsRes.error) {
      throw new Error(
        `Import failed reading actions: ${actionsRes.error.message}`,
      );
    }
    if (targetsRes.error) {
      throw new Error(
        `Import failed reading target_versions: ${targetsRes.error.message}`,
      );
    }
    if (existingLogsRes.error) {
      throw new Error(
        `Import failed reading daily_logs: ${existingLogsRes.error.message}`,
      );
    }

    const actionsById = new Map<string, Action>();
    for (const row of actionsRes.data ?? []) {
      const action = normalizeActionRow(row as Record<string, unknown>);
      actionsById.set(action.id, action);
    }

    const allTargetVersions: TargetVersion[] = (targetsRes.data ?? []).map((r) =>
      normalizeTargetVersionRow(r as Record<string, unknown>),
    );
    const targetVersionsById = new Map<string, TargetVersion>(
      allTargetVersions.map((tv) => [tv.id, tv]),
    );
    const targetsByAction = new Map<string, TargetVersion[]>();
    for (const tv of allTargetVersions) {
      const list = targetsByAction.get(tv.action_id) ?? [];
      list.push(tv);
      targetsByAction.set(tv.action_id, list);
    }

    // Also inspect any referenced target_version_id not belonging to logActionIds so cross-action refs fail explicitly!
    const referencedTvIds = Array.from(
      new Set(
        input.daily_logs
          .map((l) =>
            l.target_version_id
              ? (targetIdRemap.get(l.target_version_id) ?? l.target_version_id)
              : null,
          )
          .filter((id): id is string => id !== null),
      ),
    );
    const unknownTvIds = referencedTvIds.filter(
      (id) => !targetVersionsById.has(id),
    );
    if (unknownTvIds.length > 0) {
      const { data: extraTvRows } = await supabase
        .from('target_versions')
        .select('*')
        .in('id', unknownTvIds);
      for (const r of extraTvRows ?? []) {
        const tv = normalizeTargetVersionRow(r as Record<string, unknown>);
        targetVersionsById.set(tv.id, tv);
      }
    }

    const existingByCell = new Map<string, DailyLog>();
    for (const row of existingLogsRes.data ?? []) {
      const log = normalizeDailyLogRow(row as Record<string, unknown>);
      existingByCell.set(makeCellKey(log.action_id, log.log_date), log);
    }

    const rowsToUpsert: Array<Record<string, unknown>> = [];

    for (const rawLog of input.daily_logs) {
      try {
        parseIsoDateParts(rawLog.log_date);
      } catch {
        throw new ServiceError(
          400,
          'VALIDATION_ERROR',
          `Invalid calendar date in daily_logs: ${rawLog.log_date}`,
        );
      }

      const action = actionsById.get(rawLog.action_id);
      if (!action) {
        throw new ServiceError(
          400,
          'UNKNOWN_ACTION',
          `Imported log references unknown action_id ${rawLog.action_id}.`,
        );
      }

      const remappedTvId = rawLog.target_version_id
        ? (targetIdRemap.get(rawLog.target_version_id) ??
          rawLog.target_version_id)
        : null;

      if (remappedTvId !== null) {
        const tv = targetVersionsById.get(remappedTvId);
        if (!tv || tv.action_id !== rawLog.action_id) {
          throw new ServiceError(
            400,
            'INVALID_TARGET_VERSION',
            `Imported log target_version_id ${remappedTvId} does not belong to action ${rawLog.action_id}.`,
          );
        }
      }

      const key = makeCellKey(rawLog.action_id, rawLog.log_date);
      const existingRow = existingByCell.get(key) ?? null;

      const merged = resolveImportMerge({
        existingRow,
        importedRow: {
          action_id: rawLog.action_id,
          log_date: rawLog.log_date,
          availability_override: rawLog.availability_override,
          status: rawLog.status,
          percent_value: rawLog.percent_value,
          qadaa_resolved_at: rawLog.qadaa_resolved_at,
          target_version_id: remappedTvId,
          note: rawLog.note,
          note_updated_at: rawLog.note_updated_at,
          client_updated_at: rawLog.client_updated_at,
        },
        action,
        targetVersions: targetsByAction.get(rawLog.action_id) ?? [],
        serverNow,
      });

      if (merged.kind === 'rejected') {
        throw new ServiceError(400, merged.code, merged.error);
      }

      if (merged.resolution === 'import_existing_won') {
        skipped += 1;
        // Note: independent note LWW may still have updated note even when status stayed existing
        const noteChanged =
          existingRow &&
          (merged.row.note !== existingRow.note ||
            merged.row.note_updated_at !== existingRow.note_updated_at);
        if (!noteChanged) {
          continue;
        }
        updated += 1;
      } else if (merged.resolution === 'import_create') {
        created += 1;
      } else {
        updated += 1;
      }

      const nextRowVersion = existingRow ? existingRow.row_version + 1 : 1;
      rowsToUpsert.push({
        ...merged.row,
        row_version: nextRowVersion,
        last_mutation_id: null,
        last_device_id: null,
        updated_at: serverNow,
      });

      existingByCell.set(key, {
        ...merged.row,
        row_version: nextRowVersion,
        last_mutation_id: null,
        last_device_id: null,
      });
    }

    if (rowsToUpsert.length > 0) {
      const { error: upsertErr } = await supabase
        .from('daily_logs')
        .upsert(rowsToUpsert, { onConflict: 'action_id,log_date' });
      if (upsertErr) {
        throw new Error(
          `Import failed upserting daily_logs: ${upsertErr.message}`,
        );
      }
    }

    logsCount = input.daily_logs.length;
  }

  await writeAuditLog(supabase, {
    level: 'INFO',
    category: 'EXPORT_IMPORT',
    event_name: 'json_import_chunk_processed',
    request_id: requestId,
    summary: `Imported chunk: ${periodsCount} periods, ${actionsCount} actions, ${targetsCount} targets, ${logsCount} logs.`,
    context: {
      periods: periodsCount,
      actions: actionsCount,
      target_versions: targetsCount,
      daily_logs: logsCount,
      created,
      updated,
      skipped,
    },
  });

  return {
    ok: true,
    imported: {
      periods: periodsCount,
      actions: actionsCount,
      target_versions: targetsCount,
      daily_logs: logsCount,
      created,
      updated,
      skipped,
    },
  };
}

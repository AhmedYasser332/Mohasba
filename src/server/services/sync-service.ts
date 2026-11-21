import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveSyncConflict,
  type ConflictResolutionReason,
} from '@/domain/conflict';
import { parseIsoDateParts } from '@/domain/prayer-engine';
import type {
  Action,
  DailyLog,
  SyncCommitItem,
  SyncMutation,
  SyncResultItem,
  TargetVersion,
} from '@/domain/types';
import {
  normalizeActionRow,
  normalizeTargetVersionRow,
} from '../db/normalizers';
import { normalizeDailyLogRow } from '../db/pagination';
import { writeAuditLog } from '../observability/logger';

function cellKey(actionId: string, logDate: string): string {
  return `${actionId}|${logDate}`;
}

interface RawRpcResult {
  mutation_id: string;
  outcome: SyncResultItem['outcome'];
  resolved_row?: Record<string, unknown> | null;
  error?: string;
}

function normalizeRpcResult(raw: RawRpcResult): SyncResultItem {
  return {
    mutation_id: String(raw.mutation_id),
    outcome: raw.outcome,
    ...(raw.resolved_row !== undefined
      ? {
          resolved_row: raw.resolved_row
            ? normalizeDailyLogRow(raw.resolved_row)
            : null,
        }
      : {}),
    ...(raw.error !== undefined ? { error: String(raw.error) } : {}),
  };
}

function buildDuplicatePassThroughItem(
  m: SyncMutation,
  currentRow: DailyLog | undefined,
): SyncCommitItem {
  return {
    mutation_id: m.mutation_id,
    device_id: m.device_id,
    action_id: m.action_id,
    log_date: m.log_date,
    expected_row_version: currentRow?.row_version ?? null,
    availability_override: null,
    status: null,
    percent_value: null,
    qadaa_resolved_at: null,
    target_version_id: null,
    note: null,
    note_updated_at: null,
    client_updated_at: m.client_updated_at,
  };
}

export async function processSyncBatch(params: {
  supabase: SupabaseClient;
  deviceId: string;
  mutations: SyncMutation[];
  requestId: string;
}): Promise<{ server_now: string; results: SyncResultItem[] }> {
  const { supabase, deviceId, mutations, requestId } = params;
  const serverNow = new Date().toISOString();

  const uniqueMutationIds = Array.from(
    new Set(mutations.map((m) => m.mutation_id)),
  );
  const uniqueActionIds = Array.from(
    new Set(mutations.map((m) => m.action_id)),
  );
  const validLogDates = Array.from(
    new Set(
      mutations
        .map((m) => m.log_date)
        .filter((d) => {
          try {
            parseIsoDateParts(d);
            return true;
          } catch {
            return false;
          }
        }),
    ),
  );
  const touchedCells = new Set(
    mutations.map((m) => cellKey(m.action_id, m.log_date)),
  );

  // 2-4 bulk reads
  const [actionsRes, targetsRes, appliedRes, logsRes] = await Promise.all([
    supabase.from('actions').select('*').in('id', uniqueActionIds),
    supabase
      .from('target_versions')
      .select('*')
      .in('action_id', uniqueActionIds),
    supabase
      .from('applied_mutations')
      .select('mutation_id')
      .in('mutation_id', uniqueMutationIds),
    validLogDates.length > 0
      ? supabase
          .from('daily_logs')
          .select('*')
          .in('action_id', uniqueActionIds)
          .in('log_date', validLogDates)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (actionsRes.error) {
    throw new Error(`Sync failed reading actions: ${actionsRes.error.message}`);
  }
  if (targetsRes.error) {
    throw new Error(
      `Sync failed reading target_versions: ${targetsRes.error.message}`,
    );
  }
  if (appliedRes.error) {
    throw new Error(
      `Sync failed reading applied_mutations: ${appliedRes.error.message}`,
    );
  }
  if (logsRes.error) {
    throw new Error(`Sync failed reading daily_logs: ${logsRes.error.message}`);
  }

  const actionsById = new Map<string, Action>();
  for (const row of actionsRes.data ?? []) {
    const action = normalizeActionRow(row as Record<string, unknown>);
    actionsById.set(action.id, action);
  }

  const targetsByAction = new Map<string, TargetVersion[]>();
  for (const row of targetsRes.data ?? []) {
    const tv = normalizeTargetVersionRow(row as Record<string, unknown>);
    const list = targetsByAction.get(tv.action_id) ?? [];
    list.push(tv);
    targetsByAction.set(tv.action_id, list);
  }

  const seenMutationIds = new Set<string>(
    (appliedRes.data ?? []).map((r) => String(r.mutation_id)),
  );

  const currentRows = new Map<string, DailyLog>();
  for (const row of logsRes.data ?? []) {
    const normalized = normalizeDailyLogRow(row as Record<string, unknown>);
    const k = cellKey(normalized.action_id, normalized.log_date);
    if (touchedCells.has(k)) {
      currentRows.set(k, normalized);
    }
  }

  const slotOutcomes: Array<SyncResultItem | null> = new Array(
    mutations.length,
  ).fill(null);
  const commitItems: SyncCommitItem[] = [];
  const commitSlotIndices: number[] = [];
  const conflictResolutions: ConflictResolutionReason[] = [];
  const rejectedSummaries: Array<{ mutation_id: string; error: string }> = [];

  for (let i = 0; i < mutations.length; i += 1) {
    const m = mutations[i]!;
    const k = cellKey(m.action_id, m.log_date);

    // Validate calendar date (e.g. rejects '2026-02-31' or '2026-99-99' before SQL cast)
    try {
      parseIsoDateParts(m.log_date);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid log_date';
      slotOutcomes[i] = {
        mutation_id: m.mutation_id,
        outcome: 'rejected',
        error: msg,
      };
      rejectedSummaries.push({ mutation_id: m.mutation_id, error: msg });
      continue;
    }

    if (seenMutationIds.has(m.mutation_id)) {
      // Duplicate mutation_id: do NOT advance currentRows.row_version; let RPC return already_applied.
      commitItems.push(buildDuplicatePassThroughItem(m, currentRows.get(k)));
      commitSlotIndices.push(i);
      continue;
    }

    const action = actionsById.get(m.action_id);
    if (!action) {
      const msg = `Unknown action_id ${m.action_id}`;
      slotOutcomes[i] = {
        mutation_id: m.mutation_id,
        outcome: 'rejected',
        error: msg,
      };
      rejectedSummaries.push({ mutation_id: m.mutation_id, error: msg });
      continue;
    }

    const actionTargets = targetsByAction.get(m.action_id) ?? [];
    const serverRow = currentRows.get(k) ?? null;

    const resolution = resolveSyncConflict({
      serverRow,
      mutation: m,
      action,
      targetVersions: actionTargets,
      serverNow,
    });

    if (resolution.kind === 'rejected') {
      slotOutcomes[i] = {
        mutation_id: m.mutation_id,
        outcome: 'rejected',
        error: resolution.error,
      };
      rejectedSummaries.push({
        mutation_id: m.mutation_id,
        error: resolution.error,
      });
      continue;
    }

    commitItems.push(resolution.item);
    commitSlotIndices.push(i);
    if (
      resolution.resolution === 'conflict_mutation_won' ||
      resolution.resolution === 'conflict_server_won'
    ) {
      conflictResolutions.push(resolution.resolution);
    }

    // Advance in-memory state so sequential intra-batch mutations for the same cell chain cleanly.
    currentRows.set(k, {
      action_id: m.action_id,
      log_date: m.log_date,
      availability_override: resolution.item.availability_override,
      status: resolution.item.status,
      percent_value: resolution.item.percent_value,
      qadaa_resolved_at: resolution.item.qadaa_resolved_at,
      target_version_id: resolution.item.target_version_id,
      note: resolution.item.note,
      note_updated_at: resolution.item.note_updated_at,
      row_version: (serverRow?.row_version ?? 0) + 1,
      last_mutation_id: m.mutation_id,
      last_device_id: deviceId,
      client_updated_at: resolution.item.client_updated_at,
    });
    seenMutationIds.add(m.mutation_id);
  }

  if (commitItems.length > 0) {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'commit_sync_batch',
      { p_items: commitItems },
    );

    if (rpcError) {
      await writeAuditLog(supabase, {
        level: 'ERROR',
        category: 'SYNC',
        event_name: 'commit_sync_batch_failed',
        request_id: requestId,
        device_id: deviceId,
        summary: `commit_sync_batch RPC failed: ${rpcError.message}`,
        context: { batch_size: commitItems.length },
        error: rpcError,
      });
      throw new Error(`commit_sync_batch failed: ${rpcError.message}`);
    }

    const firstPassResults = ((rpcData ?? []) as RawRpcResult[]).map(
      normalizeRpcResult,
    );

    const raceIndices: number[] = [];
    for (let idx = 0; idx < firstPassResults.length; idx += 1) {
      const res = firstPassResults[idx]!;
      const slotIdx = commitSlotIndices[idx]!;
      if (res.outcome === 'race_conflict') {
        raceIndices.push(slotIdx);
      } else {
        slotOutcomes[slotIdx] = res;
        if (res.outcome === 'rejected') {
          rejectedSummaries.push({
            mutation_id: res.mutation_id,
            error: res.error ?? 'rejected by database constraint',
          });
        }
      }
    }

    // Retry any race_conflict items ONCE after fresh re-read from Postgres.
    if (raceIndices.length > 0) {
      const raceActionIds = Array.from(
        new Set(raceIndices.map((idx) => mutations[idx]!.action_id)),
      );
      const raceDates = Array.from(
        new Set(raceIndices.map((idx) => mutations[idx]!.log_date)),
      );
      const { data: freshLogsData, error: freshErr } = await supabase
        .from('daily_logs')
        .select('*')
        .in('action_id', raceActionIds)
        .in('log_date', raceDates);

      if (freshErr) {
        throw new Error(
          `Sync retry failed re-reading daily_logs: ${freshErr.message}`,
        );
      }

      const freshRows = new Map<string, DailyLog>();
      for (const row of freshLogsData ?? []) {
        const normalized = normalizeDailyLogRow(row as Record<string, unknown>);
        freshRows.set(
          cellKey(normalized.action_id, normalized.log_date),
          normalized,
        );
      }

      const retryItems: SyncCommitItem[] = [];
      const retrySlotIndices: number[] = [];
      const retrySeen = new Set<string>();

      for (const slotIdx of raceIndices) {
        const m = mutations[slotIdx]!;
        const k = cellKey(m.action_id, m.log_date);
        const action = actionsById.get(m.action_id);
        if (!action) {
          slotOutcomes[slotIdx] = {
            mutation_id: m.mutation_id,
            outcome: 'rejected',
            error: `Unknown action_id ${m.action_id}`,
          };
          continue;
        }

        if (retrySeen.has(m.mutation_id)) {
          retryItems.push(buildDuplicatePassThroughItem(m, freshRows.get(k)));
          retrySlotIndices.push(slotIdx);
          continue;
        }

        const freshRow = freshRows.get(k) ?? null;
        const retried = resolveSyncConflict({
          serverRow: freshRow,
          mutation: m,
          action,
          targetVersions: targetsByAction.get(m.action_id) ?? [],
          serverNow,
        });

        if (retried.kind === 'rejected') {
          slotOutcomes[slotIdx] = {
            mutation_id: m.mutation_id,
            outcome: 'rejected',
            error: retried.error,
          };
          rejectedSummaries.push({
            mutation_id: m.mutation_id,
            error: retried.error,
          });
          continue;
        }

        retryItems.push(retried.item);
        retrySlotIndices.push(slotIdx);
        if (
          retried.resolution === 'conflict_mutation_won' ||
          retried.resolution === 'conflict_server_won'
        ) {
          conflictResolutions.push(retried.resolution);
        }

        freshRows.set(k, {
          action_id: m.action_id,
          log_date: m.log_date,
          availability_override: retried.item.availability_override,
          status: retried.item.status,
          percent_value: retried.item.percent_value,
          qadaa_resolved_at: retried.item.qadaa_resolved_at,
          target_version_id: retried.item.target_version_id,
          note: retried.item.note,
          note_updated_at: retried.item.note_updated_at,
          row_version: (freshRow?.row_version ?? 0) + 1,
          last_mutation_id: m.mutation_id,
          last_device_id: deviceId,
          client_updated_at: retried.item.client_updated_at,
        });
        retrySeen.add(m.mutation_id);
      }

      if (retryItems.length > 0) {
        const { data: retryRpcData, error: retryRpcErr } = await supabase.rpc(
          'commit_sync_batch',
          { p_items: retryItems },
        );

        if (retryRpcErr) {
          await writeAuditLog(supabase, {
            level: 'ERROR',
            category: 'SYNC',
            event_name: 'commit_sync_batch_retry_failed',
            request_id: requestId,
            device_id: deviceId,
            summary: `commit_sync_batch retry failed: ${retryRpcErr.message}`,
            context: { batch_size: retryItems.length },
            error: retryRpcErr,
          });
          throw new Error(
            `commit_sync_batch retry failed: ${retryRpcErr.message}`,
          );
        }

        const retryResults = ((retryRpcData ?? []) as RawRpcResult[]).map(
          normalizeRpcResult,
        );
        for (let rIdx = 0; rIdx < retryResults.length; rIdx += 1) {
          const slotIdx = retrySlotIndices[rIdx]!;
          const res = retryResults[rIdx]!;
          slotOutcomes[slotIdx] = res;
          if (res.outcome === 'rejected') {
            rejectedSummaries.push({
              mutation_id: res.mutation_id,
              error: res.error ?? 'rejected by database constraint',
            });
          }
        }
      }
    }
  }

  const results = slotOutcomes.map((item, idx) => {
    if (item !== null) return item;
    return {
      mutation_id: mutations[idx]!.mutation_id,
      outcome: 'rejected' as const,
      error: 'Missing RPC outcome',
    };
  });

  if (conflictResolutions.length > 0) {
    await writeAuditLog(supabase, {
      level: 'INFO',
      category: 'SYNC',
      event_name: 'sync_conflicts_resolved',
      request_id: requestId,
      device_id: deviceId,
      summary: `Resolved ${conflictResolutions.length} sync conflict(s).`,
      context: {
        conflict_count: conflictResolutions.length,
        resolutions: conflictResolutions,
      },
    });
  }

  if (rejectedSummaries.length > 0) {
    await writeAuditLog(supabase, {
      level: 'WARN',
      category: 'SYNC',
      event_name: 'sync_items_rejected',
      request_id: requestId,
      device_id: deviceId,
      summary: `Rejected ${rejectedSummaries.length} sync item(s).`,
      context: {
        rejected_count: rejectedSummaries.length,
        items: rejectedSummaries.slice(0, 10),
      },
    });
  }

  return { server_now: serverNow, results };
}

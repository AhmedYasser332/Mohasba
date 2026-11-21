import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyLog } from '@/domain/types';

export const DAILY_LOGS_PAGE_SIZE = 1000;

export function normalizeDailyLogRow(row: Record<string, unknown>): DailyLog {
  return {
    action_id: String(row.action_id),
    log_date: String(row.log_date),
    availability_override:
      (row.availability_override as DailyLog['availability_override']) ?? null,
    status: (row.status as DailyLog['status']) ?? null,
    percent_value:
      row.percent_value === null || row.percent_value === undefined
        ? null
        : Number(row.percent_value),
    qadaa_resolved_at:
      row.qadaa_resolved_at === null || row.qadaa_resolved_at === undefined
        ? null
        : String(row.qadaa_resolved_at),
    target_version_id:
      row.target_version_id === null || row.target_version_id === undefined
        ? null
        : String(row.target_version_id),
    note:
      row.note === null || row.note === undefined ? null : String(row.note),
    note_updated_at:
      row.note_updated_at === null || row.note_updated_at === undefined
        ? null
        : String(row.note_updated_at),
    row_version: Number(row.row_version ?? 1),
    last_mutation_id:
      row.last_mutation_id === null || row.last_mutation_id === undefined
        ? null
        : String(row.last_mutation_id),
    last_device_id:
      row.last_device_id === null || row.last_device_id === undefined
        ? null
        : String(row.last_device_id),
    client_updated_at: String(row.client_updated_at),
    created_at:
      row.created_at === undefined ? undefined : String(row.created_at),
    updated_at:
      row.updated_at === undefined ? undefined : String(row.updated_at),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DailyLogQueryFilter = (query: any) => any;

/**
 * Fetches all matching `daily_logs` rows using deterministic keyset pagination
 * over `(log_date ASC, action_id ASC)` with page size `1000` to bypass PostgREST's
 * 1,000-row cap safely even under concurrent mid-read inserts.
 */
export async function fetchAllDailyLogsKeyset(
  supabase: SupabaseClient,
  applyFilters?: DailyLogQueryFilter,
  pageSize: number = DAILY_LOGS_PAGE_SIZE,
): Promise<DailyLog[]> {
  const allRows: DailyLog[] = [];
  let lastDate: string | null = null;
  let lastActionId: string | null = null;

  while (true) {
    let query = supabase
      .from('daily_logs')
      .select('*')
      .order('log_date', { ascending: true })
      .order('action_id', { ascending: true })
      .limit(pageSize);

    if (applyFilters) {
      query = applyFilters(query);
    }

    if (lastDate !== null && lastActionId !== null) {
      query = query.or(
        `log_date.gt.${lastDate},and(log_date.eq.${lastDate},action_id.gt.${lastActionId})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed keyset pagination on daily_logs: ${error.message}`);
    }

    const page = (data ?? []) as Record<string, unknown>[];
    for (const row of page) {
      allRows.push(normalizeDailyLogRow(row));
    }

    if (page.length < pageSize) {
      break;
    }

    const last = page[page.length - 1];
    if (!last) {
      break;
    }
    lastDate = String(last.log_date);
    lastActionId = String(last.action_id);
  }

  return allRows;
}

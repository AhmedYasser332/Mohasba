import { canonicalizeLogMutation, DomainRuleError } from './lifecycle';
import { resolveActiveTargetVersion } from './targets';
import type {
  Action,
  AvailabilityOverride,
  CellStatus,
  DailyLog,
  SyncCommitItem,
  SyncMutation,
  TargetVersion,
} from './types';

export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type ConflictResolutionReason =
  | 'fast_path_create'
  | 'fast_path_version'
  | 'fast_path_causal'
  | 'conflict_mutation_won'
  | 'conflict_server_won';

export type ResolveSyncConflictResult =
  | {
      kind: 'commit';
      item: SyncCommitItem;
      resolution: ConflictResolutionReason;
    }
  | {
      kind: 'rejected';
      code: string;
      error: string;
    };

export interface ImportMergedRow {
  action_id: string;
  log_date: string;
  availability_override: AvailabilityOverride | null;
  status: CellStatus | null;
  percent_value: number | null;
  qadaa_resolved_at: string | null;
  target_version_id: string | null;
  note: string | null;
  note_updated_at: string | null;
  client_updated_at: string;
}

export type ResolveImportMergeResult =
  | {
      kind: 'merge';
      row: ImportMergedRow;
      resolution: 'import_create' | 'import_incoming_won' | 'import_existing_won';
    }
  | {
      kind: 'rejected';
      code: string;
      error: string;
    };

interface PreparedIncomingLog {
  availability_override: AvailabilityOverride | null;
  status: CellStatus | null;
  percent_value: number | null;
  qadaa_resolved_at: string | null;
  target_version_id: string | null;
  note: string | null;
  note_updated_at: string | null;
  noteUpdatedMs: number;
  client_updated_at: string;
  clientUpdatedMs: number;
  serverNowMs: number;
}

export function isPositiveOrIntentionalState(cell: {
  availability_override: AvailabilityOverride | null;
  status: CellStatus | null;
  percent_value: number | null;
}): boolean {
  if (cell.availability_override === 'DISABLED') return true;
  if (cell.status === 'DONE' || cell.status === 'QADAA_DONE') return true;
  if (cell.status === 'PERCENT' && (cell.percent_value ?? 0) > 0) return true;
  return false;
}

function isMissedState(cell: {
  availability_override: AvailabilityOverride | null;
  status: CellStatus | null;
}): boolean {
  return cell.availability_override !== 'DISABLED' && cell.status === 'MISSED';
}

function clampTimestampIso(
  iso: string,
  serverNowMs: number,
): { ms: number; iso: string } | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const maxAllowed = serverNowMs + MAX_FUTURE_SKEW_MS;
  const clampedMs = Math.min(parsed, maxAllowed);
  return {
    ms: clampedMs,
    iso: clampedMs < parsed ? new Date(clampedMs).toISOString() : iso,
  };
}

function resolveValidatedTargetVersionId(
  clientTargetVersionId: string | null,
  actionId: string,
  logDate: string,
  targetVersions: readonly TargetVersion[],
): { ok: true; targetVersionId: string | null } | { ok: false; error: string } {
  if (clientTargetVersionId !== null) {
    const match = targetVersions.find((v) => v.id === clientTargetVersionId);
    if (!match || match.action_id !== actionId) {
      return {
        ok: false,
        error: `target_version_id ${clientTargetVersionId} does not belong to action ${actionId}.`,
      };
    }
    return { ok: true, targetVersionId: match.id };
  }

  const active = resolveActiveTargetVersion(targetVersions, actionId, logDate);
  return { ok: true, targetVersionId: active?.id ?? null };
}

function prepareIncomingLog(params: {
  incoming: {
    action_id: string;
    log_date: string;
    availability_override: AvailabilityOverride | null;
    status: CellStatus | null;
    percent_value: number | null;
    qadaa_resolved_at: string | null;
    target_version_id: string | null;
    note: string | null;
    note_updated_at: string | null;
    client_updated_at: string;
  };
  action: Action;
  targetVersions: readonly TargetVersion[];
  serverNow: string;
}):
  | { ok: true; prepared: PreparedIncomingLog }
  | { ok: false; code: string; error: string } {
  const { incoming, action, targetVersions, serverNow } = params;

  if (incoming.action_id !== action.id) {
    return {
      ok: false,
      code: 'ACTION_ID_MISMATCH',
      error: 'Log action_id does not match action.',
    };
  }

  if (incoming.log_date < action.active_from) {
    return {
      ok: false,
      code: 'LOG_DATE_BEFORE_ACTIVE_FROM',
      error: `log_date ${incoming.log_date} is before action active_from ${action.active_from}.`,
    };
  }

  if (action.archived_at !== null && incoming.log_date > action.archived_at) {
    return {
      ok: false,
      code: 'LOG_DATE_AFTER_ARCHIVED_AT',
      error: `log_date ${incoming.log_date} is after action archived_at ${action.archived_at}.`,
    };
  }

  const serverNowMs = Date.parse(serverNow);
  if (!Number.isFinite(serverNowMs)) {
    return {
      ok: false,
      code: 'INVALID_SERVER_NOW',
      error: 'Invalid serverNow timestamp.',
    };
  }

  const clampedClient = clampTimestampIso(
    incoming.client_updated_at,
    serverNowMs,
  );
  if (!clampedClient) {
    return {
      ok: false,
      code: 'INVALID_CLIENT_UPDATED_AT',
      error: 'Invalid client_updated_at timestamp.',
    };
  }

  let clampedNoteIso: string | null = null;
  let clampedNoteMs = -Infinity;
  if (incoming.note_updated_at !== null) {
    const clampedNote = clampTimestampIso(
      incoming.note_updated_at,
      serverNowMs,
    );
    if (!clampedNote) {
      return {
        ok: false,
        code: 'INVALID_NOTE_UPDATED_AT',
        error: 'Invalid note_updated_at timestamp.',
      };
    }
    clampedNoteIso = clampedNote.iso;
    clampedNoteMs = clampedNote.ms;
  }

  let canonical;
  try {
    canonical = canonicalizeLogMutation(
      action,
      {
        availability_override: incoming.availability_override,
        status: incoming.status,
        percent_value: incoming.percent_value,
        qadaa_resolved_at: incoming.qadaa_resolved_at,
      },
      clampedClient.iso,
      incoming.log_date,
    );
  } catch (err) {
    if (err instanceof DomainRuleError) {
      return { ok: false, code: err.code, error: err.message };
    }
    throw err;
  }

  const targetResult = resolveValidatedTargetVersionId(
    incoming.target_version_id,
    action.id,
    incoming.log_date,
    targetVersions,
  );
  if (!targetResult.ok) {
    return {
      ok: false,
      code: 'INVALID_TARGET_VERSION',
      error: targetResult.error,
    };
  }

  return {
    ok: true,
    prepared: {
      availability_override: canonical.availability_override,
      status: canonical.status,
      percent_value: canonical.percent_value,
      qadaa_resolved_at: canonical.qadaa_resolved_at,
      target_version_id: targetResult.targetVersionId,
      note: incoming.note,
      note_updated_at: clampedNoteIso,
      noteUpdatedMs: clampedNoteMs,
      client_updated_at: clampedClient.iso,
      clientUpdatedMs: clampedClient.ms,
      serverNowMs,
    },
  };
}

function resolveConflictFields(params: {
  existing: Pick<
    DailyLog,
    | 'availability_override'
    | 'status'
    | 'percent_value'
    | 'qadaa_resolved_at'
    | 'target_version_id'
    | 'note'
    | 'note_updated_at'
    | 'client_updated_at'
  >;
  incoming: PreparedIncomingLog;
}): {
  incomingWonStatus: boolean;
  availability_override: AvailabilityOverride | null;
  status: CellStatus | null;
  percent_value: number | null;
  qadaa_resolved_at: string | null;
  target_version_id: string | null;
  note: string | null;
  note_updated_at: string | null;
  client_updated_at: string;
} {
  const { existing, incoming } = params;
  const incomingPos = isPositiveOrIntentionalState(incoming);
  const existingPos = isPositiveOrIntentionalState(existing);
  const incomingMissed = isMissedState(incoming);
  const existingMissed = isMissedState(existing);

  let incomingWonStatus: boolean;
  if (incomingPos && existingMissed) {
    incomingWonStatus = true;
  } else if (existingPos && incomingMissed) {
    incomingWonStatus = false;
  } else {
    // Positive vs Positive, MISSED vs MISSED, or Explicit Clear (EMPTY) vs Any -> newer client_updated_at wins
    const existingParsed = Date.parse(existing.client_updated_at);
    const existingMs = Number.isFinite(existingParsed)
      ? Math.min(existingParsed, incoming.serverNowMs + MAX_FUTURE_SKEW_MS)
      : -Infinity;
    incomingWonStatus = incoming.clientUpdatedMs >= existingMs;
  }

  // Independent note LWW
  const existingNoteMs = existing.note_updated_at
    ? Date.parse(existing.note_updated_at)
    : -Infinity;
  const incomingWonNote =
    incoming.note_updated_at !== null &&
    (!Number.isFinite(existingNoteMs) ||
      incoming.noteUpdatedMs >= existingNoteMs);

  const note = incomingWonNote ? incoming.note : existing.note;
  const note_updated_at = incomingWonNote
    ? incoming.note_updated_at
    : existing.note_updated_at;

  if (incomingWonStatus) {
    return {
      incomingWonStatus: true,
      availability_override: incoming.availability_override,
      status: incoming.status,
      percent_value: incoming.percent_value,
      qadaa_resolved_at: incoming.qadaa_resolved_at,
      target_version_id: incoming.target_version_id,
      note,
      note_updated_at,
      client_updated_at: incoming.client_updated_at,
    };
  }

  return {
    incomingWonStatus: false,
    availability_override: existing.availability_override,
    status: existing.status,
    percent_value: existing.percent_value,
    qadaa_resolved_at: existing.qadaa_resolved_at,
    target_version_id: existing.target_version_id,
    note,
    note_updated_at,
    client_updated_at: existing.client_updated_at,
  };
}

/**
 * Deterministic sync conflict resolver shared by `POST /api/sync`.
 */
export function resolveSyncConflict(params: {
  serverRow: DailyLog | null;
  mutation: SyncMutation;
  action: Action;
  targetVersions: readonly TargetVersion[];
  serverNow: string;
}): ResolveSyncConflictResult {
  const { serverRow, mutation, action, targetVersions, serverNow } = params;

  const prep = prepareIncomingLog({
    incoming: {
      action_id: mutation.action_id,
      log_date: mutation.log_date,
      availability_override: mutation.availability_override,
      status: mutation.status,
      percent_value: mutation.percent_value,
      qadaa_resolved_at: mutation.qadaa_resolved_at,
      target_version_id: mutation.client_target_version_id,
      note: mutation.note,
      note_updated_at: mutation.note_updated_at,
      client_updated_at: mutation.client_updated_at,
    },
    action,
    targetVersions,
    serverNow,
  });

  if (!prep.ok) {
    return { kind: 'rejected', code: prep.code, error: prep.error };
  }

  const prepared = prep.prepared;

  // Fast Path 1: Clean row creation
  if (serverRow === null) {
    return {
      kind: 'commit',
      resolution: 'fast_path_create',
      item: {
        mutation_id: mutation.mutation_id,
        device_id: mutation.device_id,
        action_id: mutation.action_id,
        log_date: mutation.log_date,
        expected_row_version: null,
        availability_override: prepared.availability_override,
        status: prepared.status,
        percent_value: prepared.percent_value,
        qadaa_resolved_at: prepared.qadaa_resolved_at,
        target_version_id: prepared.target_version_id,
        note: prepared.note,
        note_updated_at: prepared.note_updated_at,
        client_updated_at: prepared.client_updated_at,
      },
    };
  }

  // Fast Path 2: Matching base_row_version
  const isVersionFastPath =
    mutation.base_row_version !== null &&
    mutation.base_row_version === serverRow.row_version;

  // Fast Path 3: Causal same-device self-correction (dropped-ACK M1 -> M2 chain)
  const isCausalFastPath =
    mutation.parent_mutation_id !== null &&
    mutation.parent_mutation_id === serverRow.last_mutation_id &&
    mutation.device_id === serverRow.last_device_id;

  if (isVersionFastPath || isCausalFastPath) {
    return {
      kind: 'commit',
      resolution: isVersionFastPath ? 'fast_path_version' : 'fast_path_causal',
      item: {
        mutation_id: mutation.mutation_id,
        device_id: mutation.device_id,
        action_id: mutation.action_id,
        log_date: mutation.log_date,
        expected_row_version: serverRow.row_version,
        availability_override: prepared.availability_override,
        status: prepared.status,
        percent_value: prepared.percent_value,
        qadaa_resolved_at: prepared.qadaa_resolved_at,
        target_version_id: prepared.target_version_id,
        note: prepared.note,
        note_updated_at: prepared.note_updated_at,
        client_updated_at: prepared.client_updated_at,
      },
    };
  }

  // Conflict Path: genuine multi-device version mismatch or concurrent creation
  const merged = resolveConflictFields({
    existing: serverRow,
    incoming: prepared,
  });

  return {
    kind: 'commit',
    resolution: merged.incomingWonStatus
      ? 'conflict_mutation_won'
      : 'conflict_server_won',
    item: {
      mutation_id: mutation.mutation_id,
      device_id: mutation.device_id,
      action_id: mutation.action_id,
      log_date: mutation.log_date,
      expected_row_version: serverRow.row_version,
      availability_override: merged.availability_override,
      status: merged.status,
      percent_value: merged.percent_value,
      qadaa_resolved_at: merged.qadaa_resolved_at,
      target_version_id: merged.target_version_id,
      note: merged.note,
      note_updated_at: merged.note_updated_at,
      client_updated_at: merged.client_updated_at,
    },
  };
}

/**
 * Deterministic JSON import merge using the same conflict precedence without `applied_mutations`.
 */
export function resolveImportMerge(params: {
  existingRow: DailyLog | null;
  importedRow: Pick<
    DailyLog,
    | 'action_id'
    | 'log_date'
    | 'availability_override'
    | 'status'
    | 'percent_value'
    | 'qadaa_resolved_at'
    | 'target_version_id'
    | 'note'
    | 'note_updated_at'
    | 'client_updated_at'
  >;
  action: Action;
  targetVersions: readonly TargetVersion[];
  serverNow: string;
}): ResolveImportMergeResult {
  const { existingRow, importedRow, action, targetVersions, serverNow } = params;

  const prep = prepareIncomingLog({
    incoming: importedRow,
    action,
    targetVersions,
    serverNow,
  });

  if (!prep.ok) {
    return { kind: 'rejected', code: prep.code, error: prep.error };
  }

  const prepared = prep.prepared;

  if (existingRow === null) {
    return {
      kind: 'merge',
      resolution: 'import_create',
      row: {
        action_id: importedRow.action_id,
        log_date: importedRow.log_date,
        availability_override: prepared.availability_override,
        status: prepared.status,
        percent_value: prepared.percent_value,
        qadaa_resolved_at: prepared.qadaa_resolved_at,
        target_version_id: prepared.target_version_id,
        note: prepared.note,
        note_updated_at: prepared.note_updated_at,
        client_updated_at: prepared.client_updated_at,
      },
    };
  }

  const merged = resolveConflictFields({
    existing: existingRow,
    incoming: prepared,
  });

  return {
    kind: 'merge',
    resolution: merged.incomingWonStatus
      ? 'import_incoming_won'
      : 'import_existing_won',
    row: {
      action_id: importedRow.action_id,
      log_date: importedRow.log_date,
      availability_override: merged.availability_override,
      status: merged.status,
      percent_value: merged.percent_value,
      qadaa_resolved_at: merged.qadaa_resolved_at,
      target_version_id: merged.target_version_id,
      note: merged.note,
      note_updated_at: merged.note_updated_at,
      client_updated_at: merged.client_updated_at,
    },
  };
}

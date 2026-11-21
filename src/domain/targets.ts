import { addDaysIso } from './prayer-engine';
import type { DailyLog, TargetVersion } from './types';

export interface TargetProgressionTrail {
  actionId: string;
  versions: TargetVersion[];
  latest: TargetVersion | null;
  formattedTrail: string;
}

/**
 * Resolves the target version active for `actionId` on `isoDate`
 * (latest version with `effective_from <= isoDate`).
 */
export function resolveActiveTargetVersion(
  targetVersions: readonly TargetVersion[],
  actionId: string,
  isoDate: string,
): TargetVersion | null {
  let active: TargetVersion | null = null;
  for (const version of targetVersions) {
    if (version.action_id !== actionId) continue;
    if (version.effective_from > isoDate) continue;
    if (
      active === null ||
      version.effective_from > active.effective_from ||
      (version.effective_from === active.effective_from &&
        (version.created_at ?? '') > (active.created_at ?? ''))
    ) {
      active = version;
    }
  }
  return active;
}

/**
 * Same-day Target Evolution default:
 * - Today (`D`) if today's cell is `EMPTY`
 * - Tomorrow (`D + 1`) if today's cell already has a non-empty log or is explicitly DISABLED
 */
export function suggestEvolutionEffectiveDate(
  todayLog:
    | Pick<DailyLog, 'status' | 'availability_override'>
    | null
    | undefined,
  todayIso: string,
): string {
  if (
    todayLog &&
    (todayLog.status !== null || todayLog.availability_override === 'DISABLED')
  ) {
    return addDaysIso(todayIso, 1);
  }
  return todayIso;
}

/**
 * Target Versions become immutable once referenced by any log.
 */
export function isTargetVersionReferenced(
  targetVersionId: string,
  logs: readonly Pick<DailyLog, 'target_version_id'>[],
): boolean {
  return logs.some((log) => log.target_version_id === targetVersionId);
}

/**
 * Builds the chronological progression trail for an action (e.g. `10 صفحات ← 20 صفحة`).
 */
export function buildProgressionTrail(
  targetVersions: readonly TargetVersion[],
  actionId: string,
): TargetProgressionTrail {
  const versions = targetVersions
    .filter((v) => v.action_id === actionId)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));

  const latest = versions.length > 0 ? (versions[versions.length - 1] ?? null) : null;
  const formattedTrail = versions.map((v) => v.target_label).join(' ← ');

  return {
    actionId,
    versions,
    latest,
    formattedTrail,
  };
}

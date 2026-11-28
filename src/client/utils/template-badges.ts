import type { Action, TargetVersion } from '@/domain';

/** Human-readable Arabic cadence badge for actions with default disabled weekdays. */
export function getActionCadenceLabel(
  disabledDays: readonly number[],
): string | null {
  if (disabledDays.length === 0) return null;
  const key = [...disabledDays].sort((a, b) => a - b).join(',');
  if (key === '0,1,2,3,4,6') return 'الجمعة فقط';
  if (key === '0,2,3,5,6') return 'الإثنين والخميس';
  if (key === '0,1,2,3,5') return 'السبت والخميس';
  if (key === '5') return 'عدا الجمعة';
  return `${7 - disabledDays.length} أيام/أسبوع`;
}

/** Builds metadata badge pills for template previews and merge previews. */
export function buildActionMetaBadges(
  action: Action,
  targetByActionId: ReadonlyMap<string, TargetVersion>,
): string[] {
  const badges: string[] = [];
  const tv = targetByActionId.get(action.id);
  if (tv) badges.push(tv.target_label);
  const cadence = getActionCadenceLabel(action.default_disabled_days);
  if (cadence) badges.push(cadence);
  if (action.is_mosque_action) badges.push('مسجد');
  if (action.is_qadaa_eligible) badges.push('قضاء');
  if (action.supports_percentage) badges.push('نسبة %');
  return badges;
}

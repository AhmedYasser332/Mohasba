import { describe, expect, it } from 'vitest';
import { AR_STRINGS } from '@/domain/i18n/ar';
import { buildStarterPack } from '@/domain/starter-pack';
import {
  ActionSchema,
  PeriodSchema,
  TargetVersionSchema,
} from '@/domain/types';

describe('starter-pack & i18n dictionary', () => {
  it('generates deterministic valid periods, actions, and target_versions with zero personal v1 habits', () => {
    const bundleA = buildStarterPack('2026-11-01');
    const bundleB = buildStarterPack('2026-11-01');
    expect(bundleA).toEqual(bundleB);

    expect(bundleA.periods.length).toBeGreaterThanOrEqual(8);
    expect(bundleA.actions.length).toBeGreaterThanOrEqual(20);
    expect(bundleA.targetVersions.length).toBeGreaterThanOrEqual(1);

    const periodIds = new Set<string>();
    for (const period of bundleA.periods) {
      PeriodSchema.parse(period);
      expect(periodIds.has(period.id)).toBe(false);
      periodIds.add(period.id);
    }

    const actionIds = new Set<string>();
    for (const action of bundleA.actions) {
      ActionSchema.parse(action);
      expect(actionIds.has(action.id)).toBe(false);
      actionIds.add(action.id);
      expect(periodIds.has(action.period_id)).toBe(true);
      if (action.bound_time_period_id !== null) {
        expect(periodIds.has(action.bound_time_period_id)).toBe(true);
      }
      // Zero personal v1 habits
      expect(action.title).not.toMatch(/شغل|كلية|دروس العلم|جامعة/);
    }

    const targetIds = new Set<string>();
    for (const tv of bundleA.targetVersions) {
      TargetVersionSchema.parse(tv);
      expect(targetIds.has(tv.id)).toBe(false);
      targetIds.add(tv.id);
      expect(actionIds.has(tv.action_id)).toBe(true);
    }
  });

  it('provides complete Arabic UI dictionary with every leaf string non-empty', () => {
    const collectLeafStrings = (node: unknown, path = 'AR_STRINGS'): string[] => {
      if (typeof node === 'string') {
        expect(node.trim().length, `Empty leaf at ${path}`).toBeGreaterThan(0);
        return [node];
      }
      if (Array.isArray(node)) {
        expect(node.length, `Empty array at ${path}`).toBeGreaterThan(0);
        return node.flatMap((item, idx) =>
          collectLeafStrings(item, `${path}[${idx}]`),
        );
      }
      if (node !== null && typeof node === 'object') {
        const entries = Object.entries(node);
        expect(entries.length, `Empty object at ${path}`).toBeGreaterThan(0);
        return entries.flatMap(([key, val]) =>
          collectLeafStrings(val, `${path}.${key}`),
        );
      }
      throw new Error(`Unexpected leaf type at ${path}: ${typeof node}`);
    };

    const leaves = collectLeafStrings(AR_STRINGS);
    expect(leaves.length).toBeGreaterThan(60);
    expect(Object.keys(AR_STRINGS.nav)).toEqual([
      'now',
      'week',
      'qadaa',
      'analytics',
      'settings',
    ]);
  });
});

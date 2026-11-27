'use client';

import { useSyncExternalStore } from 'react';

export type CrosshairDisplayMode = 'both' | 'row' | 'col' | 'off';
export type CrosshairMotionMode = 'smooth' | 'instant';

export interface CrosshairPreferences {
  mode: CrosshairDisplayMode;
  /** Percentage multiplier (20..220, default 100). */
  opacity: number;
  motion: CrosshairMotionMode;
  showHeaderIndicator: boolean;
  showFocusFallback: boolean;
  coverPeriodColumn: boolean;
}

export const CROSSHAIR_PREFS_STORAGE_KEY = 'mohasba.crosshair.prefs';
const CROSSHAIR_PREFS_EVENT = 'mohasba:crosshair-prefs-change';

export const DEFAULT_CROSSHAIR_PREFS: Readonly<CrosshairPreferences> =
  Object.freeze({
    mode: 'both',
    opacity: 100,
    motion: 'smooth',
    showHeaderIndicator: true,
    showFocusFallback: true,
    coverPeriodColumn: false,
  });

const VALID_MODES = new Set<CrosshairDisplayMode>(['both', 'row', 'col', 'off']);
const VALID_MOTIONS = new Set<CrosshairMotionMode>(['smooth', 'instant']);

function clampOpacity(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return DEFAULT_CROSSHAIR_PREFS.opacity;
  return Math.min(220, Math.max(20, Math.round(num / 10) * 10));
}

function parseCrosshairPrefs(raw: string | null): CrosshairPreferences {
  if (!raw) return DEFAULT_CROSSHAIR_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof CrosshairPreferences, unknown>>;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CROSSHAIR_PREFS;
    const mode = VALID_MODES.has(parsed.mode as CrosshairDisplayMode)
      ? (parsed.mode as CrosshairDisplayMode)
      : DEFAULT_CROSSHAIR_PREFS.mode;
    const motion = VALID_MOTIONS.has(parsed.motion as CrosshairMotionMode)
      ? (parsed.motion as CrosshairMotionMode)
      : DEFAULT_CROSSHAIR_PREFS.motion;
    return {
      mode,
      opacity: clampOpacity(parsed.opacity),
      motion,
      showHeaderIndicator:
        typeof parsed.showHeaderIndicator === 'boolean'
          ? parsed.showHeaderIndicator
          : DEFAULT_CROSSHAIR_PREFS.showHeaderIndicator,
      showFocusFallback:
        typeof parsed.showFocusFallback === 'boolean'
          ? parsed.showFocusFallback
          : DEFAULT_CROSSHAIR_PREFS.showFocusFallback,
      coverPeriodColumn:
        typeof parsed.coverPeriodColumn === 'boolean'
          ? parsed.coverPeriodColumn
          : DEFAULT_CROSSHAIR_PREFS.coverPeriodColumn,
    };
  } catch {
    return DEFAULT_CROSSHAIR_PREFS;
  }
}

let cachedRaw: string | null | undefined;
let cachedSnapshot: CrosshairPreferences = DEFAULT_CROSSHAIR_PREFS;

export function getCrosshairPrefsSnapshot(): CrosshairPreferences {
  if (typeof window === 'undefined') return DEFAULT_CROSSHAIR_PREFS;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CROSSHAIR_PREFS_STORAGE_KEY);
  } catch {
    return DEFAULT_CROSSHAIR_PREFS;
  }
  if (raw === cachedRaw) {
    return cachedSnapshot;
  }
  cachedRaw = raw;
  cachedSnapshot = parseCrosshairPrefs(raw);
  return cachedSnapshot;
}

function getServerSnapshot(): CrosshairPreferences {
  return DEFAULT_CROSSHAIR_PREFS;
}

function subscribeCrosshairPrefs(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CROSSHAIR_PREFS_STORAGE_KEY) {
      listener();
    }
  };
  const onCustom = () => listener();
  window.addEventListener('storage', onStorage);
  window.addEventListener(CROSSHAIR_PREFS_EVENT, onCustom);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CROSSHAIR_PREFS_EVENT, onCustom);
  };
}

export function updateCrosshairPrefs(
  patch: Partial<CrosshairPreferences>,
): CrosshairPreferences {
  const current = getCrosshairPrefsSnapshot();
  const next: CrosshairPreferences = {
    mode:
      patch.mode && VALID_MODES.has(patch.mode) ? patch.mode : current.mode,
    opacity:
      patch.opacity !== undefined
        ? clampOpacity(patch.opacity)
        : current.opacity,
    motion:
      patch.motion && VALID_MOTIONS.has(patch.motion)
        ? patch.motion
        : current.motion,
    showHeaderIndicator:
      typeof patch.showHeaderIndicator === 'boolean'
        ? patch.showHeaderIndicator
        : current.showHeaderIndicator,
    showFocusFallback:
      typeof patch.showFocusFallback === 'boolean'
        ? patch.showFocusFallback
        : current.showFocusFallback,
    coverPeriodColumn:
      typeof patch.coverPeriodColumn === 'boolean'
        ? patch.coverPeriodColumn
        : current.coverPeriodColumn,
  };
  if (typeof window !== 'undefined') {
    const serialized = JSON.stringify(next);
    cachedRaw = serialized;
    cachedSnapshot = next;
    try {
      window.localStorage.setItem(CROSSHAIR_PREFS_STORAGE_KEY, serialized);
    } catch {
      // Ignore storage quota errors in restricted browsing modes
    }
    window.dispatchEvent(new Event(CROSSHAIR_PREFS_EVENT));
  }
  return next;
}

export function resetCrosshairPrefs(): CrosshairPreferences {
  if (typeof window !== 'undefined') {
    cachedRaw = null;
    cachedSnapshot = DEFAULT_CROSSHAIR_PREFS;
    try {
      window.localStorage.removeItem(CROSSHAIR_PREFS_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    window.dispatchEvent(new Event(CROSSHAIR_PREFS_EVENT));
  }
  return DEFAULT_CROSSHAIR_PREFS;
}

export function useCrosshairPrefs(): CrosshairPreferences {
  return useSyncExternalStore(
    subscribeCrosshairPrefs,
    getCrosshairPrefsSnapshot,
    getServerSnapshot,
  );
}

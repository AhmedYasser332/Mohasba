'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

const DISCLOSURE_CHANGE_EVENT = 'mohasba:disclosure-storage-change';

interface CacheEntry {
  raw: string | null;
  value: unknown;
}

const snapshotCache = new Map<string, CacheEntry>();
const memoryFallbackStore = new Map<string, string | null>();
const storageUnavailableKeys = new Set<string>();

const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_BOOLEAN_RECORD: Readonly<Record<string, boolean>> = Object.freeze(
  {},
);

function notifyDisclosureChange(storageKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(DISCLOSURE_CHANGE_EVENT, {
        detail: { key: storageKey },
      }),
    );
  } catch {
    // Ignore event dispatch errors in restricted environments
  }
}

function subscribeDisclosureKey(
  storageKey: string,
  listener: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === storageKey) {
      listener();
    }
  };
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<{ key?: string }>).detail;
    if (!detail || detail.key === storageKey) {
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(DISCLOSURE_CHANGE_EVENT, onCustom);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(DISCLOSURE_CHANGE_EVENT, onCustom);
  };
}

function readStorageItem(
  storageKey: string,
): { ok: true; raw: string | null } | { ok: false } {
  if (typeof window === 'undefined') return { ok: false };
  if (storageUnavailableKeys.has(storageKey)) {
    return { ok: true, raw: memoryFallbackStore.get(storageKey) ?? null };
  }
  try {
    return { ok: true, raw: window.localStorage.getItem(storageKey) };
  } catch {
    storageUnavailableKeys.add(storageKey);
    return { ok: true, raw: memoryFallbackStore.get(storageKey) ?? null };
  }
}

function writeStorageItem(storageKey: string, serialized: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(storageKey, serialized);
    storageUnavailableKeys.delete(storageKey);
    memoryFallbackStore.delete(storageKey);
    return true;
  } catch {
    storageUnavailableKeys.add(storageKey);
    memoryFallbackStore.set(storageKey, serialized);
    return false;
  }
}

function removeStorageItem(storageKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(storageKey);
    storageUnavailableKeys.delete(storageKey);
    memoryFallbackStore.delete(storageKey);
    return true;
  } catch {
    storageUnavailableKeys.add(storageKey);
    memoryFallbackStore.set(storageKey, null);
    return false;
  }
}

function parseStringSet(raw: string, fallback: Set<string>): Set<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const strings = parsed.filter((item): item is string => typeof item === 'string');
    return new Set<string>(strings);
  } catch {
    return fallback;
  }
}

function parseBooleanRecord(
  raw: string,
  fallback: Record<string, boolean>,
): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback;
    }
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return fallback;
  }
}

function parseBooleanValue(raw: string, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * SSR- and hydration-safe persistent Set<string> backed by localStorage (with in-memory fallback).
 */
export function usePersistedStringSet(
  storageKey: string,
  defaultValues?: readonly string[],
): readonly [
  Set<string>,
  (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void,
] {
  const defaultSerialized = defaultValues ? JSON.stringify(defaultValues) : '';
  const serverDefault = useMemo<Set<string>>(() => {
    if (!defaultValues || defaultValues.length === 0) {
      return EMPTY_STRING_SET as Set<string>;
    }
    return new Set<string>(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSerialized]);

  const subscribe = useCallback(
    (listener: () => void) => subscribeDisclosureKey(storageKey, listener),
    [storageKey],
  );

  const getSnapshot = useCallback((): Set<string> => {
    const read = readStorageItem(storageKey);
    if (!read.ok || read.raw === null) {
      return serverDefault;
    }
    const cached = snapshotCache.get(storageKey);
    if (cached && cached.raw === read.raw && cached.value instanceof Set) {
      return cached.value as Set<string>;
    }
    const nextValue = parseStringSet(read.raw, serverDefault);
    snapshotCache.set(storageKey, { raw: read.raw, value: nextValue });
    return nextValue;
  }, [serverDefault, storageKey]);

  const getServerSnapshot = useCallback((): Set<string> => serverDefault, [serverDefault]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const prev = getSnapshot();
      const rawNext = typeof updater === 'function' ? updater(prev) : updater;
      const next = new Set<string>(rawNext);
      const serialized = JSON.stringify(Array.from(next));
      snapshotCache.set(storageKey, { raw: serialized, value: next });
      writeStorageItem(storageKey, serialized);
      notifyDisclosureChange(storageKey);
    },
    [getSnapshot, storageKey],
  );

  return [value, setValue] as const;
}

/**
 * SSR- and hydration-safe persistent Record<string, boolean> backed by localStorage (with in-memory fallback).
 */
export function usePersistedBooleanRecord(
  storageKey: string,
  defaultValue?: Record<string, boolean>,
): readonly [
  Record<string, boolean>,
  (
    updater:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void,
] {
  const defaultSerialized = defaultValue ? JSON.stringify(defaultValue) : '';
  const serverDefault = useMemo<Record<string, boolean>>(() => {
    if (!defaultValue || Object.keys(defaultValue).length === 0) {
      return EMPTY_BOOLEAN_RECORD as Record<string, boolean>;
    }
    return { ...defaultValue };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSerialized]);

  const subscribe = useCallback(
    (listener: () => void) => subscribeDisclosureKey(storageKey, listener),
    [storageKey],
  );

  const getSnapshot = useCallback((): Record<string, boolean> => {
    const read = readStorageItem(storageKey);
    if (!read.ok || read.raw === null) {
      return serverDefault;
    }
    const cached = snapshotCache.get(storageKey);
    if (
      cached &&
      cached.raw === read.raw &&
      cached.value !== null &&
      typeof cached.value === 'object' &&
      !Array.isArray(cached.value) &&
      !(cached.value instanceof Set)
    ) {
      return cached.value as Record<string, boolean>;
    }
    const nextValue = parseBooleanRecord(read.raw, serverDefault);
    snapshotCache.set(storageKey, { raw: read.raw, value: nextValue });
    return nextValue;
  }, [serverDefault, storageKey]);

  const getServerSnapshot = useCallback(
    (): Record<string, boolean> => serverDefault,
    [serverDefault],
  );

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (
      updater:
        | Record<string, boolean>
        | ((prev: Record<string, boolean>) => Record<string, boolean>),
    ) => {
      const prev = getSnapshot();
      const rawNext = typeof updater === 'function' ? updater(prev) : updater;
      const next: Record<string, boolean> = { ...rawNext };
      const serialized = JSON.stringify(next);
      snapshotCache.set(storageKey, { raw: serialized, value: next });
      writeStorageItem(storageKey, serialized);
      notifyDisclosureChange(storageKey);
    },
    [getSnapshot, storageKey],
  );

  return [value, setValue] as const;
}

/**
 * SSR- and hydration-safe persistent boolean backed by localStorage (with in-memory fallback).
 */
export function usePersistedBoolean(
  storageKey: string,
  defaultValue: boolean,
): readonly [boolean, (updater: boolean | ((prev: boolean) => boolean)) => void] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeDisclosureKey(storageKey, listener),
    [storageKey],
  );

  const getSnapshot = useCallback((): boolean => {
    const read = readStorageItem(storageKey);
    if (!read.ok || read.raw === null) {
      return defaultValue;
    }
    const cached = snapshotCache.get(storageKey);
    if (cached && cached.raw === read.raw && typeof cached.value === 'boolean') {
      return cached.value;
    }
    const nextValue = parseBooleanValue(read.raw, defaultValue);
    snapshotCache.set(storageKey, { raw: read.raw, value: nextValue });
    return nextValue;
  }, [defaultValue, storageKey]);

  const getServerSnapshot = useCallback((): boolean => defaultValue, [defaultValue]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      const prev = getSnapshot();
      const next = Boolean(typeof updater === 'function' ? updater(prev) : updater);
      const serialized = next ? 'true' : 'false';
      snapshotCache.set(storageKey, { raw: serialized, value: next });
      writeStorageItem(storageKey, serialized);
      notifyDisclosureChange(storageKey);
    },
    [getSnapshot, storageKey],
  );

  return [value, setValue] as const;
}

/**
 * SSR- and hydration-safe tri-state nullable boolean (`true | false | null`) backed by localStorage (with in-memory fallback).
 */
export function usePersistedNullableBoolean(
  storageKey: string,
): readonly [boolean | null, (next: boolean | null) => void] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeDisclosureKey(storageKey, listener),
    [storageKey],
  );

  const getSnapshot = useCallback((): boolean | null => {
    const read = readStorageItem(storageKey);
    if (!read.ok || read.raw === null) {
      return null;
    }
    const cached = snapshotCache.get(storageKey);
    if (
      cached &&
      cached.raw === read.raw &&
      (typeof cached.value === 'boolean' || cached.value === null)
    ) {
      return cached.value as boolean | null;
    }
    let nextValue: boolean | null = null;
    if (read.raw === 'true') {
      nextValue = true;
    } else if (read.raw === 'false') {
      nextValue = false;
    } else {
      try {
        const parsed: unknown = JSON.parse(read.raw);
        if (typeof parsed === 'boolean') {
          nextValue = parsed;
        }
      } catch {
        nextValue = null;
      }
    }
    snapshotCache.set(storageKey, { raw: read.raw, value: nextValue });
    return nextValue;
  }, [storageKey]);

  const getServerSnapshot = useCallback((): boolean | null => null, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: boolean | null) => {
      if (next === null) {
        snapshotCache.delete(storageKey);
        removeStorageItem(storageKey);
        notifyDisclosureChange(storageKey);
        return;
      }
      const serialized = next ? 'true' : 'false';
      snapshotCache.set(storageKey, { raw: serialized, value: next });
      writeStorageItem(storageKey, serialized);
      notifyDisclosureChange(storageKey);
    },
    [storageKey],
  );

  return [value, setValue] as const;
}

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CROSSHAIR_PREFS_STORAGE_KEY,
  DEFAULT_CROSSHAIR_PREFS,
  getCrosshairPrefsSnapshot,
  resetCrosshairPrefs,
  updateCrosshairPrefs,
  useCrosshairPrefs,
} from '@/client/utils/crosshair-prefs';

function createMockWindow() {
  const storageMap = new Map<string, string>();
  const target = new EventTarget();
  const dispatched: Event[] = [];

  const mockWindow = {
    localStorage: {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storageMap.set(key, String(value));
      },
      removeItem: (key: string) => {
        storageMap.delete(key);
      },
      clear: () => {
        storageMap.clear();
      },
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: (evt: Event) => {
      dispatched.push(evt);
      return target.dispatchEvent(evt);
    },
  };

  return { mockWindow, storageMap, target, dispatched };
}

describe('crosshair-prefs', () => {
  const origWindow = globalThis.window;

  beforeEach(() => {
    resetCrosshairPrefs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (origWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      vi.stubGlobal('window', origWindow);
    }
    vi.resetModules();
  });

  it('returns stable DEFAULT_CROSSHAIR_PREFS on SSR / server snapshot without window', () => {
    delete (globalThis as { window?: unknown }).window;

    const first = getCrosshairPrefsSnapshot();
    const second = getCrosshairPrefsSnapshot();
    expect(Object.is(first, second)).toBe(true);
    expect(first).toEqual(DEFAULT_CROSSHAIR_PREFS);

    function SsrProbe() {
      const prefs = useCrosshairPrefs();
      return React.createElement(
        'span',
        null,
        `${prefs.mode}:${prefs.opacity}:${prefs.motion}:${prefs.coverPeriodColumn}`,
      );
    }

    const html1 = renderToStaticMarkup(React.createElement(SsrProbe));
    const html2 = renderToStaticMarkup(React.createElement(SsrProbe));
    expect(html1).toBe('<span>both:100:instant:false</span>');
    expect(html2).toBe(html1);
    expect(DEFAULT_CROSSHAIR_PREFS.motion).toBe('instant');
    expect(DEFAULT_CROSSHAIR_PREFS.showFocusFallback).toBe(false);
  });

  it('clamps opacity to 20..220 rounded to nearest step of 10 and falls back on malformed JSON or invalid values', () => {
    const { mockWindow, storageMap } = createMockWindow();
    vi.stubGlobal('window', mockWindow);

    // Lower bound, upper bound, step-10 rounding
    expect(updateCrosshairPrefs({ opacity: 0 }).opacity).toBe(20);
    expect(updateCrosshairPrefs({ opacity: -50 }).opacity).toBe(20);
    expect(updateCrosshairPrefs({ opacity: 300 }).opacity).toBe(220);
    expect(updateCrosshairPrefs({ opacity: 124 }).opacity).toBe(120);
    expect(updateCrosshairPrefs({ opacity: 125 }).opacity).toBe(130);
    expect(updateCrosshairPrefs({ opacity: Number.NaN }).opacity).toBe(100);

    // Malformed JSON fallback
    storageMap.set(CROSSHAIR_PREFS_STORAGE_KEY, '{not-valid-json');
    expect(getCrosshairPrefsSnapshot()).toEqual(DEFAULT_CROSSHAIR_PREFS);

    // Non-object JSON fallback
    storageMap.set(CROSSHAIR_PREFS_STORAGE_KEY, 'null');
    expect(getCrosshairPrefsSnapshot()).toEqual(DEFAULT_CROSSHAIR_PREFS);

    // Partial invalid fields fallback while preserving valid ones
    storageMap.set(
      CROSSHAIR_PREFS_STORAGE_KEY,
      JSON.stringify({
        mode: 'invalid_mode',
        opacity: 154,
        motion: 'invalid_motion',
        showHeaderIndicator: 'yes',
        showFocusFallback: false,
        coverPeriodColumn: true,
      }),
    );
    expect(getCrosshairPrefsSnapshot()).toEqual({
      mode: 'both',
      opacity: 150,
      motion: 'instant',
      showHeaderIndicator: true,
      showFocusFallback: false,
      coverPeriodColumn: true,
    });
  });

  it('updateCrosshairPrefs and resetCrosshairPrefs persist to localStorage and cache snapshots cleanly', () => {
    const { mockWindow, storageMap, dispatched } = createMockWindow();
    vi.stubGlobal('window', mockWindow);

    const updated = updateCrosshairPrefs({
      mode: 'row',
      opacity: 180,
      motion: 'smooth',
      coverPeriodColumn: true,
    });

    expect(updated).toEqual({
      mode: 'row',
      opacity: 180,
      motion: 'smooth',
      showHeaderIndicator: true,
      showFocusFallback: false,
      coverPeriodColumn: true,
    });

    const persisted = JSON.parse(
      storageMap.get(CROSSHAIR_PREFS_STORAGE_KEY) ?? '{}',
    );
    expect(persisted).toEqual(updated);
    expect(Object.is(getCrosshairPrefsSnapshot(), updated)).toBe(true);
    expect(dispatched.some((e) => e.type === 'mohasba:crosshair-prefs-change')).toBe(
      true,
    );

    const afterReset = resetCrosshairPrefs();
    expect(afterReset).toEqual(DEFAULT_CROSSHAIR_PREFS);
    expect(storageMap.has(CROSSHAIR_PREFS_STORAGE_KEY)).toBe(false);
    expect(getCrosshairPrefsSnapshot()).toEqual(DEFAULT_CROSSHAIR_PREFS);
  });

  it('synchronizes external storage events when key matches CROSSHAIR_PREFS_STORAGE_KEY or key is null', async () => {
    const { mockWindow, storageMap } = createMockWindow();
    vi.stubGlobal('window', mockWindow);

    let notifications = 0;
    let unsubscribe: (() => void) | undefined;
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useSyncExternalStore: (
          subscribe: (listener: () => void) => () => void,
          getSnapshot: () => unknown,
          getServerSnapshot?: () => unknown,
        ) => {
          // Verify getServerSnapshot stability directly
          if (getServerSnapshot) {
            const s1 = getServerSnapshot();
            const s2 = getServerSnapshot();
            expect(Object.is(s1, s2)).toBe(true);
            expect(s1).toEqual(DEFAULT_CROSSHAIR_PREFS);
          }
          unsubscribe = subscribe(() => {
            notifications += 1;
          });
          return getSnapshot();
        },
      };
    });

    const mod = await import('@/client/utils/crosshair-prefs');

    const initial = mod.useCrosshairPrefs();
    expect(initial).toEqual(DEFAULT_CROSSHAIR_PREFS);

    // Unrelated storage key should NOT notify
    const unrelatedEvent = new Event('storage') as Event & { key: string | null };
    unrelatedEvent.key = 'other.key';
    mockWindow.dispatchEvent(unrelatedEvent);
    expect(notifications).toBe(0);

    // Matching storage key updates snapshot & notifies subscriber
    storageMap.set(
      CROSSHAIR_PREFS_STORAGE_KEY,
      JSON.stringify({ mode: 'col', opacity: 60 }),
    );
    const matchingEvent = new Event('storage') as Event & { key: string | null };
    matchingEvent.key = CROSSHAIR_PREFS_STORAGE_KEY;
    mockWindow.dispatchEvent(matchingEvent);
    expect(notifications).toBe(1);
    expect(mod.getCrosshairPrefsSnapshot()).toMatchObject({
      mode: 'col',
      opacity: 60,
    });

    // Clear-all storage event (key === null) also notifies subscriber
    storageMap.delete(CROSSHAIR_PREFS_STORAGE_KEY);
    const clearAllEvent = new Event('storage') as Event & { key: string | null };
    clearAllEvent.key = null;
    mockWindow.dispatchEvent(clearAllEvent);
    expect(notifications).toBe(2);
    expect(mod.getCrosshairPrefsSnapshot()).toEqual(DEFAULT_CROSSHAIR_PREFS);

    unsubscribe?.();
  });
});

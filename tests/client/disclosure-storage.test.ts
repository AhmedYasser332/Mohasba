import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  usePersistedBoolean,
  usePersistedBooleanRecord,
  usePersistedStringSet,
} from '@/client/utils/disclosure-storage';

function createMockWindow() {
  const storageMap = new Map<string, string>();
  const target = new EventTarget();
  const dispatched: Event[] = [];

  class MockCustomEvent<T = unknown> extends Event {
    detail: T;
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type);
      this.detail = init?.detail as T;
    }
  }

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

  return { mockWindow, storageMap, dispatched, MockCustomEvent };
}

describe('disclosure-storage', () => {
  const origWindow = globalThis.window;
  const origCustomEvent = globalThis.CustomEvent;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (origWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      vi.stubGlobal('window', origWindow);
    }
    if (origCustomEvent !== undefined) {
      vi.stubGlobal('CustomEvent', origCustomEvent);
    }
    vi.resetModules();
  });

  it('produces stable SSR snapshots without window for all three hooks', () => {
    delete (globalThis as { window?: unknown }).window;

    function SsrProbe() {
      const [setVal] = usePersistedStringSet('test.ssr.set', ['a', 'b']);
      const [recVal] = usePersistedBooleanRecord('test.ssr.rec', {
        g1: true,
      });
      const [boolVal] = usePersistedBoolean('test.ssr.bool', true);
      return React.createElement(
        'div',
        null,
        `${Array.from(setVal).join(',')}|${JSON.stringify(recVal)}|${String(boolVal)}`,
      );
    }

    const html1 = renderToStaticMarkup(React.createElement(SsrProbe));
    const html2 = renderToStaticMarkup(React.createElement(SsrProbe));
    expect(html1).toBe('<div>a,b|{&quot;g1&quot;:true}|true</div>');
    expect(html2).toBe(html1);
  });

  it('verifies getServerSnapshot reference stability, localStorage persistence, invalid JSON fallbacks, and cross-component sync', async () => {
    const { mockWindow, storageMap, dispatched, MockCustomEvent } =
      createMockWindow();
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('CustomEvent', MockCustomEvent);

    const listenersBySlot: Array<{ key: string; count: number; unsub: () => void }> =
      [];
    const snapshotRefs: unknown[] = [];

    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useMemo: <T,>(factory: () => T) => factory(),
        useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
        useSyncExternalStore: (
          subscribe: (listener: () => void) => () => void,
          getSnapshot: () => unknown,
          getServerSnapshot?: () => unknown,
        ) => {
          if (getServerSnapshot) {
            const s1 = getServerSnapshot();
            const s2 = getServerSnapshot();
            expect(Object.is(s1, s2)).toBe(true);
            snapshotRefs.push(s1);
          }
          const slot = { key: '', count: 0, unsub: () => {} };
          slot.unsub = subscribe(() => {
            slot.count += 1;
          });
          listenersBySlot.push(slot);
          return getSnapshot();
        },
      };
    });

    const mod = await import('@/client/utils/disclosure-storage');

    // 1. StringSet: default, invalid JSON fallback, persistence, cross-component sync
    storageMap.set('test.set', '{bad-json');
    const [badSet] = mod.usePersistedStringSet('test.set', ['general']);
    expect(Array.from(badSet)).toEqual(['general']);

    storageMap.set('test.set', JSON.stringify(['ntfy', 123, 'backup']));
    const [filteredSet, setStringSet] = mod.usePersistedStringSet('test.set', [
      'general',
    ]);
    expect(Array.from(filteredSet)).toEqual(['ntfy', 'backup']);

    // Second subscriber on same key
    const [, setStringSet2] = mod.usePersistedStringSet('test.set', ['general']);
    setStringSet((prev) => {
      const next = new Set(prev);
      next.add('shortcuts');
      return next;
    });
    expect(JSON.parse(storageMap.get('test.set') ?? '[]')).toEqual([
      'ntfy',
      'backup',
      'shortcuts',
    ]);
    expect(
      dispatched.some(
        (e) =>
          e.type === 'mohasba:disclosure-storage-change' &&
          (e as CustomEvent<{ key: string }>).detail?.key === 'test.set',
      ),
    ).toBe(true);
    // Both subscribers on test.set notified
    expect(listenersBySlot[1]!.count).toBeGreaterThanOrEqual(1);
    expect(listenersBySlot[2]!.count).toBeGreaterThanOrEqual(1);

    // Direct setter on second component updates storage & notifies first
    const prevFirstCount = listenersBySlot[1]!.count;
    setStringSet2(new Set(['only']));
    expect(JSON.parse(storageMap.get('test.set') ?? '[]')).toEqual(['only']);
    expect(listenersBySlot[1]!.count).toBeGreaterThan(prevFirstCount);

    // 2. BooleanRecord: invalid JSON / array / mixed-value filtering + persistence
    storageMap.set('test.rec', '[1,2,3]');
    const [arrRec] = mod.usePersistedBooleanRecord('test.rec', { p1: false });
    expect(arrRec).toEqual({ p1: false });

    storageMap.set(
      'test.rec',
      JSON.stringify({ p1: true, p2: 'bad', p3: false }),
    );
    const [rec, setRec] = mod.usePersistedBooleanRecord('test.rec', {});
    expect(rec).toEqual({ p1: true, p3: false });

    setRec((prev) => ({ ...prev, p2: true }));
    expect(JSON.parse(storageMap.get('test.rec') ?? '{}')).toEqual({
      p1: true,
      p3: false,
      p2: true,
    });

    // 3. Boolean: invalid JSON fallback, string 'true'/'false', persistence, storage event filtering
    storageMap.set('test.bool', 'not-a-bool');
    const [badBool] = mod.usePersistedBoolean('test.bool', true);
    expect(badBool).toBe(true);

    storageMap.set('test.bool', 'false');
    const [parsedBool, setBool] = mod.usePersistedBoolean('test.bool', true);
    expect(parsedBool).toBe(false);

    const boolSlot = listenersBySlot[listenersBySlot.length - 1]!;
    const beforeUnrelated = boolSlot.count;
    const unrelatedStorage = new Event('storage') as Event & {
      key: string | null;
    };
    unrelatedStorage.key = 'some.other.key';
    mockWindow.dispatchEvent(unrelatedStorage);
    expect(boolSlot.count).toBe(beforeUnrelated);

    // Matching storage event notifies
    storageMap.set('test.bool', 'true');
    const matchingStorage = new Event('storage') as Event & {
      key: string | null;
    };
    matchingStorage.key = 'test.bool';
    mockWindow.dispatchEvent(matchingStorage);
    expect(boolSlot.count).toBe(beforeUnrelated + 1);

    // Clear-all storage event (key === null) notifies
    storageMap.clear();
    const clearAllStorage = new Event('storage') as Event & {
      key: string | null;
    };
    clearAllStorage.key = null;
    mockWindow.dispatchEvent(clearAllStorage);
    expect(boolSlot.count).toBe(beforeUnrelated + 2);

    setBool((prev) => !prev);
    expect(storageMap.get('test.bool')).toBe('false');

    for (const s of listenersBySlot) {
      s.unsub();
    }
  });
});

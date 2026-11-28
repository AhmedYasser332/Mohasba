'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatCountdownClock } from './cell-display';

const SHOW_SECONDS_PREF_KEY = 'mohasba.countdown.showSeconds';
const SHOW_SECONDS_EVENT = 'mohasba:countdown-show-seconds-change';
const TICK_MS = 1000;

let memoryFallbackShowSeconds = false;

function getShowSecondsPrefSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SHOW_SECONDS_PREF_KEY) === '1';
  } catch {
    return memoryFallbackShowSeconds;
  }
}

function getShowSecondsServerSnapshot(): boolean {
  return false;
}

function subscribeShowSecondsPref(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SHOW_SECONDS_PREF_KEY) {
      listener();
    }
  };
  const onLocalChange = () => listener();
  window.addEventListener('storage', onStorage);
  window.addEventListener(SHOW_SECONDS_EVENT, onLocalChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SHOW_SECONDS_EVENT, onLocalChange);
  };
}

interface PeriodCountdownProps {
  endInstant: number;
  isClosing: boolean;
}

/**
 * Live descending countdown to the end of the active period window.
 * Click toggles between `H:MM` and `H:MM:SS`; the choice persists on this device.
 */
export function PeriodCountdown({ endInstant, isClosing }: PeriodCountdownProps) {
  const showSeconds = useSyncExternalStore(
    subscribeShowSecondsPref,
    getShowSecondsPrefSnapshot,
    getShowSecondsServerSnapshot,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const syncNow = () => setNowMs(Date.now());
    const id = window.setInterval(syncNow, TICK_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const toggleSeconds = () => {
    const next = !showSeconds;
    memoryFallbackShowSeconds = next;
    try {
      window.localStorage.setItem(SHOW_SECONDS_PREF_KEY, next ? '1' : '0');
    } catch {
      // Storage unavailable (private mode): keep the in-memory toggle only.
    }
    window.dispatchEvent(new Event(SHOW_SECONDS_EVENT));
  };

  const remainingMs = endInstant - nowMs;
  if (remainingMs <= 0) {
    return <span className="window-countdown">انتهى الوقت</span>;
  }

  const clock = formatCountdownClock(remainingMs, showSeconds);

  return (
    <button
      type="button"
      className={`window-countdown is-live-countdown ${isClosing ? 'closing' : ''}`}
      data-testid="period-countdown"
      aria-pressed={showSeconds}
      aria-label={`الوقت المتبقي ${clock}، اضغط ${showSeconds ? 'لإخفاء' : 'لإظهار'} الثواني`}
      title={showSeconds ? 'اضغط لإخفاء الثواني' : 'اضغط لإظهار الثواني'}
      onClick={toggleSeconds}
    >
      <span>باقي</span>{' '}
      <span dir="ltr" className="nums">
        {clock}
      </span>
    </button>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { formatCountdownClock } from './cell-display';

const SHOW_SECONDS_PREF_KEY = 'mohasba.countdown.showSeconds';
const TICK_MS = 1000;

function readShowSecondsPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SHOW_SECONDS_PREF_KEY) === '1';
  } catch {
    return false;
  }
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
  const [showSeconds, setShowSeconds] = useState(readShowSecondsPref);
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
    setShowSeconds((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SHOW_SECONDS_PREF_KEY, next ? '1' : '0');
      } catch {
        // Storage unavailable (private mode): keep the in-memory toggle only.
      }
      return next;
    });
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

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface LongPressConfig {
  /** Hold duration in ms before long-press fires. Default: 450ms. */
  delayMs?: number;
  /** Delay in ms before entering visual armed state (.is-pressing). Default: 120ms. */
  armDelayMs?: number;
  /** Pointer movement distance in px that cancels long-press (protects mobile scrolling). Default: 10px. */
  moveThresholdPx?: number;
  /** Only trigger on touch/pen pointers (desktop mouse uses left-click + right-click). Default: true. */
  touchOnly?: boolean;
}

export interface UseLongPressOptions extends LongPressConfig {
  disabled?: boolean;
  onLongPress: (event: React.PointerEvent) => void;
  onClick?: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}

export interface LongPressBindHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
  onClick: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

export interface KeyedLongPressCallbacks {
  disabled?: boolean;
  onLongPress: (event: React.PointerEvent) => void;
  onClick?: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}

interface ActivePressState<TKey> {
  key: TKey;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  fired: boolean;
}

/**
 * Shared matrix/list long-press controller using Pointer Events with a single
 * transient window scroll capture listener while a touch hold is active.
 *
 * - 450ms activation threshold (configurable)
 * - 120ms visual arm delay (`pressingKey`)
 * - Immediate cancellation on >10px pointer movement or scroll (zero scroll conflict)
 * - Suppresses trailing click and touch contextmenu after long-press fires
 * - Silent (zero audio)
 */
export function useKeyedLongPress<TKey = string>(config: LongPressConfig = {}) {
  const {
    delayMs = 450,
    armDelayMs = 120,
    moveThresholdPx = 10,
    touchOnly = true,
  } = config;

  const [pressingKey, setPressingKey] = useState<TKey | null>(null);

  const activeRef = useRef<ActivePressState<TKey> | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef<{ key: TKey; until: number } | null>(null);

  const clearTimers = useCallback(() => {
    if (armTimerRef.current !== null) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    if (fireTimerRef.current !== null) {
      clearTimeout(fireTimerRef.current);
      fireTimerRef.current = null;
    }
    if (scrollCleanupRef.current !== null) {
      scrollCleanupRef.current();
      scrollCleanupRef.current = null;
    }
  }, []);

  const cancelActive = useCallback(() => {
    clearTimers();
    activeRef.current = null;
    setPressingKey((prev) => (prev !== null ? null : prev));
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const handlePointerDown = useCallback(
    (
      event: React.PointerEvent,
      key: TKey,
      disabled: boolean | undefined,
      onLongPress: (event: React.PointerEvent) => void,
    ) => {
      if (disabled) return;
      const isTouchOrPen =
        event.pointerType === 'touch' || event.pointerType === 'pen';
      if (touchOnly && !isTouchOrPen) return;
      if (!touchOnly && event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      clearTimers();
      setPressingKey(null);

      const state: ActivePressState<TKey> = {
        key,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        fired: false,
      };
      activeRef.current = state;

      if (typeof window !== 'undefined') {
        const onScroll = () => {
          cancelActive();
        };
        window.addEventListener('scroll', onScroll, {
          capture: true,
          passive: true,
        });
        scrollCleanupRef.current = () => {
          window.removeEventListener('scroll', onScroll, true);
        };
      }

      armTimerRef.current = setTimeout(() => {
        if (activeRef.current === state && !state.fired) {
          setPressingKey(key);
        }
      }, armDelayMs);

      fireTimerRef.current = setTimeout(() => {
        if (activeRef.current !== state) return;
        state.fired = true;
        clearTimers();
        setPressingKey(null);
        suppressClickRef.current = {
          key,
          until: Date.now() + 800,
        };
        onLongPress(event);
      }, delayMs);
    },
    [armDelayMs, cancelActive, clearTimers, delayMs, touchOnly],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = activeRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const dist = Math.hypot(
        event.clientX - state.startX,
        event.clientY - state.startY,
      );
      if (dist > moveThresholdPx) {
        cancelActive();
      }
    },
    [cancelActive, moveThresholdPx],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      const state = activeRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      clearTimers();
      setPressingKey(null);
      activeRef.current = null;
    },
    [clearTimers],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent) => {
      const state = activeRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      cancelActive();
    },
    [cancelActive],
  );

  const shouldSuppressClick = useCallback(
    (event: React.MouseEvent, key: TKey): boolean => {
      const suppressed = suppressClickRef.current;
      if (
        suppressed &&
        suppressed.key === key &&
        Date.now() <= suppressed.until
      ) {
        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = null;
        return true;
      }
      return false;
    },
    [],
  );

  const shouldSuppressContextMenu = useCallback(
    (event: React.MouseEvent, key: TKey): boolean => {
      const state = activeRef.current;
      const suppressed = suppressClickRef.current;
      const isTouchContext =
        (state &&
          (state.pointerType === 'touch' || state.pointerType === 'pen')) ||
        (suppressed &&
          suppressed.key === key &&
          Date.now() <= suppressed.until);

      if (isTouchContext) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      return false;
    },
    [],
  );

  const getLongPressProps = useCallback(
    (
      key: TKey,
      callbacks: KeyedLongPressCallbacks,
    ): LongPressBindHandlers => ({
      onPointerDown: (event: React.PointerEvent) =>
        handlePointerDown(event, key, callbacks.disabled, callbacks.onLongPress),
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onClick: (event: React.MouseEvent) => {
        if (shouldSuppressClick(event, key)) return;
        callbacks.onClick?.(event);
      },
      onContextMenu: (event: React.MouseEvent) => {
        if (shouldSuppressContextMenu(event, key)) return;
        callbacks.onContextMenu?.(event);
      },
    }),
    [
      handlePointerCancel,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      shouldSuppressClick,
      shouldSuppressContextMenu,
    ],
  );

  return {
    pressingKey,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    shouldSuppressClick,
    shouldSuppressContextMenu,
    getLongPressProps,
    cancelActive,
  };
}

/**
 * Single-element convenience wrapper around `useKeyedLongPress`.
 */
export function useLongPress(options: UseLongPressOptions) {
  const {
    delayMs,
    armDelayMs,
    moveThresholdPx,
    touchOnly,
    disabled,
    onLongPress,
    onClick,
    onContextMenu,
  } = options;

  const { pressingKey, getLongPressProps, cancelActive } =
    useKeyedLongPress<'single'>({
      delayMs,
      armDelayMs,
      moveThresholdPx,
      touchOnly,
    });

  const handlers = getLongPressProps('single', {
    disabled,
    onLongPress,
    onClick,
    onContextMenu,
  });

  return {
    isPressing: pressingKey === 'single',
    handlers,
    cancel: cancelActive,
  };
}

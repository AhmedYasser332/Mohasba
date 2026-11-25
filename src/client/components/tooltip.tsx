'use client';

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

type TooltipChildProps = React.HTMLAttributes<HTMLElement> & {
  ref?: React.Ref<HTMLElement>;
};

export interface TooltipProps {
  content: string;
  shortcut?: string;
  children: React.ReactElement<TooltipChildProps>;
  disabled?: boolean;
}

interface TooltipCoords {
  top: number;
  left: number;
  ready: boolean;
}

const VIEWPORT_MARGIN = 8;
const GAP_PX = 6;
const HOVER_CLOSE_GRACE_MS = 100;

function subscribeNoop() {
  return () => {};
}

function getClientTrue() {
  return true;
}

function getServerFalse() {
  return false;
}

function assignRef(
  ref: React.Ref<HTMLElement> | undefined,
  node: HTMLElement | null,
) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(node);
  } else {
    (ref as React.MutableRefObject<HTMLElement | null>).current = node;
  }
}

function computeTooltipCoords(
  triggerRect: DOMRect,
  tipRect: DOMRect,
  viewportW: number,
  viewportH: number,
): TooltipCoords {
  let left = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2;
  const maxLeft = Math.max(
    VIEWPORT_MARGIN,
    viewportW - tipRect.width - VIEWPORT_MARGIN,
  );
  left = Math.min(Math.max(VIEWPORT_MARGIN, left), maxLeft);

  let top = triggerRect.bottom + GAP_PX;
  if (top + tipRect.height > viewportH - VIEWPORT_MARGIN) {
    const flippedTop = triggerRect.top - tipRect.height - GAP_PX;
    if (flippedTop >= VIEWPORT_MARGIN) {
      top = flippedTop;
    } else {
      top = Math.max(
        VIEWPORT_MARGIN,
        viewportH - tipRect.height - VIEWPORT_MARGIN,
      );
    }
  }

  return {
    top: Math.round(top),
    left: Math.round(left),
    ready: true,
  };
}

/**
 * Zero-dependency React Portal tooltip with RTL viewport clamping and WCAG 1.4.13 compliance.
 */
export function Tooltip({
  content,
  shortcut,
  children,
  disabled = false,
}: TooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchRef = useRef(false);

  const mounted = useSyncExternalStore(
    subscribeNoop,
    getClientTrue,
    getServerFalse,
  );
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords>({
    top: -9999,
    left: -9999,
    ready: false,
  });

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_GRACE_MS);
  }, [clearCloseTimer]);

  const openImmediately = useCallback(
    (target?: HTMLElement | null) => {
      if (disabled || !content.trim() || isTouchRef.current) return;
      if (target) {
        triggerRef.current = target;
      }
      clearCloseTimer();
      setCoords((prev) => ({ ...prev, ready: false }));
      setOpen(true);
    },
    [clearCloseTimer, content, disabled],
  );

  const closeImmediately = useCallback(() => {
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer]);

  const effectiveOpen = open && !disabled && content.trim().length > 0;

  useLayoutEffect(() => {
    if (!effectiveOpen || !triggerRef.current || !tipRef.current) return;

    const updatePosition = () => {
      if (!triggerRef.current || !tipRef.current) return;
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tipRect = tipRef.current.getBoundingClientRect();
      setCoords(
        computeTooltipCoords(
          triggerRect,
          tipRect,
          window.innerWidth,
          window.innerHeight,
        ),
      );
    };

    updatePosition();

    const handleScrollOrResize = () => {
      closeImmediately();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeImmediately();
      }
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeImmediately, content, effectiveOpen, shortcut]);

  const childProps = children.props;
  const existingDescribedBy = childProps['aria-describedby'];
  const mergedDescribedBy = effectiveOpen
    ? existingDescribedBy
      ? `${existingDescribedBy} ${tooltipId}`
      : tooltipId
    : existingDescribedBy;

  const enhancedChild = React.cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef(childProps.ref, node);
    },
    'aria-describedby': mergedDescribedBy,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      isTouchRef.current = e.pointerType === 'touch';
      if (isTouchRef.current) {
        closeImmediately();
      }
      childProps.onPointerDown?.(e);
    },
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      isTouchRef.current = e.pointerType === 'touch';
      childProps.onPointerEnter?.(e);
    },
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      openImmediately(e.currentTarget);
      childProps.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      scheduleClose();
      childProps.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (!isTouchRef.current) {
        let isFocusVisible = true;
        try {
          isFocusVisible = e.currentTarget.matches(':focus-visible');
        } catch {
          isFocusVisible = true;
        }
        if (isFocusVisible) {
          openImmediately(e.currentTarget);
        }
      }
      childProps.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      closeImmediately();
      childProps.onBlur?.(e);
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      closeImmediately();
      childProps.onClick?.(e);
    },
  });

  return (
    <>
      {enhancedChild}
      {mounted &&
        effectiveOpen &&
        createPortal(
          <div
            ref={tipRef}
            id={tooltipId}
            role="tooltip"
            className={`portal-tooltip ${coords.ready ? 'is-ready' : ''}`}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
          >
            <span className="portal-tooltip-text">{content}</span>
            {shortcut && (
              <kbd className="portal-tooltip-kbd nums" dir="ltr">
                {shortcut}
              </kbd>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

'use client';

import React, { useCallback, useEffect, useRef } from 'react';

export interface AppDialogProps {
  open: boolean;
  onRequestClose: () => void;
  /** Called when the browser closes the native <dialog> directly (e.g. repeated Esc). Defaults to onRequestClose. */
  onNativeClose?: () => void;
  /** When false, Esc and outside-backdrop dismissal are blocked (e.g. while an async save/reset is busy). */
  canDismiss?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
  children: React.ReactNode;
}

/**
 * Thin wrapper around native <dialog> + showModal() that centralizes:
 * - React `open` state synchronization (including `onClose` for Chromium repeated-Esc)
 * - Pointer-rect bounds outside dismissal (prevents text-selection drag from closing)
 * - Optional dismissal lock (`canDismiss`) and initial focus target
 */
export const AppDialog = React.forwardRef<HTMLDialogElement, AppDialogProps>(
  function AppDialog(
    {
      open,
      onRequestClose,
      onNativeClose,
      canDismiss = true,
      initialFocusRef,
      className = 'app-dialog',
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      'data-testid': dataTestId,
      children,
    },
    forwardedRef,
  ) {
    const dialogRef = useRef<HTMLDialogElement | null>(null);
    const pointerDownOutsideRef = useRef(false);

    const setRefs = useCallback(
      (node: HTMLDialogElement | null) => {
        dialogRef.current = node;
        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    useEffect(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      pointerDownOutsideRef.current = false;
      if (open) {
        if (!dialog.open) {
          dialog.showModal();
        }
        initialFocusRef?.current?.focus();
      } else if (dialog.open) {
        dialog.close();
      }
    }, [open, initialFocusRef]);

    const isOutsideDialog = (
      e: React.PointerEvent<HTMLDialogElement>,
    ): boolean => {
      const dialog = dialogRef.current;
      if (!dialog) return false;
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };

    return (
      <dialog
        ref={setRefs}
        className={className}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        data-testid={dataTestId}
        onCancel={(e) => {
          e.preventDefault();
          if (canDismiss) {
            onRequestClose();
          }
        }}
        onPointerDown={(e) => {
          pointerDownOutsideRef.current = isOutsideDialog(e);
        }}
        onPointerCancel={() => {
          pointerDownOutsideRef.current = false;
        }}
        onPointerUp={(e) => {
          const startedOutside = pointerDownOutsideRef.current;
          pointerDownOutsideRef.current = false;
          if (startedOutside && isOutsideDialog(e) && canDismiss) {
            onRequestClose();
          }
        }}
        onClose={() => {
          if (open && canDismiss) {
            (onNativeClose ?? onRequestClose)();
          }
        }}
      >
        {children}
      </dialog>
    );
  },
);

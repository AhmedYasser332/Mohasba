'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type PointerDndDropPosition = 'before' | 'after' | 'into';
export type PointerDndDirection = 'up' | 'down';

export interface PointerDndReorderUpdate {
  id: string;
  groupId: string;
  sortOrder: number;
}

export interface PointerDndReorderPayload {
  activeId: string;
  fromGroupId: string;
  toGroupId: string;
  /** Final ordered item IDs in the destination group. */
  targetGroupItemIds: string[];
  /** Final ordered item IDs in the source group (equals targetGroupItemIds when intra-group). */
  sourceGroupItemIds: string[];
  /** 0-based index of activeId inside targetGroupItemIds. */
  toIndex: number;
  /** Affected items with updated groupId and 1-based sortOrder ready for `reorderSchema`. */
  updates: PointerDndReorderUpdate[];
}

export interface PointerDragState {
  isDragging: boolean;
  activeId: string | null;
  activeLabel: string;
  fromGroupId: string | null;
  overItemId: string | null;
  overGroupId: string | null;
  dropPosition: PointerDndDropPosition | null;
  pointerX: number;
  pointerY: number;
}

export interface UsePointerDndOptions<TItem> {
  items: readonly TItem[];
  getId: (item: TItem) => string;
  getGroupId: (item: TItem) => string;
  /** Optional item title used for the floating ghost and Arabic aria-live announcements. */
  getLabel?: (item: TItem) => string;
  /** Ordered list of all group IDs (enables keyboard/pointer moves into empty or collapsed groups). */
  groupOrder?: readonly string[];
  /** Optional group title getter for Arabic aria-live announcements. */
  getGroupLabel?: (groupId: string) => string;
  /** Optional predicate identifying collapsed groups (triggers 400ms auto-expand on hover). */
  isGroupCollapsed?: (groupId: string) => boolean;
  /** Allow dragging/moving items across different groupIds. Default: true. */
  allowCrossGroup?: boolean;
  /** Disable pointer drag & keyboard reorder (e.g., offline or dense mode). Default: false. */
  disabled?: boolean;
  /** Pointer movement threshold in px before drag activates. Default: 6 (>5px). */
  activationDistancePx?: number;
  /** Hover delay in ms before auto-expanding a collapsed target group. Default: 400ms. */
  autoExpandDelayMs?: number;
  /** Invoked when a drag or Alt+Arrow keyboard move produces a real order/group change. */
  onReorder: (payload: PointerDndReorderPayload) => void | Promise<void>;
  /** Invoked after hovering over a collapsed group for `autoExpandDelayMs` during drag. */
  onHoverCollapsedGroup?: (groupId: string) => void;
}

export interface PointerDndHandleProps {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  disabled: boolean;
  'aria-roledescription': string;
  'aria-disabled': boolean;
  'data-dnd-handle': 'true';
  style: React.CSSProperties;
}

export interface PointerDndItemProps {
  ref: (element: HTMLElement | null) => void;
  'data-dnd-item-id': string;
  'data-dnd-group-id': string;
  'data-dnd-dragging'?: 'true';
  'data-dnd-drop-position'?: 'before' | 'after';
}

export interface PointerDndGroupDropProps {
  ref: (element: HTMLElement | null) => void;
  'data-dnd-group-drop': string;
  'data-dnd-group-over'?: 'true';
}

const INITIAL_DRAG_STATE: PointerDragState = {
  isDragging: false,
  activeId: null,
  activeLabel: '',
  fromGroupId: null,
  overItemId: null,
  overGroupId: null,
  dropPosition: null,
  pointerX: 0,
  pointerY: 0,
};

const EDGE_SCROLL_ZONE_PX = 48;
const EDGE_SCROLL_MAX_STEP_PX = 14;
const GAP_SNAP_TOLERANCE_PX = 36;

interface PendingSession {
  activeId: string;
  activeLabel: string;
  fromGroupId: string;
  pointerId: number;
  startX: number;
  startY: number;
  isDragging: boolean;
  captureEl: HTMLElement | null;
}

function buildGroupBuckets<TItem>(
  items: readonly TItem[],
  getId: (item: TItem) => string,
  getGroupId: (item: TItem) => string,
  groupOrder?: readonly string[],
): { buckets: Map<string, string[]>; orderedGroups: string[] } {
  const buckets = new Map<string, string[]>();
  const orderedGroups: string[] = [];

  if (groupOrder) {
    for (const gid of groupOrder) {
      if (!buckets.has(gid)) {
        buckets.set(gid, []);
        orderedGroups.push(gid);
      }
    }
  }

  for (const item of items) {
    const id = getId(item);
    const gid = getGroupId(item);
    let list = buckets.get(gid);
    if (!list) {
      list = [];
      buckets.set(gid, list);
      orderedGroups.push(gid);
    }
    list.push(id);
  }

  return { buckets, orderedGroups };
}

function buildReorderPayload(params: {
  activeId: string;
  fromGroupId: string;
  toGroupId: string;
  buckets: Map<string, string[]>;
  insertIndex: number;
}): PointerDndReorderPayload | null {
  const { activeId, fromGroupId, toGroupId, buckets, insertIndex } = params;
  const originalFrom = buckets.get(fromGroupId) ?? [];
  const originalIdx = originalFrom.indexOf(activeId);
  if (originalIdx === -1) return null;

  if (fromGroupId === toGroupId) {
    const remaining = originalFrom.filter((id) => id !== activeId);
    const clampedIdx = Math.max(0, Math.min(insertIndex, remaining.length));
    const nextOrder = [
      ...remaining.slice(0, clampedIdx),
      activeId,
      ...remaining.slice(clampedIdx),
    ];

    const unchanged =
      nextOrder.length === originalFrom.length &&
      nextOrder.every((id, i) => id === originalFrom[i]);
    if (unchanged) return null;

    const updates: PointerDndReorderUpdate[] = nextOrder.map((id, i) => ({
      id,
      groupId: toGroupId,
      sortOrder: i + 1,
    }));

    return {
      activeId,
      fromGroupId,
      toGroupId,
      targetGroupItemIds: nextOrder,
      sourceGroupItemIds: nextOrder,
      toIndex: clampedIdx,
      updates,
    };
  }

  const nextSource = originalFrom.filter((id) => id !== activeId);
  const originalTarget = buckets.get(toGroupId) ?? [];
  const cleanTarget = originalTarget.filter((id) => id !== activeId);
  const clampedIdx = Math.max(0, Math.min(insertIndex, cleanTarget.length));
  const nextTarget = [
    ...cleanTarget.slice(0, clampedIdx),
    activeId,
    ...cleanTarget.slice(clampedIdx),
  ];

  const updates: PointerDndReorderUpdate[] = [
    ...nextTarget.map((id, i) => ({
      id,
      groupId: toGroupId,
      sortOrder: i + 1,
    })),
    ...nextSource.map((id, i) => ({
      id,
      groupId: fromGroupId,
      sortOrder: i + 1,
    })),
  ];

  return {
    activeId,
    fromGroupId,
    toGroupId,
    targetGroupItemIds: nextTarget,
    sourceGroupItemIds: nextSource,
    toIndex: clampedIdx,
    updates,
  };
}

/**
 * Zero-dependency Pointer Events + Keyboard (WCAG 2.5.7) drag-and-drop hook
 * shared across the Weekly Matrix and Settings (Periods & Actions).
 */
export function usePointerDnd<TItem>(options: UsePointerDndOptions<TItem>) {
  const {
    items,
    getId,
    getGroupId,
    getLabel,
    groupOrder,
    getGroupLabel,
    isGroupCollapsed,
    allowCrossGroup = true,
    disabled = false,
    activationDistancePx = 6,
    autoExpandDelayMs = 400,
    onReorder,
    onHoverCollapsedGroup,
  } = options;

  const [dragState, setDragState] = useState<PointerDragState>(INITIAL_DRAG_STATE);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');

  const itemElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const groupElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const itemRefCallbacksRef = useRef<
    Map<string, (el: HTMLElement | null) => void>
  >(new Map());
  const groupRefCallbacksRef = useRef<
    Map<string, (el: HTMLElement | null) => void>
  >(new Map());

  const sessionRef = useRef<PendingSession | null>(null);
  const dragStateRef = useRef<PointerDragState>(INITIAL_DRAG_STATE);
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandGroupIdRef = useRef<string | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const lastPointerYRef = useRef<number>(0);

  // Keep latest callbacks/data accessible to window event listeners without rebinding mid-drag
  const latestRef = useRef({
    items,
    getId,
    getGroupId,
    getLabel,
    groupOrder,
    getGroupLabel,
    isGroupCollapsed,
    allowCrossGroup,
    disabled,
    activationDistancePx,
    autoExpandDelayMs,
    onReorder,
    onHoverCollapsedGroup,
  });

  useEffect(() => {
    latestRef.current = {
      items,
      getId,
      getGroupId,
      getLabel,
      groupOrder,
      getGroupLabel,
      isGroupCollapsed,
      allowCrossGroup,
      disabled,
      activationDistancePx,
      autoExpandDelayMs,
      onReorder,
      onHoverCollapsedGroup,
    };
  });

  const itemById = useMemo(() => {
    const map = new Map<string, TItem>();
    for (const item of items) {
      map.set(getId(item), item);
    }
    return map;
  }, [getId, items]);

  const setSyncedDragState = useCallback((next: PointerDragState) => {
    dragStateRef.current = next;
    setDragState(next);
  }, []);

  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimerRef.current !== null) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
    autoExpandGroupIdRef.current = null;
  }, []);

  const stopEdgeAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  const announceMove = useCallback(
    (itemId: string, toGroupId: string, toIndex: number) => {
      const cfg = latestRef.current;
      const item = cfg.items.find((x) => cfg.getId(x) === itemId);
      const label = item && cfg.getLabel ? cfg.getLabel(item) : '';
      const groupLabel = cfg.getGroupLabel ? cfg.getGroupLabel(toGroupId) : '';
      const pos = toIndex + 1;

      let message: string;
      if (label && groupLabel) {
        message = `تم نقل «${label}» إلى الموضع ${pos} داخل «${groupLabel}»`;
      } else if (label) {
        message = `تم نقل «${label}» إلى الموضع ${pos}`;
      } else if (groupLabel) {
        message = `تم نقل العنصر إلى الموضع ${pos} داخل «${groupLabel}»`;
      } else {
        message = `تم نقل العنصر إلى الموضع ${pos}`;
      }

      // Toggle briefly if identical so assistive tech re-announces consecutive moves
      setLiveAnnouncement((prev) => (prev === message ? `${message} ` : message));
    },
    [],
  );

  const scheduleAutoExpandIfNeeded = useCallback(
    (overGroupId: string | null) => {
      const cfg = latestRef.current;
      if (!overGroupId || !cfg.onHoverCollapsedGroup) {
        clearAutoExpandTimer();
        return;
      }

      const collapsed = cfg.isGroupCollapsed
        ? cfg.isGroupCollapsed(overGroupId)
        : false;
      if (!collapsed) {
        clearAutoExpandTimer();
        return;
      }

      if (autoExpandGroupIdRef.current === overGroupId) {
        return;
      }

      clearAutoExpandTimer();
      autoExpandGroupIdRef.current = overGroupId;
      autoExpandTimerRef.current = setTimeout(() => {
        autoExpandTimerRef.current = null;
        if (
          sessionRef.current?.isDragging &&
          autoExpandGroupIdRef.current === overGroupId
        ) {
          latestRef.current.onHoverCollapsedGroup?.(overGroupId);
        }
      }, cfg.autoExpandDelayMs);
    },
    [clearAutoExpandTimer],
  );

  const computeHitTarget = useCallback(
    (
      clientX: number,
      clientY: number,
      activeId: string,
      fromGroupId: string,
    ): {
      overItemId: string | null;
      overGroupId: string | null;
      dropPosition: PointerDndDropPosition | null;
    } => {
      const cfg = latestRef.current;
      const groupByItemId = new Map<string, string>();
      for (const item of cfg.items) {
        groupByItemId.set(cfg.getId(item), cfg.getGroupId(item));
      }

      // 1. Direct hit or nearest visible item row
      let bestItem: {
        id: string;
        groupId: string;
        pos: 'before' | 'after';
        dist: number;
      } | null = null;

      for (const [id, el] of itemElementsRef.current.entries()) {
        const gid = groupByItemId.get(id);
        if (!gid) continue;
        if (!cfg.allowCrossGroup && gid !== fromGroupId) continue;

        const rect = el.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue;

        // Ignore items horizontally far away (e.g. separate side columns)
        const horizPad = 64;
        if (clientX < rect.left - horizPad || clientX > rect.right + horizPad) {
          continue;
        }

        const midY = rect.top + rect.height / 2;
        const insideY = clientY >= rect.top && clientY <= rect.bottom;
        const dist = insideY
          ? 0
          : Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));

        if (dist <= GAP_SNAP_TOLERANCE_PX) {
          if (
            !bestItem ||
            dist < bestItem.dist ||
            (dist === bestItem.dist &&
              Math.abs(clientY - midY) <
                Math.abs(
                  clientY -
                    (itemElementsRef.current
                      .get(bestItem.id)!
                      .getBoundingClientRect().top +
                      itemElementsRef.current
                        .get(bestItem.id)!
                        .getBoundingClientRect().height /
                        2),
                ))
          ) {
            bestItem = {
              id,
              groupId: gid,
              pos: clientY < midY ? 'before' : 'after',
              dist,
            };
          }
        }
      }

      if (bestItem && bestItem.dist === 0) {
        return {
          overItemId: bestItem.id,
          overGroupId: bestItem.groupId,
          dropPosition: bestItem.id === activeId ? null : bestItem.pos,
        };
      }

      // 2. Direct hit on a group drop header/container (handles collapsed or empty groups)
      let bestGroup: { gid: string; dist: number } | null = null;
      for (const [gid, el] of groupElementsRef.current.entries()) {
        if (!cfg.allowCrossGroup && gid !== fromGroupId) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue;

        const horizPad = 64;
        if (clientX < rect.left - horizPad || clientX > rect.right + horizPad) {
          continue;
        }

        const insideY = clientY >= rect.top && clientY <= rect.bottom;
        const dist = insideY
          ? 0
          : Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));

        if (dist <= GAP_SNAP_TOLERANCE_PX) {
          if (!bestGroup || dist < bestGroup.dist) {
            bestGroup = { gid, dist };
          }
        }
      }

      if (bestGroup && bestGroup.dist === 0) {
        return {
          overItemId: null,
          overGroupId: bestGroup.gid,
          dropPosition: 'into',
        };
      }

      // 3. Snap to closest item or group within gap tolerance
      if (bestItem && (!bestGroup || bestItem.dist <= bestGroup.dist)) {
        return {
          overItemId: bestItem.id,
          overGroupId: bestItem.groupId,
          dropPosition: bestItem.id === activeId ? null : bestItem.pos,
        };
      }

      if (bestGroup) {
        return {
          overItemId: null,
          overGroupId: bestGroup.gid,
          dropPosition: 'into',
        };
      }

      return {
        overItemId: null,
        overGroupId: null,
        dropPosition: null,
      };
    },
    [],
  );

  const cleanupSession = useCallback(() => {
    const sess = sessionRef.current;
    if (sess?.captureEl) {
      try {
        if (sess.captureEl.hasPointerCapture(sess.pointerId)) {
          sess.captureEl.releasePointerCapture(sess.pointerId);
        }
      } catch {
        // ignore release errors if element unmounted
      }
    }
    sessionRef.current = null;
    clearAutoExpandTimer();
    stopEdgeAutoScroll();
    setSyncedDragState(INITIAL_DRAG_STATE);
  }, [clearAutoExpandTimer, setSyncedDragState, stopEdgeAutoScroll]);

  const startEdgeAutoScrollLoop = useCallback(() => {
    if (scrollRafRef.current !== null || typeof window === 'undefined') return;
    const step = () => {
      if (!sessionRef.current?.isDragging) {
        scrollRafRef.current = null;
        return;
      }
      const y = lastPointerYRef.current;
      const vh = window.innerHeight;
      let delta = 0;
      if (y < EDGE_SCROLL_ZONE_PX) {
        const ratio = (EDGE_SCROLL_ZONE_PX - y) / EDGE_SCROLL_ZONE_PX;
        delta = -Math.max(4, Math.round(ratio * EDGE_SCROLL_MAX_STEP_PX));
      } else if (y > vh - EDGE_SCROLL_ZONE_PX) {
        const ratio = (y - (vh - EDGE_SCROLL_ZONE_PX)) / EDGE_SCROLL_ZONE_PX;
        delta = Math.max(4, Math.round(ratio * EDGE_SCROLL_MAX_STEP_PX));
      }
      if (delta !== 0) {
        window.scrollBy(0, delta);
      }
      scrollRafRef.current = requestAnimationFrame(step);
    };
    scrollRafRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const sess = sessionRef.current;
      if (!sess || event.pointerId !== sess.pointerId) return;

      lastPointerYRef.current = event.clientY;

      if (!sess.isDragging) {
        const dist = Math.hypot(
          event.clientX - sess.startX,
          event.clientY - sess.startY,
        );
        if (dist <= latestRef.current.activationDistancePx) {
          return;
        }
        sess.isDragging = true;
        startEdgeAutoScrollLoop();
      }

      event.preventDefault();
      const hit = computeHitTarget(
        event.clientX,
        event.clientY,
        sess.activeId,
        sess.fromGroupId,
      );

      scheduleAutoExpandIfNeeded(hit.overGroupId);

      setSyncedDragState({
        isDragging: true,
        activeId: sess.activeId,
        activeLabel: sess.activeLabel,
        fromGroupId: sess.fromGroupId,
        overItemId: hit.overItemId,
        overGroupId: hit.overGroupId,
        dropPosition: hit.dropPosition,
        pointerX: event.clientX,
        pointerY: event.clientY,
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      const sess = sessionRef.current;
      if (!sess || event.pointerId !== sess.pointerId) return;

      const wasDragging = sess.isDragging;
      const finalDrag = dragStateRef.current;
      cleanupSession();

      if (!wasDragging) return;

      const cfg = latestRef.current;
      const toGroupId = finalDrag.overGroupId ?? sess.fromGroupId;
      if (!cfg.allowCrossGroup && toGroupId !== sess.fromGroupId) {
        return;
      }

      const { buckets } = buildGroupBuckets(
        cfg.items,
        cfg.getId,
        cfg.getGroupId,
        cfg.groupOrder,
      );

      const rawTargetIds = buckets.get(toGroupId) ?? [];
      const targetWithoutActive = rawTargetIds.filter(
        (id) => id !== sess.activeId,
      );

      let insertIndex = targetWithoutActive.length;
      if (
        finalDrag.overItemId &&
        finalDrag.overItemId !== sess.activeId &&
        (finalDrag.dropPosition === 'before' ||
          finalDrag.dropPosition === 'after')
      ) {
        const overIdx = targetWithoutActive.indexOf(finalDrag.overItemId);
        if (overIdx !== -1) {
          insertIndex =
            finalDrag.dropPosition === 'after' ? overIdx + 1 : overIdx;
        }
      }

      const payload = buildReorderPayload({
        activeId: sess.activeId,
        fromGroupId: sess.fromGroupId,
        toGroupId,
        buckets,
        insertIndex,
      });

      if (payload) {
        announceMove(payload.activeId, payload.toGroupId, payload.toIndex);
        void cfg.onReorder(payload);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      const sess = sessionRef.current;
      if (!sess || event.pointerId !== sess.pointerId) return;
      cleanupSession();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sessionRef.current) {
        event.preventDefault();
        cleanupSession();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      clearAutoExpandTimer();
      stopEdgeAutoScroll();
    };
  }, [
    announceMove,
    cleanupSession,
    clearAutoExpandTimer,
    computeHitTarget,
    scheduleAutoExpandIfNeeded,
    setSyncedDragState,
    startEdgeAutoScrollLoop,
    stopEdgeAutoScroll,
  ]);

  const handleKeyboardMove = useCallback(
    (id: string, direction: PointerDndDirection): boolean => {
      const cfg = latestRef.current;
      if (cfg.disabled) return false;

      const item = cfg.items.find((x) => cfg.getId(x) === id);
      if (!item) return false;

      const fromGroupId = cfg.getGroupId(item);
      const { buckets, orderedGroups } = buildGroupBuckets(
        cfg.items,
        cfg.getId,
        cfg.getGroupId,
        cfg.groupOrder,
      );

      const currentList = buckets.get(fromGroupId) ?? [];
      const currentIdx = currentList.indexOf(id);
      if (currentIdx === -1) return false;

      let toGroupId = fromGroupId;
      let insertIndex = currentIdx;

      if (direction === 'up') {
        if (currentIdx > 0) {
          insertIndex = currentIdx - 1;
        } else if (cfg.allowCrossGroup) {
          const groupIdx = orderedGroups.indexOf(fromGroupId);
          if (groupIdx <= 0) return false;
          toGroupId = orderedGroups[groupIdx - 1]!;
          insertIndex = (buckets.get(toGroupId) ?? []).length;
          if (cfg.isGroupCollapsed?.(toGroupId)) {
            cfg.onHoverCollapsedGroup?.(toGroupId);
          }
        } else {
          return false;
        }
      } else {
        if (currentIdx < currentList.length - 1) {
          insertIndex = currentIdx + 1;
        } else if (cfg.allowCrossGroup) {
          const groupIdx = orderedGroups.indexOf(fromGroupId);
          if (groupIdx === -1 || groupIdx >= orderedGroups.length - 1) {
            return false;
          }
          toGroupId = orderedGroups[groupIdx + 1]!;
          insertIndex = 0;
          if (cfg.isGroupCollapsed?.(toGroupId)) {
            cfg.onHoverCollapsedGroup?.(toGroupId);
          }
        } else {
          return false;
        }
      }

      const payload = buildReorderPayload({
        activeId: id,
        fromGroupId,
        toGroupId,
        buckets,
        insertIndex,
      });

      if (!payload) return false;
      announceMove(payload.activeId, payload.toGroupId, payload.toIndex);
      void cfg.onReorder(payload);
      return true;
    },
    [announceMove],
  );

  const getHandleProps = useCallback(
    (id: string): PointerDndHandleProps => ({
      disabled,
      'aria-roledescription': 'مقبض إعادة الترتيب',
      'aria-disabled': disabled,
      'data-dnd-handle': 'true',
      style: { touchAction: 'none' },
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (latestRef.current.disabled) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        const item = itemById.get(id);
        if (!item) return;

        const fromGroupId = latestRef.current.getGroupId(item);
        const activeLabel = latestRef.current.getLabel
          ? latestRef.current.getLabel(item)
          : '';

        event.stopPropagation();

        const targetEl = event.currentTarget;
        try {
          targetEl.setPointerCapture(event.pointerId);
        } catch {
          // ignore if capture unsupported
        }

        lastPointerYRef.current = event.clientY;
        sessionRef.current = {
          activeId: id,
          activeLabel,
          fromGroupId,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          isDragging: false,
          captureEl: targetEl,
        };
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (latestRef.current.disabled) return;
        if (event.altKey && !event.ctrlKey && !event.metaKey) {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            handleKeyboardMove(id, 'up');
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            handleKeyboardMove(id, 'down');
          }
        }
      },
    }),
    [disabled, handleKeyboardMove, itemById],
  );

  const getItemProps = useCallback(
    (id: string): PointerDndItemProps => {
      let refCb = itemRefCallbacksRef.current.get(id);
      if (!refCb) {
        refCb = (el: HTMLElement | null) => {
          if (el) {
            itemElementsRef.current.set(id, el);
          } else {
            itemElementsRef.current.delete(id);
          }
        };
        itemRefCallbacksRef.current.set(id, refCb);
      }

      const item = itemById.get(id);
      const groupId = item ? getGroupId(item) : '';
      const isDraggingThis = dragState.isDragging && dragState.activeId === id;
      const dropPosForThis =
        dragState.isDragging &&
        dragState.overItemId === id &&
        dragState.activeId !== id &&
        (dragState.dropPosition === 'before' ||
          dragState.dropPosition === 'after')
          ? dragState.dropPosition
          : undefined;

      return {
        ref: refCb,
        'data-dnd-item-id': id,
        'data-dnd-group-id': groupId,
        ...(isDraggingThis ? { 'data-dnd-dragging': 'true' as const } : {}),
        ...(dropPosForThis ? { 'data-dnd-drop-position': dropPosForThis } : {}),
      };
    },
    [dragState, getGroupId, itemById],
  );

  const getGroupDropProps = useCallback(
    (groupId: string): PointerDndGroupDropProps => {
      let refCb = groupRefCallbacksRef.current.get(groupId);
      if (!refCb) {
        refCb = (el: HTMLElement | null) => {
          if (el) {
            groupElementsRef.current.set(groupId, el);
          } else {
            groupElementsRef.current.delete(groupId);
          }
        };
        groupRefCallbacksRef.current.set(groupId, refCb);
      }

      const isOverGroup =
        dragState.isDragging && dragState.overGroupId === groupId;

      return {
        ref: refCb,
        'data-dnd-group-drop': groupId,
        ...(isOverGroup ? { 'data-dnd-group-over': 'true' as const } : {}),
      };
    },
    [dragState],
  );

  return {
    dragState,
    getHandleProps,
    getItemProps,
    getGroupDropProps,
    handleKeyboardMove,
    liveAnnouncement,
  };
}

/**
 * Compact portal floating drag ghost pill (zero wobble/tilt gimmicks, Al-Mizan Al-Ma'dani).
 */
export function PointerDragGhost({
  dragState,
}: {
  dragState: PointerDragState;
}) {
  if (
    !dragState.isDragging ||
    !dragState.activeLabel ||
    typeof document === 'undefined'
  ) {
    return null;
  }

  return createPortal(
    React.createElement(
      'div',
      {
        className: 'dnd-drag-ghost',
        role: 'presentation',
        'aria-hidden': 'true',
        style: {
          position: 'fixed',
          insetBlockStart: `${Math.round(dragState.pointerY + 12)}px`,
          left: `${Math.round(dragState.pointerX)}px`,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          zIndex: 80,
        },
      },
      dragState.activeLabel,
    ),
    document.body,
  );
}

'use client';

import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import {
  useCrosshairPrefs,
  type CrosshairPreferences,
} from '../../utils/crosshair-prefs';

export interface CrosshairFocusTarget {
  rowIndex: number;
  colIndex: number;
}

interface CrosshairParticipant {
  setSuppressed: (suppressed: boolean) => void;
}

export interface CrosshairCoordinator {
  register: (id: string, participant: CrosshairParticipant) => void;
  unregister: (id: string) => void;
  enter: (id: string) => void;
  leave: (id: string) => void;
  isSuppressed: (id: string) => boolean;
}

export function createCrosshairCoordinator(): CrosshairCoordinator {
  const participants = new Map<string, CrosshairParticipant>();
  let hoveredId: string | null = null;

  const broadcast = () => {
    for (const [id, participant] of participants) {
      participant.setSuppressed(hoveredId !== null && hoveredId !== id);
    }
  };

  return {
    register(id, participant) {
      participants.set(id, participant);
      participant.setSuppressed(hoveredId !== null && hoveredId !== id);
    },
    unregister(id) {
      participants.delete(id);
      if (hoveredId === id) {
        hoveredId = null;
        broadcast();
      }
    },
    enter(id) {
      if (hoveredId === id) return;
      hoveredId = id;
      broadcast();
    },
    leave(id) {
      if (hoveredId !== id) return;
      hoveredId = null;
      broadcast();
    },
    isSuppressed(id) {
      return hoveredId !== null && hoveredId !== id;
    },
  };
}

interface RowGeom {
  rowIndex: number;
  top: number;
  bottom: number;
  height: number;
}

interface ColGeom {
  colIndex: number;
  left: number;
  right: number;
  width: number;
}

interface TableGeometry {
  headHeight: number;
  bodyTop: number;
  bodyHeight: number;
  rowLeft: number;
  rowWidth: number;
  dayBandLeft: number;
  dayBandRight: number;
  cols: ColGeom[];
  colsByIndex: Map<number, ColGeom>;
  rows: RowGeom[];
  rowsByIndex: Map<number, RowGeom>;
}

const EMPTY_GEOMETRY: TableGeometry = {
  headHeight: 0,
  bodyTop: 0,
  bodyHeight: 0,
  rowLeft: 0,
  rowWidth: 0,
  dayBandLeft: 0,
  dayBandRight: 0,
  cols: [],
  colsByIndex: new Map(),
  rows: [],
  rowsByIndex: new Map(),
};

/** Max pixel gap treated as a cell seam or One-Glance period spacer (held smoothly without flicker). */
const MAX_SPACER_GAP_PX = 7;

function measureStageGeometry(
  stage: HTMLElement,
  coverPeriodColumn: boolean,
): TableGeometry {
  const table = stage.querySelector<HTMLTableElement>('table.ledger-table');
  if (!table) return EMPTY_GEOMETRY;

  const stageRect = stage.getBoundingClientRect();
  if (stageRect.width <= 0 || stageRect.height <= 0) {
    return EMPTY_GEOMETRY;
  }

  const theadRect = table.tHead?.getBoundingClientRect();
  const headHeight = theadRect ? theadRect.height : 0;
  const bodyTop = theadRect ? Math.max(0, theadRect.bottom - stageRect.top) : 0;
  const bodyHeight = Math.max(0, stageRect.height - bodyTop);

  const cols: ColGeom[] = [];
  const colsByIndex = new Map<number, ColGeom>();
  let dayBandLeft = Infinity;
  let dayBandRight = -Infinity;

  const headerCells = table.querySelectorAll<HTMLTableCellElement>(
    'thead th.col-day[data-col-index]',
  );
  for (const th of headerCells) {
    const colIndex = Number(th.dataset.colIndex);
    if (!Number.isFinite(colIndex)) continue;
    const rect = th.getBoundingClientRect();
    if (rect.width <= 0) continue;
    const left = rect.left - stageRect.left;
    const right = rect.right - stageRect.left;
    const geom: ColGeom = { colIndex, left, right, width: rect.width };
    cols.push(geom);
    colsByIndex.set(colIndex, geom);
    if (left < dayBandLeft) dayBandLeft = left;
    if (right > dayBandRight) dayBandRight = right;
  }

  const rows: RowGeom[] = [];
  const rowsByIndex = new Map<number, RowGeom>();
  let rowLeft = 0;
  let rowWidth = stageRect.width;
  let measuredRowSpan = false;

  const rowEls = table.querySelectorAll<HTMLTableRowElement>(
    'tbody tr.data-row[data-grid-row]',
  );
  for (const tr of rowEls) {
    const rowIndex = Number(tr.dataset.gridRow);
    if (!Number.isFinite(rowIndex)) continue;
    const rect = tr.getBoundingClientRect();
    if (rect.height <= 0) continue;

    if (!measuredRowSpan) {
      if (coverPeriodColumn) {
        rowLeft = 0;
        rowWidth = stageRect.width;
      } else {
        let minLeft = Infinity;
        let maxRight = -Infinity;
        for (const cell of Array.from(tr.cells)) {
          if (cell.classList.contains('cell-period')) continue;
          const cRect = cell.getBoundingClientRect();
          if (cRect.width <= 0) continue;
          const l = cRect.left - stageRect.left;
          const r = cRect.right - stageRect.left;
          if (l < minLeft) minLeft = l;
          if (r > maxRight) maxRight = r;
        }
        if (
          Number.isFinite(minLeft) &&
          Number.isFinite(maxRight) &&
          maxRight > minLeft
        ) {
          rowLeft = minLeft;
          rowWidth = maxRight - minLeft;
        }
      }
      measuredRowSpan = true;
    }

    const geom: RowGeom = {
      rowIndex,
      top: rect.top - stageRect.top,
      bottom: rect.bottom - stageRect.top,
      height: rect.height,
    };
    rows.push(geom);
    rowsByIndex.set(rowIndex, geom);
  }

  return {
    headHeight,
    bodyTop,
    bodyHeight,
    rowLeft,
    rowWidth,
    dayBandLeft: Number.isFinite(dayBandLeft) ? dayBandLeft : 0,
    dayBandRight: Number.isFinite(dayBandRight) ? dayBandRight : 0,
    cols,
    colsByIndex,
    rows,
    rowsByIndex,
  };
}

function findColAtX(geo: TableGeometry, x: number): ColGeom | null {
  if (geo.cols.length === 0 || x < geo.dayBandLeft || x > geo.dayBandRight) {
    return null;
  }
  let closest: ColGeom | null = null;
  let closestDist = Infinity;
  for (const col of geo.cols) {
    if (x >= col.left && x <= col.right) {
      return col;
    }
    const center = col.left + col.width / 2;
    const dist = Math.abs(x - center);
    if (dist < closestDist) {
      closestDist = dist;
      closest = col;
    }
  }
  return closest;
}

function findRowAtY(
  geo: TableGeometry,
  y: number,
  allowSpacerBridge: boolean,
): RowGeom | null {
  const { rows } = geo;
  if (rows.length === 0) return null;
  if (y < rows[0]!.top || y > rows[rows.length - 1]!.bottom) {
    return null;
  }

  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = rows[mid]!;
    if (y < r.top) {
      hi = mid - 1;
    } else if (y > r.bottom) {
      lo = mid + 1;
    } else {
      return r;
    }
  }

  // Pointer fell between rows[hi] and rows[lo]
  if (allowSpacerBridge && hi >= 0 && lo < rows.length) {
    const above = rows[hi]!;
    const below = rows[lo]!;
    const gap = below.top - above.bottom;
    if (gap <= MAX_SPACER_GAP_PX) {
      return y - above.bottom <= below.top - y ? above : below;
    }
  }
  return null;
}

interface TableCrosshairStageProps {
  coordinator: CrosshairCoordinator;
  focusTarget: CrosshairFocusTarget | null;
  layoutKey: string;
  children: React.ReactNode;
}

export function TableCrosshairStage({
  coordinator,
  focusTarget,
  layoutKey,
  children,
}: TableCrosshairStageProps) {
  const tableId = useId();
  const prefs = useCrosshairPrefs();
  const prefsRef = useRef<CrosshairPreferences>(prefs);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rowBarRef = useRef<HTMLDivElement | null>(null);
  const colBarRef = useRef<HTMLDivElement | null>(null);
  const headBarRef = useRef<HTMLDivElement | null>(null);
  const headLineRef = useRef<HTMLDivElement | null>(null);

  const geoRef = useRef<TableGeometry>(EMPTY_GEOMETRY);
  const focusTargetRef = useRef<CrosshairFocusTarget | null>(focusTarget);
  const isHoveringRef = useRef(false);
  const suppressedRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const visualStateRef = useRef<{
    rowActive: boolean;
    colActive: boolean;
    rowIndex: number | null;
    colIndex: number | null;
    mode: 'idle' | 'hover' | 'focus';
    rowW: number;
    rowH: number;
    colW: number;
    colH: number;
    headH: number;
    rowTransform: string;
    colTransform: string;
    headTransform: string;
    headLineTransform: string;
  }>({
    rowActive: false,
    colActive: false,
    rowIndex: null,
    colIndex: null,
    mode: 'idle',
    rowW: -1,
    rowH: -1,
    colW: -1,
    colH: -1,
    headH: -1,
    rowTransform: '',
    colTransform: '',
    headTransform: '',
    headLineTransform: '',
  });

  const applyBars = useRef(
    (
      row: RowGeom | null,
      col: ColGeom | null,
      mode: 'idle' | 'hover' | 'focus',
      allowGlide: boolean,
    ) => {
      const stage = stageRef.current;
      const rowBar = rowBarRef.current;
      const colBar = colBarRef.current;
      const headBar = headBarRef.current;
      const headLine = headLineRef.current;
      if (!stage || !rowBar || !colBar || !headBar || !headLine) return;

      const geo = geoRef.current;
      const prev = visualStateRef.current;
      const curPrefs = prefsRef.current;
      const effectiveGlide = allowGlide && curPrefs.motion === 'smooth';
      const showRow =
        curPrefs.mode === 'both' || curPrefs.mode === 'row';
      const showCol =
        curPrefs.mode === 'both' || curPrefs.mode === 'col';
      const effectiveMode = curPrefs.mode === 'off' ? 'idle' : mode;
      const effectiveRow = showRow ? row : null;
      const effectiveCol = showCol ? col : null;

      if (prev.mode !== effectiveMode) {
        stage.dataset.crosshairMode = effectiveMode;
        prev.mode = effectiveMode;
      }

      if (effectiveRow && geo.rowWidth > 0 && effectiveRow.height > 0) {
        const nextTransform = `translate3d(${geo.rowLeft}px, ${effectiveRow.top}px, 0)`;
        if (prev.rowW !== geo.rowWidth) {
          rowBar.style.width = `${geo.rowWidth}px`;
          prev.rowW = geo.rowWidth;
        }
        if (prev.rowH !== effectiveRow.height) {
          rowBar.style.height = `${effectiveRow.height}px`;
          prev.rowH = effectiveRow.height;
        }
        if (
          !prev.rowActive ||
          prev.rowIndex !== effectiveRow.rowIndex ||
          prev.rowTransform !== nextTransform
        ) {
          rowBar.dataset.glide = effectiveGlide && prev.rowActive ? 'true' : 'false';
          rowBar.style.transform = nextTransform;
          rowBar.dataset.active = 'true';
          rowBar.dataset.rowIndex = String(effectiveRow.rowIndex);
          prev.rowActive = true;
          prev.rowIndex = effectiveRow.rowIndex;
          prev.rowTransform = nextTransform;
        }
      } else if (prev.rowActive || rowBar.dataset.active === 'true') {
        rowBar.dataset.glide = 'false';
        rowBar.dataset.active = 'false';
        delete rowBar.dataset.rowIndex;
        prev.rowActive = false;
        prev.rowIndex = null;
      }

      if (effectiveCol && effectiveCol.width > 0) {
        const nextColTransform = `translate3d(${effectiveCol.left}px, ${geo.bodyTop}px, 0)`;
        const nextHeadTransform = `translate3d(${effectiveCol.left}px, 0px, 0)`;
        const lineY = Math.max(0, geo.headHeight - 2);
        const nextHeadLineTransform = `translate3d(${effectiveCol.left}px, ${lineY}px, 0)`;

        if (prev.colW !== effectiveCol.width) {
          const wPx = `${effectiveCol.width}px`;
          colBar.style.width = wPx;
          headBar.style.width = wPx;
          headLine.style.width = wPx;
          prev.colW = effectiveCol.width;
        }
        if (prev.colH !== geo.bodyHeight) {
          colBar.style.height = `${geo.bodyHeight}px`;
          prev.colH = geo.bodyHeight;
        }
        if (prev.headH !== geo.headHeight) {
          headBar.style.height = `${geo.headHeight}px`;
          prev.headH = geo.headHeight;
        }

        const headerOn = curPrefs.showHeaderIndicator;
        if (
          !prev.colActive ||
          prev.colIndex !== effectiveCol.colIndex ||
          prev.colTransform !== nextColTransform ||
          prev.headTransform !== nextHeadTransform ||
          prev.headLineTransform !== nextHeadLineTransform ||
          (headBar.dataset.active === 'true') !== headerOn
        ) {
          const glideFlag = effectiveGlide && prev.colActive ? 'true' : 'false';
          colBar.dataset.glide = glideFlag;
          colBar.style.transform = nextColTransform;
          colBar.dataset.active = 'true';
          colBar.dataset.colIndex = String(effectiveCol.colIndex);

          if (headerOn) {
            headBar.dataset.glide = glideFlag;
            headBar.style.transform = nextHeadTransform;
            headBar.dataset.active = 'true';
            headBar.dataset.colIndex = String(effectiveCol.colIndex);

            headLine.dataset.glide = glideFlag;
            headLine.style.transform = nextHeadLineTransform;
            headLine.dataset.active = 'true';
          } else {
            headBar.dataset.active = 'false';
            delete headBar.dataset.colIndex;
            headLine.dataset.active = 'false';
          }

          prev.colActive = true;
          prev.colIndex = effectiveCol.colIndex;
          prev.colTransform = nextColTransform;
          prev.headTransform = nextHeadTransform;
          prev.headLineTransform = nextHeadLineTransform;
        }
      } else if (
        prev.colActive ||
        colBar.dataset.active === 'true' ||
        headBar.dataset.active === 'true' ||
        headLine.dataset.active === 'true'
      ) {
        colBar.dataset.glide = 'false';
        colBar.dataset.active = 'false';
        delete colBar.dataset.colIndex;
        headBar.dataset.glide = 'false';
        headBar.dataset.active = 'false';
        delete headBar.dataset.colIndex;
        headLine.dataset.glide = 'false';
        headLine.dataset.active = 'false';
        prev.colActive = false;
        prev.colIndex = null;
      }
    },
  );

  const syncIdleOrFocus = useRef((allowGlide: boolean) => {
    if (isHoveringRef.current) return;
    if (
      suppressedRef.current ||
      !focusTargetRef.current ||
      prefsRef.current.mode === 'off' ||
      !prefsRef.current.showFocusFallback
    ) {
      applyBars.current(null, null, 'idle', false);
      return;
    }
    const stage = stageRef.current;
    if (stage && geoRef.current.rows.length === 0) {
      geoRef.current = measureStageGeometry(
        stage,
        prefsRef.current.coverPeriodColumn,
      );
    }
    const geo = geoRef.current;
    const target = focusTargetRef.current;
    const row = geo.rowsByIndex.get(target.rowIndex) ?? null;
    const col = geo.colsByIndex.get(target.colIndex) ?? null;
    if (!row && !col) {
      applyBars.current(null, null, 'idle', false);
      return;
    }
    applyBars.current(row, col, 'focus', allowGlide);
  });

  const syncFromPointer = useRef((allowGlide: boolean) => {
    const stage = stageRef.current;
    const pointer = lastPointerRef.current;
    if (!stage || !pointer || !isHoveringRef.current) return;
    if (prefsRef.current.mode === 'off') {
      applyBars.current(null, null, 'idle', false);
      return;
    }

    if (geoRef.current.rows.length === 0 && geoRef.current.cols.length === 0) {
      geoRef.current = measureStageGeometry(
        stage,
        prefsRef.current.coverPeriodColumn,
      );
    }
    const geo = geoRef.current;
    const stageRect = stage.getBoundingClientRect();
    const localX = pointer.x - stageRect.left;
    const localY = pointer.y - stageRect.top;

    // Outside table stage bounds (can happen after wheel scroll)
    if (
      localX < 0 ||
      localX > stageRect.width ||
      localY < 0 ||
      localY > stageRect.height
    ) {
      applyBars.current(null, null, 'idle', false);
      return;
    }

    // Hovering sticky table header: smoothly track day column, clear row band
    if (localY < geo.bodyTop) {
      const col = findColAtX(geo, localX);
      applyBars.current(null, col, 'hover', allowGlide);
      return;
    }

    // Hovering Period merged column in One-Glance mode (outside data row span)
    if (localX < geo.rowLeft || localX > geo.rowLeft + geo.rowWidth) {
      applyBars.current(null, null, 'hover', false);
      return;
    }

    const col = findColAtX(geo, localX);
    const row = findRowAtY(geo, localY, col !== null);

    // Over a Standard Mode group-row / side-label-row separator: clear both cleanly
    if (!row) {
      applyBars.current(null, null, 'hover', false);
      return;
    }

    applyBars.current(row, col, 'hover', allowGlide);
  });

  // Register with shared multi-table coordinator (prevents sibling focus leak in One-Glance mode)
  useEffect(() => {
    coordinator.register(tableId, {
      setSuppressed(suppressed) {
        suppressedRef.current = suppressed;
        if (!isHoveringRef.current) {
          syncIdleOrFocus.current(false);
        }
      },
    });
    return () => {
      coordinator.unregister(tableId);
    };
  }, [coordinator, tableId]);

  // Pointer & scroll listeners (imperative DOM — zero React re-renders)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let scrollAttached = false;

    const schedulePointerFrame = (allowGlide: boolean) => {
      if (rafIdRef.current !== null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        syncFromPointer.current(allowGlide);
      });
    };

    const handleScroll = () => {
      if (!isHoveringRef.current || !lastPointerRef.current) return;
      schedulePointerFrame(true);
    };

    const detachScroll = () => {
      if (!scrollAttached) return;
      scrollAttached = false;
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('blur', handleLeave);
    };

    const handleLeave = () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      detachScroll();
      const wasHovering = isHoveringRef.current;
      isHoveringRef.current = false;
      lastPointerRef.current = null;
      if (wasHovering) {
        coordinator.leave(tableId);
      }
      syncIdleOrFocus.current(false);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      if (!isHoveringRef.current) {
        isHoveringRef.current = true;
        coordinator.enter(tableId);
        if (!scrollAttached) {
          scrollAttached = true;
          window.addEventListener('scroll', handleScroll, {
            passive: true,
            capture: true,
          });
          window.addEventListener('blur', handleLeave);
        }
      }
      schedulePointerFrame(true);
    };

    stage.addEventListener('pointermove', handlePointerMove, { passive: true });
    stage.addEventListener('pointerleave', handleLeave);
    stage.addEventListener('mouseleave', handleLeave);
    stage.addEventListener('pointercancel', handleLeave);

    // Keep cached geometry fresh on resize, zoom, or sidebar transition
    let resizeRaf: number | null = null;
    const scheduleMeasure = () => {
      if (resizeRaf !== null) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = null;
        geoRef.current = measureStageGeometry(
          stage,
          prefsRef.current.coverPeriodColumn,
        );
        if (isHoveringRef.current) {
          syncFromPointer.current(false);
        } else {
          syncIdleOrFocus.current(false);
        }
      });
    };
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(scheduleMeasure)
        : null;
    ro?.observe(stage);
    const tableEl = stage.querySelector('table.ledger-table');
    if (tableEl) ro?.observe(tableEl);
    window.addEventListener('resize', scheduleMeasure, { passive: true });

    return () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (resizeRaf !== null) {
        window.cancelAnimationFrame(resizeRaf);
      }
      detachScroll();
      stage.removeEventListener('pointermove', handlePointerMove);
      stage.removeEventListener('pointerleave', handleLeave);
      stage.removeEventListener('mouseleave', handleLeave);
      stage.removeEventListener('pointercancel', handleLeave);
      window.removeEventListener('resize', scheduleMeasure);
      ro?.disconnect();
    };
  }, [coordinator, tableId]);

  // Re-measure when table rows/groups/mode/preferences change
  useLayoutEffect(() => {
    prefsRef.current = prefs;
    const stage = stageRef.current;
    if (!stage) return;
    geoRef.current = measureStageGeometry(stage, prefs.coverPeriodColumn);
    if (isHoveringRef.current) {
      syncFromPointer.current(false);
    } else {
      syncIdleOrFocus.current(false);
    }
  }, [layoutKey, prefs]);

  // Update keyboard focus fallback target (glides smoothly on arrow-key navigation)
  useLayoutEffect(() => {
    focusTargetRef.current = focusTarget;
    if (!isHoveringRef.current) {
      syncIdleOrFocus.current(true);
    }
  }, [focusTarget]);

  const stageStyle = {
    '--crosshair-strength': String(prefs.opacity / 100),
  } as React.CSSProperties;

  return (
    <div className="ledger-table-wrap">
      <div
        ref={stageRef}
        className="ledger-table-stage"
        data-crosshair-mode="idle"
        style={stageStyle}
      >
        <div className="crosshair-sticky-track" aria-hidden="true">
          <div
            ref={headBarRef}
            className="crosshair-head-bar"
            data-active="false"
            data-glide="false"
          />
          <div
            ref={headLineRef}
            className="crosshair-head-line"
            data-active="false"
            data-glide="false"
          />
        </div>
        <div className="crosshair-body-layer" aria-hidden="true">
          <div
            ref={colBarRef}
            className="crosshair-col-bar"
            data-active="false"
            data-glide="false"
          />
          <div
            ref={rowBarRef}
            className="crosshair-row-bar"
            data-active="false"
            data-glide="false"
          />
        </div>
        {children}
      </div>
    </div>
  );
}

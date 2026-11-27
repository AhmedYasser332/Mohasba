'use client';

import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';

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

function measureStageGeometry(stage: HTMLElement): TableGeometry {
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
      if (Number.isFinite(minLeft) && Number.isFinite(maxRight) && maxRight > minLeft) {
        rowLeft = minLeft;
        rowWidth = maxRight - minLeft;
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

      if (prev.mode !== mode) {
        stage.dataset.crosshairMode = mode;
        prev.mode = mode;
      }

      if (row && geo.rowWidth > 0 && row.height > 0) {
        const nextTransform = `translate3d(${geo.rowLeft}px, ${row.top}px, 0) scale3d(${geo.rowWidth}, ${row.height}, 1)`;
        if (
          !prev.rowActive ||
          prev.rowIndex !== row.rowIndex ||
          prev.rowTransform !== nextTransform
        ) {
          rowBar.dataset.glide = allowGlide && prev.rowActive ? 'true' : 'false';
          rowBar.style.transform = nextTransform;
          rowBar.dataset.active = 'true';
          rowBar.dataset.rowIndex = String(row.rowIndex);
          prev.rowActive = true;
          prev.rowIndex = row.rowIndex;
          prev.rowTransform = nextTransform;
        }
      } else if (prev.rowActive) {
        rowBar.dataset.active = 'false';
        delete rowBar.dataset.rowIndex;
        prev.rowActive = false;
        prev.rowIndex = null;
      }

      if (col && col.width > 0) {
        const nextColTransform = `translate3d(${col.left}px, ${geo.bodyTop}px, 0) scale3d(${col.width}, ${geo.bodyHeight}, 1)`;
        const nextHeadTransform = `translate3d(${col.left}px, 0px, 0) scale3d(${col.width}, ${geo.headHeight}, 1)`;
        const lineY = Math.max(0, geo.headHeight - 2);
        const nextHeadLineTransform = `translate3d(${col.left}px, ${lineY}px, 0) scale3d(${col.width}, 1, 1)`;

        if (
          !prev.colActive ||
          prev.colIndex !== col.colIndex ||
          prev.colTransform !== nextColTransform ||
          prev.headTransform !== nextHeadTransform
        ) {
          const glideFlag = allowGlide && prev.colActive ? 'true' : 'false';
          colBar.dataset.glide = glideFlag;
          colBar.style.transform = nextColTransform;
          colBar.dataset.active = 'true';
          colBar.dataset.colIndex = String(col.colIndex);

          headBar.dataset.glide = glideFlag;
          headBar.style.transform = nextHeadTransform;
          headBar.dataset.active = 'true';
          headBar.dataset.colIndex = String(col.colIndex);

          headLine.dataset.glide = glideFlag;
          headLine.style.transform = nextHeadLineTransform;
          headLine.dataset.active = 'true';

          prev.colActive = true;
          prev.colIndex = col.colIndex;
          prev.colTransform = nextColTransform;
          prev.headTransform = nextHeadTransform;
          prev.headLineTransform = nextHeadLineTransform;
        }
      } else if (prev.colActive) {
        colBar.dataset.active = 'false';
        delete colBar.dataset.colIndex;
        headBar.dataset.active = 'false';
        delete headBar.dataset.colIndex;
        headLine.dataset.active = 'false';
        prev.colActive = false;
        prev.colIndex = null;
      }
    },
  );

  const syncIdleOrFocus = useRef((allowGlide: boolean) => {
    if (isHoveringRef.current) return;
    if (suppressedRef.current || !focusTargetRef.current) {
      applyBars.current(null, null, 'idle', false);
      return;
    }
    const stage = stageRef.current;
    if (stage && geoRef.current.rows.length === 0) {
      geoRef.current = measureStageGeometry(stage);
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

    if (geoRef.current.rows.length === 0 && geoRef.current.cols.length === 0) {
      geoRef.current = measureStageGeometry(stage);
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
      applyBars.current(null, null, 'hover', false);
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
      if (!isHoveringRef.current) return;
      isHoveringRef.current = false;
      lastPointerRef.current = null;
      coordinator.leave(tableId);
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

    // Keep cached geometry fresh on resize / layout shifts
    let resizeRaf: number | null = null;
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (resizeRaf !== null) return;
            resizeRaf = window.requestAnimationFrame(() => {
              resizeRaf = null;
              geoRef.current = measureStageGeometry(stage);
              if (isHoveringRef.current) {
                syncFromPointer.current(false);
              } else {
                syncIdleOrFocus.current(false);
              }
            });
          })
        : null;
    ro?.observe(stage);
    const tableEl = stage.querySelector('table.ledger-table');
    if (tableEl) ro?.observe(tableEl);

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
      ro?.disconnect();
    };
  }, [coordinator, tableId]);

  // Re-measure when table rows/groups/mode change
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    geoRef.current = measureStageGeometry(stage);
    if (isHoveringRef.current) {
      syncFromPointer.current(false);
    } else {
      syncIdleOrFocus.current(false);
    }
  }, [layoutKey]);

  // Update keyboard focus fallback target (glides smoothly on arrow-key navigation)
  useLayoutEffect(() => {
    focusTargetRef.current = focusTarget;
    if (!isHoveringRef.current) {
      syncIdleOrFocus.current(true);
    }
  }, [focusTarget]);

  return (
    <div className="ledger-table-wrap">
      <div
        ref={stageRef}
        className="ledger-table-stage"
        data-crosshair-mode="idle"
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

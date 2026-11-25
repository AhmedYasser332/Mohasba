'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AR_STRINGS,
  addDaysIso,
  diffDaysIso,
  getIsoDayOfWeek,
  getWeekDates,
  makeCellKey,
  matchesShortcutEvent,
  parseIsoDateParts,
  planDeferToQadaa,
  planNormalDay,
  resolveActiveTargetVersion,
  resolveEffectiveShortcuts,
  resolvePeriodWindowsForDay,
  type Action,
  type AvailabilityOverride,
  type CellStatus,
  type EffectiveCellState,
  type Period,
  type ResolvedPeriodWindow,
  type WindowLookupCache,
} from '@/domain';
import { useKeyedLongPress } from '../../hooks/use-long-press';
import {
  PointerDragGhost,
  usePointerDnd,
  type PointerDndReorderPayload,
} from '../../hooks/use-pointer-dnd';
import { useMohasba } from '../../store/mohasba-provider';
import {
  DEFAULT_UNDO_HOLD_MS,
  type CellMutationInput,
} from '../../sync/outbox-engine';
import {
  computeCellScore,
  formatArabicDateFull,
  formatArabicDateRange,
  formatHhmmInTz,
  getCellStateClass,
  resolveCellDisplay,
  type CellDisplayInfo,
} from '../cell-display';
import type { CellEditorTarget } from '../cell-editor-dialog';
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClipboard,
  IconCopy,
  IconCross,
  IconDash,
  IconGripVertical,
  IconQadaa,
  IconX,
} from '../icons';

interface WeekViewProps {
  oneGlanceMode: boolean;
  onSetOneGlanceMode: (enabled: boolean) => void;
  onOpenCellEditor: (target: CellEditorTarget) => void;
  onActionFeedback: (message: string) => void;
}

interface GridCoord {
  row: number;
  col: number;
}

interface GridSelection {
  anchor: GridCoord;
  extent: GridCoord;
}

interface GridRect {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}

interface VisibleGridRow {
  rowIndex: number;
  action: Action;
  group: Period;
  side: 'TIME_BOUND' | 'DAILY_GROUP';
}

type ClipboardCellKind =
  | 'DONE'
  | 'MISSED'
  | 'QADAA_DONE'
  | 'PERCENT'
  | 'DISABLED'
  | 'EMPTY';

interface ClipboardCellSnapshot {
  kind: ClipboardCellKind;
  percentValue: number | null;
}

interface ClipboardMatrix {
  rows: number;
  cols: number;
  cells: ClipboardCellSnapshot[][];
}

interface FillDragState {
  source: GridCoord;
  startX: number;
  startY: number;
  target: GridCoord;
  sourceSnapshot: ClipboardCellSnapshot;
  sourceSide: 'TIME_BOUND' | 'DAILY_GROUP';
}

interface SessionUndoEntry {
  batchId: string | null;
  mutationId: string | null;
  priorInputs: CellMutationInput[];
}

const SINGLE_CLICK_COALESCE_HOLD_MS = 1_200;
const MAX_SESSION_UNDO_ENTRIES = 30;
const DRAG_SELECT_THRESHOLD_PX = 6;

function formatArabicCells(count: number): string {
  if (count === 1) return 'خانة واحدة';
  if (count === 2) return 'خانتين';
  if (count >= 3 && count <= 10) return `${count} خانات`;
  return `${count} خانة`;
}

function normalizeRect(selection: GridSelection): GridRect {
  return {
    r1: Math.min(selection.anchor.row, selection.extent.row),
    r2: Math.max(selection.anchor.row, selection.extent.row),
    c1: Math.min(selection.anchor.col, selection.extent.col),
    c2: Math.max(selection.anchor.col, selection.extent.col),
  };
}

function isCoordInRect(row: number, col: number, rect: GridRect | null): boolean {
  if (!rect) return false;
  return row >= rect.r1 && row <= rect.r2 && col >= rect.c1 && col <= rect.c2;
}

function isCoordInFillDrag(
  row: number,
  col: number,
  fillDrag: FillDragState | null,
): boolean {
  if (!fillDrag) return false;
  const { source, target } = fillDrag;
  if (target.row !== source.row) {
    return (
      col === source.col &&
      row >= Math.min(source.row, target.row) &&
      row <= Math.max(source.row, target.row)
    );
  }
  if (target.col !== source.col) {
    return (
      row === source.row &&
      col >= Math.min(source.col, target.col) &&
      col <= Math.max(source.col, target.col)
    );
  }
  return row === source.row && col === source.col;
}

function getFillTargetCoords(fillDrag: FillDragState): GridCoord[] {
  const { source, target } = fillDrag;
  const coords: GridCoord[] = [];
  if (target.row !== source.row) {
    const rMin = Math.min(source.row, target.row);
    const rMax = Math.max(source.row, target.row);
    for (let r = rMin; r <= rMax; r += 1) {
      if (r === source.row) continue;
      coords.push({ row: r, col: source.col });
    }
  } else if (target.col !== source.col) {
    const cMin = Math.min(source.col, target.col);
    const cMax = Math.max(source.col, target.col);
    for (let c = cMin; c <= cMax; c += 1) {
      if (c === source.col) continue;
      coords.push({ row: source.row, col: c });
    }
  }
  return coords;
}

function snapshotCellFromDisplay(display: CellDisplayInfo): ClipboardCellSnapshot {
  switch (display.state) {
    case 'DONE':
      return { kind: 'DONE', percentValue: null };
    case 'MISSED':
      return { kind: 'MISSED', percentValue: null };
    case 'QADAA_DONE':
      return { kind: 'QADAA_DONE', percentValue: null };
    case 'PERCENT':
      return { kind: 'PERCENT', percentValue: display.percentValue ?? 50 };
    case 'DISABLED':
      return { kind: 'DISABLED', percentValue: null };
    default:
      return { kind: 'EMPTY', percentValue: null };
  }
}

function isCellPostArchived(action: Action, logDate: string): boolean {
  return action.archived_at !== null && logDate > action.archived_at;
}

function isVisibleInWeek(
  item: { archived_at: string | null },
  weekDates: readonly string[],
): boolean {
  return (
    item.archived_at === null || weekDates.some((d) => d <= item.archived_at!)
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

function serializeClipboardToTsv(matrix: ClipboardMatrix): string {
  return matrix.cells
    .map((row) =>
      row
        .map((cell) => {
          switch (cell.kind) {
            case 'DONE':
              return 'DONE';
            case 'MISSED':
              return 'MISSED';
            case 'QADAA_DONE':
              return 'QADAA';
            case 'PERCENT':
              return `${cell.percentValue ?? 50}%`;
            case 'DISABLED':
              return 'DISABLED';
            case 'EMPTY':
            default:
              return '';
          }
        })
        .join('\t'),
    )
    .join('\n');
}

function parseTsvCellToken(raw: string): ClipboardCellSnapshot | null {
  const token = raw.trim();
  if (!token) {
    return { kind: 'EMPTY', percentValue: null };
  }
  const upper = token.toUpperCase();
  if (upper === 'DONE' || upper === '✓' || upper === '100%' || token === 'تم') {
    return { kind: 'DONE', percentValue: null };
  }
  if (upper === 'MISSED' || upper === '✕' || upper === '0%' || token === 'فات') {
    return { kind: 'MISSED', percentValue: null };
  }
  if (upper === 'QADAA' || upper === 'QADAA_DONE' || token === 'قضاء') {
    return { kind: 'QADAA_DONE', percentValue: null };
  }
  if (upper === 'DISABLED' || upper === '-' || upper === 'X' || token === 'معذور') {
    return { kind: 'DISABLED', percentValue: null };
  }
  const pctMatch = /^(\d{1,3})\s*%$/.exec(token);
  if (pctMatch) {
    const val = Number(pctMatch[1]);
    if (val >= 100) return { kind: 'DONE', percentValue: null };
    if (val <= 0) return { kind: 'MISSED', percentValue: null };
    return { kind: 'PERCENT', percentValue: val };
  }
  return null;
}

function parseTsvToClipboard(text: string): ClipboardMatrix | null {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.trim()) return null;
  const rawLines = normalized.split('\n');
  while (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  const rows: ClipboardCellSnapshot[][] = [];
  let maxCols = 0;
  let validTokens = 0;

  for (const line of rawLines) {
    const tokens = line.split('\t');
    const parsedRow: ClipboardCellSnapshot[] = [];
    for (const token of tokens) {
      const parsed = parseTsvCellToken(token);
      if (parsed) {
        if (parsed.kind !== 'EMPTY') validTokens += 1;
        parsedRow.push(parsed);
      } else {
        parsedRow.push({ kind: 'EMPTY', percentValue: null });
      }
    }
    maxCols = Math.max(maxCols, parsedRow.length);
    rows.push(parsedRow);
  }

  if (rows.length === 0 || maxCols === 0 || validTokens === 0) return null;
  for (const row of rows) {
    while (row.length < maxCols) {
      row.push({ kind: 'EMPTY', percentValue: null });
    }
  }
  return { rows: rows.length, cols: maxCols, cells: rows };
}

function renderCellGlyph(state: EffectiveCellState, pct: number | null) {
  switch (state) {
    case 'DONE':
      return <IconCheck size="sm" />;
    case 'MISSED':
      return <IconCross size="sm" />;
    case 'QADAA_DONE':
      return <IconQadaa size="sm" />;
    case 'PERCENT':
      return (
        <>
          <span>{pct ?? 0}%</span>
          <span
            className="m-cell-bar"
            style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
          />
        </>
      );
    case 'DISABLED':
      return <IconDash size="sm" />;
    case 'INACTIVE':
    case 'UNLOGGED_EXPIRED':
    case 'PENDING':
    default:
      return null;
  }
}

export function WeekView({
  oneGlanceMode,
  onSetOneGlanceMode,
  onOpenCellEditor,
  onActionFeedback,
}: WeekViewProps) {
  const {
    settings,
    periods,
    actions,
    targetVersions,
    logsByKey,
    outbox,
    nowMs,
    activeWindowResolution,
    todayIslamicDate,
    isOnline,
    fetchLogsRange,
    logCellBatch,
    logBulkNormalDay,
    logBulkDeferToQadaa,
    undoMutation,
    undoBatch,
    reorderSchema,
  } = useMohasba();

  const [weekAnchorDate, setWeekAnchorDate] = useState<string | null>(null);
  const [selectedBulkDate, setSelectedBulkDate] = useState<string | null>(null);
  const [mobileCompactGrid, setMobileCompactGrid] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [loadingWeekRange, setLoadingWeekRange] = useState(false);
  const [normalDialogOpen, setNormalDialogOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dndSaving, setDndSaving] = useState(false);

  // Desktop spreadsheet grid focus, selection, copy marquee, fill drag & clipboard
  const [focusedCell, setFocusedCell] = useState<GridCoord | null>(null);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [copiedRect, setCopiedRect] = useState<GridRect | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [fillDrag, setFillDrag] = useState<FillDragState | null>(null);

  const fetchedRangesRef = useRef<Set<string>>(new Set());
  const normalDialogRef = useRef<HTMLDialogElement | null>(null);
  const appliedDefaultWeekModeRef = useRef(false);
  const clipboardRef = useRef<ClipboardMatrix | null>(null);
  const undoStackRef = useRef<SessionUndoEntry[]>([]);
  const cellButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const desktopGridAreaRef = useRef<HTMLDivElement | null>(null);
  const bulkBarRef = useRef<HTMLDivElement | null>(null);
  const fillDragRef = useRef<FillDragState | null>(null);
  const dragSelectRef = useRef<{
    startX: number;
    startY: number;
    anchor: GridCoord;
    anchorSide: 'TIME_BOUND' | 'DAILY_GROUP';
    active: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  // Respect settings.default_week_mode on initial mount (Desktop >= 1024px)
  useEffect(() => {
    if (appliedDefaultWeekModeRef.current || !settings) return;
    appliedDefaultWeekModeRef.current = true;
    if (
      settings.default_week_mode === 'one_glance' &&
      !oneGlanceMode &&
      typeof window !== 'undefined' &&
      window.innerWidth >= 1024
    ) {
      onSetOneGlanceMode(true);
    }
  }, [oneGlanceMode, onSetOneGlanceMode, settings]);

  const effectiveAnchor = weekAnchorDate ?? todayIslamicDate;

  const weekDates = useMemo(() => {
    if (!settings || !effectiveAnchor) return [];
    return getWeekDates(effectiveAnchor, settings.week_start_day);
  }, [effectiveAnchor, settings]);

  const effectiveBulkDate = useMemo(() => {
    if (selectedBulkDate && weekDates.includes(selectedBulkDate)) {
      return selectedBulkDate;
    }
    if (todayIslamicDate && weekDates.includes(todayIslamicDate)) {
      return todayIslamicDate;
    }
    return weekDates[0] ?? todayIslamicDate ?? '';
  }, [selectedBulkDate, todayIslamicDate, weekDates]);

  const effectiveShortcuts = useMemo(
    () => resolveEffectiveShortcuts(settings?.keyboard_shortcuts),
    [settings?.keyboard_shortcuts],
  );

  useEffect(() => {
    if (!todayIslamicDate || weekDates.length === 0 || !isOnline) return;
    const from = weekDates[0]!;
    const to = weekDates[weekDates.length - 1]!;
    const rangeKey = `${from}..${to}`;
    const ageDays = diffDaysIso(from, todayIslamicDate);
    if (ageDays > 80 && !fetchedRangesRef.current.has(rangeKey)) {
      fetchedRangesRef.current.add(rangeKey);
      setLoadingWeekRange(true);
      void fetchLogsRange(from, to).finally(() => {
        setLoadingWeekRange(false);
      });
    }
  }, [fetchLogsRange, isOnline, todayIslamicDate, weekDates]);

  useEffect(() => {
    const dlg = normalDialogRef.current;
    if (!dlg) return;
    if (normalDialogOpen) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [normalDialogOpen]);

  const periodsById = useMemo(
    () => new Map(periods.map((p) => [p.id, p])),
    [periods],
  );
  const targetVersionsById = useMemo(
    () => new Map(targetVersions.map((v) => [v.id, v])),
    [targetVersions],
  );

  const activeGroups = useMemo(() => {
    if (weekDates.length === 0) return { right: [] as Period[], left: [] as Period[] };
    const right = periods
      .filter((p) => p.side === 'TIME_BOUND' && isVisibleInWeek(p, weekDates))
      .sort((a, b) => a.sort_order - b.sort_order);
    const left = periods
      .filter((p) => p.side === 'DAILY_GROUP' && isVisibleInWeek(p, weekDates))
      .sort((a, b) => a.sort_order - b.sort_order);
    return { right, left };
  }, [periods, weekDates]);

  const actionsByPeriodId = useMemo(() => {
    const map = new Map<string, Action[]>();
    for (const action of [...actions].sort((a, b) => a.sort_order - b.sort_order)) {
      if (!isVisibleInWeek(action, weekDates)) continue;
      const list = map.get(action.period_id) ?? [];
      list.push(action);
      map.set(action.period_id, list);
    }
    return map;
  }, [actions, weekDates]);

  const allStandardGroups = useMemo(
    () => [...activeGroups.right, ...activeGroups.left],
    [activeGroups.left, activeGroups.right],
  );

  const allStandardGroupIds = useMemo(
    () => allStandardGroups.map((g) => g.id),
    [allStandardGroups],
  );

  // Flat ordered actions for DnD in Standard Mode (includes collapsed groups so cross-group moves stay accurate)
  const standardDndItems = useMemo(() => {
    const list: Action[] = [];
    for (const g of allStandardGroups) {
      const groupActions = actionsByPeriodId.get(g.id) ?? [];
      list.push(...groupActions);
    }
    return list;
  }, [actionsByPeriodId, allStandardGroups]);

  // Flat visible rows for Desktop Grid coordinates (Standard respects collapsedGroups; One-Glance shows all)
  const { visibleGridRows, rowIndexByActionId, rightRowCount } = useMemo(() => {
    const rows: VisibleGridRow[] = [];
    const indexMap = new Map<string, number>();

    for (const group of activeGroups.right) {
      if (!oneGlanceMode && collapsedGroups[group.id]) continue;
      const groupActions = actionsByPeriodId.get(group.id) ?? [];
      for (const action of groupActions) {
        const idx = rows.length;
        rows.push({ rowIndex: idx, action, group, side: 'TIME_BOUND' });
        indexMap.set(action.id, idx);
      }
    }

    const rCount = rows.length;

    for (const group of activeGroups.left) {
      if (!oneGlanceMode && collapsedGroups[group.id]) continue;
      const groupActions = actionsByPeriodId.get(group.id) ?? [];
      for (const action of groupActions) {
        const idx = rows.length;
        rows.push({ rowIndex: idx, action, group, side: 'DAILY_GROUP' });
        indexMap.set(action.id, idx);
      }
    }

    return {
      visibleGridRows: rows,
      rowIndexByActionId: indexMap,
      rightRowCount: rCount,
    };
  }, [actionsByPeriodId, activeGroups.left, activeGroups.right, collapsedGroups, oneGlanceMode]);

  const todayColIdx = useMemo(() => {
    if (!todayIslamicDate) return 0;
    const idx = weekDates.indexOf(todayIslamicDate);
    return idx >= 0 ? idx : 0;
  }, [todayIslamicDate, weekDates]);

  const effectiveFocusedCell = useMemo<GridCoord | null>(() => {
    if (visibleGridRows.length === 0 || weekDates.length === 0) return null;
    if (!focusedCell) {
      return { row: 0, col: todayColIdx };
    }
    return {
      row: Math.min(Math.max(0, focusedCell.row), visibleGridRows.length - 1),
      col: Math.min(Math.max(0, focusedCell.col), weekDates.length - 1),
    };
  }, [focusedCell, todayColIdx, visibleGridRows.length, weekDates.length]);

  const selectedRect = useMemo<GridRect | null>(() => {
    if (!selection || visibleGridRows.length === 0 || weekDates.length === 0) {
      return null;
    }
    const raw = normalizeRect(selection);
    return {
      r1: Math.min(Math.max(0, raw.r1), visibleGridRows.length - 1),
      r2: Math.min(Math.max(0, raw.r2), visibleGridRows.length - 1),
      c1: Math.min(Math.max(0, raw.c1), weekDates.length - 1),
      c2: Math.min(Math.max(0, raw.c2), weekDates.length - 1),
    };
  }, [selection, visibleGridRows.length, weekDates.length]);

  const selectedCellCount = useMemo(() => {
    if (!selectedRect) return 0;
    return (
      (selectedRect.r2 - selectedRect.r1 + 1) *
      (selectedRect.c2 - selectedRect.c1 + 1)
    );
  }, [selectedRect]);

  const selectedHasQadaaEligible = useMemo(() => {
    if (!selectedRect) return false;
    for (let r = selectedRect.r1; r <= selectedRect.r2; r += 1) {
      if (visibleGridRows[r]?.action.is_qadaa_eligible) return true;
    }
    return false;
  }, [selectedRect, visibleGridRows]);

  const selectedHasPercentageEligible = useMemo(() => {
    if (!selectedRect) return false;
    for (let r = selectedRect.r1; r <= selectedRect.r2; r += 1) {
      if (visibleGridRows[r]?.action.supports_percentage) return true;
    }
    return false;
  }, [selectedRect, visibleGridRows]);

  const gridBoundsRef = useRef({
    oneGlanceMode: false,
    rightRowCount: 0,
    totalRows: 0,
    visibleSides: [] as ('TIME_BOUND' | 'DAILY_GROUP')[],
  });

  useEffect(() => {
    gridBoundsRef.current = {
      oneGlanceMode,
      rightRowCount,
      totalRows: visibleGridRows.length,
      visibleSides: visibleGridRows.map((r) => r.side),
    };
  }, [oneGlanceMode, rightRowCount, visibleGridRows]);

  const fillCommitHandlerRef = useRef<(fd: FillDragState) => void>(() => {});

  const clearAllInteractionState = useCallback(() => {
    fillDragRef.current = null;
    setFillDrag(null);
    dragSelectRef.current = null;
    setSelection(null);
    setCopiedRect(null);
    document.body.style.cursor = '';
  }, []);

  const navigateWeek = useCallback((nextAnchor: string) => {
    setWeekAnchorDate(nextAnchor);
    setSelection(null);
    setCopiedRect(null);
  }, []);

  // Mouse drag-select (>6px activation) & Google Sheets Fill Handle pointer tracking
  useEffect(() => {
    const findCoordFromPoint = (clientX: number, clientY: number): GridCoord | null => {
      const el = document.elementFromPoint(clientX, clientY);
      const cellEl =
        el?.closest<HTMLElement>('[data-grid-row][data-grid-col]') ??
        el
          ?.closest<HTMLElement>('td.cell-status')
          ?.querySelector<HTMLElement>('[data-grid-row][data-grid-col]');
      if (!cellEl) return null;
      const row = Number(cellEl.dataset.gridRow);
      const col = Number(cellEl.dataset.gridCol);
      if (Number.isNaN(row) || Number.isNaN(col)) return null;
      return { row, col };
    };

    const onPointerMove = (event: PointerEvent) => {
      const fd = fillDragRef.current;
      if (fd) {
        const over = findCoordFromPoint(event.clientX, event.clientY);
        if (!over) return;
        const bounds = gridBoundsRef.current;
        if (
          bounds.oneGlanceMode &&
          bounds.visibleSides[over.row] !== fd.sourceSide
        ) {
          return;
        }
        const dRow = Math.abs(over.row - fd.source.row);
        const dCol = Math.abs(over.col - fd.source.col);
        const lockedTarget: GridCoord =
          dRow > dCol ||
          (dRow === dCol &&
            Math.abs(event.clientY - fd.startY) >=
              Math.abs(event.clientX - fd.startX))
            ? { row: over.row, col: fd.source.col }
            : { row: fd.source.row, col: over.col };

        if (
          lockedTarget.row !== fd.target.row ||
          lockedTarget.col !== fd.target.col
        ) {
          const nextFd: FillDragState = { ...fd, target: lockedTarget };
          fillDragRef.current = nextFd;
          setFillDrag(nextFd);
        }
        return;
      }

      const ds = dragSelectRef.current;
      if (!ds) return;
      if (!ds.active) {
        const dist = Math.hypot(
          event.clientX - ds.startX,
          event.clientY - ds.startY,
        );
        if (dist <= DRAG_SELECT_THRESHOLD_PX) return;
        ds.active = true;
        window.getSelection()?.removeAllRanges();
      }

      const over = findCoordFromPoint(event.clientX, event.clientY);
      if (over) {
        const bounds = gridBoundsRef.current;
        let clamped = over;
        if (bounds.oneGlanceMode) {
          const minRow =
            ds.anchorSide === 'TIME_BOUND' ? 0 : bounds.rightRowCount;
          const maxRow =
            ds.anchorSide === 'TIME_BOUND'
              ? Math.max(0, bounds.rightRowCount - 1)
              : Math.max(bounds.rightRowCount, bounds.totalRows - 1);
          clamped = {
            row: Math.min(Math.max(over.row, minRow), maxRow),
            col: over.col,
          };
        }
        setSelection({ anchor: ds.anchor, extent: clamped });
        setFocusedCell(clamped);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const fd = fillDragRef.current;
      if (fd) {
        fillDragRef.current = null;
        setFillDrag(null);
        document.body.style.cursor = '';
        suppressNextClickRef.current = true;
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 50);
        if (event.type !== 'pointercancel') {
          fillCommitHandlerRef.current(fd);
        }
      }

      const ds = dragSelectRef.current;
      if (!ds) return;
      if (ds.active) {
        suppressNextClickRef.current = true;
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 50);
      }
      dragSelectRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  // Mobile 450ms long-press controller
  const longPress = useKeyedLongPress<string>({
    delayMs: 450,
    armDelayMs: 120,
    moveThresholdPx: 10,
    touchOnly: true,
  });

  // Inline Desktop Standard Mode Drag-and-Drop (online-only)
  const handleDndReorder = useCallback(
    async (payload: PointerDndReorderPayload) => {
      if (!isOnline || dndSaving) return;
      setDndSaving(true);
      try {
        const res = await reorderSchema({
          target: 'actions',
          items: payload.updates.map((u) => ({
            id: u.id,
            sort_order: u.sortOrder,
            period_id: u.groupId,
          })),
        });
        if (res.ok) {
          onActionFeedback('تم حفظ الترتيب الجديد للأعمال');
        } else {
          onActionFeedback(res.errorMessage ?? 'تعذر حفظ الترتيب الجديد');
        }
      } finally {
        setDndSaving(false);
      }
    },
    [dndSaving, isOnline, onActionFeedback, reorderSchema],
  );

  const handleHoverCollapsedGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) =>
      prev[groupId] ? { ...prev, [groupId]: false } : prev,
    );
  }, []);

  const dndDisabled = oneGlanceMode || !isOnline || dndSaving;

  const dnd = usePointerDnd<Action>({
    items: standardDndItems,
    getId: useCallback((a: Action) => a.id, []),
    getGroupId: useCallback((a: Action) => a.period_id, []),
    getLabel: useCallback((a: Action) => a.title, []),
    groupOrder: allStandardGroupIds,
    getGroupLabel: useCallback(
      (gid: string) => periodsById.get(gid)?.title ?? '',
      [periodsById],
    ),
    isGroupCollapsed: useCallback(
      (gid: string) => Boolean(collapsedGroups[gid]),
      [collapsedGroups],
    ),
    allowCrossGroup: true,
    disabled: dndDisabled,
    onReorder: handleDndReorder,
    onHoverCollapsedGroup: handleHoverCollapsedGroup,
  });

  const todayWindowsByPeriodId = useMemo(() => {
    if (!settings || !todayIslamicDate) {
      return new Map<string, ResolvedPeriodWindow>();
    }
    const resolved = resolvePeriodWindowsForDay(
      todayIslamicDate,
      periods,
      settings,
      nowMs,
    );
    return new Map(resolved.map((w) => [w.periodId, w]));
  }, [nowMs, periods, settings, todayIslamicDate]);

  const livePeriodIds = useMemo(() => {
    const set = new Set<string>();
    for (const w of activeWindowResolution?.activeWindows ?? []) {
      set.add(w.periodId);
    }
    return set;
  }, [activeWindowResolution]);

  const normalDayEligibleCount = useMemo(() => {
    if (!effectiveBulkDate) return 0;
    return planNormalDay({
      logDate: effectiveBulkDate,
      actions,
      periods,
      logsByKey,
    }).length;
  }, [actions, effectiveBulkDate, logsByKey, periods]);

  const deferQadaaEligibleCount = useMemo(() => {
    if (!settings || !effectiveBulkDate) return 0;
    return planDeferToQadaa({
      logDate: effectiveBulkDate,
      actions,
      periods,
      settings,
      logsByKey,
      now: nowMs,
    }).length;
  }, [actions, effectiveBulkDate, logsByKey, nowMs, periods, settings]);

  const pushUndoEntry = useCallback((entry: SessionUndoEntry) => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_SESSION_UNDO_ENTRIES - 1)),
      entry,
    ];
  }, []);

  const capturePriorSnapshot = useCallback(
    (action: Action, logDate: string): CellMutationInput => {
      const existing = logsByKey.get(makeCellKey(action.id, logDate));
      return {
        action,
        logDate,
        availability_override: existing?.availability_override ?? null,
        status: existing?.status ?? null,
        percent_value: existing?.percent_value ?? null,
        qadaa_resolved_at: existing?.qadaa_resolved_at ?? null,
        clientTargetVersionId: existing?.target_version_id ?? null,
        note: existing?.note ?? null,
        note_updated_at: existing?.note_updated_at ?? null,
      };
    },
    [logsByKey],
  );

  const buildCellMutationForTarget = useCallback(
    (
      action: Action,
      logDate: string,
      display: CellDisplayInfo,
      target: ClipboardCellSnapshot,
    ): CellMutationInput => {
      const isDefaultOff = action.default_disabled_days.includes(
        getIsoDayOfWeek(logDate),
      );
      let availabilityOverride: AvailabilityOverride | null = null;
      let status: CellStatus | null = null;
      let percentValue: number | null = null;
      let qadaaResolvedAt: string | null = null;

      if (target.kind === 'DISABLED') {
        availabilityOverride = 'DISABLED';
        status = null;
      } else if (target.kind === 'EMPTY') {
        availabilityOverride = isDefaultOff ? 'ENABLED' : null;
        status = null;
      } else if (target.kind === 'PERCENT') {
        availabilityOverride = isDefaultOff ? 'ENABLED' : null;
        status = 'PERCENT';
        percentValue = target.percentValue ?? 50;
      } else if (target.kind === 'QADAA_DONE') {
        availabilityOverride = isDefaultOff ? 'ENABLED' : null;
        status = 'QADAA_DONE';
        qadaaResolvedAt =
          display.log?.qadaa_resolved_at ?? new Date().toISOString();
      } else {
        availabilityOverride = isDefaultOff ? 'ENABLED' : null;
        status = target.kind;
      }

      return {
        action,
        logDate,
        availability_override: availabilityOverride,
        status,
        percent_value: percentValue,
        qadaa_resolved_at: qadaaResolvedAt,
        clientTargetVersionId: display.targetVersion?.id ?? null,
        note: display.log?.note ?? null,
        note_updated_at: display.log?.note_updated_at ?? null,
      };
    },
    [],
  );

  const handleSessionUndo = useCallback(async (): Promise<boolean> => {
    const entry = undoStackRef.current.pop();
    if (!entry) return false;

    const batchStillHeld =
      entry.batchId !== null &&
      outbox.some((o) => o.batch_id === entry.batchId && o.state === 'held');
    const mutStillHeld =
      entry.mutationId !== null &&
      outbox.some(
        (o) => o.mutation_id === entry.mutationId && o.state === 'held',
      );

    if (batchStillHeld && entry.batchId) {
      await undoBatch(entry.batchId);
    } else if (mutStillHeld && entry.mutationId) {
      await undoMutation(entry.mutationId);
    } else if (entry.priorInputs.length > 0) {
      await logCellBatch(entry.priorInputs, 0, false);
    }

    onActionFeedback('تم التراجع عن آخر تعديل');
    return true;
  }, [logCellBatch, onActionFeedback, outbox, undoBatch, undoMutation]);

  const focusGridCell = useCallback((row: number, col: number) => {
    const coord = { row, col };
    setFocusedCell(coord);
    const btn = cellButtonRefs.current.get(`${row}:${col}`);
    if (btn && !btn.disabled) {
      btn.focus({ preventScroll: false });
    }
  }, []);

  const windowKeyDownHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const windowCache: WindowLookupCache = new Map();

  const resolveDisplay = (action: Action, logDate: string): CellDisplayInfo =>
    resolveCellDisplay({
      action,
      logDate,
      logsByKey,
      periodsById,
      periods,
      targetVersions,
      targetVersionsById,
      settings: settings!,
      nowMs,
      windowCache,
    });

  // Canonical Zero-Modal 1-Click / 1-Tap State Cycle (#106)
  const handleCellPrimaryCycle = async (
    action: Action,
    logDate: string,
    display: CellDisplayInfo,
  ) => {
    if (isCellPostArchived(action, logDate)) return;

    // Protect historical QADAA_DONE & DISABLED cells from accidental stray overwrites
    if (display.state === 'QADAA_DONE' || display.state === 'DISABLED') {
      onOpenCellEditor({ action, logDate });
      return;
    }

    let nextTarget: ClipboardCellSnapshot;
    if (action.supports_percentage) {
      switch (display.state) {
        case 'DONE':
          nextTarget = { kind: 'PERCENT', percentValue: 50 };
          break;
        case 'PERCENT':
          nextTarget = { kind: 'MISSED', percentValue: null };
          break;
        case 'MISSED':
          nextTarget = { kind: 'EMPTY', percentValue: null };
          break;
        case 'PENDING':
        case 'UNLOGGED_EXPIRED':
        default:
          nextTarget = { kind: 'DONE', percentValue: null };
          break;
      }
    } else {
      switch (display.state) {
        case 'DONE':
          nextTarget = { kind: 'MISSED', percentValue: null };
          break;
        case 'MISSED':
          nextTarget = { kind: 'EMPTY', percentValue: null };
          break;
        case 'PENDING':
        case 'UNLOGGED_EXPIRED':
        default:
          nextTarget = { kind: 'DONE', percentValue: null };
          break;
      }
    }

    const prior = capturePriorSnapshot(action, logDate);
    const mutation = buildCellMutationForTarget(
      action,
      logDate,
      display,
      nextTarget,
    );
    const res = await logCellBatch(
      [mutation],
      SINGLE_CLICK_COALESCE_HOLD_MS,
      false,
    );
    if (res.items.length > 0) {
      pushUndoEntry({
        batchId: res.batchId,
        mutationId: res.items[0]?.mutation_id ?? null,
        priorInputs: [prior],
      });
    }
  };

  const getTargetCoords = (): GridCoord[] => {
    if (selectedRect) {
      const coords: GridCoord[] = [];
      for (let r = selectedRect.r1; r <= selectedRect.r2; r += 1) {
        for (let c = selectedRect.c1; c <= selectedRect.c2; c += 1) {
          coords.push({ row: r, col: c });
        }
      }
      return coords;
    }
    if (effectiveFocusedCell) {
      return [effectiveFocusedCell];
    }
    return [];
  };

  const applyTargetStateToCoords = async (
    coords: readonly GridCoord[],
    target: ClipboardCellSnapshot,
    options: {
      showToast?: boolean;
      actionNameAr?: string;
      clearSelection?: boolean;
    } = {},
  ) => {
    if (coords.length === 0) return;
    const mutations: CellMutationInput[] = [];
    const priorInputs: CellMutationInput[] = [];
    let skippedIncompatible = 0;

    for (const coord of coords) {
      const rowMeta = visibleGridRows[coord.row];
      const logDate = weekDates[coord.col];
      if (!rowMeta || !logDate) continue;
      const { action } = rowMeta;
      const display = resolveDisplay(action, logDate);

      if (isCellPostArchived(action, logDate)) {
        continue;
      }
      if (target.kind === 'QADAA_DONE' && !action.is_qadaa_eligible) {
        skippedIncompatible += 1;
        continue;
      }
      if (target.kind === 'PERCENT' && !action.supports_percentage) {
        skippedIncompatible += 1;
        continue;
      }

      priorInputs.push(capturePriorSnapshot(action, logDate));
      mutations.push(
        buildCellMutationForTarget(action, logDate, display, target),
      );
    }

    if (mutations.length === 0) {
      if (skippedIncompatible > 0) {
        onActionFeedback(
          `لم يتم التعديل — تم تخطي ${formatArabicCells(skippedIncompatible)} غير متوافقة`,
        );
      }
      return;
    }

    const isBulkOrDestructive =
      options.showToast ??
      (mutations.length > 1 || target.kind === 'DISABLED');
    const holdMs = isBulkOrDestructive
      ? DEFAULT_UNDO_HOLD_MS
      : SINGLE_CLICK_COALESCE_HOLD_MS;

    const res = await logCellBatch(mutations, holdMs, isBulkOrDestructive);
    if (res.items.length > 0) {
      pushUndoEntry({
        batchId: res.batchId,
        mutationId: res.batchId ? null : (res.items[0]?.mutation_id ?? null),
        priorInputs,
      });
    }

    if (options.clearSelection !== false) {
      setSelection(null);
    }

    if (isBulkOrDestructive || skippedIncompatible > 0) {
      const label = options.actionNameAr
        ? `${options.actionNameAr} (${formatArabicCells(mutations.length)})`
        : `تم تحديث ${formatArabicCells(mutations.length)}`;
      const skipSuffix =
        skippedIncompatible > 0
          ? ` (تم تخطي ${skippedIncompatible} غير متوافقة)`
          : '';
      onActionFeedback(`${label}${skipSuffix}`);
    }
  };

  const handleFillCommit = (fd: FillDragState) => {
    const targetCoords = getFillTargetCoords(fd);
    if (targetCoords.length === 0) return;
    void applyTargetStateToCoords(targetCoords, fd.sourceSnapshot, {
      showToast: true,
      actionNameAr: 'تم تعبئة',
      clearSelection: true,
    });
  };

  const handleCopySelection = (options?: { clearSelection?: boolean }) => {
    const rect: GridRect | null =
      selectedRect ??
      (effectiveFocusedCell
        ? {
            r1: effectiveFocusedCell.row,
            r2: effectiveFocusedCell.row,
            c1: effectiveFocusedCell.col,
            c2: effectiveFocusedCell.col,
          }
        : null);
    if (!rect) return;

    const cells: ClipboardCellSnapshot[][] = [];
    for (let r = rect.r1; r <= rect.r2; r += 1) {
      const rowSnaps: ClipboardCellSnapshot[] = [];
      const rowMeta = visibleGridRows[r];
      for (let c = rect.c1; c <= rect.c2; c += 1) {
        const logDate = weekDates[c];
        if (!rowMeta || !logDate) {
          rowSnaps.push({ kind: 'EMPTY', percentValue: null });
          continue;
        }
        const display = resolveDisplay(rowMeta.action, logDate);
        rowSnaps.push(snapshotCellFromDisplay(display));
      }
      cells.push(rowSnaps);
    }

    const matrix: ClipboardMatrix = {
      rows: cells.length,
      cols: cells[0]?.length ?? 0,
      cells,
    };
    clipboardRef.current = matrix;
    setHasClipboard(true);
    setCopiedRect(rect);

    if (options?.clearSelection) {
      setSelection(null);
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      const tsv = serializeClipboardToTsv(matrix);
      void navigator.clipboard.writeText(tsv).catch(() => {
        // Ignore clipboard permission errors in restricted contexts
      });
    }

    const count = matrix.rows * matrix.cols;
    onActionFeedback(`تم نسخ ${formatArabicCells(count)}`);
  };

  const handlePasteSelection = async () => {
    let source = clipboardRef.current;
    if (
      !source &&
      typeof navigator !== 'undefined' &&
      navigator.clipboard?.readText
    ) {
      try {
        const text = await navigator.clipboard.readText();
        source = parseTsvToClipboard(text);
        if (source) {
          clipboardRef.current = source;
          setHasClipboard(true);
        }
      } catch {
        // Ignore clipboard read permission errors
      }
    }

    if (!source || source.rows === 0 || source.cols === 0) return;

    const targetRect: GridRect | null =
      selectedRect ??
      (effectiveFocusedCell
        ? {
            r1: effectiveFocusedCell.row,
            r2: effectiveFocusedCell.row,
            c1: effectiveFocusedCell.col,
            c2: effectiveFocusedCell.col,
          }
        : null);
    if (!targetRect) return;

    const targetRows = targetRect.r2 - targetRect.r1 + 1;
    const targetCols = targetRect.c2 - targetRect.c1 + 1;

    // Google Sheets dimension mapping:
    // - 1x1 broadcasts across targetRect
    // - exact multiple tiles across targetRect
    // - otherwise expands from top-start anchor (r1, c1) clipped to grid bounds
    const shouldTile =
      (source.rows === 1 && source.cols === 1) ||
      (targetRows >= source.rows &&
        targetCols >= source.cols &&
        targetRows % source.rows === 0 &&
        targetCols % source.cols === 0);

    const endRow = shouldTile
      ? targetRect.r2
      : Math.min(visibleGridRows.length - 1, targetRect.r1 + source.rows - 1);
    const endCol = shouldTile
      ? targetRect.c2
      : Math.min(weekDates.length - 1, targetRect.c1 + source.cols - 1);

    const mutations: CellMutationInput[] = [];
    const priorInputs: CellMutationInput[] = [];
    let skippedIncompatible = 0;

    for (let r = targetRect.r1; r <= endRow; r += 1) {
      const rowMeta = visibleGridRows[r];
      if (!rowMeta) continue;
      const srcRow = (r - targetRect.r1) % source.rows;

      for (let c = targetRect.c1; c <= endCol; c += 1) {
        const logDate = weekDates[c];
        if (!logDate) continue;
        const srcCol = (c - targetRect.c1) % source.cols;
        const snap = source.cells[srcRow]?.[srcCol];
        if (!snap) continue;

        const { action } = rowMeta;
        const display = resolveDisplay(action, logDate);

        if (isCellPostArchived(action, logDate)) {
          continue;
        }
        if (snap.kind === 'QADAA_DONE' && !action.is_qadaa_eligible) {
          skippedIncompatible += 1;
          continue;
        }
        if (snap.kind === 'PERCENT' && !action.supports_percentage) {
          skippedIncompatible += 1;
          continue;
        }

        priorInputs.push(capturePriorSnapshot(action, logDate));
        mutations.push(
          buildCellMutationForTarget(action, logDate, display, snap),
        );
      }
    }

    if (mutations.length === 0) {
      if (skippedIncompatible > 0) {
        onActionFeedback(
          `تعذر اللصق — تم تخطي ${formatArabicCells(skippedIncompatible)} غير متوافقة`,
        );
      }
      return;
    }

    const res = await logCellBatch(mutations, DEFAULT_UNDO_HOLD_MS, true);
    if (res.items.length > 0) {
      pushUndoEntry({
        batchId: res.batchId,
        mutationId: res.batchId ? null : (res.items[0]?.mutation_id ?? null),
        priorInputs,
      });
    }

    setSelection(null);

    const skipSuffix =
      skippedIncompatible > 0
        ? ` (تم تخطي ${skippedIncompatible} غير متوافقة)`
        : '';
    onActionFeedback(
      `تم لصق ${formatArabicCells(mutations.length)}${skipSuffix}`,
    );
  };

  const handleSelectDayColumn = (
    colIdx: number,
    sideScope?: 'TIME_BOUND' | 'DAILY_GROUP',
  ) => {
    const logDate = weekDates[colIdx];
    if (logDate) {
      setSelectedBulkDate(logDate);
    }
    if (visibleGridRows.length === 0) return;

    let startRow = 0;
    let endRow = visibleGridRows.length - 1;
    if (oneGlanceMode && sideScope === 'TIME_BOUND') {
      startRow = 0;
      endRow = Math.max(0, rightRowCount - 1);
      if (rightRowCount === 0) return;
    } else if (oneGlanceMode && sideScope === 'DAILY_GROUP') {
      startRow = rightRowCount;
      endRow = visibleGridRows.length - 1;
      if (startRow > endRow) return;
    }

    const isAlreadySelected =
      selectedRect !== null &&
      selectedRect.c1 === colIdx &&
      selectedRect.c2 === colIdx &&
      selectedRect.r1 === startRow &&
      selectedRect.r2 === endRow;

    if (isAlreadySelected) {
      setSelection(null);
      return;
    }

    setSelection({
      anchor: { row: startRow, col: colIdx },
      extent: { row: endRow, col: colIdx },
    });
    focusGridCell(startRow, colIdx);
  };

  const handleSelectActionRow = (rowIndex: number) => {
    if (weekDates.length === 0) return;
    const endCol = weekDates.length - 1;
    const isAlreadySelected =
      selectedRect !== null &&
      selectedRect.r1 === rowIndex &&
      selectedRect.r2 === rowIndex &&
      selectedRect.c1 === 0 &&
      selectedRect.c2 === endCol;

    if (isAlreadySelected) {
      setSelection(null);
      return;
    }

    setSelection({
      anchor: { row: rowIndex, col: 0 },
      extent: { row: rowIndex, col: endCol },
    });
    focusGridCell(rowIndex, 0);
  };

  const handleSelectPeriodColumn = (periodId: string, colIdx: number) => {
    const matchingRows = visibleGridRows.filter((r) => r.group.id === periodId);
    if (matchingRows.length === 0) return;
    const firstRow = matchingRows[0]!.rowIndex;
    const lastRow = matchingRows[matchingRows.length - 1]!.rowIndex;

    const isAlreadySelected =
      selectedRect !== null &&
      selectedRect.r1 === firstRow &&
      selectedRect.r2 === lastRow &&
      selectedRect.c1 === colIdx &&
      selectedRect.c2 === colIdx;

    if (isAlreadySelected) {
      setSelection(null);
      return;
    }

    setSelection({
      anchor: { row: firstRow, col: colIdx },
      extent: { row: lastRow, col: colIdx },
    });
    focusGridCell(firstRow, colIdx);
  };

  const handleQuickCompletePeriod = async (group: Period, logDate: string) => {
    if (!logDate) return;
    const groupActions = actionsByPeriodId.get(group.id) ?? [];
    const mutations: CellMutationInput[] = [];
    const priorInputs: CellMutationInput[] = [];

    for (const action of groupActions) {
      if (isCellPostArchived(action, logDate)) continue;
      const display = resolveDisplay(action, logDate);
      if (
        display.state === 'DISABLED' ||
        display.state === 'DONE' ||
        display.state === 'QADAA_DONE'
      ) {
        continue;
      }
      priorInputs.push(capturePriorSnapshot(action, logDate));
      mutations.push(
        buildCellMutationForTarget(action, logDate, display, {
          kind: 'DONE',
          percentValue: null,
        }),
      );
    }

    setSelection(null);

    if (mutations.length === 0) {
      onActionFeedback(`جميع أعمال «${group.title}» مكتملة بالفعل`);
      return;
    }

    const res = await logCellBatch(mutations, DEFAULT_UNDO_HOLD_MS, true);
    if (res.items.length > 0) {
      pushUndoEntry({
        batchId: res.batchId,
        mutationId: res.batchId ? null : (res.items[0]?.mutation_id ?? null),
        priorInputs,
      });
    }
    onActionFeedback(
      `تم إكمال ${group.title} (${formatArabicCells(mutations.length)})`,
    );
  };

  const handleMultiCellSpaceToggle = async () => {
    if (!selectedRect) return;
    const coords = getTargetCoords();
    let hasEditable = false;
    let allDone = true;

    for (const coord of coords) {
      const rowMeta = visibleGridRows[coord.row];
      const logDate = weekDates[coord.col];
      if (!rowMeta || !logDate) continue;
      if (isCellPostArchived(rowMeta.action, logDate)) continue;
      hasEditable = true;
      const display = resolveDisplay(rowMeta.action, logDate);
      if (display.state !== 'DONE') {
        allDone = false;
        break;
      }
    }

    if (!hasEditable) return;
    const nextTarget: ClipboardCellSnapshot = allDone
      ? { kind: 'EMPTY', percentValue: null }
      : { kind: 'DONE', percentValue: null };

    await applyTargetStateToCoords(coords, nextTarget, {
      showToast: coords.length > 1,
      actionNameAr: allDone ? 'تم مسح الحالات' : 'تم تحديد تم للكل',
      clearSelection: true,
    });
  };

  const handleCellStateHotkey = (
    event: {
      code: string;
      key: string;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      preventDefault: () => void;
    },
    coords: GridCoord[],
  ): boolean => {
    if (event.ctrlKey || event.metaKey || event.altKey || coords.length === 0) {
      return false;
    }
    if (event.code === 'Digit1' || event.code === 'Numpad1') {
      event.preventDefault();
      void applyTargetStateToCoords(coords, { kind: 'DONE', percentValue: null });
      return true;
    }
    if (event.code === 'Digit2' || event.code === 'Numpad2') {
      event.preventDefault();
      void applyTargetStateToCoords(coords, { kind: 'MISSED', percentValue: null });
      return true;
    }
    if (event.code === 'Digit3' || event.code === 'Numpad3') {
      event.preventDefault();
      void applyTargetStateToCoords(coords, {
        kind: 'QADAA_DONE',
        percentValue: null,
      });
      return true;
    }
    if (event.code === 'Digit4' || event.code === 'Numpad4') {
      event.preventDefault();
      void applyTargetStateToCoords(coords, { kind: 'PERCENT', percentValue: 50 });
      return true;
    }
    if (
      event.code === 'Digit0' ||
      event.code === 'Numpad0' ||
      event.key === 'Delete' ||
      event.key === 'Backspace'
    ) {
      event.preventDefault();
      void applyTargetStateToCoords(coords, { kind: 'EMPTY', percentValue: null });
      return true;
    }
    if (event.code === 'KeyX') {
      event.preventDefault();
      void applyTargetStateToCoords(
        coords,
        { kind: 'DISABLED', percentValue: null },
        { showToast: true, actionNameAr: 'تم تعطيل' },
      );
      return true;
    }
    return false;
  };

  const handleWindowKeyDown = (e: KeyboardEvent) => {
    if (
      normalDialogOpen ||
      document.querySelector('dialog[open]') !== null ||
      isEditableTarget(e.target) ||
      isEditableTarget(document.activeElement)
    ) {
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      clearAllInteractionState();
      return;
    }

    if (e.defaultPrevented) return;

    const targetNode = e.target instanceof Node ? e.target : null;
    const isFocusInGrid =
      targetNode !== null &&
      (desktopGridAreaRef.current?.contains(targetNode) ?? false);
    if (selectedRect === null && !isFocusInGrid) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyC') {
      e.preventDefault();
      handleCopySelection();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyV') {
      e.preventDefault();
      void handlePasteSelection();
      return;
    }

    if (mod || e.altKey) return;

    if (e.code === 'Space' && !e.shiftKey) {
      if (targetNode && bulkBarRef.current?.contains(targetNode)) {
        return;
      }
      if (selectedRect !== null) {
        e.preventDefault();
        void handleMultiCellSpaceToggle();
      }
      return;
    }

    handleCellStateHotkey(e, getTargetCoords());
  };

  useEffect(() => {
    fillCommitHandlerRef.current = handleFillCommit;
    windowKeyDownHandlerRef.current = handleWindowKeyDown;
  });

  const hasActiveGridOverlay =
    selectedCellCount > 0 || copiedRect !== null || fillDrag !== null;

  useEffect(() => {
    if (!hasActiveGridOverlay) return;
    const onKeyDown = (e: KeyboardEvent) => {
      windowKeyDownHandlerRef.current(e);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasActiveGridOverlay]);

  // Outside-click dismissal for active grid selection
  useEffect(() => {
    if (!selection) return;
    const onPointerDown = (e: PointerEvent) => {
      if (fillDragRef.current) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (bulkBarRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(
          '[data-grid-row][data-grid-col], .col-day-btn, .row-title-btn, .period-select-btn, .period-quick-done-btn, .group-select-btn',
        )
      ) {
        return;
      }
      setSelection(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [selection]);

  if (!settings || !todayIslamicDate || weekDates.length === 0) {
    return null;
  }

  const handleGridCellKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    row: number,
    col: number,
    action: Action,
    logDate: string,
    display: CellDisplayInfo,
  ) => {
    if (normalDialogOpen || isEditableTarget(event.target)) return;

    // Respect user-configured shortcuts from settings.keyboard_shortcuts
    if (matchesShortcutEvent(event, effectiveShortcuts.toggle_one_glance)) {
      event.preventDefault();
      event.stopPropagation();
      onSetOneGlanceMode(!oneGlanceMode);
      return;
    }
    if (matchesShortcutEvent(event, effectiveShortcuts.jump_today)) {
      event.preventDefault();
      event.stopPropagation();
      if (todayIslamicDate) navigateWeek(todayIslamicDate);
      return;
    }
    if (matchesShortcutEvent(event, effectiveShortcuts.undo)) {
      if (undoStackRef.current.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        void handleSessionUndo();
      }
      return;
    }

    const mod = event.ctrlKey || event.metaKey;

    // Copy & Paste (physical KeyC / KeyV works on both Arabic & English layouts)
    if (mod && !event.altKey && !event.shiftKey && event.code === 'KeyC') {
      event.preventDefault();
      event.stopPropagation();
      handleCopySelection();
      return;
    }
    if (mod && !event.altKey && !event.shiftKey && event.code === 'KeyV') {
      event.preventDefault();
      event.stopPropagation();
      void handlePasteSelection();
      return;
    }

    // Escape clears fillDrag, dragSelect, selection, copiedRect & cursor
    if (event.key === 'Escape') {
      if (
        copiedRect ||
        selection ||
        fillDragRef.current ||
        dragSelectRef.current
      ) {
        event.preventDefault();
        clearAllInteractionState();
      }
      return;
    }

    // Row & Column selection chords
    if (event.code === 'Space' && event.shiftKey && !mod && !event.altKey) {
      event.preventDefault();
      setSelection({
        anchor: { row, col: 0 },
        extent: { row, col: weekDates.length - 1 },
      });
      return;
    }
    if (event.code === 'Space' && mod && !event.altKey) {
      event.preventDefault();
      const rowMeta = visibleGridRows[row];
      handleSelectDayColumn(col, oneGlanceMode ? rowMeta?.side : undefined);
      return;
    }

    // RTL-Accurate Spatial Arrow & Home/End Navigation
    // In RTL, col 0 is visual right and col 6 is visual left:
    // ArrowLeft => col + 1 (next day), ArrowRight => col - 1 (prev day)
    let nextRow = row;
    let nextCol = col;
    let isNav = false;

    if (event.key === 'ArrowLeft') {
      nextCol = Math.min(weekDates.length - 1, col + 1);
      isNav = true;
    } else if (event.key === 'ArrowRight') {
      nextCol = Math.max(0, col - 1);
      isNav = true;
    } else if (event.key === 'ArrowUp' && !event.altKey) {
      nextRow = Math.max(0, row - 1);
      isNav = true;
    } else if (event.key === 'ArrowDown' && !event.altKey) {
      nextRow = Math.min(visibleGridRows.length - 1, row + 1);
      isNav = true;
    } else if (event.key === 'Home') {
      nextRow = mod ? 0 : row;
      nextCol = 0;
      isNav = true;
    } else if (event.key === 'End') {
      nextRow = mod ? visibleGridRows.length - 1 : row;
      nextCol = weekDates.length - 1;
      isNav = true;
    }

    if (isNav) {
      event.preventDefault();
      // Skip post-archived cells cleanly if stepping vertically/horizontally
      const stepRow = Math.sign(nextRow - row);
      const stepCol = Math.sign(nextCol - col);
      let candidateRow = nextRow;
      let candidateCol = nextCol;
      while (
        candidateRow >= 0 &&
        candidateRow < visibleGridRows.length &&
        candidateCol >= 0 &&
        candidateCol < weekDates.length
      ) {
        const btn = cellButtonRefs.current.get(
          `${candidateRow}:${candidateCol}`,
        );
        if (btn && !btn.disabled) break;
        if (stepRow === 0 && stepCol === 0) break;
        candidateRow += stepRow;
        candidateCol += stepCol;
      }
      if (
        candidateRow >= 0 &&
        candidateRow < visibleGridRows.length &&
        candidateCol >= 0 &&
        candidateCol < weekDates.length
      ) {
        const targetBtn = cellButtonRefs.current.get(
          `${candidateRow}:${candidateCol}`,
        );
        if (targetBtn && !targetBtn.disabled) {
          nextRow = candidateRow;
          nextCol = candidateCol;
        }
      }

      if (event.shiftKey) {
        const anchor = selection?.anchor ?? { row, col };
        let clampedExtent: GridCoord = { row: nextRow, col: nextCol };
        if (oneGlanceMode) {
          const anchorSide = visibleGridRows[anchor.row]?.side ?? 'TIME_BOUND';
          const minRow = anchorSide === 'TIME_BOUND' ? 0 : rightRowCount;
          const maxRow =
            anchorSide === 'TIME_BOUND'
              ? Math.max(0, rightRowCount - 1)
              : Math.max(rightRowCount, visibleGridRows.length - 1);
          clampedExtent = {
            row: Math.min(Math.max(nextRow, minRow), maxRow),
            col: nextCol,
          };
        }
        setSelection({ anchor, extent: clampedExtent });
      } else {
        setSelection(null);
      }
      focusGridCell(nextRow, nextCol);
      return;
    }

    // Open CellEditorDialog via Enter / ContextMenu / Shift+F10
    if (
      event.key === 'Enter' ||
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      event.preventDefault();
      if (!isCellPostArchived(action, logDate)) {
        onOpenCellEditor({ action, logDate });
      }
      return;
    }

    if (mod || event.altKey) return;

    // Space => 1-step cycle when single cell, toggle DONE/EMPTY when multi-cell
    if (event.code === 'Space' && !event.shiftKey) {
      event.preventDefault();
      if (selectedCellCount >= 2) {
        void handleMultiCellSpaceToggle();
      } else {
        setSelection(null);
        void handleCellPrimaryCycle(action, logDate, display);
      }
      return;
    }

    // Direct cell state hotkeys (physical KeyboardEvent.code)
    handleCellStateHotkey(event, getTargetCoords());
  };

  const computeWeekRate = (action: Action): string => {
    let sum = 0;
    let count = 0;
    for (const d of weekDates) {
      const display = resolveDisplay(action, d);
      const score = computeCellScore(display.state, display.percentValue);
      if (score !== null) {
        sum += score;
        count += 1;
      }
    }
    return count > 0 ? `${Math.round((sum / count) * 100)}%` : '-';
  };

  const toggleGroup = (periodId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [periodId]: !prev[periodId],
    }));
  };

  const handleDeferToQadaa = async () => {
    if (bulkBusy || !effectiveBulkDate || deferQadaaEligibleCount === 0) return;
    setBulkBusy(true);
    try {
      const res = await logBulkDeferToQadaa(effectiveBulkDate);
      if (res.items.length > 0) {
        onActionFeedback(
          `تم ترحيل ${formatArabicCells(res.items.length)} منتهية للقضاء`,
        );
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const handleApplyNormalDay = async () => {
    if (bulkBusy || !effectiveBulkDate) return;
    setBulkBusy(true);
    try {
      const res = await logBulkNormalDay(effectiveBulkDate);
      setNormalDialogOpen(false);
      if (res.items.length > 0) {
        onActionFeedback(
          `تم تطبيق يوم اعتيادي (${formatArabicCells(res.items.length)})`,
        );
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const activeDayCol = effectiveFocusedCell?.col ?? todayColIdx;
  const activeDayDate = weekDates[activeDayCol] ?? todayIslamicDate;

  const renderDesktopMatrixCell = (params: {
    action: Action;
    logDate: string;
    rowIndex: number;
    colIndex: number;
    dayLabel: string;
  }) => {
    const { action, logDate, rowIndex, colIndex, dayLabel } = params;
    const display = resolveDisplay(action, logDate);
    const nonInteractive = isCellPostArchived(action, logDate);
    const hasNote = display.note.trim().length > 0;
    const isTabStop =
      !nonInteractive &&
      effectiveFocusedCell !== null &&
      effectiveFocusedCell.row === rowIndex &&
      effectiveFocusedCell.col === colIndex;
    const isFocused =
      !nonInteractive &&
      focusedCell !== null &&
      effectiveFocusedCell !== null &&
      effectiveFocusedCell.row === rowIndex &&
      effectiveFocusedCell.col === colIndex;
    const isSelected =
      selectedCellCount >= 2 && isCoordInRect(rowIndex, colIndex, selectedRect);
    const isCopied = isCoordInRect(rowIndex, colIndex, copiedRect);
    const isFillSource =
      fillDrag !== null &&
      fillDrag.source.row === rowIndex &&
      fillDrag.source.col === colIndex;
    const isFillPreview =
      isCoordInFillDrag(rowIndex, colIndex, fillDrag) && !isFillSource;
    const coordKey = `${rowIndex}:${colIndex}`;

    return (
      <td key={logDate} className="cell-status" role="presentation">
        <div
          className={`m-cell-wrap ${isFocused ? 'has-focus' : ''} ${
            !nonInteractive && selectedCellCount < 2 ? 'is-fill-eligible' : ''
          } ${isFillSource ? 'is-fill-source' : ''}`}
        >
          <button
            ref={(el) => {
              if (el) {
                cellButtonRefs.current.set(coordKey, el);
              } else {
                cellButtonRefs.current.delete(coordKey);
              }
            }}
            type="button"
            role="gridcell"
            tabIndex={isTabStop ? 0 : -1}
            disabled={nonInteractive}
            aria-disabled={nonInteractive || undefined}
            aria-selected={isSelected}
            aria-label={`${action.title} ${dayLabel}${hasNote ? ' — يحتوي على ملاحظة' : ''}`}
            title={hasNote ? `ملاحظة: ${display.note.trim()}` : undefined}
            data-testid={`week-cell-${action.id}-${logDate}`}
            data-grid-row={rowIndex}
            data-grid-col={colIndex}
            className={`m-cell nums ${getCellStateClass(display.state)} ${
              isFocused ? 'is-grid-focused' : ''
            } ${isSelected ? 'is-grid-selected' : ''} ${
              isCopied ? 'is-grid-copied' : ''
            } ${isFillSource ? 'is-fill-source' : ''} ${
              isFillPreview ? 'is-fill-preview' : ''
            }`}
            onFocus={() => {
              if (!nonInteractive) {
                setFocusedCell({ row: rowIndex, col: colIndex });
              }
            }}
            onPointerDown={(e) => {
              if (nonInteractive) return;
              if (e.pointerType !== 'mouse' || e.button !== 0) return;
              suppressNextClickRef.current = false;

              if (e.shiftKey) {
                e.preventDefault();
                suppressNextClickRef.current = true;
                setTimeout(() => {
                  suppressNextClickRef.current = false;
                }, 50);
                const anchor =
                  selection?.anchor ??
                  effectiveFocusedCell ?? { row: rowIndex, col: colIndex };
                let extent: GridCoord = { row: rowIndex, col: colIndex };
                if (oneGlanceMode) {
                  const anchorSide =
                    visibleGridRows[anchor.row]?.side ?? 'TIME_BOUND';
                  const minRow =
                    anchorSide === 'TIME_BOUND' ? 0 : rightRowCount;
                  const maxRow =
                    anchorSide === 'TIME_BOUND'
                      ? Math.max(0, rightRowCount - 1)
                      : Math.max(rightRowCount, visibleGridRows.length - 1);
                  extent = {
                    row: Math.min(Math.max(rowIndex, minRow), maxRow),
                    col: colIndex,
                  };
                }
                setSelection({ anchor, extent });
                focusGridCell(extent.row, extent.col);
                return;
              }

              const rowMeta = visibleGridRows[rowIndex];
              dragSelectRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                anchor: { row: rowIndex, col: colIndex },
                anchorSide: rowMeta?.side ?? 'TIME_BOUND',
                active: false,
              };
            }}
            onClick={() => {
              if (nonInteractive) return;
              if (suppressNextClickRef.current) {
                suppressNextClickRef.current = false;
                return;
              }
              setSelection(null);
              setFocusedCell({ row: rowIndex, col: colIndex });
              void handleCellPrimaryCycle(action, logDate, display);
            }}
            onContextMenu={(e) => {
              if (nonInteractive) return;
              e.preventDefault();
              setFocusedCell({ row: rowIndex, col: colIndex });
              onOpenCellEditor({ action, logDate });
            }}
            onKeyDown={(e) =>
              handleGridCellKeyDown(e, rowIndex, colIndex, action, logDate, display)
            }
          >
            {renderCellGlyph(display.state, display.percentValue)}
            {hasNote && <span className="m-cell-note-dot" aria-hidden="true" />}
          </button>

          {!nonInteractive && (
            <span
              className="m-fill-handle"
              data-testid="fill-handle"
              aria-hidden="true"
              onPointerDown={(e) => {
                if (e.pointerType !== 'mouse' || e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                window.getSelection()?.removeAllRanges();
                const rowMeta = visibleGridRows[rowIndex];
                const nextFill: FillDragState = {
                  source: { row: rowIndex, col: colIndex },
                  startX: e.clientX,
                  startY: e.clientY,
                  target: { row: rowIndex, col: colIndex },
                  sourceSnapshot: snapshotCellFromDisplay(display),
                  sourceSide: rowMeta?.side ?? 'TIME_BOUND',
                };
                fillDragRef.current = nextFill;
                setFillDrag(nextFill);
                setSelection(null);
                setFocusedCell({ row: rowIndex, col: colIndex });
                document.body.style.cursor = 'crosshair';
              }}
            />
          )}
        </div>
      </td>
    );
  };

  const renderStandardGroupRows = (group: Period) => {
    const groupActions = actionsByPeriodId.get(group.id) ?? [];
    if (groupActions.length === 0) return null;
    const isCollapsed = Boolean(collapsedGroups[group.id]);
    const isLive =
      weekDates.includes(todayIslamicDate) && livePeriodIds.has(group.id);
    const liveWin = isLive ? todayWindowsByPeriodId.get(group.id) : undefined;
    const groupDropProps = dnd.getGroupDropProps(group.id);

    return (
      <React.Fragment key={group.id}>
        <tr className="group-row" role="row" {...groupDropProps}>
          <td colSpan={9}>
            <div className="group-row-bar">
              <button
                type="button"
                className="group-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(group.id)}
              >
                <span className="group-toggle-start">
                  {isCollapsed ? (
                    <IconChevronLeft size="sm" />
                  ) : (
                    <IconChevronDown size="sm" />
                  )}
                  <span>{group.title}</span>
                  <span className="panel-meta nums">({groupActions.length})</span>
                </span>

                {liveWin && (
                  <span className="panel-meta nums" dir="ltr">
                    {formatHhmmInTz(liveWin.startInstant, settings.iana_timezone)}{' '}
                    -{' '}
                    {formatHhmmInTz(liveWin.endInstant, settings.iana_timezone)}
                  </span>
                )}

                {liveWin && (
                  <span className="horizon-track" aria-hidden="true">
                    <span
                      className={`horizon-fill ${liveWin.isPreExpiry ? 'closing' : ''}`}
                      style={{ width: `${Math.round(liveWin.elapsedRatio * 100)}%` }}
                    />
                  </span>
                )}
              </button>

              <div className="group-row-actions">
                <button
                  type="button"
                  className="btn group-select-btn"
                  aria-label={`تحديد مجموعة ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`}
                  onClick={() => {
                    if (isCollapsed) {
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [group.id]: false,
                      }));
                    } else {
                      handleSelectPeriodColumn(group.id, activeDayCol);
                    }
                  }}
                >
                  تحديد
                </button>
                <button
                  type="button"
                  className="period-quick-done-btn group-quick-done-btn"
                  aria-label={`إكمال جميع أعمال ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`}
                  title={`إكمال ${group.title} (${formatArabicDateFull(activeDayDate)})`}
                  onClick={() => {
                    void handleQuickCompletePeriod(group, activeDayDate);
                  }}
                >
                  <IconCheck size="sm" />
                </button>
              </div>
            </div>
          </td>
        </tr>

        {!isCollapsed &&
          groupActions.map((action) => {
            const tv = resolveActiveTargetVersion(
              targetVersions,
              action.id,
              effectiveBulkDate,
            );
            const rowIndex = rowIndexByActionId.get(action.id) ?? 0;
            const itemProps = dnd.getItemProps(action.id);
            const handleProps = dnd.getHandleProps(action.id);
            const isRowSelected =
              selectedRect !== null &&
              selectedRect.r1 <= rowIndex &&
              selectedRect.r2 >= rowIndex &&
              selectedRect.c1 === 0 &&
              selectedRect.c2 === weekDates.length - 1;

            return (
              <tr
                key={action.id}
                className={`data-row ${isRowSelected ? 'is-row-selected' : ''}`}
                role="row"
                {...itemProps}
              >
                <td className="cell-title" title={action.title}>
                  <div className="cell-title-inner">
                    <button
                      type="button"
                      className="dnd-handle-btn"
                      data-testid={`dnd-handle-${action.id}`}
                      aria-label={`إعادة ترتيب ${action.title}`}
                      title={
                        isOnline
                          ? 'اسحب لإعادة الترتيب أو استخدم Alt+↑/↓'
                          : 'إعادة الترتيب متاحة عند الاتصال بالإنترنت فقط'
                      }
                      {...handleProps}
                    >
                      <IconGripVertical size="sm" />
                    </button>
                    <button
                      type="button"
                      className={`row-title-btn ${isRowSelected ? 'is-row-selected' : ''}`}
                      aria-label={`تحديد صف ${action.title}`}
                      onClick={() => handleSelectActionRow(rowIndex)}
                    >
                      <span className="cell-title-text">{action.title}</span>
                      {tv && (
                        <span className="target-tag nums ms-1">
                          {tv.target_label}
                        </span>
                      )}
                    </button>
                  </div>
                </td>

                {weekDates.map((d, colIdx) => {
                  const dowName =
                    AR_STRINGS.week.weekdaysAr[getIsoDayOfWeek(d)] ?? d;
                  return renderDesktopMatrixCell({
                    action,
                    logDate: d,
                    rowIndex,
                    colIndex: colIdx,
                    dayLabel: dowName,
                  });
                })}

                <td className="cell-rate nums">{computeWeekRate(action)}</td>
              </tr>
            );
          })}
      </React.Fragment>
    );
  };

  const renderMobileCompactGroupRows = (group: Period) => {
    const groupActions = actionsByPeriodId.get(group.id) ?? [];
    if (groupActions.length === 0) return null;
    const isCollapsed = Boolean(collapsedGroups[group.id]);

    return (
      <React.Fragment key={group.id}>
        <tr className="group-row">
          <td colSpan={9}>
            <button
              type="button"
              className="group-toggle"
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(group.id)}
            >
              <span className="group-toggle-start">
                {isCollapsed ? (
                  <IconChevronLeft size="sm" />
                ) : (
                  <IconChevronDown size="sm" />
                )}
                <span>{group.title}</span>
                <span className="panel-meta nums">({groupActions.length})</span>
              </span>
            </button>
          </td>
        </tr>

        {!isCollapsed &&
          groupActions.map((action) => (
            <tr key={action.id} className="data-row">
              <td className="cell-title" title={action.title}>
                {action.title}
              </td>
              {weekDates.map((d) => {
                const display = resolveDisplay(action, d);
                const nonInteractive = isCellPostArchived(action, d);
                const hasNote = display.note.trim().length > 0;
                const abbr =
                  AR_STRINGS.week.weekdaysShortEn[getIsoDayOfWeek(d)] ?? d;
                const cellKey = `mc:${action.id}:${d}`;

                return (
                  <td key={d} className="cell-status">
                    <button
                      type="button"
                      disabled={nonInteractive}
                      aria-disabled={nonInteractive || undefined}
                      className={`m-cell nums ${getCellStateClass(display.state)} ${
                        longPress.pressingKey === cellKey ? 'is-pressing' : ''
                      }`}
                      aria-label={`${action.title} ${abbr}${hasNote ? ' — يحتوي على ملاحظة' : ''}`}
                      title={hasNote ? `ملاحظة: ${display.note.trim()}` : undefined}
                      onPointerDown={(e) =>
                        longPress.handlePointerDown(
                          e,
                          cellKey,
                          nonInteractive,
                          () => onOpenCellEditor({ action, logDate: d }),
                        )
                      }
                      onPointerMove={longPress.handlePointerMove}
                      onPointerUp={longPress.handlePointerUp}
                      onPointerCancel={longPress.handlePointerCancel}
                      onClick={(e) => {
                        if (nonInteractive) return;
                        if (longPress.shouldSuppressClick(e, cellKey)) return;
                        void handleCellPrimaryCycle(action, d, display);
                      }}
                      onContextMenu={(e) => {
                        if (nonInteractive) return;
                        if (longPress.shouldSuppressContextMenu(e, cellKey)) {
                          return;
                        }
                        e.preventDefault();
                        onOpenCellEditor({ action, logDate: d });
                      }}
                    >
                      {renderCellGlyph(display.state, display.percentValue)}
                      {hasNote && (
                        <span className="m-cell-note-dot" aria-hidden="true" />
                      )}
                    </button>
                  </td>
                );
              })}
              <td className="cell-rate nums">{computeWeekRate(action)}</td>
            </tr>
          ))}
      </React.Fragment>
    );
  };

  const renderOneGlanceSideTable = (side: 'TIME_BOUND' | 'DAILY_GROUP') => {
    const groups =
      side === 'TIME_BOUND' ? activeGroups.right : activeGroups.left;
    const populatedGroups = groups.filter(
      (g) => (actionsByPeriodId.get(g.id)?.length ?? 0) > 0,
    );
    const sideClass =
      side === 'TIME_BOUND' ? 'overview-table-time' : 'overview-table-daily';

    const sideStartRow = side === 'TIME_BOUND' ? 0 : rightRowCount;
    const sideEndRow =
      side === 'TIME_BOUND'
        ? Math.max(0, rightRowCount - 1)
        : visibleGridRows.length - 1;

    return (
      <div className="ledger-table-wrap">
        <table
          className={`ledger-table ${sideClass}`}
          role="grid"
          aria-multiselectable="true"
          aria-label={
            side === 'TIME_BOUND'
              ? AR_STRINGS.week.rightSideTitle
              : AR_STRINGS.week.leftSideTitle
          }
        >
          <thead>
            <tr role="row">
              <th className="col-period" scope="col">
                {side === 'TIME_BOUND' ? 'الفترة' : 'المجموعة'}
              </th>
              <th className="col-action" scope="col">
                العمل
              </th>
              {weekDates.map((d, colIdx) => {
                const { day } = parseIsoDateParts(d);
                const abbr =
                  AR_STRINGS.week.weekdaysShortEn[getIsoDayOfWeek(d)] ?? '';
                const isToday = d === todayIslamicDate;
                const isColSelected =
                  selectedRect !== null &&
                  selectedRect.c1 === colIdx &&
                  selectedRect.c2 === colIdx &&
                  selectedRect.r1 === sideStartRow &&
                  selectedRect.r2 === sideEndRow;
                return (
                  <th
                    key={d}
                    className={`col-day ${isToday ? 'is-today' : ''}`}
                    scope="col"
                  >
                    <button
                      type="button"
                      className={`col-day-btn ${isColSelected ? 'is-col-selected' : ''}`}
                      aria-label={`تحديد عمود ${formatArabicDateFull(d)}`}
                      onClick={() => handleSelectDayColumn(colIdx, side)}
                    >
                      <span dir="ltr" className="block text-[10px] leading-tight">
                        {abbr}
                      </span>
                      <span className="block nums text-[10px] leading-tight">
                        {day}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th className="col-rate" scope="col">
                %
              </th>
            </tr>
          </thead>

          <tbody>
            {populatedGroups.map((group, groupIdx) => {
              const groupActions = actionsByPeriodId.get(group.id) ?? [];
              const isLive =
                weekDates.includes(todayIslamicDate) &&
                livePeriodIds.has(group.id);
              const isLastGroup = groupIdx === populatedGroups.length - 1;

              return (
                <React.Fragment key={group.id}>
                  {groupActions.map((action, idx) => {
                    const isLastInGroup = idx === groupActions.length - 1;
                    const rowIndex = rowIndexByActionId.get(action.id) ?? 0;
                    const isRowSelected =
                      selectedRect !== null &&
                      selectedRect.r1 <= rowIndex &&
                      selectedRect.r2 >= rowIndex &&
                      selectedRect.c1 === 0 &&
                      selectedRect.c2 === weekDates.length - 1;
                    return (
                      <tr
                        key={action.id}
                        role="row"
                        className={`data-row ${isLastInGroup ? 'period-end-row' : ''} ${
                          isRowSelected ? 'is-row-selected' : ''
                        }`}
                      >
                        {idx === 0 && (
                          <td
                            className={`cell-period ${isLive ? 'is-live-period' : ''}`}
                            rowSpan={groupActions.length}
                          >
                            <div className="cell-period-inner">
                              <button
                                type="button"
                                className="period-select-btn"
                                aria-label={`تحديد فترة ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`}
                                onClick={() =>
                                  handleSelectPeriodColumn(group.id, activeDayCol)
                                }
                              >
                                {group.title}
                              </button>
                              <button
                                type="button"
                                className="period-quick-done-btn"
                                aria-label={`إكمال جميع أعمال ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`}
                                title={`إكمال ${group.title} (${formatArabicDateFull(activeDayDate)})`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleQuickCompletePeriod(
                                    group,
                                    activeDayDate,
                                  );
                                }}
                              >
                                <IconCheck size="sm" />
                              </button>
                            </div>
                          </td>
                        )}
                        <td className="cell-title" title={action.title}>
                          <button
                            type="button"
                            className={`row-title-btn ${isRowSelected ? 'is-row-selected' : ''}`}
                            aria-label={`تحديد صف ${action.title}`}
                            onClick={() => handleSelectActionRow(rowIndex)}
                          >
                            <span className="cell-title-text">
                              {action.title}
                            </span>
                          </button>
                        </td>
                        {weekDates.map((d, colIdx) => {
                          const abbr =
                            AR_STRINGS.week.weekdaysShortEn[
                              getIsoDayOfWeek(d)
                            ] ?? d;
                          return renderDesktopMatrixCell({
                            action,
                            logDate: d,
                            rowIndex,
                            colIndex: colIdx,
                            dayLabel: abbr,
                          });
                        })}
                        <td className="cell-rate nums">
                          {computeWeekRate(action)}
                        </td>
                      </tr>
                    );
                  })}
                  {!isLastGroup && (
                    <tr className="period-spacer" aria-hidden="true">
                      <td colSpan={10} />
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <div className="matrix-toolbar">
        <div className="matrix-toolbar-group">
          <button
            type="button"
            className="btn"
            aria-label={AR_STRINGS.week.previousWeek}
            onClick={() =>
              navigateWeek(addDaysIso(weekDates[0]!, -7))
            }
          >
            <IconChevronRight size="sm" />
            <span>{AR_STRINGS.week.previousWeek}</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => navigateWeek(todayIslamicDate)}
          >
            {AR_STRINGS.week.todayButton}
          </button>

          <button
            type="button"
            className="btn"
            aria-label={AR_STRINGS.week.nextWeek}
            onClick={() =>
              navigateWeek(addDaysIso(weekDates[0]!, 7))
            }
          >
            <span>{AR_STRINGS.week.nextWeek}</span>
            <IconChevronLeft size="sm" />
          </button>

          <strong className="text-sm nums">
            أسبوع {formatArabicDateRange(weekDates[0]!, weekDates[6]!)}
          </strong>
          {loadingWeekRange && (
            <span className="panel-meta">جاري تحميل السجلات...</span>
          )}
        </div>

        <div className="matrix-toolbar-group">
          <div className="seg-tabs desktop-only" role="tablist" aria-label="وضع عرض الجدول">
            <button
              type="button"
              role="tab"
              className="seg-tab"
              aria-selected={!oneGlanceMode}
              onClick={() => onSetOneGlanceMode(false)}
            >
              {AR_STRINGS.week.standardMode}
            </button>
            <button
              type="button"
              role="tab"
              className="seg-tab"
              aria-selected={oneGlanceMode}
              onClick={() => onSetOneGlanceMode(true)}
            >
              نظرة واحدة
            </button>
          </div>

          <div
            className="toolbar-bulk-group"
            role="group"
            aria-label="إجراءات جماعية ليوم محدد"
          >
            <select
              className="field-select"
              aria-label="اليوم المستهدف للإجراءات الجماعية"
              value={effectiveBulkDate}
              disabled={bulkBusy}
              onChange={(e) => {
                const nextDate = e.target.value;
                setSelectedBulkDate(nextDate);
                const nextCol = weekDates.indexOf(nextDate);
                if (nextCol >= 0) {
                  setFocusedCell((prev) => ({
                    row: prev?.row ?? 0,
                    col: nextCol,
                  }));
                }
              }}
            >
              {weekDates.map((d) => (
                <option key={d} value={d}>
                  {formatArabicDateFull(d)}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn"
              data-testid="btn-normal-day"
              disabled={bulkBusy}
              onClick={() => setNormalDialogOpen(true)}
            >
              {AR_STRINGS.week.normalDayButton}
            </button>

            <button
              type="button"
              className="btn"
              data-testid="btn-defer-qadaa"
              disabled={bulkBusy || deferQadaaEligibleCount === 0}
              onClick={() => {
                void handleDeferToQadaa();
              }}
            >
              {AR_STRINGS.week.deferToQadaaButton}
              {deferQadaaEligibleCount > 0 ? ` (${deferQadaaEligibleCount})` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Matrix: Standard Mode OR One-Glance Side-by-Side */}
      <div className="matrix-desktop-wrap">
        <div
          className="matrix-hint-strip mb-2"
          data-testid="week-hint-strip"
          aria-label="تلميحات استخدام الجدول"
        >
          <span className="matrix-hint-item">نقرة: تبديل فوري</span>
          <span className="matrix-hint-item">كليك يمين: تعديل وملاحظة</span>
          <span className="matrix-hint-item">سحب أو Shift: تحديد متعدد</span>
          <span className="matrix-hint-item">مقبض الزاوية: تعبئة سريعة</span>
          <span className="matrix-hint-item">Ctrl+C / Ctrl+V: نسخ ولصق</span>
          {!oneGlanceMode && isOnline && (
            <span className="matrix-hint-item">مقبض السحب أو Alt+↑/↓: إعادة الترتيب</span>
          )}
        </div>

        <div ref={desktopGridAreaRef}>
          {oneGlanceMode ? (
            <div className="overview-split" data-testid="one-glance-split">
              {renderOneGlanceSideTable('TIME_BOUND')}
              {renderOneGlanceSideTable('DAILY_GROUP')}
            </div>
          ) : (
            <div className="ledger-table-wrap">
              <table
                className="ledger-table"
                role="grid"
                aria-multiselectable="true"
                aria-label="الجدول الأسبوعي"
              >
                <thead>
                  <tr role="row">
                    <th className="col-action" scope="col">
                      العمل
                    </th>
                    {weekDates.map((d, colIdx) => {
                      const { day } = parseIsoDateParts(d);
                      const dowName =
                        AR_STRINGS.week.weekdaysAr[getIsoDayOfWeek(d)] ?? '';
                      const isToday = d === todayIslamicDate;
                      const isColSelected =
                        selectedRect !== null &&
                        selectedRect.c1 === colIdx &&
                        selectedRect.c2 === colIdx &&
                        selectedRect.r1 === 0 &&
                        selectedRect.r2 === visibleGridRows.length - 1;
                      return (
                        <th
                          key={d}
                          className={`col-day ${isToday ? 'is-today' : ''}`}
                          scope="col"
                        >
                          <button
                            type="button"
                            className={`col-day-btn ${isColSelected ? 'is-col-selected' : ''}`}
                            aria-label={`تحديد عمود ${formatArabicDateFull(d)}`}
                            onClick={() => handleSelectDayColumn(colIdx)}
                          >
                            <span>{dowName}</span>
                            <span className="nums">{day}</span>
                          </button>
                        </th>
                      );
                    })}
                    <th className="col-rate" scope="col">
                      النسبة
                    </th>
                  </tr>
                </thead>

                <tbody>
                  <tr className="side-label-row" role="row">
                    <td colSpan={9}>{AR_STRINGS.week.rightSideTitle}</td>
                  </tr>
                  {activeGroups.right.map(renderStandardGroupRows)}

                  <tr className="side-divider" aria-hidden="true">
                    <td colSpan={9} />
                  </tr>

                  <tr className="side-label-row" role="row">
                    <td colSpan={9}>{AR_STRINGS.week.leftSideTitle}</td>
                  </tr>
                  {activeGroups.left.map(renderStandardGroupRows)}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Floating Bulk Selection Bar when >= 2 cells are selected */}
        {selectedCellCount >= 2 && (
          <div className="week-bulk-bar-wrap">
            <div
              ref={bulkBarRef}
              className="week-bulk-bar"
              role="toolbar"
              aria-label="إجراءات التحديد المتعدد"
              data-testid="week-bulk-bar"
            >
              <span className="week-bulk-count nums">
                {formatArabicCells(selectedCellCount)}
              </span>

              <button
                type="button"
                className="btn btn-live"
                aria-label="تم للكل"
                onClick={() => {
                  void applyTargetStateToCoords(
                    getTargetCoords(),
                    { kind: 'DONE', percentValue: null },
                    {
                      showToast: true,
                      actionNameAr: 'تم تحديد تم للكل',
                      clearSelection: true,
                    },
                  );
                }}
              >
                <IconCheck size="sm" />
                <span>تم</span>
              </button>

              <button
                type="button"
                className="btn btn-danger"
                aria-label="فات للكل"
                onClick={() => {
                  void applyTargetStateToCoords(
                    getTargetCoords(),
                    { kind: 'MISSED', percentValue: null },
                    {
                      showToast: true,
                      actionNameAr: 'تم تحديد فات للكل',
                      clearSelection: true,
                    },
                  );
                }}
              >
                <IconCross size="sm" />
                <span>فات</span>
              </button>

              {selectedHasPercentageEligible && (
                <button
                  type="button"
                  className="btn"
                  aria-label="نسبة 50%"
                  onClick={() => {
                    void applyTargetStateToCoords(
                      getTargetCoords(),
                      { kind: 'PERCENT', percentValue: 50 },
                      {
                        showToast: true,
                        actionNameAr: 'تم تحديد 50%',
                        clearSelection: true,
                      },
                    );
                  }}
                >
                  <span className="nums">50%</span>
                </button>
              )}

              {selectedHasQadaaEligible && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void applyTargetStateToCoords(
                      getTargetCoords(),
                      { kind: 'QADAA_DONE', percentValue: null },
                      {
                        showToast: true,
                        actionNameAr: 'تم تسجيل القضاء',
                        clearSelection: true,
                      },
                    );
                  }}
                >
                  <IconQadaa size="sm" />
                  <span>قضاء</span>
                </button>
              )}

              <button
                type="button"
                className="btn"
                aria-label="تعطيل للكل"
                onClick={() => {
                  void applyTargetStateToCoords(
                    getTargetCoords(),
                    { kind: 'DISABLED', percentValue: null },
                    {
                      showToast: true,
                      actionNameAr: 'تم تعطيل',
                      clearSelection: true,
                    },
                  );
                }}
              >
                <IconDash size="sm" />
                <span>تعطيل</span>
              </button>

              <button
                type="button"
                className="btn"
                onClick={() => {
                  void applyTargetStateToCoords(
                    getTargetCoords(),
                    { kind: 'EMPTY', percentValue: null },
                    {
                      showToast: true,
                      actionNameAr: 'تم مسح الحالات',
                      clearSelection: true,
                    },
                  );
                }}
              >
                <span>مسح</span>
              </button>

              <button
                type="button"
                className="btn"
                onClick={() => handleCopySelection({ clearSelection: true })}
              >
                <IconCopy size="sm" />
                <span>نسخ</span>
              </button>

              {hasClipboard && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void handlePasteSelection();
                  }}
                >
                  <IconClipboard size="sm" />
                  <span>لصق</span>
                </button>
              )}

              <button
                type="button"
                className="btn btn-icon week-bulk-close"
                aria-label="إلغاء التحديد"
                title="إلغاء التحديد (Esc)"
                onClick={() => setSelection(null)}
              >
                <IconX size="sm" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile View: WHOOP 7-Day Boxes (Sat..Fri) + Compact Grid Toggle */}
      <div className="matrix-mobile-wrap">
        <div className="seg-tabs" role="tablist" aria-label="عرض الموبايل">
          <button
            type="button"
            role="tab"
            className="seg-tab"
            aria-selected={!mobileCompactGrid}
            onClick={() => setMobileCompactGrid(false)}
          >
            صناديق الأسبوع
          </button>
          <button
            type="button"
            role="tab"
            className="seg-tab"
            aria-selected={mobileCompactGrid}
            onClick={() => setMobileCompactGrid(true)}
          >
            جدول مضغوط
          </button>
        </div>

        <p className="matrix-mobile-hint">
          نقرة لتبديل الحالة، واضغط مطوّلاً للتعديل المفصّل أو إضافة ملاحظة
        </p>

        {!mobileCompactGrid ? (
          <div className="flex flex-col gap-3">
            {[...activeGroups.right, ...activeGroups.left].map((group) => {
              const groupActions = actionsByPeriodId.get(group.id) ?? [];
              if (groupActions.length === 0) return null;
              const isCollapsed = Boolean(collapsedGroups[group.id]);

              return (
                <section key={group.id} className="panel">
                  <button
                    type="button"
                    className="group-toggle"
                    aria-expanded={!isCollapsed}
                    style={{
                      background: 'var(--bg-subtle)',
                      borderBlockEnd: isCollapsed
                        ? 'none'
                        : '1px solid var(--border-hairline)',
                    }}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span className="group-toggle-start">
                      {isCollapsed ? (
                        <IconChevronLeft size="sm" />
                      ) : (
                        <IconChevronDown size="sm" />
                      )}
                      <span>{group.title}</span>
                    </span>
                    <span className="panel-meta nums">
                      {groupActions.length} أعمال
                    </span>
                  </button>

                  {!isCollapsed &&
                    groupActions.map((action) => (
                      <div key={action.id} className="m-whoop-row">
                        <div className="m-whoop-head">
                          <span className="text-sm font-medium">
                            {action.title}
                          </span>
                          <span className="panel-meta nums">
                            {computeWeekRate(action)}
                          </span>
                        </div>
                        <div className="m-whoop-days">
                          {weekDates.map((d) => {
                            const display = resolveDisplay(action, d);
                            const nonInteractive = isCellPostArchived(
                              action,
                              d,
                            );
                            const hasNote = display.note.trim().length > 0;
                            const abbr =
                              AR_STRINGS.week.weekdaysShortEn[
                                getIsoDayOfWeek(d)
                              ] ?? '';
                            const cellKey = `wh:${action.id}:${d}`;

                            return (
                              <button
                                key={d}
                                type="button"
                                disabled={nonInteractive}
                                aria-disabled={nonInteractive || undefined}
                                className={`m-whoop-day ${
                                  longPress.pressingKey === cellKey
                                    ? 'is-pressing'
                                    : ''
                                }`}
                                aria-label={`${action.title} ${abbr}${hasNote ? ' — يحتوي على ملاحظة' : ''}`}
                                title={
                                  hasNote
                                    ? `ملاحظة: ${display.note.trim()}`
                                    : undefined
                                }
                                onPointerDown={(e) =>
                                  longPress.handlePointerDown(
                                    e,
                                    cellKey,
                                    nonInteractive,
                                    () =>
                                      onOpenCellEditor({ action, logDate: d }),
                                  )
                                }
                                onPointerMove={longPress.handlePointerMove}
                                onPointerUp={longPress.handlePointerUp}
                                onPointerCancel={longPress.handlePointerCancel}
                                onClick={(e) => {
                                  if (nonInteractive) return;
                                  if (
                                    longPress.shouldSuppressClick(e, cellKey)
                                  ) {
                                    return;
                                  }
                                  void handleCellPrimaryCycle(
                                    action,
                                    d,
                                    display,
                                  );
                                }}
                                onContextMenu={(e) => {
                                  if (nonInteractive) return;
                                  if (
                                    longPress.shouldSuppressContextMenu(
                                      e,
                                      cellKey,
                                    )
                                  ) {
                                    return;
                                  }
                                  e.preventDefault();
                                  onOpenCellEditor({ action, logDate: d });
                                }}
                              >
                                <span className="m-whoop-day-lbl" dir="ltr">
                                  {abbr}
                                </span>
                                <span
                                  className={`m-whoop-box nums ${getCellStateClass(display.state)}`}
                                >
                                  {renderCellGlyph(
                                    display.state,
                                    display.percentValue,
                                  )}
                                  {hasNote && (
                                    <span
                                      className="m-cell-note-dot"
                                      aria-hidden="true"
                                    />
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="ledger-table-wrap mobile-compact-wrap">
            <table className="ledger-table mobile-compact-table">
              <thead>
                <tr>
                  <th className="col-action">العمل</th>
                  {weekDates.map((d) => {
                    const { day } = parseIsoDateParts(d);
                    const abbr =
                      AR_STRINGS.week.weekdaysShortEn[getIsoDayOfWeek(d)] ?? '';
                    const isToday = d === todayIslamicDate;
                    return (
                      <th
                        key={d}
                        className={`col-day ${isToday ? 'is-today' : ''}`}
                      >
                        <span dir="ltr">{abbr}</span>
                        <div className="nums">{day}</div>
                      </th>
                    );
                  })}
                  <th className="col-rate">%</th>
                </tr>
              </thead>
              <tbody>
                {[...activeGroups.right, ...activeGroups.left].map(
                  renderMobileCompactGroupRows,
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DnD Floating Ghost & Screen-Reader Live Region */}
      <PointerDragGhost dragState={dnd.dragState} />
      <div className="sr-only" aria-live="assertive" role="status">
        {dnd.liveAnnouncement}
      </div>

      {/* Normal Day Confirmation Dialog */}
      <dialog
        ref={normalDialogRef}
        className="app-dialog"
        aria-labelledby="normal-day-dialog-title"
        onCancel={(e) => {
          e.preventDefault();
          setNormalDialogOpen(false);
        }}
        onClick={(e) => {
          if (e.target === normalDialogRef.current) {
            setNormalDialogOpen(false);
          }
        }}
      >
        <div className="dialog-head">
          <h3 className="dialog-title" id="normal-day-dialog-title">
            {AR_STRINGS.week.normalDayButton}
          </h3>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="إغلاق"
            onClick={() => setNormalDialogOpen(false)}
          >
            <IconCross size="sm" />
          </button>
        </div>

        <div className="dialog-body">
          <p className="m-0">
            سيتم تعبئة{' '}
            <strong className="nums">
              {formatArabicCells(normalDayEligibleCount)}
            </strong>{' '}
            فارغة فقط ليوم{' '}
            <strong>{formatArabicDateFull(effectiveBulkDate)}</strong> بحالة
            «تم».
          </p>
          <p className="m-0 panel-meta">
            الأعمال الجوهرية والصلوات الفائتة المعلّمة مسبقاً لا تُمسّ ولا
            تُستبدل تلقائياً.
          </p>
        </div>

        <div className="dialog-foot">
          <button
            type="button"
            className="btn"
            disabled={bulkBusy}
            onClick={() => setNormalDialogOpen(false)}
          >
            {AR_STRINGS.week.cancel}
          </button>
          <button
            type="button"
            className="btn btn-live"
            disabled={bulkBusy || normalDayEligibleCount === 0}
            onClick={() => {
              void handleApplyNormalDay();
            }}
          >
            تطبيق التعبئة
          </button>
        </div>
      </dialog>
    </>
  );
}

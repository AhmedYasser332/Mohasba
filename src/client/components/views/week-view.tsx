'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { AppDialog } from '../app-dialog';
import {
  IconArrowDown,
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
import {
  TableCrosshairStage,
  createCrosshairCoordinator,
  type CrosshairFocusTarget,
} from './table-crosshair-stage';

/** Max gap between clicks/taps on the same cell to count as a repeat (cycle) click. */
const MULTI_TAP_WINDOW_MS = 450;

function useCellButtonRefs() {
  const cellButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const callbacksRef = useRef<
    Map<string, (el: HTMLButtonElement | null) => void>
  >(new Map());

  const getCellButtonRef = useCallback((coordKey: string) => {
    let cb = callbacksRef.current.get(coordKey);
    if (!cb) {
      cb = (el: HTMLButtonElement | null) => {
        if (el) {
          cellButtonRefs.current.set(coordKey, el);
        } else {
          cellButtonRefs.current.delete(coordKey);
        }
      };
      callbacksRef.current.set(coordKey, cb);
    }
    return cb;
  }, []);

  return { cellButtonRefs, getCellButtonRef };
}

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
  sourceRect: GridRect;
  sourceMatrix: ClipboardMatrix;
  startX: number;
  startY: number;
  target: GridCoord;
  sourceSide: 'TIME_BOUND' | 'DAILY_GROUP';
}

interface SessionUndoEntry {
  batchId: string | null;
  mutationId: string | null;
  priorInputs: CellMutationInput[];
  appliedInputs: CellMutationInput[];
  createdAt: number;
}

interface ContextMenuState {
  x: number;
  y: number;
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

function doesUndoEntryMatchLiveLogs(
  entry: SessionUndoEntry,
  logsByKey: ReadonlyMap<
    string,
    {
      status: CellStatus | null;
      percent_value: number | null;
      availability_override: AvailabilityOverride | null;
      note: string | null;
    }
  >,
): boolean {
  for (const input of entry.appliedInputs) {
    const liveLog = logsByKey.get(makeCellKey(input.action.id, input.logDate));
    if (!liveLog) return false;
    if (
      (liveLog.status ?? null) !== (input.status ?? null) ||
      (liveLog.percent_value ?? null) !== (input.percent_value ?? null) ||
      (liveLog.availability_override ?? null) !==
        (input.availability_override ?? null) ||
      (liveLog.note ?? null) !== (input.note ?? null)
    ) {
      return false;
    }
  }
  return true;
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

function getFillPreviewRect(fillDrag: FillDragState | null): GridRect | null {
  if (!fillDrag) return null;
  const { sourceRect, target } = fillDrag;
  if (target.row > sourceRect.r2) {
    return {
      r1: sourceRect.r2 + 1,
      r2: target.row,
      c1: sourceRect.c1,
      c2: sourceRect.c2,
    };
  }
  if (target.row < sourceRect.r1) {
    return {
      r1: target.row,
      r2: sourceRect.r1 - 1,
      c1: sourceRect.c1,
      c2: sourceRect.c2,
    };
  }
  if (target.col > sourceRect.c2) {
    return {
      r1: sourceRect.r1,
      r2: sourceRect.r2,
      c1: sourceRect.c2 + 1,
      c2: target.col,
    };
  }
  if (target.col < sourceRect.c1) {
    return {
      r1: sourceRect.r1,
      r2: sourceRect.r2,
      c1: target.col,
      c2: sourceRect.c1 - 1,
    };
  }
  return null;
}

function getFillTargetEntries(
  fillDrag: FillDragState,
): Array<{ coord: GridCoord; snapshot: ClipboardCellSnapshot }> {
  const previewRect = getFillPreviewRect(fillDrag);
  if (!previewRect) return [];
  const { sourceRect, sourceMatrix } = fillDrag;
  const entries: Array<{ coord: GridCoord; snapshot: ClipboardCellSnapshot }> =
    [];

  for (let r = previewRect.r1; r <= previewRect.r2; r += 1) {
    const srcRow =
      (((r - sourceRect.r1) % sourceMatrix.rows) + sourceMatrix.rows) %
      sourceMatrix.rows;
    for (let c = previewRect.c1; c <= previewRect.c2; c += 1) {
      const srcCol =
        (((c - sourceRect.c1) % sourceMatrix.cols) + sourceMatrix.cols) %
        sourceMatrix.cols;
      const snapshot = sourceMatrix.cells[srcRow]?.[srcCol];
      if (!snapshot) continue;
      entries.push({ coord: { row: r, col: c }, snapshot });
    }
  }
  return entries;
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
    activeUndoToast,
    fetchLogsRange,
    logCellBatch,
    logBulkNormalDay,
    logBulkDeferToQadaa,
    undoMutation,
    undoBatch,
    dismissUndoToast,
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

  // Desktop spreadsheet grid focus, selection, copy marquee, fill drag, crosshair & clipboard
  const [crosshairCoordinator] = useState(() => createCrosshairCoordinator());
  const [focusedCell, setFocusedCell] = useState<GridCoord | null>(null);
  // Select-first click model: 1st click selects, a repeat click on the same cell cycles.
  const lastCellTapRef = useRef<{
    key: string;
    at: number;
    plannedFrom?: string;
    plannedTo?: string;
  } | null>(null);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [extraCoords, setExtraCoords] = useState<GridCoord[]>([]);
  const [copiedRect, setCopiedRect] = useState<GridRect | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [fillDrag, setFillDrag] = useState<FillDragState | null>(null);
  const [isGridDragging, setIsGridDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const fetchedRangesRef = useRef<Set<string>>(new Set());
  const appliedDefaultWeekModeRef = useRef(false);
  const clipboardRef = useRef<ClipboardMatrix | null>(null);
  const lastWrittenTsvRef = useRef<string | null>(null);
  const undoStackRef = useRef<SessionUndoEntry[]>([]);
  const redoStackRef = useRef<SessionUndoEntry[]>([]);
  const extraCoordsRef = useRef<GridCoord[]>([]);
  const pendingJumpTodayFocusRef = useRef(false);
  const { cellButtonRefs, getCellButtonRef } = useCellButtonRefs();
  const desktopGridAreaRef = useRef<HTMLDivElement | null>(null);
  const bulkBarRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const lastPointerTypeRef = useRef<string>('mouse');
  const fillDragRef = useRef<FillDragState | null>(null);
  const dragSelectRef = useRef<{
    startX: number;
    startY: number;
    anchor: GridCoord;
    lastExtent: GridCoord;
    anchorSide: 'TIME_BOUND' | 'DAILY_GROUP';
    active: boolean;
  } | null>(null);
  const periodAnchorRef = useRef<{
    periodId: string;
    side: 'TIME_BOUND' | 'DAILY_GROUP';
    colIdx: number;
  } | null>(null);
  const periodDragRef = useRef<{
    startX: number;
    startY: number;
    anchorPeriodId: string;
    anchorFirstRow: number;
    anchorLastRow: number;
    anchorSide: 'TIME_BOUND' | 'DAILY_GROUP';
    colIdx: number;
    lastPeriodId: string;
    active: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const suppressNextPeriodClickRef = useRef(false);

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

  const { selectedCoordSet, selectedCoordsList } = useMemo(() => {
    const set = new Set<string>();
    const list: GridCoord[] = [];
    if (selectedRect) {
      for (let r = selectedRect.r1; r <= selectedRect.r2; r += 1) {
        for (let c = selectedRect.c1; c <= selectedRect.c2; c += 1) {
          const key = `${r}:${c}`;
          if (!set.has(key)) {
            set.add(key);
            list.push({ row: r, col: c });
          }
        }
      }
    }
    for (const coord of extraCoords) {
      if (
        coord.row >= 0 &&
        coord.row < visibleGridRows.length &&
        coord.col >= 0 &&
        coord.col < weekDates.length
      ) {
        const key = `${coord.row}:${coord.col}`;
        if (!set.has(key)) {
          set.add(key);
          list.push(coord);
        }
      }
    }
    return { selectedCoordSet: set, selectedCoordsList: list };
  }, [extraCoords, selectedRect, visibleGridRows.length, weekDates.length]);

  const selectedCellCount = selectedCoordsList.length;

  const isContiguousMultiSelected =
    selectedRect !== null && extraCoords.length === 0 && selectedCellCount >= 2;

  const selectedHasQadaaEligible = useMemo(() => {
    return selectedCoordsList.some(
      (c) => visibleGridRows[c.row]?.action.is_qadaa_eligible,
    );
  }, [selectedCoordsList, visibleGridRows]);

  const selectedHasPercentageEligible = useMemo(() => {
    return selectedCoordsList.some(
      (c) => visibleGridRows[c.row]?.action.supports_percentage,
    );
  }, [selectedCoordsList, visibleGridRows]);

  const crosshairCoord = useMemo(() => {
    if (!focusedCell || visibleGridRows.length === 0 || weekDates.length === 0) {
      return null;
    }
    const clampedRow = Math.min(
      Math.max(0, focusedCell.row),
      visibleGridRows.length - 1,
    );
    const clampedCol = Math.min(
      Math.max(0, focusedCell.col),
      weekDates.length - 1,
    );
    return {
      row: clampedRow,
      col: clampedCol,
      side: visibleGridRows[clampedRow]?.side,
    };
  }, [focusedCell, visibleGridRows, weekDates.length]);

  useEffect(() => {
    extraCoordsRef.current = extraCoords;
  }, [extraCoords]);

  const fillPreviewRect = useMemo(() => getFillPreviewRect(fillDrag), [fillDrag]);

  const gridBoundsRef = useRef({
    oneGlanceMode: false,
    rightRowCount: 0,
    totalRows: 0,
    visibleSides: [] as ('TIME_BOUND' | 'DAILY_GROUP')[],
    periodRanges: new Map<
      string,
      { firstRow: number; lastRow: number; side: 'TIME_BOUND' | 'DAILY_GROUP' }
    >(),
  });

  useEffect(() => {
    const periodRanges = new Map<
      string,
      { firstRow: number; lastRow: number; side: 'TIME_BOUND' | 'DAILY_GROUP' }
    >();
    for (const r of visibleGridRows) {
      const existing = periodRanges.get(r.group.id);
      if (existing) {
        existing.lastRow = r.rowIndex;
      } else {
        periodRanges.set(r.group.id, {
          firstRow: r.rowIndex,
          lastRow: r.rowIndex,
          side: r.side,
        });
      }
    }
    gridBoundsRef.current = {
      oneGlanceMode,
      rightRowCount,
      totalRows: visibleGridRows.length,
      visibleSides: visibleGridRows.map((r) => r.side),
      periodRanges,
    };
  }, [oneGlanceMode, rightRowCount, visibleGridRows]);

  const fillCommitHandlerRef = useRef<(fd: FillDragState) => void>(() => {});
  const restoreFocusHandlerRef = useRef<() => void>(() => {});

  const clearSelection = useCallback(() => {
    setSelection(null);
    setExtraCoords([]);
    setContextMenu(null);
  }, [setContextMenu]);

  const clearAllInteractionState = useCallback(
    (options?: { restoreFocus?: boolean }) => {
      fillDragRef.current = null;
      setFillDrag(null);
      dragSelectRef.current = null;
      periodDragRef.current = null;
      periodAnchorRef.current = null;
      setIsGridDragging(false);
      setSelection(null);
      setExtraCoords([]);
      setCopiedRect(null);
      setContextMenu(null);
      document.body.style.cursor = '';
      if (options?.restoreFocus) {
        restoreFocusHandlerRef.current();
      }
    },
    [setContextMenu],
  );

  const navigateWeek = useCallback(
    (nextAnchor: string) => {
      setWeekAnchorDate(nextAnchor);
      setSelection(null);
      setExtraCoords([]);
      setCopiedRect(null);
      setContextMenu(null);
      periodDragRef.current = null;
      periodAnchorRef.current = null;
    },
    [setContextMenu],
  );

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
        const { sourceRect } = fd;
        const dRow =
          over.row > sourceRect.r2
            ? over.row - sourceRect.r2
            : over.row < sourceRect.r1
              ? sourceRect.r1 - over.row
              : 0;
        const dCol =
          over.col > sourceRect.c2
            ? over.col - sourceRect.c2
            : over.col < sourceRect.c1
              ? sourceRect.c1 - over.col
              : 0;

        let lockedTarget: GridCoord;
        if (dRow === 0 && dCol === 0) {
          lockedTarget = { row: sourceRect.r2, col: sourceRect.c2 };
        } else if (
          dRow > dCol ||
          (dRow === dCol &&
            Math.abs(event.clientY - fd.startY) >=
              Math.abs(event.clientX - fd.startX))
        ) {
          lockedTarget = { row: over.row, col: sourceRect.c2 };
        } else {
          lockedTarget = { row: sourceRect.r2, col: over.col };
        }

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

      const pd = periodDragRef.current;
      if (pd) {
        const el = document.elementFromPoint(event.clientX, event.clientY);
        const periodEl = el?.closest<HTMLElement>('[data-period-id]');
        const hoveredPeriodId = periodEl?.dataset.periodId;
        const dist = Math.hypot(
          event.clientX - pd.startX,
          event.clientY - pd.startY,
        );
        if (!pd.active) {
          if (
            dist <= 4 &&
            (!hoveredPeriodId || hoveredPeriodId === pd.anchorPeriodId)
          ) {
            return;
          }
          pd.active = true;
          setIsGridDragging(true);
          setExtraCoords([]);
          window.getSelection()?.removeAllRanges();
          periodAnchorRef.current = {
            periodId: pd.anchorPeriodId,
            side: pd.anchorSide,
            colIdx: pd.colIdx,
          };
          setSelection({
            anchor: { row: pd.anchorFirstRow, col: pd.colIdx },
            extent: { row: pd.anchorLastRow, col: pd.colIdx },
          });
        }
        if (!hoveredPeriodId) return;
        const bounds = gridBoundsRef.current;
        const targetRange = bounds.periodRanges.get(hoveredPeriodId);
        if (!targetRange) return;
        if (bounds.oneGlanceMode && targetRange.side !== pd.anchorSide) return;
        if (hoveredPeriodId === pd.lastPeriodId) return;
        pd.lastPeriodId = hoveredPeriodId;
        const minRow = Math.min(pd.anchorFirstRow, targetRange.firstRow);
        const maxRow = Math.max(pd.anchorLastRow, targetRange.lastRow);
        setSelection({
          anchor: { row: minRow, col: pd.colIdx },
          extent: { row: maxRow, col: pd.colIdx },
        });
        setFocusedCell({ row: targetRange.firstRow, col: pd.colIdx });
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
        setIsGridDragging(true);
        setExtraCoords([]);
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
        ds.lastExtent = clamped;
        setSelection({ anchor: ds.anchor, extent: clamped });
        setFocusedCell(clamped);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const fd = fillDragRef.current;
      if (fd) {
        fillDragRef.current = null;
        setFillDrag(null);
        setIsGridDragging(false);
        document.body.style.cursor = '';
        suppressNextClickRef.current = true;
        if (event.type !== 'pointercancel') {
          fillCommitHandlerRef.current(fd);
        }
      }

      const pd = periodDragRef.current;
      if (pd) {
        if (pd.active) {
          setIsGridDragging(false);
          suppressNextPeriodClickRef.current = true;
        }
        periodDragRef.current = null;
      }

      const ds = dragSelectRef.current;
      if (!ds) return;
      if (ds.active) {
        setIsGridDragging(false);
        suppressNextClickRef.current = true;
        if (
          ds.lastExtent.row === ds.anchor.row &&
          ds.lastExtent.col === ds.anchor.col &&
          extraCoordsRef.current.length === 0
        ) {
          setSelection(null);
        }
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
      document.body.style.cursor = '';
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

  const pushUndoEntry = useCallback(
    (entry: Omit<SessionUndoEntry, 'createdAt'> & { createdAt?: number }) => {
      undoStackRef.current = [
        ...undoStackRef.current.slice(-(MAX_SESSION_UNDO_ENTRIES - 1)),
        { ...entry, createdAt: entry.createdAt ?? Date.now() },
      ];
      redoStackRef.current = [];
    },
    [],
  );

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

    redoStackRef.current = [
      ...redoStackRef.current.slice(-(MAX_SESSION_UNDO_ENTRIES - 1)),
      entry,
    ];

    const priorByKey = new Map(
      entry.priorInputs.map((p) => [makeCellKey(p.action.id, p.logDate), p]),
    );
    const doesHeldMatchPrior = (items: typeof outbox): boolean => {
      if (items.length === 0 || items.length !== entry.priorInputs.length) {
        return false;
      }
      for (const item of items) {
        const prior = priorByKey.get(item.cell_key);
        if (!prior) return false;
        const snap = item.undo_prior_snapshot;
        if (
          (snap?.status ?? null) !== (prior.status ?? null) ||
          (snap?.percent_value ?? null) !== (prior.percent_value ?? null) ||
          (snap?.availability_override ?? null) !==
            (prior.availability_override ?? null) ||
          (snap?.note ?? null) !== (prior.note ?? null)
        ) {
          return false;
        }
      }
      return true;
    };

    const heldBatchItems =
      entry.batchId !== null
        ? outbox.filter(
            (o) => o.batch_id === entry.batchId && o.state === 'held',
          )
        : [];
    const heldMutItems =
      entry.mutationId !== null
        ? outbox.filter(
            (o) => o.mutation_id === entry.mutationId && o.state === 'held',
          )
        : [];

    if (entry.batchId && doesHeldMatchPrior(heldBatchItems)) {
      await undoBatch(entry.batchId);
      dismissUndoToast();
    } else if (entry.mutationId && doesHeldMatchPrior(heldMutItems)) {
      await undoMutation(entry.mutationId);
      dismissUndoToast();
    } else if (entry.priorInputs.length > 0) {
      await logCellBatch(entry.priorInputs, 0, false);
      dismissUndoToast();
    }

    onActionFeedback('تم التراجع عن آخر تعديل');
    return true;
  }, [
    dismissUndoToast,
    logCellBatch,
    onActionFeedback,
    outbox,
    undoBatch,
    undoMutation,
  ]);

  const handleSessionRedo = useCallback(async (): Promise<boolean> => {
    const entry = redoStackRef.current.pop();
    if (!entry) return false;

    if (entry.appliedInputs.length > 0) {
      const res = await logCellBatch(entry.appliedInputs, 0, false);
      undoStackRef.current = [
        ...undoStackRef.current.slice(-(MAX_SESSION_UNDO_ENTRIES - 1)),
        {
          ...entry,
          batchId: res.batchId,
          mutationId: res.batchId ? null : (res.items[0]?.mutation_id ?? null),
          createdAt: Date.now(),
        },
      ];
    } else {
      undoStackRef.current = [
        ...undoStackRef.current.slice(-(MAX_SESSION_UNDO_ENTRIES - 1)),
        { ...entry, createdAt: Date.now() },
      ];
    }

    onActionFeedback('تمت إعادة التعديل');
    return true;
  }, [logCellBatch, onActionFeedback]);

  const focusGridCell = useCallback(
    (row: number, col: number) => {
      const coord = { row, col };
      setFocusedCell(coord);
      const btn = cellButtonRefs.current.get(`${row}:${col}`);
      if (btn && !btn.disabled) {
        btn.focus({ preventScroll: false });
      }
    },
    [cellButtonRefs],
  );

  const restoreFocusToGrid = useCallback(
    (coord?: GridCoord | null) => {
      const target = coord ?? effectiveFocusedCell;
      if (!target) return;
      requestAnimationFrame(() => {
        focusGridCell(target.row, target.col);
      });
    },
    [effectiveFocusedCell, focusGridCell],
  );

  // Alt+T (mohasba:jump-today) navigates to current week and restores focus onto today's column
  useEffect(() => {
    const onJumpToday = () => {
      if (!todayIslamicDate) return;
      if (weekDates.includes(todayIslamicDate)) {
        restoreFocusToGrid({
          row: effectiveFocusedCell?.row ?? 0,
          col: todayColIdx,
        });
      } else {
        pendingJumpTodayFocusRef.current = true;
        navigateWeek(todayIslamicDate);
      }
    };
    window.addEventListener('mohasba:jump-today', onJumpToday);
    return () => window.removeEventListener('mohasba:jump-today', onJumpToday);
  }, [
    effectiveFocusedCell?.row,
    navigateWeek,
    restoreFocusToGrid,
    todayColIdx,
    todayIslamicDate,
    weekDates,
  ]);

  useEffect(() => {
    if (!pendingJumpTodayFocusRef.current || !todayIslamicDate) return;
    const idx = weekDates.indexOf(todayIslamicDate);
    if (idx < 0) return;
    pendingJumpTodayFocusRef.current = false;
    restoreFocusToGrid({
      row: effectiveFocusedCell?.row ?? 0,
      col: idx,
    });
  }, [effectiveFocusedCell?.row, restoreFocusToGrid, todayIslamicDate, weekDates]);

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
    options?: {
      showUndoToast?: boolean;
      /** Rapid multi-click: state already planned by the previous click but not yet rendered. */
      stateOverride?: CellDisplayInfo['state'];
      onPlanned?: (fromState: CellDisplayInfo['state'], toState: CellDisplayInfo['state']) => void;
    },
  ) => {
    if (isCellPostArchived(action, logDate)) return;
    const effective: CellDisplayInfo = options?.stateOverride
      ? { ...display, state: options.stateOverride }
      : display;
    display = effective;

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
    options?.onPlanned?.(
      display.state,
      nextTarget.kind === 'EMPTY' ? 'PENDING' : nextTarget.kind,
    );
    const mutation = buildCellMutationForTarget(
      action,
      logDate,
      display,
      nextTarget,
    );
    const showUndoToast = options?.showUndoToast ?? false;
    const holdMs = showUndoToast
      ? DEFAULT_UNDO_HOLD_MS
      : SINGLE_CLICK_COALESCE_HOLD_MS;
    const res = await logCellBatch([mutation], holdMs, showUndoToast);
    if (res.items.length > 0) {
      pushUndoEntry({
        batchId: res.batchId,
        mutationId: res.batchId ? null : (res.items[0]?.mutation_id ?? null),
        priorInputs: [prior],
        appliedInputs: [mutation],
      });
    }
  };

  const getTargetCoords = (): GridCoord[] => {
    if (selectedCoordsList.length > 0) {
      return selectedCoordsList;
    }
    if (effectiveFocusedCell) {
      return [effectiveFocusedCell];
    }
    return [];
  };

  const applySnapshotEntries = async (
    entries: ReadonlyArray<{ coord: GridCoord; snapshot: ClipboardCellSnapshot }>,
    options: {
      showToast?: boolean;
      actionNameAr?: string;
      clearSelection?: boolean;
      restoreFocus?: boolean;
      emptySkippedMessage?: string;
    } = {},
  ) => {
    if (entries.length === 0) return;
    const focusTarget = effectiveFocusedCell;
    const mutations: CellMutationInput[] = [];
    const priorInputs: CellMutationInput[] = [];
    let skippedIncompatible = 0;

    for (const { coord, snapshot } of entries) {
      const rowMeta = visibleGridRows[coord.row];
      const logDate = weekDates[coord.col];
      if (!rowMeta || !logDate) continue;
      const { action } = rowMeta;
      const display = resolveDisplay(action, logDate);

      if (isCellPostArchived(action, logDate)) {
        continue;
      }
      if (snapshot.kind === 'QADAA_DONE' && !action.is_qadaa_eligible) {
        skippedIncompatible += 1;
        continue;
      }
      if (snapshot.kind === 'PERCENT' && !action.supports_percentage) {
        skippedIncompatible += 1;
        continue;
      }

      priorInputs.push(capturePriorSnapshot(action, logDate));
      mutations.push(
        buildCellMutationForTarget(action, logDate, display, snapshot),
      );
    }

    if (mutations.length === 0) {
      if (skippedIncompatible > 0) {
        onActionFeedback(
          options.emptySkippedMessage ??
            `لم يتم التعديل — تم تخطي ${formatArabicCells(skippedIncompatible)} غير متوافقة`,
        );
      }
      if (options.restoreFocus) {
        restoreFocusToGrid(focusTarget);
      }
      return;
    }

    const isBulkOrDestructive =
      options.showToast ??
      (mutations.length > 1 ||
        entries.some((e) => e.snapshot.kind === 'DISABLED'));
    const holdMs = isBulkOrDestructive
      ? DEFAULT_UNDO_HOLD_MS
      : SINGLE_CLICK_COALESCE_HOLD_MS;

    const res = await logCellBatch(mutations, holdMs, isBulkOrDestructive);
    if (res.items.length > 0) {
      pushUndoEntry({
        batchId: res.batchId,
        mutationId: res.batchId ? null : (res.items[0]?.mutation_id ?? null),
        priorInputs,
        appliedInputs: mutations,
      });
    }

    if (options.clearSelection !== false) {
      clearSelection();
    }
    if (options.restoreFocus) {
      restoreFocusToGrid(focusTarget);
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

  const applyTargetStateToCoords = async (
    coords: readonly GridCoord[],
    target: ClipboardCellSnapshot,
    options: {
      showToast?: boolean;
      actionNameAr?: string;
      clearSelection?: boolean;
      restoreFocus?: boolean;
    } = {},
  ) => {
    await applySnapshotEntries(
      coords.map((coord) => ({ coord, snapshot: target })),
      options,
    );
  };

  const buildMatrixFromRect = (rect: GridRect): ClipboardMatrix => {
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
    return {
      rows: cells.length,
      cols: cells[0]?.length ?? 0,
      cells,
    };
  };

  const handleFillCommit = (fd: FillDragState) => {
    const entries = getFillTargetEntries(fd);
    if (entries.length === 0) return;
    void applySnapshotEntries(entries, {
      showToast: true,
      actionNameAr: 'تم تعبئة',
      clearSelection: true,
    });
  };

  const handleFillHandleDoubleClick = (
    rowIndex: number,
    colIndex: number,
  ) => {
    const rowMeta = visibleGridRows[rowIndex];
    if (!rowMeta) return;
    const sourceGroupId = rowMeta.group.id;
    let lastPeriodRow = rowIndex;
    while (
      lastPeriodRow + 1 < visibleGridRows.length &&
      visibleGridRows[lastPeriodRow + 1]?.group.id === sourceGroupId
    ) {
      lastPeriodRow += 1;
    }
    if (lastPeriodRow <= rowIndex) return;

    const sourceRect: GridRect =
      isContiguousMultiSelected &&
      selectedRect !== null &&
      rowIndex === selectedRect.r2 &&
      colIndex === selectedRect.c2
        ? selectedRect
        : { r1: rowIndex, r2: rowIndex, c1: colIndex, c2: colIndex };

    const sourceMatrix = buildMatrixFromRect(sourceRect);
    const entries: Array<{ coord: GridCoord; snapshot: ClipboardCellSnapshot }> =
      [];

    for (let r = sourceRect.r2 + 1; r <= lastPeriodRow; r += 1) {
      const srcRow = (r - sourceRect.r1) % sourceMatrix.rows;
      for (let c = sourceRect.c1; c <= sourceRect.c2; c += 1) {
        const srcCol = c - sourceRect.c1;
        const snapshot = sourceMatrix.cells[srcRow]?.[srcCol];
        if (snapshot) {
          entries.push({ coord: { row: r, col: c }, snapshot });
        }
      }
    }

    if (entries.length === 0) return;
    void applySnapshotEntries(entries, {
      showToast: true,
      actionNameAr: 'تم تعبئة الفترة',
      clearSelection: true,
    });
  };

  const handleCopySelection = (options?: {
    clearSelection?: boolean;
    restoreFocus?: boolean;
    silent?: boolean;
  }) => {
    let rect: GridRect | null = null;
    let matrix: ClipboardMatrix | null = null;

    if (selectedRect && extraCoords.length === 0) {
      rect = selectedRect;
      matrix = buildMatrixFromRect(rect);
    } else if (selectedCoordsList.length > 0) {
      let r1 = Number.POSITIVE_INFINITY;
      let r2 = -1;
      let c1 = Number.POSITIVE_INFINITY;
      let c2 = -1;
      for (const coord of selectedCoordsList) {
        r1 = Math.min(r1, coord.row);
        r2 = Math.max(r2, coord.row);
        c1 = Math.min(c1, coord.col);
        c2 = Math.max(c2, coord.col);
      }
      rect = { r1, r2, c1, c2 };
      const cells: ClipboardCellSnapshot[][] = [];
      for (let r = r1; r <= r2; r += 1) {
        const rowSnaps: ClipboardCellSnapshot[] = [];
        const rowMeta = visibleGridRows[r];
        for (let c = c1; c <= c2; c += 1) {
          const logDate = weekDates[c];
          if (!selectedCoordSet.has(`${r}:${c}`) || !rowMeta || !logDate) {
            rowSnaps.push({ kind: 'EMPTY', percentValue: null });
            continue;
          }
          const display = resolveDisplay(rowMeta.action, logDate);
          rowSnaps.push(snapshotCellFromDisplay(display));
        }
        cells.push(rowSnaps);
      }
      matrix = { rows: cells.length, cols: cells[0]?.length ?? 0, cells };
    } else if (effectiveFocusedCell) {
      rect = {
        r1: effectiveFocusedCell.row,
        r2: effectiveFocusedCell.row,
        c1: effectiveFocusedCell.col,
        c2: effectiveFocusedCell.col,
      };
      matrix = buildMatrixFromRect(rect);
    }

    if (!rect || !matrix) return;

    clipboardRef.current = matrix;
    setHasClipboard(true);
    setCopiedRect(rect);

    if (options?.clearSelection) {
      clearSelection();
    }
    if (options?.restoreFocus) {
      restoreFocusToGrid();
    }

    const tsv = serializeClipboardToTsv(matrix);
    lastWrittenTsvRef.current = tsv;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(tsv).catch(() => {
        // Ignore clipboard permission errors in restricted contexts
      });
    }

    if (!options?.silent) {
      const count =
        selectedCellCount > 0 ? selectedCellCount : matrix.rows * matrix.cols;
      onActionFeedback(`تم نسخ ${formatArabicCells(count)}`);
    }
  };

  const handleCutSelection = async (options?: { restoreFocus?: boolean }) => {
    const coords = getTargetCoords();
    if (coords.length === 0) return;
    handleCopySelection({ clearSelection: false, silent: true });
    await applyTargetStateToCoords(
      coords,
      { kind: 'EMPTY', percentValue: null },
      {
        showToast: true,
        actionNameAr: 'تم قص',
        clearSelection: true,
        restoreFocus: options?.restoreFocus,
      },
    );
  };

  const handlePasteSelection = async (options?: { restoreFocus?: boolean }) => {
    let source = clipboardRef.current;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        const osText = await navigator.clipboard.readText();
        const normalizedOs = osText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const normalizedLast =
          lastWrittenTsvRef.current
            ?.replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n') ?? null;
        if (
          normalizedOs.trim().length > 0 &&
          (!source || normalizedLast === null || normalizedOs !== normalizedLast)
        ) {
          const parsed = parseTsvToClipboard(osText);
          if (parsed) {
            source = parsed;
            clipboardRef.current = parsed;
            lastWrittenTsvRef.current = osText;
            setHasClipboard(true);
          }
        }
      } catch {
        // Ignore clipboard read permission errors and fall back to in-app clipboardRef
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
    // - otherwise expands from top-start anchor (r1, c1) clipped to grid/side bounds
    const shouldTile =
      (source.rows === 1 && source.cols === 1) ||
      (targetRows >= source.rows &&
        targetCols >= source.cols &&
        targetRows % source.rows === 0 &&
        targetCols % source.cols === 0);

    const anchorSide = visibleGridRows[targetRect.r1]?.side;
    const maxPasteRow =
      oneGlanceMode && anchorSide === 'TIME_BOUND'
        ? Math.max(0, rightRowCount - 1)
        : visibleGridRows.length - 1;

    const endRow = shouldTile
      ? Math.min(maxPasteRow, targetRect.r2)
      : Math.min(maxPasteRow, targetRect.r1 + source.rows - 1);
    const endCol = shouldTile
      ? targetRect.c2
      : Math.min(weekDates.length - 1, targetRect.c1 + source.cols - 1);

    const entries: Array<{ coord: GridCoord; snapshot: ClipboardCellSnapshot }> =
      [];

    for (let r = targetRect.r1; r <= endRow; r += 1) {
      const srcRow = (r - targetRect.r1) % source.rows;
      for (let c = targetRect.c1; c <= endCol; c += 1) {
        const srcCol = (c - targetRect.c1) % source.cols;
        const snap = source.cells[srcRow]?.[srcCol];
        if (snap) {
          entries.push({ coord: { row: r, col: c }, snapshot: snap });
        }
      }
    }

    await applySnapshotEntries(entries, {
      showToast: true,
      actionNameAr: 'تم لصق',
      clearSelection: true,
      restoreFocus: options?.restoreFocus,
      emptySkippedMessage: `تعذر اللصق — تم تخطي ${formatArabicCells(entries.length)} غير متوافقة`,
    });
  };

  const handleFillDownShortcut = async (options?: {
    restoreFocus?: boolean;
  }) => {
    if (visibleGridRows.length === 0 || weekDates.length === 0) return;

    const entries: Array<{ coord: GridCoord; snapshot: ClipboardCellSnapshot }> =
      [];

    if (selectedRect && selectedRect.r2 > selectedRect.r1) {
      const srcRowMeta = visibleGridRows[selectedRect.r1];
      if (!srcRowMeta) return;
      for (let c = selectedRect.c1; c <= selectedRect.c2; c += 1) {
        const logDate = weekDates[c];
        if (!logDate) continue;
        const snap = snapshotCellFromDisplay(
          resolveDisplay(srcRowMeta.action, logDate),
        );
        for (let r = selectedRect.r1 + 1; r <= selectedRect.r2; r += 1) {
          entries.push({ coord: { row: r, col: c }, snapshot: snap });
        }
      }
    } else {
      const targetRow = selectedRect
        ? selectedRect.r1
        : (effectiveFocusedCell?.row ?? 0);
      const c1 = selectedRect
        ? selectedRect.c1
        : (effectiveFocusedCell?.col ?? 0);
      const c2 = selectedRect
        ? selectedRect.c2
        : (effectiveFocusedCell?.col ?? 0);

      if (targetRow <= 0) return;
      if (
        oneGlanceMode &&
        visibleGridRows[targetRow - 1]?.side !== visibleGridRows[targetRow]?.side
      ) {
        return;
      }
      const srcRowMeta = visibleGridRows[targetRow - 1];
      if (!srcRowMeta) return;
      for (let c = c1; c <= c2; c += 1) {
        const logDate = weekDates[c];
        if (!logDate) continue;
        const snap = snapshotCellFromDisplay(
          resolveDisplay(srcRowMeta.action, logDate),
        );
        entries.push({ coord: { row: targetRow, col: c }, snapshot: snap });
      }
    }

    if (entries.length === 0) return;

    // Detect no-op Fill Down (e.g. top row is empty & rows below are empty, or all rows already match)
    const hasAnyVisualChange = entries.some(({ coord, snapshot }) => {
      const targetRowMeta = visibleGridRows[coord.row];
      const targetDate = weekDates[coord.col];
      if (!targetRowMeta || !targetDate) return false;
      const cur = snapshotCellFromDisplay(
        resolveDisplay(targetRowMeta.action, targetDate),
      );
      return (
        cur.kind !== snapshot.kind || cur.percentValue !== snapshot.percentValue
      );
    });

    if (!hasAnyVisualChange) {
      const allSourceEmpty = entries.every((e) => e.snapshot.kind === 'EMPTY');
      onActionFeedback(
        allSourceEmpty
          ? 'تعبئة لأسفل تنسخ الصف العلوي في التحديد — اجعل الصف الأول مسجلاً (مثل تم) ثم حدده مع الصفوف الفارغة تحته'
          : 'جميع الصفوف المحددة مطابقة بالفعل للصف العلوي',
      );
      if (options?.restoreFocus) {
        restoreFocusToGrid();
      }
      return;
    }

    await applySnapshotEntries(entries, {
      showToast: true,
      actionNameAr: 'تم التعبئة للأسفل',
      clearSelection: true,
      restoreFocus: options?.restoreFocus,
    });
  };

  const handleSelectAllActiveTable = () => {
    if (visibleGridRows.length === 0 || weekDates.length === 0) return;
    const endCol = weekDates.length - 1;
    let startRow = 0;
    let endRow = visibleGridRows.length - 1;

    if (oneGlanceMode) {
      const activeSide =
        visibleGridRows[effectiveFocusedCell?.row ?? 0]?.side ?? 'TIME_BOUND';
      if (activeSide === 'TIME_BOUND') {
        startRow = 0;
        endRow = Math.max(0, rightRowCount - 1);
      } else {
        startRow = rightRowCount;
        endRow = Math.max(rightRowCount, visibleGridRows.length - 1);
      }
    }

    if (startRow > endRow) return;
    setExtraCoords([]);
    setSelection({
      anchor: { row: startRow, col: 0 },
      extent: { row: endRow, col: endCol },
    });
  };

  const toggleCoordsInSelection = (toggled: readonly GridCoord[]) => {
    if (toggled.length === 0) return;
    const nextMap = new Map<string, GridCoord>();
    for (const c of selectedCoordsList) {
      nextMap.set(`${c.row}:${c.col}`, c);
    }

    const allPresent = toggled.every((c) => nextMap.has(`${c.row}:${c.col}`));
    if (allPresent) {
      for (const c of toggled) {
        nextMap.delete(`${c.row}:${c.col}`);
      }
    } else {
      for (const c of toggled) {
        nextMap.set(`${c.row}:${c.col}`, c);
      }
    }

    setSelection(null);
    setExtraCoords(Array.from(nextMap.values()));
  };

  const handleSelectDayColumn = (
    colIdx: number,
    sideScope?: 'TIME_BOUND' | 'DAILY_GROUP',
    event?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
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

    const colCoords: GridCoord[] = [];
    for (let r = startRow; r <= endRow; r += 1) {
      colCoords.push({ row: r, col: colIdx });
    }

    if (event && (event.ctrlKey || event.metaKey)) {
      toggleCoordsInSelection(colCoords);
      focusGridCell(startRow, colIdx);
      return;
    }

    if (event?.shiftKey) {
      const anchorCol =
        selection?.anchor.col ?? effectiveFocusedCell?.col ?? colIdx;
      setExtraCoords([]);
      setSelection({
        anchor: { row: startRow, col: anchorCol },
        extent: { row: endRow, col: colIdx },
      });
      focusGridCell(startRow, colIdx);
      return;
    }

    const isAlreadySelected =
      extraCoords.length === 0 &&
      selectedRect !== null &&
      selectedRect.c1 === colIdx &&
      selectedRect.c2 === colIdx &&
      selectedRect.r1 === startRow &&
      selectedRect.r2 === endRow;

    if (isAlreadySelected) {
      clearSelection();
      return;
    }

    setExtraCoords([]);
    setSelection({
      anchor: { row: startRow, col: colIdx },
      extent: { row: endRow, col: colIdx },
    });
    focusGridCell(startRow, colIdx);
  };

  const handleSelectActionRow = (
    rowIndex: number,
    event?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => {
    if (weekDates.length === 0) return;
    const endCol = weekDates.length - 1;
    const rowCoords: GridCoord[] = [];
    for (let c = 0; c <= endCol; c += 1) {
      rowCoords.push({ row: rowIndex, col: c });
    }

    if (event && (event.ctrlKey || event.metaKey)) {
      toggleCoordsInSelection(rowCoords);
      focusGridCell(rowIndex, 0);
      return;
    }

    if (event?.shiftKey) {
      let anchorRow =
        selection?.anchor.row ?? effectiveFocusedCell?.row ?? rowIndex;
      if (oneGlanceMode) {
        const targetSide = visibleGridRows[rowIndex]?.side ?? 'TIME_BOUND';
        if (visibleGridRows[anchorRow]?.side !== targetSide) {
          anchorRow = rowIndex;
        }
      }
      setExtraCoords([]);
      setSelection({
        anchor: { row: anchorRow, col: 0 },
        extent: { row: rowIndex, col: endCol },
      });
      focusGridCell(rowIndex, 0);
      return;
    }

    const isAlreadySelected =
      extraCoords.length === 0 &&
      selectedRect !== null &&
      selectedRect.r1 === rowIndex &&
      selectedRect.r2 === rowIndex &&
      selectedRect.c1 === 0 &&
      selectedRect.c2 === endCol;

    if (isAlreadySelected) {
      clearSelection();
      return;
    }

    setExtraCoords([]);
    setSelection({
      anchor: { row: rowIndex, col: 0 },
      extent: { row: rowIndex, col: endCol },
    });
    focusGridCell(rowIndex, 0);
  };

  const getPeriodRowRange = (
    periodId: string,
  ): {
    firstRow: number;
    lastRow: number;
    side: 'TIME_BOUND' | 'DAILY_GROUP';
  } | null => {
    let firstRow = -1;
    let lastRow = -1;
    let side: 'TIME_BOUND' | 'DAILY_GROUP' = 'TIME_BOUND';
    for (const r of visibleGridRows) {
      if (r.group.id === periodId) {
        if (firstRow === -1) {
          firstRow = r.rowIndex;
          side = r.side;
        }
        lastRow = r.rowIndex;
      }
    }
    if (firstRow === -1) return null;
    return { firstRow, lastRow, side };
  };

  const isPeriodFullySelected = (periodId: string, colIdx: number): boolean => {
    const range = getPeriodRowRange(periodId);
    if (!range) return false;
    for (let r = range.firstRow; r <= range.lastRow; r += 1) {
      if (!selectedCoordSet.has(`${r}:${colIdx}`)) return false;
    }
    return true;
  };

  const getPeriodQuickDoneState = (
    group: Period,
    logDate: string,
  ): { hasEditable: boolean; allDone: boolean } => {
    if (!logDate) return { hasEditable: false, allDone: false };
    const groupActions = actionsByPeriodId.get(group.id) ?? [];
    let editableCount = 0;
    let nonDoneCount = 0;
    for (const action of groupActions) {
      if (isCellPostArchived(action, logDate)) continue;
      const display = resolveDisplay(action, logDate);
      if (display.state === 'DISABLED' || display.state === 'QADAA_DONE') {
        continue;
      }
      editableCount += 1;
      if (display.state !== 'DONE') {
        nonDoneCount += 1;
      }
    }
    return {
      hasEditable: editableCount > 0,
      allDone: editableCount > 0 && nonDoneCount === 0,
    };
  };

  const handleSelectPeriodColumn = (
    periodId: string,
    colIdx: number,
    event?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => {
    const range = getPeriodRowRange(periodId);
    if (!range) return;
    const { firstRow, lastRow, side } = range;

    const periodCoords: GridCoord[] = [];
    for (let r = firstRow; r <= lastRow; r += 1) {
      periodCoords.push({ row: r, col: colIdx });
    }

    if (event && (event.ctrlKey || event.metaKey)) {
      toggleCoordsInSelection(periodCoords);
      periodAnchorRef.current = { periodId, side, colIdx };
      focusGridCell(firstRow, colIdx);
      return;
    }

    if (event?.shiftKey) {
      let anchorRange = range;
      const storedAnchor = periodAnchorRef.current;
      if (
        storedAnchor &&
        (!oneGlanceMode || storedAnchor.side === side)
      ) {
        const resolved = getPeriodRowRange(storedAnchor.periodId);
        if (resolved) anchorRange = resolved;
      } else {
        const fallbackRow = selection?.anchor.row ?? effectiveFocusedCell?.row;
        if (fallbackRow !== undefined) {
          const fallbackMeta = visibleGridRows[fallbackRow];
          if (fallbackMeta && (!oneGlanceMode || fallbackMeta.side === side)) {
            const resolved = getPeriodRowRange(fallbackMeta.group.id);
            if (resolved) anchorRange = resolved;
          }
        }
      }
      const minRow = Math.min(anchorRange.firstRow, firstRow);
      const maxRow = Math.max(anchorRange.lastRow, lastRow);
      setExtraCoords([]);
      setSelection({
        anchor: { row: minRow, col: colIdx },
        extent: { row: maxRow, col: colIdx },
      });
      focusGridCell(firstRow, colIdx);
      return;
    }

    const isAlreadySelected =
      extraCoords.length === 0 &&
      selectedRect !== null &&
      selectedRect.r1 === firstRow &&
      selectedRect.r2 === lastRow &&
      selectedRect.c1 === colIdx &&
      selectedRect.c2 === colIdx;

    if (isAlreadySelected) {
      clearSelection();
      periodAnchorRef.current = null;
      return;
    }

    periodAnchorRef.current = { periodId, side, colIdx };
    setExtraCoords([]);
    setSelection({
      anchor: { row: firstRow, col: colIdx },
      extent: { row: lastRow, col: colIdx },
    });
    focusGridCell(firstRow, colIdx);
  };

  const handlePeriodHeaderPointerDown = (
    e: React.PointerEvent<HTMLElement>,
    group: Period,
    colIdx: number,
  ) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if ((e.target as Element | null)?.closest('.period-quick-done-btn')) {
      return;
    }
    suppressNextPeriodClickRef.current = false;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      return;
    }
    const range = getPeriodRowRange(group.id);
    if (!range) return;
    periodDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      anchorPeriodId: group.id,
      anchorFirstRow: range.firstRow,
      anchorLastRow: range.lastRow,
      anchorSide: range.side,
      colIdx,
      lastPeriodId: group.id,
      active: false,
    };
  };

  const handleQuickCompletePeriod = async (group: Period, logDate: string) => {
    if (!logDate) return;
    const groupActions = actionsByPeriodId.get(group.id) ?? [];
    const editableEntries: Array<{ action: Action; display: CellDisplayInfo }> =
      [];

    for (const action of groupActions) {
      if (isCellPostArchived(action, logDate)) continue;
      const display = resolveDisplay(action, logDate);
      if (display.state === 'DISABLED' || display.state === 'QADAA_DONE') {
        continue;
      }
      editableEntries.push({ action, display });
    }

    clearSelection();

    if (editableEntries.length === 0) {
      onActionFeedback(`لا توجد أعمال قابلة للتحديث في «${group.title}»`);
      return;
    }

    const incompleteEntries = editableEntries.filter(
      (entry) => entry.display.state !== 'DONE',
    );
    const isToggleOff = incompleteEntries.length === 0;
    const targetEntries = isToggleOff ? editableEntries : incompleteEntries;
    const nextSnapshot: ClipboardCellSnapshot = isToggleOff
      ? { kind: 'EMPTY', percentValue: null }
      : { kind: 'DONE', percentValue: null };

    const mutations: CellMutationInput[] = [];
    const priorInputs: CellMutationInput[] = [];
    for (const { action, display } of targetEntries) {
      priorInputs.push(capturePriorSnapshot(action, logDate));
      mutations.push(
        buildCellMutationForTarget(action, logDate, display, nextSnapshot),
      );
    }

    if (mutations.length === 0) return;

    const hasActiveOutbox = mutations.some((m) => {
      const cellKey = makeCellKey(m.action.id, m.logDate);
      return outbox.some(
        (o) =>
          o.cell_key === cellKey &&
          o.attempt_count === 0 &&
          (o.state === 'held' || o.state === 'pending'),
      );
    });
    if (hasActiveOutbox) {
      dismissUndoToast();
    }

    const res = await logCellBatch(
      mutations,
      hasActiveOutbox ? 0 : DEFAULT_UNDO_HOLD_MS,
      !hasActiveOutbox,
    );
    if (res.items.length > 0) {
      pushUndoEntry({
        batchId: res.batchId,
        mutationId: res.batchId ? null : (res.items[0]?.mutation_id ?? null),
        priorInputs,
        appliedInputs: mutations,
      });
    }
    onActionFeedback(
      isToggleOff
        ? `تم إلغاء إكمال ${group.title} (${formatArabicCells(mutations.length)})`
        : `تم إكمال ${group.title} (${formatArabicCells(mutations.length)})`,
    );
  };

  const handleMultiCellSpaceToggle = async () => {
    if (selectedCellCount === 0) return;
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
    if (e.isComposing) return;
    if (
      normalDialogOpen ||
      document.querySelector('dialog[open]') !== null ||
      isEditableTarget(e.target) ||
      isEditableTarget(document.activeElement)
    ) {
      return;
    }

    // Global session Undo (capture phase — takes precedence over app-shell toast-only undo)
    if (matchesShortcutEvent(e, effectiveShortcuts.undo)) {
      if (undoStackRef.current.length > 0) {
        const topEntry = undoStackRef.current[undoStackRef.current.length - 1]!;
        if (activeUndoToast) {
          const toastCreatedAt = activeUndoToast.expiresAt - DEFAULT_UNDO_HOLD_MS;
          if (toastCreatedAt > topEntry.createdAt) {
            return;
          }
        }
        if (!doesUndoEntryMatchLiveLogs(topEntry, logsByKey)) {
          undoStackRef.current = undoStackRef.current.slice(0, -1);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        void handleSessionUndo();
      }
      return;
    }

    const mod = e.ctrlKey || e.metaKey;

    // Global 30-step Redo (Ctrl+Y or Ctrl+Shift+Z / Cmd+Shift+Z)
    if (
      mod &&
      !e.altKey &&
      ((!e.shiftKey && e.code === 'KeyY') || (e.shiftKey && e.code === 'KeyZ'))
    ) {
      if (redoStackRef.current.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        void handleSessionRedo();
      }
      return;
    }

    if (e.key === 'Escape') {
      if (contextMenu) {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu(null);
        restoreFocusToGrid();
        return;
      }
      if (
        selectedCellCount > 0 ||
        copiedRect !== null ||
        fillDragRef.current !== null ||
        dragSelectRef.current !== null ||
        periodDragRef.current !== null
      ) {
        e.preventDefault();
        e.stopPropagation();
        clearAllInteractionState({ restoreFocus: true });
      }
      return;
    }

    if (e.defaultPrevented) return;

    const targetNode = e.target instanceof Node ? e.target : null;
    const isFocusInGrid =
      targetNode !== null &&
      (desktopGridAreaRef.current?.contains(targetNode) ?? false);
    const isFocusInBulkBar =
      targetNode !== null &&
      (bulkBarRef.current?.contains(targetNode) ?? false);
    const isFocusOnCellButton =
      targetNode instanceof Element &&
      targetNode.matches('[data-grid-row][data-grid-col]');

    if (selectedCellCount === 0 && !isFocusInGrid && !isFocusInBulkBar) {
      return;
    }

    if (
      mod &&
      !e.altKey &&
      ((!e.shiftKey && e.code === 'KeyA') ||
        (e.shiftKey && e.code === 'Space'))
    ) {
      e.preventDefault();
      e.stopPropagation();
      handleSelectAllActiveTable();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyC') {
      e.preventDefault();
      e.stopPropagation();
      handleCopySelection();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyX') {
      e.preventDefault();
      e.stopPropagation();
      void handleCutSelection();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyV') {
      e.preventDefault();
      e.stopPropagation();
      void handlePasteSelection();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      e.stopPropagation();
      void handleFillDownShortcut();
      return;
    }

    if (mod || e.altKey || isFocusOnCellButton) return;

    if (e.code === 'Space' && !e.shiftKey) {
      if (isFocusInBulkBar) return;
      if (selectedCellCount > 0) {
        e.preventDefault();
        void handleMultiCellSpaceToggle();
      }
      return;
    }

    if (selectedCellCount > 0) {
      handleCellStateHotkey(e, getTargetCoords());
    }
  };

  useEffect(() => {
    fillCommitHandlerRef.current = handleFillCommit;
    windowKeyDownHandlerRef.current = handleWindowKeyDown;
    restoreFocusHandlerRef.current = () => restoreFocusToGrid();
  });

  // Persistent capture-phase window keydown listener so Ctrl+Z / Ctrl+Y / grid chords work globally
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      windowKeyDownHandlerRef.current(e);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Outside-click dismissal for active grid selection
  useEffect(() => {
    if (selection === null && extraCoords.length === 0) return;
    const onPointerDown = (e: PointerEvent) => {
      if (fillDragRef.current) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (bulkBarRef.current?.contains(target)) return;
      if (contextMenuRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(
          '[data-grid-row][data-grid-col], .col-day-btn, .row-title-btn, .cell-period, .period-select-btn, .period-quick-done-btn, .group-select-btn',
        )
      ) {
        return;
      }
      clearSelection();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [clearSelection, extraCoords.length, selection]);

  // Viewport-clamped RTL cursor positioning for Multi-Cell Right-Click Context Menu
  useLayoutEffect(() => {
    const el = contextMenuRef.current;
    if (!el || !contextMenu || selectedCellCount < 2) return;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = el.getBoundingClientRect();

    const rawLeft =
      contextMenu.x - rect.width >= margin
        ? contextMenu.x - rect.width
        : contextMenu.x;
    const left = Math.max(margin, Math.min(vw - rect.width - margin, rawLeft));

    const rawTop =
      contextMenu.y + rect.height <= vh - margin
        ? contextMenu.y
        : contextMenu.y - rect.height;
    const top = Math.max(margin, Math.min(vh - rect.height - margin, rawTop));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [contextMenu, selectedCellCount]);

  // Focus first item & dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu || selectedCellCount < 2) return;
    const focusTimer = requestAnimationFrame(() => {
      contextMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus();
    });
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      cancelAnimationFrame(focusTimer);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [contextMenu, selectedCellCount]);

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
      if (todayIslamicDate) {
        if (weekDates.includes(todayIslamicDate)) {
          restoreFocusToGrid({ row, col: todayColIdx });
        } else {
          pendingJumpTodayFocusRef.current = true;
          navigateWeek(todayIslamicDate);
        }
      }
      return;
    }

    const mod = event.ctrlKey || event.metaKey;

    // Escape clears fillDrag, dragSelect, selection, copiedRect & cursor
    if (event.key === 'Escape') {
      if (
        copiedRect ||
        selection ||
        extraCoords.length > 0 ||
        fillDragRef.current ||
        dragSelectRef.current ||
        periodDragRef.current
      ) {
        event.preventDefault();
        clearAllInteractionState({ restoreFocus: true });
      }
      return;
    }

    // Row & Column & Select-All selection chords
    if (event.code === 'Space' && event.shiftKey && mod && !event.altKey) {
      event.preventDefault();
      handleSelectAllActiveTable();
      return;
    }
    if (event.code === 'Space' && event.shiftKey && !mod && !event.altKey) {
      event.preventDefault();
      setExtraCoords([]);
      setSelection({
        anchor: { row, col: 0 },
        extent: { row, col: weekDates.length - 1 },
      });
      return;
    }
    if (event.code === 'Space' && mod && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      const rowMeta = visibleGridRows[row];
      handleSelectDayColumn(col, oneGlanceMode ? rowMeta?.side : undefined);
      return;
    }

    // RTL-Accurate Spatial Arrow, Ctrl+Arrow (Edge/Period Jump) & Home/End Navigation
    // In RTL, col 0 is visual right and col 6 is visual left:
    // ArrowLeft => col + 1 (next day), ArrowRight => col - 1 (prev day)
    let nextRow = row;
    let nextCol = col;
    let isNav = false;
    let isEdgeJump = false;

    const curSide = visibleGridRows[row]?.side ?? 'TIME_BOUND';
    const sideMinRow =
      oneGlanceMode && curSide === 'DAILY_GROUP' ? rightRowCount : 0;
    const sideMaxRow =
      oneGlanceMode && curSide === 'TIME_BOUND'
        ? Math.max(0, rightRowCount - 1)
        : Math.max(0, visibleGridRows.length - 1);

    if (mod && !event.altKey) {
      const curGroupId = visibleGridRows[row]?.group.id;
      let blockStart = row;
      while (
        blockStart - 1 >= sideMinRow &&
        visibleGridRows[blockStart - 1]?.group.id === curGroupId
      ) {
        blockStart -= 1;
      }
      let blockEnd = row;
      while (
        blockEnd + 1 <= sideMaxRow &&
        visibleGridRows[blockEnd + 1]?.group.id === curGroupId
      ) {
        blockEnd += 1;
      }

      if (event.key === 'ArrowLeft') {
        nextCol = weekDates.length - 1;
        isNav = true;
        isEdgeJump = true;
      } else if (event.key === 'ArrowRight') {
        nextCol = 0;
        isNav = true;
        isEdgeJump = true;
      } else if (event.key === 'ArrowUp') {
        nextRow =
          row > blockStart ? blockStart : Math.max(sideMinRow, blockStart - 1);
        isNav = true;
        isEdgeJump = true;
      } else if (event.key === 'ArrowDown') {
        nextRow =
          row < blockEnd ? blockEnd : Math.min(sideMaxRow, blockEnd + 1);
        isNav = true;
        isEdgeJump = true;
      } else if (event.key === 'Home') {
        nextRow = sideMinRow;
        nextCol = 0;
        isNav = true;
        isEdgeJump = true;
      } else if (event.key === 'End') {
        nextRow = sideMaxRow;
        nextCol = weekDates.length - 1;
        isNav = true;
        isEdgeJump = true;
      }
    } else if (!event.altKey) {
      if (event.key === 'ArrowLeft') {
        nextCol = Math.min(weekDates.length - 1, col + 1);
        isNav = true;
      } else if (event.key === 'ArrowRight') {
        nextCol = Math.max(0, col - 1);
        isNav = true;
      } else if (event.key === 'ArrowUp') {
        nextRow = Math.max(0, row - 1);
        isNav = true;
      } else if (event.key === 'ArrowDown') {
        nextRow = Math.min(visibleGridRows.length - 1, row + 1);
        isNav = true;
      } else if (event.key === 'Home') {
        nextCol = 0;
        isNav = true;
      } else if (event.key === 'End') {
        nextCol = weekDates.length - 1;
        isNav = true;
      }
    }

    if (isNav) {
      event.preventDefault();
      if (!isEdgeJump) {
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
        setExtraCoords([]);
        setSelection({ anchor, extent: clampedExtent });
        focusGridCell(clampedExtent.row, clampedExtent.col);
      } else {
        clearSelection();
        focusGridCell(nextRow, nextCol);
      }
      return;
    }

    // F2 / ContextMenu / Shift+F10 ALWAYS open CellEditorDialog
    if (
      (event.key === 'F2' && !mod && !event.altKey) ||
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      event.preventDefault();
      if (!isCellPostArchived(action, logDate)) {
        onOpenCellEditor({ action, logDate });
      }
      return;
    }

    // Enter respects settings.enter_key_mode ('editor' | 'move_down')
    if (event.key === 'Enter' && !mod && !event.altKey) {
      event.preventDefault();
      const enterKeyMode = settings.enter_key_mode ?? 'editor';
      if (enterKeyMode === 'move_down') {
        const delta = event.shiftKey ? -1 : 1;
        let targetRow = Math.min(Math.max(row + delta, sideMinRow), sideMaxRow);
        while (targetRow >= sideMinRow && targetRow <= sideMaxRow) {
          const btn = cellButtonRefs.current.get(`${targetRow}:${col}`);
          if (btn && !btn.disabled) break;
          if (
            (delta > 0 && targetRow >= sideMaxRow) ||
            (delta < 0 && targetRow <= sideMinRow)
          ) {
            break;
          }
          targetRow += delta;
        }
        const targetBtn = cellButtonRefs.current.get(`${targetRow}:${col}`);
        clearSelection();
        if (targetBtn && !targetBtn.disabled) {
          focusGridCell(targetRow, col);
        }
      } else if (!isCellPostArchived(action, logDate)) {
        onOpenCellEditor({ action, logDate });
      }
      return;
    }

    if (mod || event.altKey) return;

    // Space => 1-step cycle when single cell, toggle DONE/EMPTY when multi-cell/disjoint
    if (event.code === 'Space' && !event.shiftKey) {
      event.preventDefault();
      if (selectedCellCount >= 2 || extraCoords.length > 0) {
        void handleMultiCellSpaceToggle();
      } else {
        clearSelection();
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
    rowSide: 'TIME_BOUND' | 'DAILY_GROUP';
  }) => {
    const { action, logDate, rowIndex, colIndex, dayLabel, rowSide } = params;
    const display = resolveDisplay(action, logDate);
    const nonInteractive = isCellPostArchived(action, logDate);
    const hasNote = display.note.trim().length > 0;
    const coordKey = `${rowIndex}:${colIndex}`;
    const desktopCellKey = `dt:${action.id}:${logDate}`;
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
      (selectedCellCount >= 2 || extraCoords.length > 0) &&
      selectedCoordSet.has(coordKey);
    const sameSideAbove =
      !oneGlanceMode || visibleGridRows[rowIndex - 1]?.side === rowSide;
    const sameSideBelow =
      !oneGlanceMode || visibleGridRows[rowIndex + 1]?.side === rowSide;
    const isSelTop =
      isSelected &&
      (!sameSideAbove || !selectedCoordSet.has(`${rowIndex - 1}:${colIndex}`));
    const isSelBottom =
      isSelected &&
      (!sameSideBelow || !selectedCoordSet.has(`${rowIndex + 1}:${colIndex}`));
    const isSelStart =
      isSelected && !selectedCoordSet.has(`${rowIndex}:${colIndex - 1}`);
    const isSelEnd =
      isSelected && !selectedCoordSet.has(`${rowIndex}:${colIndex + 1}`);

    const isCopied = isCoordInRect(rowIndex, colIndex, copiedRect);
    const isCopyTop =
      isCopied &&
      (!sameSideAbove || !isCoordInRect(rowIndex - 1, colIndex, copiedRect));
    const isCopyBottom =
      isCopied &&
      (!sameSideBelow || !isCoordInRect(rowIndex + 1, colIndex, copiedRect));
    const isCopyStart =
      isCopied && !isCoordInRect(rowIndex, colIndex - 1, copiedRect);
    const isCopyEnd =
      isCopied && !isCoordInRect(rowIndex, colIndex + 1, copiedRect);

    const isFillSource =
      fillDrag !== null && isCoordInRect(rowIndex, colIndex, fillDrag.sourceRect);
    const isFillPreview =
      isCoordInRect(rowIndex, colIndex, fillPreviewRect) && !isFillSource;

    const isMultiSelectionCorner =
      isContiguousMultiSelected &&
      selectedRect !== null &&
      rowIndex === selectedRect.r2 &&
      colIndex === selectedRect.c2;
    const isFillEligible =
      !nonInteractive &&
      (isMultiSelectionCorner ||
        (selectedCellCount < 2 && extraCoords.length === 0));

    const isColCrosshair =
      crosshairCoord !== null &&
      crosshairCoord.col === colIndex &&
      (!oneGlanceMode || crosshairCoord.side === rowSide);

    return (
      <td
        key={logDate}
        className={`cell-status ${isColCrosshair ? 'is-col-crosshair' : ''}`}
        role="presentation"
        data-col-index={colIndex}
      >
        <div
          className={`m-cell-wrap ${isFocused ? 'has-focus' : ''} ${
            isFillEligible ? 'is-fill-eligible' : ''
          } ${isMultiSelectionCorner ? 'is-fill-corner' : ''} ${
            isFillSource ? 'is-fill-source' : ''
          } ${isCopied ? 'is-copy-wrap' : ''} ${
            isCopyTop ? 'is-copy-top' : ''
          } ${isCopyBottom ? 'is-copy-bottom' : ''} ${
            isCopyStart ? 'is-copy-start' : ''
          } ${isCopyEnd ? 'is-copy-end' : ''}`}
        >
          <button
            ref={getCellButtonRef(coordKey)}
            type="button"
            role="gridcell"
            tabIndex={isTabStop ? 0 : -1}
            disabled={nonInteractive}
            aria-selected={isSelected}
            aria-label={`${action.title} ${dayLabel}${hasNote ? ' — يحتوي على ملاحظة' : ''}`}
            title={hasNote ? `ملاحظة: ${display.note.trim()}` : undefined}
            data-testid={`week-cell-${action.id}-${logDate}`}
            data-grid-row={rowIndex}
            data-grid-col={colIndex}
            className={`m-cell nums ${getCellStateClass(display.state)} ${
              longPress.pressingKey === desktopCellKey ? 'is-pressing' : ''
            } ${isFocused ? 'is-grid-focused' : ''} ${
              isSelected ? 'is-grid-selected' : ''
            } ${isSelTop ? 'is-sel-top' : ''} ${
              isSelBottom ? 'is-sel-bottom' : ''
            } ${isSelStart ? 'is-sel-start' : ''} ${
              isSelEnd ? 'is-sel-end' : ''
            } ${isCopied ? 'is-grid-copied' : ''} ${
              isCopyTop ? 'is-copy-top' : ''
            } ${isCopyBottom ? 'is-copy-bottom' : ''} ${
              isCopyStart ? 'is-copy-start' : ''
            } ${isCopyEnd ? 'is-copy-end' : ''} ${
              isFillSource ? 'is-fill-source' : ''
            } ${isFillPreview ? 'is-fill-preview' : ''}`}
            onFocus={() => {
              if (!nonInteractive) {
                setFocusedCell({ row: rowIndex, col: colIndex });
              }
            }}
            onPointerDown={(e) => {
              if (nonInteractive) return;
              lastPointerTypeRef.current = e.pointerType || 'mouse';
              if (e.pointerType !== 'mouse') {
                longPress.handlePointerDown(
                  e,
                  desktopCellKey,
                  nonInteractive,
                  () => {
                    clearSelection();
                    setFocusedCell({ row: rowIndex, col: colIndex });
                    onOpenCellEditor({ action, logDate });
                  },
                );
                return;
              }
              if (e.button !== 0) return;
              suppressNextClickRef.current = false;

              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                suppressNextClickRef.current = true;
                toggleCoordsInSelection([{ row: rowIndex, col: colIndex }]);
                focusGridCell(rowIndex, colIndex);
                return;
              }

              if (e.shiftKey) {
                e.preventDefault();
                suppressNextClickRef.current = true;
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
                setExtraCoords([]);
                setSelection({ anchor, extent });
                focusGridCell(extent.row, extent.col);
                return;
              }

              const rowMeta = visibleGridRows[rowIndex];
              dragSelectRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                anchor: { row: rowIndex, col: colIndex },
                lastExtent: { row: rowIndex, col: colIndex },
                anchorSide: rowMeta?.side ?? 'TIME_BOUND',
                active: false,
              };
            }}
            onPointerMove={longPress.handlePointerMove}
            onPointerUp={longPress.handlePointerUp}
            onPointerCancel={longPress.handlePointerCancel}
            onClick={(event) => {
              if (nonInteractive) return;
              if (longPress.shouldSuppressClick(event, desktopCellKey)) return;
              if (
                suppressNextClickRef.current ||
                event.shiftKey ||
                event.ctrlKey ||
                event.metaKey
              ) {
                suppressNextClickRef.current = false;
                lastCellTapRef.current = null;
                return;
              }
              // Google-Sheets-style select-first: a plain click only selects/focuses
              // (keeping any copy marquee for paste). Repeat clicks on the same cell
              // within MULTI_TAP_WINDOW_MS cycle the state (2 clicks = DONE, 3 = MISSED...).
              const tapAt = performance.now();
              const prevTap = lastCellTapRef.current;
              const isRepeatTap =
                prevTap !== null &&
                prevTap.key === coordKey &&
                tapAt - prevTap.at <= MULTI_TAP_WINDOW_MS;
              lastCellTapRef.current = { key: coordKey, at: tapAt };
              clearSelection();
              setFocusedCell({ row: rowIndex, col: colIndex });
              if (!isRepeatTap) return;
              // If React has not re-rendered since the previous cycle click, continue
              // from the state that click planned (prevents DONE->DONE on fast triple-clicks).
              const staleOverride =
                prevTap?.plannedFrom === display.state && prevTap.plannedTo
                  ? (prevTap.plannedTo as CellDisplayInfo['state'])
                  : undefined;
              void handleCellPrimaryCycle(action, logDate, display, {
                showUndoToast: lastPointerTypeRef.current !== 'mouse',
                stateOverride: staleOverride,
                onPlanned: (fromState, toState) => {
                  if (lastCellTapRef.current?.key === coordKey) {
                    lastCellTapRef.current.plannedFrom = display.state;
                    lastCellTapRef.current.plannedTo = toState;
                  }
                  void fromState;
                },
              });
            }}
            onContextMenu={(e) => {
              if (nonInteractive) return;
              if (longPress.shouldSuppressContextMenu(e, desktopCellKey)) {
                return;
              }
              e.preventDefault();
              if (selectedCellCount >= 2 && selectedCoordSet.has(coordKey)) {
                setFocusedCell({ row: rowIndex, col: colIndex });
                setContextMenu({ x: e.clientX, y: e.clientY });
                return;
              }
              setContextMenu(null);
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
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleFillHandleDoubleClick(rowIndex, colIndex);
              }}
              onPointerDown={(e) => {
                if (e.pointerType !== 'mouse' || e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                window.getSelection()?.removeAllRanges();
                const rowMeta = visibleGridRows[rowIndex];
                const sourceRect: GridRect = isMultiSelectionCorner && selectedRect
                  ? selectedRect
                  : {
                      r1: rowIndex,
                      r2: rowIndex,
                      c1: colIndex,
                      c2: colIndex,
                    };
                const sourceMatrix = buildMatrixFromRect(sourceRect);
                const nextFill: FillDragState = {
                  sourceRect,
                  sourceMatrix,
                  startX: e.clientX,
                  startY: e.clientY,
                  target: { row: sourceRect.r2, col: sourceRect.c2 },
                  sourceSide: rowMeta?.side ?? 'TIME_BOUND',
                };
                fillDragRef.current = nextFill;
                setFillDrag(nextFill);
                setIsGridDragging(true);
                clearSelection();
                setFocusedCell({ row: rowIndex, col: colIndex });
                document.body.style.cursor = 'crosshair';
              }}
            />
          )}
        </div>
      </td>
    );
  };

  const isRowFullySelected = (rowIndex: number): boolean => {
    if (weekDates.length === 0) return false;
    for (let c = 0; c < weekDates.length; c += 1) {
      if (!selectedCoordSet.has(`${rowIndex}:${c}`)) return false;
    }
    return true;
  };

  const isColFullySelected = (
    colIdx: number,
    startRow: number,
    endRow: number,
  ): boolean => {
    if (startRow > endRow) return false;
    for (let r = startRow; r <= endRow; r += 1) {
      if (!selectedCoordSet.has(`${r}:${colIdx}`)) return false;
    }
    return true;
  };

  const renderStandardGroupRows = (group: Period) => {
    const groupActions = actionsByPeriodId.get(group.id) ?? [];
    if (groupActions.length === 0) return null;
    const isCollapsed = Boolean(collapsedGroups[group.id]);
    const isLive =
      weekDates.includes(todayIslamicDate) && livePeriodIds.has(group.id);
    const liveWin = isLive ? todayWindowsByPeriodId.get(group.id) : undefined;
    const groupDropProps = dnd.getGroupDropProps(group.id);
    const periodDoneState = getPeriodQuickDoneState(group, activeDayDate);
    const isPeriodSelected =
      !isCollapsed && isPeriodFullySelected(group.id, activeDayCol);

    return (
      <React.Fragment key={group.id}>
        <tr
          className="group-row"
          role="row"
          data-period-id={group.id}
          data-period-side={group.side}
          {...groupDropProps}
        >
          <td colSpan={9} role="gridcell">
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
                  className={`btn group-select-btn ${isPeriodSelected ? 'is-period-selected' : ''}`}
                  data-period-id={group.id}
                  data-period-side={group.side}
                  aria-label={`تحديد مجموعة ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`}
                  onPointerDown={(e) => {
                    if (!isCollapsed) {
                      handlePeriodHeaderPointerDown(e, group, activeDayCol);
                    }
                  }}
                  onClick={(e) => {
                    if (suppressNextPeriodClickRef.current) {
                      suppressNextPeriodClickRef.current = false;
                      return;
                    }
                    if (isCollapsed) {
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [group.id]: false,
                      }));
                    } else {
                      handleSelectPeriodColumn(group.id, activeDayCol, e);
                    }
                  }}
                >
                  تحديد
                </button>
                <button
                  type="button"
                  className={`period-quick-done-btn group-quick-done-btn ${
                    periodDoneState.allDone ? 'is-all-done' : ''
                  }`}
                  aria-pressed={periodDoneState.allDone}
                  aria-label={
                    periodDoneState.allDone
                      ? `إلغاء إكمال جميع أعمال ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`
                      : `إكمال جميع أعمال ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`
                  }
                  title={
                    periodDoneState.allDone
                      ? `إلغاء إكمال ${group.title} (${formatArabicDateFull(activeDayDate)})`
                      : `إكمال ${group.title} (${formatArabicDateFull(activeDayDate)})`
                  }
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
            const rowSide = visibleGridRows[rowIndex]?.side ?? group.side;
            const itemProps = dnd.getItemProps(action.id);
            const handleProps = dnd.getHandleProps(action.id);
            const isRowSelected = isRowFullySelected(rowIndex);
            const isRowCrosshair =
              crosshairCoord !== null && crosshairCoord.row === rowIndex;

            return (
              <tr
                key={action.id}
                className={`data-row ${isRowSelected ? 'is-row-selected' : ''} ${
                  isRowCrosshair ? 'is-row-crosshair' : ''
                }`}
                role="row"
                data-grid-row={rowIndex}
                data-period-id={group.id}
                data-period-side={group.side}
                {...itemProps}
              >
                <td className="cell-title" role="rowheader" title={action.title}>
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
                      className={`row-title-btn ${isRowSelected ? 'is-row-selected' : ''} ${
                        isRowCrosshair ? 'is-row-crosshair' : ''
                      }`}
                      aria-label={`تحديد صف ${action.title}`}
                      onClick={(e) => handleSelectActionRow(rowIndex, e)}
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
                    rowSide,
                  });
                })}

                <td className="cell-rate nums" role="gridcell">{computeWeekRate(action)}</td>
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
                        void handleCellPrimaryCycle(action, d, display, {
                          showUndoToast: true,
                        });
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

    const sideFocusTarget: CrosshairFocusTarget | null =
      crosshairCoord !== null && crosshairCoord.side === side
        ? { rowIndex: crosshairCoord.row, colIndex: crosshairCoord.col }
        : null;
    const sideLayoutKey = `og:${side}:${weekDates[0] ?? ''}:${sideStartRow}:${sideEndRow}:${populatedGroups.length}`;

    return (
      <TableCrosshairStage
        coordinator={crosshairCoordinator}
        focusTarget={sideFocusTarget}
        layoutKey={sideLayoutKey}
      >
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
                const isColSelected = isColFullySelected(
                  colIdx,
                  sideStartRow,
                  sideEndRow,
                );
                const isColCrosshair =
                  crosshairCoord !== null &&
                  crosshairCoord.col === colIdx &&
                  crosshairCoord.side === side;
                return (
                  <th
                    key={d}
                    className={`col-day ${isToday ? 'is-today' : ''} ${
                      isColCrosshair ? 'is-col-crosshair' : ''
                    }`}
                    data-col-index={colIdx}
                    scope="col"
                  >
                    <button
                      type="button"
                      className={`col-day-btn ${isColSelected ? 'is-col-selected' : ''}`}
                      aria-label={`تحديد عمود ${formatArabicDateFull(d)}`}
                      onClick={(e) => handleSelectDayColumn(colIdx, side, e)}
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
              const periodDoneState = getPeriodQuickDoneState(
                group,
                activeDayDate,
              );
              const isPeriodSelected = isPeriodFullySelected(
                group.id,
                activeDayCol,
              );

              return (
                <React.Fragment key={group.id}>
                  {groupActions.map((action, idx) => {
                    const isLastInGroup = idx === groupActions.length - 1;
                    const rowIndex = rowIndexByActionId.get(action.id) ?? 0;
                    const isRowSelected = isRowFullySelected(rowIndex);
                    const isRowCrosshair =
                      crosshairCoord !== null && crosshairCoord.row === rowIndex;
                    return (
                      <tr
                        key={action.id}
                        role="row"
                        data-grid-row={rowIndex}
                        data-period-id={group.id}
                        data-period-side={side}
                        className={`data-row ${isLastInGroup ? 'period-end-row' : ''} ${
                          isRowSelected ? 'is-row-selected' : ''
                        } ${isRowCrosshair ? 'is-row-crosshair' : ''}`}
                      >
                        {idx === 0 && (
                          <td
                            className={`cell-period ${isLive ? 'is-live-period' : ''}`}
                            role="rowheader"
                            rowSpan={groupActions.length}
                            data-period-id={group.id}
                            data-period-side={side}
                            onPointerDown={(e) =>
                              handlePeriodHeaderPointerDown(
                                e,
                                group,
                                activeDayCol,
                              )
                            }
                            onClick={(e) => {
                              if ((e.target as Element | null)?.closest('button')) {
                                return;
                              }
                              if (suppressNextPeriodClickRef.current) {
                                suppressNextPeriodClickRef.current = false;
                                return;
                              }
                              handleSelectPeriodColumn(
                                group.id,
                                activeDayCol,
                                e,
                              );
                            }}
                          >
                            <div className="cell-period-inner">
                              <button
                                type="button"
                                className={`period-select-btn ${
                                  isPeriodSelected ? 'is-period-selected' : ''
                                }`}
                                data-period-id={group.id}
                                data-period-side={side}
                                aria-label={`تحديد فترة ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`}
                                onClick={(e) => {
                                  if (suppressNextPeriodClickRef.current) {
                                    suppressNextPeriodClickRef.current = false;
                                    return;
                                  }
                                  handleSelectPeriodColumn(
                                    group.id,
                                    activeDayCol,
                                    e,
                                  );
                                }}
                              >
                                {group.title}
                              </button>
                              <button
                                type="button"
                                className={`period-quick-done-btn ${
                                  periodDoneState.allDone ? 'is-all-done' : ''
                                }`}
                                aria-pressed={periodDoneState.allDone}
                                aria-label={
                                  periodDoneState.allDone
                                    ? `إلغاء إكمال جميع أعمال ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`
                                    : `إكمال جميع أعمال ${group.title} ليوم ${formatArabicDateFull(activeDayDate)}`
                                }
                                title={
                                  periodDoneState.allDone
                                    ? `إلغاء إكمال ${group.title} (${formatArabicDateFull(activeDayDate)})`
                                    : `إكمال ${group.title} (${formatArabicDateFull(activeDayDate)})`
                                }
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
                        <td className="cell-title" role="rowheader" title={action.title}>
                          <button
                            type="button"
                            className={`row-title-btn ${isRowSelected ? 'is-row-selected' : ''} ${
                              isRowCrosshair ? 'is-row-crosshair' : ''
                            }`}
                            aria-label={`تحديد صف ${action.title}`}
                            onClick={(e) => handleSelectActionRow(rowIndex, e)}
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
                            rowSide: side,
                          });
                        })}
                        <td className="cell-rate nums" role="gridcell">
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
      </TableCrosshairStage>
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
            onClick={() => {
              if (weekDates.includes(todayIslamicDate)) {
                restoreFocusToGrid({
                  row: effectiveFocusedCell?.row ?? 0,
                  col: todayColIdx,
                });
              } else {
                pendingJumpTodayFocusRef.current = true;
                navigateWeek(todayIslamicDate);
              }
            }}
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
          <span className="matrix-hint-item">نقرة: تحديد</span>
          <span className="matrix-hint-item">نقرتان: تم، ثلاث: فائت</span>
          <span className="matrix-hint-item">كليك يمين: تعديل وملاحظة</span>
          <span className="matrix-hint-item">سحب أو Shift: تحديد متعدد</span>
          <span className="matrix-hint-item">مقبض الزاوية: تعبئة سريعة</span>
          <span className="matrix-hint-item">Ctrl+C / Ctrl+V: نسخ ولصق</span>
          {!oneGlanceMode && isOnline && (
            <span className="matrix-hint-item">مقبض السحب أو Alt+↑/↓: إعادة الترتيب</span>
          )}
        </div>

        <div
          ref={desktopGridAreaRef}
          className={isGridDragging ? 'is-grid-dragging' : undefined}
        >
          {oneGlanceMode ? (
            <div className="overview-split" data-testid="one-glance-split">
              {renderOneGlanceSideTable('TIME_BOUND')}
              {renderOneGlanceSideTable('DAILY_GROUP')}
            </div>
          ) : (
            <TableCrosshairStage
              coordinator={crosshairCoordinator}
              focusTarget={
                crosshairCoord !== null
                  ? { rowIndex: crosshairCoord.row, colIndex: crosshairCoord.col }
                  : null
              }
              layoutKey={`std:${weekDates[0] ?? ''}:${visibleGridRows.length}:${Object.entries(collapsedGroups)
                .filter(([, v]) => v)
                .map(([k]) => k)
                .join(',')}`}
            >
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
                      const isColSelected = isColFullySelected(
                        colIdx,
                        0,
                        visibleGridRows.length - 1,
                      );
                      const isColCrosshair =
                        crosshairCoord !== null && crosshairCoord.col === colIdx;
                      return (
                        <th
                          key={d}
                          className={`col-day ${isToday ? 'is-today' : ''} ${
                            isColCrosshair ? 'is-col-crosshair' : ''
                          }`}
                          data-col-index={colIdx}
                          scope="col"
                        >
                          <button
                            type="button"
                            className={`col-day-btn ${isColSelected ? 'is-col-selected' : ''}`}
                            aria-label={`تحديد عمود ${formatArabicDateFull(d)}`}
                            onClick={(e) =>
                              handleSelectDayColumn(colIdx, undefined, e)
                            }
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
                  <tr className="side-label-row" role="presentation">
                    <td colSpan={9}>{AR_STRINGS.week.rightSideTitle}</td>
                  </tr>
                  {activeGroups.right.map(renderStandardGroupRows)}

                  <tr className="side-divider" aria-hidden="true">
                    <td colSpan={9} />
                  </tr>

                  <tr className="side-label-row" role="presentation">
                    <td colSpan={9}>{AR_STRINGS.week.leftSideTitle}</td>
                  </tr>
                  {activeGroups.left.map(renderStandardGroupRows)}
                </tbody>
              </table>
            </TableCrosshairStage>
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
                      restoreFocus: true,
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
                      restoreFocus: true,
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
                        restoreFocus: true,
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
                        restoreFocus: true,
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
                      restoreFocus: true,
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
                      restoreFocus: true,
                    },
                  );
                }}
              >
                <span>مسح</span>
              </button>

              <button
                type="button"
                className="btn"
                onClick={() =>
                  handleCopySelection({
                    clearSelection: true,
                    restoreFocus: true,
                  })
                }
              >
                <IconCopy size="sm" />
                <span>نسخ</span>
              </button>

              {hasClipboard && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void handlePasteSelection({ restoreFocus: true });
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
                onClick={() => {
                  clearSelection();
                  restoreFocusToGrid();
                }}
              >
                <IconX size="sm" />
              </button>
            </div>
          </div>
        )}

        {/* Cursor-Anchored Multi-Cell Right-Click Context Menu */}
        {contextMenu && selectedCellCount >= 2 && (
          <div
            ref={contextMenuRef}
            role="menu"
            aria-label="إجراءات التحديد المتعدد"
            className="week-context-menu"
            data-testid="week-context-menu"
            style={{
              left: `${Math.max(8, contextMenu.x - 212)}px`,
              top: `${Math.max(8, contextMenu.y)}px`,
            }}
            onKeyDown={(e) => {
              const items = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]',
                ),
              );
              if (items.length === 0) return;
              const currentIdx = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                items[(currentIdx + 1 + items.length) % items.length]?.focus();
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                items[(currentIdx - 1 + items.length) % items.length]?.focus();
              } else if (e.key === 'Home') {
                e.preventDefault();
                items[0]?.focus();
              } else if (e.key === 'End') {
                e.preventDefault();
                items[items.length - 1]?.focus();
              }
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="week-context-menu-item is-done"
              onClick={() => {
                setContextMenu(null);
                void applyTargetStateToCoords(
                  getTargetCoords(),
                  { kind: 'DONE', percentValue: null },
                  {
                    showToast: true,
                    actionNameAr: 'تم تحديد تم للكل',
                    clearSelection: true,
                    restoreFocus: true,
                  },
                );
              }}
            >
              <span className="week-context-menu-item-label">
                <IconCheck size="sm" />
                <span>تم للكل</span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="week-context-menu-item is-missed"
              onClick={() => {
                setContextMenu(null);
                void applyTargetStateToCoords(
                  getTargetCoords(),
                  { kind: 'MISSED', percentValue: null },
                  {
                    showToast: true,
                    actionNameAr: 'تم تحديد فات للكل',
                    clearSelection: true,
                    restoreFocus: true,
                  },
                );
              }}
            >
              <span className="week-context-menu-item-label">
                <IconCross size="sm" />
                <span>فات للكل</span>
              </span>
            </button>

            {selectedHasPercentageEligible && (
              <button
                type="button"
                role="menuitem"
                className="week-context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  void applyTargetStateToCoords(
                    getTargetCoords(),
                    { kind: 'PERCENT', percentValue: 50 },
                    {
                      showToast: true,
                      actionNameAr: 'تم تحديد 50%',
                      clearSelection: true,
                      restoreFocus: true,
                    },
                  );
                }}
              >
                <span className="week-context-menu-item-label nums">
                  <span>50% للكل</span>
                </span>
              </button>
            )}

            {selectedHasQadaaEligible && (
              <button
                type="button"
                role="menuitem"
                className="week-context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  void applyTargetStateToCoords(
                    getTargetCoords(),
                    { kind: 'QADAA_DONE', percentValue: null },
                    {
                      showToast: true,
                      actionNameAr: 'تم تسجيل القضاء',
                      clearSelection: true,
                      restoreFocus: true,
                    },
                  );
                }}
              >
                <span className="week-context-menu-item-label">
                  <IconQadaa size="sm" />
                  <span>قضاء للكل</span>
                </span>
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              className="week-context-menu-item"
              onClick={() => {
                setContextMenu(null);
                void applyTargetStateToCoords(
                  getTargetCoords(),
                  { kind: 'DISABLED', percentValue: null },
                  {
                    showToast: true,
                    actionNameAr: 'تم تعطيل',
                    clearSelection: true,
                    restoreFocus: true,
                  },
                );
              }}
            >
              <span className="week-context-menu-item-label">
                <IconDash size="sm" />
                <span>تعطيل للكل</span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="week-context-menu-item"
              onClick={() => {
                setContextMenu(null);
                void applyTargetStateToCoords(
                  getTargetCoords(),
                  { kind: 'EMPTY', percentValue: null },
                  {
                    showToast: true,
                    actionNameAr: 'تم مسح الحالات',
                    clearSelection: true,
                    restoreFocus: true,
                  },
                );
              }}
            >
              <span className="week-context-menu-item-label">
                <span>مسح الخلايا</span>
              </span>
            </button>

            <div role="separator" className="week-context-menu-divider" />

            <button
              type="button"
              role="menuitem"
              className="week-context-menu-item"
              onClick={() => {
                setContextMenu(null);
                handleCopySelection({
                  clearSelection: true,
                  restoreFocus: true,
                });
              }}
            >
              <span className="week-context-menu-item-label">
                <IconCopy size="sm" />
                <span>نسخ</span>
              </span>
              <kbd className="week-context-menu-kbd" dir="ltr">
                Ctrl+C
              </kbd>
            </button>

            <button
              type="button"
              role="menuitem"
              className="week-context-menu-item"
              onClick={() => {
                setContextMenu(null);
                void handleCutSelection({ restoreFocus: true });
              }}
            >
              <span className="week-context-menu-item-label">
                <span>قص</span>
              </span>
              <kbd className="week-context-menu-kbd" dir="ltr">
                Ctrl+X
              </kbd>
            </button>

            {hasClipboard && (
              <button
                type="button"
                role="menuitem"
                className="week-context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  void handlePasteSelection({ restoreFocus: true });
                }}
              >
                <span className="week-context-menu-item-label">
                  <IconClipboard size="sm" />
                  <span>لصق</span>
                </span>
                <kbd className="week-context-menu-kbd" dir="ltr">
                  Ctrl+V
                </kbd>
              </button>
            )}

            {selectedRect && selectedRect.r2 > selectedRect.r1 && (
              <button
                type="button"
                role="menuitem"
                className="week-context-menu-item"
                title="ينسخ حالة الصف الأول المحدد ويكررها على الصفوف التي تحته"
                onClick={() => {
                  setContextMenu(null);
                  void handleFillDownShortcut({ restoreFocus: true });
                }}
              >
                <span className="week-context-menu-item-label">
                  <IconArrowDown size="sm" />
                  <span>تعبئة لأسفل (من الصف الأول)</span>
                </span>
                <kbd className="week-context-menu-kbd" dir="ltr">
                  Ctrl+D
                </kbd>
              </button>
            )}
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
                                    { showUndoToast: true },
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
      <AppDialog
        open={normalDialogOpen}
        onRequestClose={() => setNormalDialogOpen(false)}
        canDismiss={!bulkBusy}
        className="app-dialog"
        aria-labelledby="normal-day-dialog-title"
      >
        <div className="dialog-head">
          <h2 className="dialog-title" id="normal-day-dialog-title">
            {AR_STRINGS.week.normalDayButton}
          </h2>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="إغلاق"
            disabled={bulkBusy}
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
      </AppDialog>
    </>
  );
}

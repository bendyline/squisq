/**
 * DataGrid — the virtualized grid over a `TableQueryProvider`.
 *
 * Rendering model: TanStack Virtual drives ROW virtualization only (at the
 * ~20-column design target, column virtualization buys nothing and costs
 * sticky-header/selection complexity); columns are a CSS grid template from
 * the width map. The grid owns a bounded scroll container
 * (`overscroll-behavior: contain`) — it never scrolls the document.
 *
 * Interaction contract (kept in sync with the plan spec):
 *  - selection: rectangular `{anchor, focus}` in view coordinates; roving
 *    tabIndex on the focused cell (real focus — the cell editor needs it);
 *  - keyboard: arrows move, Shift extends, Ctrl/Cmd jumps to data edges,
 *    PageUp/Down by viewport, Home/End row-wise, Ctrl/Cmd+Home/End
 *    grid-wise, Enter commits+moves down, Tab commits+moves right, F2 or
 *    typing opens the editor, Escape cancels, Ctrl/Cmd+A selects all,
 *    Ctrl/Cmd+Z / +Shift+Z drive the edit journal;
 *  - clipboard: `copy` writes TSV (`text/plain`) + `<table>` (`text/html`)
 *    from the selection prefetch cache (capped; truncation is announced);
 *  - edits: committed per cell through `provider.applyEdits` + the journal;
 *    the view is NEVER auto re-sorted after an edit — `staleView` drives an
 *    explicit refresh affordance instead;
 *  - sort headers cycle asc → desc → none; Shift+click appends a term.
 *
 * Theming: every color resolves through `--squisq-grid-*` tokens with
 * literal fallbacks (see styles/grid.css) so the grid works standalone;
 * editor-react aliases the tokens onto its chrome palette.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  FilterOp,
  TableCellEdit,
  TableCellValue,
  TableColumnKind,
  TableQueryProvider,
  TableSchema,
  TableViewState,
} from '@bendyline/squisq/table';
import { serializeTableViewState } from '@bendyline/squisq/table';
import type { EditJournal } from './store/journal.js';

const ROW_HEIGHT = 28;
const PAGE_SIZE = 200;
const OVERSCAN = 12;
const DEFAULT_HEIGHT = 420;
const COPY_CELL_CAP = 50_000;
const DEFAULT_COL_WIDTH = 140;

export interface DataGridProps {
  provider: TableQueryProvider;
  /** Present = editable; the journal records batches for undo + save. */
  journal?: EditJournal;
  view: TableViewState;
  onViewChange?: (view: TableViewState) => void;
  /** False = view state is session-only ("not saved to document" hint). */
  viewPersisted?: boolean;
  onSave?: () => void | Promise<void>;
  saving?: boolean;
  height?: number;
  /** Reason editing is unavailable (e.g. parquet sidecars). */
  readOnlyReason?: string;
  /**
   * Per-cell lock predicate (source row id + column). A locked cell renders
   * with a lock affordance and refuses edits while its neighbors stay
   * editable — how XLSX keeps formula/date cells safe from value patching.
   */
  isCellLocked?: (rowId: number, col: number) => boolean;
  /** Tooltip/announcement for locked cells. */
  lockedReason?: string;
  /**
   * Formula editing, when the host has a calculation engine. A cell whose
   * `getFormula` returns text edits as `=formula`; any committed draft
   * starting with `=` routes through `commitFormula`, whose returned
   * `updates` (the edited cell plus recalculated dependents) are applied to
   * the provider and the visible cache.
   */
  formulaSupport?: FormulaSupport;
  /**
   * Notified after each committed VALUE edit. A host mirroring edits into a
   * calculation engine may RETURN the recalculated dependent updates, which
   * the grid applies to the provider and the visible cache — this is what
   * makes formula cells recalc live when a plain value changes.
   */
  onCellEdited?: (edit: TableCellEdit) => void | TableCellEdit[] | Promise<void | TableCellEdit[]>;
  /** Unsaved formula edits (kept outside the value journal) for the save bar. */
  extraDirtyCount?: number;
  /**
   * Discard handler for those formula edits (runs beside journal discard).
   * The host reverts its engine + provider; the grid then refetches.
   */
  onDiscardExtra?: () => void | Promise<void>;
  className?: string;
}

export interface FormulaCommitResult {
  ok: boolean;
  /** User-facing message when `ok` is false (parse error, budget, …). */
  error?: string;
  /** Value updates to apply: the edited cell + recalculated dependents. */
  updates?: TableCellEdit[];
}

export interface FormulaSupport {
  /** Formula source (no `=`) for a cell, or undefined for plain values. */
  getFormula(rowId: number, col: number): string | undefined;
  commitFormula(rowId: number, col: number, formula: string): Promise<FormulaCommitResult>;
}

interface CellPos {
  row: number;
  col: number;
}

interface Selection {
  anchor: CellPos;
  focus: CellPos;
}

interface PageCache {
  version: number;
  pages: Map<number, { rowIds: number[]; cells: TableCellValue[][] }>;
}

function cellDisplay(value: TableCellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function coerceInput(text: string, kind: TableColumnKind): TableCellValue | { error: string } {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (kind === 'number') {
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return { error: 'not a number' };
    return value;
  }
  if (kind === 'boolean') {
    if (/^(?:true|1)$/i.test(trimmed)) return true;
    if (/^(?:false|0)$/i.test(trimmed)) return false;
    return { error: 'true or false' };
  }
  return text;
}

interface FilterOpChoice {
  op: FilterOp;
  glyph: string;
  label: string;
}

/** Text-matching choices (string/date columns; case toggle applies). */
const TEXT_OP_CHOICES: readonly FilterOpChoice[] = [
  { op: '~', glyph: '~', label: 'Contains' },
  { op: '!~', glyph: '!~', label: "Doesn't contain" },
  { op: '=', glyph: '=', label: 'Equals' },
  { op: '!=', glyph: '≠', label: 'Not equal' },
  { op: '^~', glyph: '^', label: 'Starts with' },
  { op: '$~', glyph: '$', label: 'Ends with' },
];

/** Comparison choices (every kind; the whole set for numeric columns). */
const COMPARE_OP_CHOICES: readonly FilterOpChoice[] = [
  { op: '=', glyph: '=', label: 'Equals' },
  { op: '!=', glyph: '≠', label: 'Not equal' },
  { op: '<', glyph: '<', label: 'Less than' },
  { op: '>', glyph: '>', label: 'Greater than' },
  { op: '<=', glyph: '≤', label: 'At most' },
  { op: '>=', glyph: '≥', label: 'At least' },
];

function opChoicesFor(kind: TableColumnKind): readonly FilterOpChoice[] {
  if (kind === 'number' || kind === 'boolean') return COMPARE_OP_CHOICES;
  // Text-ish columns hold anything ("mixed"), so they get both families.
  return [
    ...TEXT_OP_CHOICES,
    ...COMPARE_OP_CHOICES.filter((choice) => choice.op !== '=' && choice.op !== '!='),
  ];
}

function defaultOpFor(kind: TableColumnKind): FilterOp {
  return kind === 'number' || kind === 'boolean' ? '=' : '~';
}

function glyphFor(kind: TableColumnKind, op: FilterOp): string {
  return (
    opChoicesFor(kind).find((choice) => choice.op === op)?.glyph ??
    TEXT_OP_CHOICES.find((choice) => choice.op === op)?.glyph ??
    op
  );
}

/** Ops the case-sensitivity toggle applies to. */
const CASE_CAPABLE_OPS: readonly FilterOp[] = ['=', '!=', '~', '!~', '^~', '$~'];

function normalizedRange(selection: Selection): { r0: number; r1: number; c0: number; c1: number } {
  return {
    r0: Math.min(selection.anchor.row, selection.focus.row),
    r1: Math.max(selection.anchor.row, selection.focus.row),
    c0: Math.min(selection.anchor.col, selection.focus.col),
    c1: Math.max(selection.anchor.col, selection.focus.col),
  };
}

export function DataGrid({
  provider,
  journal,
  view,
  onViewChange,
  viewPersisted = true,
  onSave,
  saving = false,
  height = DEFAULT_HEIGHT,
  readOnlyReason,
  isCellLocked,
  lockedReason,
  formulaSupport,
  onCellEdited,
  extraDirtyCount = 0,
  onDiscardExtra,
  className,
}: DataGridProps): ReactElement {
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [viewRowCount, setViewRowCount] = useState(0);
  const [issueNote, setIssueNote] = useState<string | null>(null);
  const [staleView, setStaleView] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<(CellPos & { draft: string; error?: string }) | null>(
    null,
  );
  const [colWidths, setColWidths] = useState<Record<number, number>>({});
  /** Per-column filter operator + case flag (defaults derive from kind/view). */
  const [filterOps, setFilterOps] = useState<
    Record<number, { op: FilterOp; caseSensitive: boolean }>
  >({});
  /** Column whose operator menu is open, if any. */
  const [opMenuCol, setOpMenuCol] = useState<number | null>(null);
  const [dirtyTick, setDirtyTick] = useState(0);
  const [announce, setAnnounce] = useState('');
  // Re-render + refetch signal. It must be a REAL dependency of the windowed
  // fetch effect: after applyView clears the page cache, neither
  // `virtualItems` nor `viewRowCount` necessarily changes (same row count,
  // same scroll box), so without this tick the effect never re-runs and the
  // grid renders empty rows — caught by the browser e2e, invisible in jsdom.
  const [fetchTick, setFetchTick] = useState(0);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const cache = useRef<PageCache>({ version: 0, pages: new Map() });
  const inFlight = useRef(new Set<number>());
  const selectionCells = useRef(new Map<number, TableCellValue[]>());
  const viewRef = useRef(view);
  viewRef.current = view;

  const editable = Boolean(journal && provider.applyEdits && !readOnlyReason);
  const dirtyCount = journal?.dirtyCount ?? 0;
  void dirtyTick;
  void fetchTick;

  // ── Schema + view lifecycle ────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    provider.describe().then(
      (described) => {
        if (!cancelled) setSchema(described);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const applyView = useCallback(
    async (next: TableViewState) => {
      const result = await provider.setView(next);
      cache.current = { version: cache.current.version + 1, pages: new Map() };
      inFlight.current.clear();
      setViewRowCount(result.viewRowCount);
      setStaleView(false);
      setIssueNote(
        result.issues.length > 0 ? result.issues.map((i) => i.message).join('; ') : null,
      );
      setFetchTick((t) => t + 1);
    },
    [provider],
  );

  useEffect(() => {
    void applyView(view);
    // Serialized form is the stable identity of a view.
  }, [applyView, JSON.stringify(serializeTableViewState(view))]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Virtualizer + windowed fetch ───────────────────────────────────

  const virtualizer = useVirtualizer({
    count: viewRowCount,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // Correct first paint before the scroll element is measured — and the
    // only measurement available in layout-less environments (jsdom).
    initialRect: { width: 800, height },
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    if (viewRowCount === 0) return;
    const version = cache.current.version;
    const first = virtualItems[0]?.index ?? 0;
    const last = virtualItems[virtualItems.length - 1]?.index ?? 0;
    const firstPage = Math.floor(first / PAGE_SIZE);
    const lastPage = Math.floor(last / PAGE_SIZE);
    for (let page = firstPage; page <= lastPage; page++) {
      if (cache.current.pages.has(page) || inFlight.current.has(page)) continue;
      inFlight.current.add(page);
      provider.rows(page * PAGE_SIZE, PAGE_SIZE).then(
        (result) => {
          inFlight.current.delete(page);
          if (cache.current.version !== version) return; // view changed
          cache.current.pages.set(page, {
            rowIds: Array.from(result.rowIds),
            cells: result.cells,
          });
          setFetchTick((t) => t + 1);
        },
        () => inFlight.current.delete(page),
      );
    }
  }, [provider, virtualItems, viewRowCount, fetchTick]);

  const cellAt = useCallback((row: number): { rowId: number; cells: TableCellValue[] } | null => {
    const page = cache.current.pages.get(Math.floor(row / PAGE_SIZE));
    if (!page) return null;
    const offset = row % PAGE_SIZE;
    const rowId = page.rowIds[offset];
    const cells = page.cells[offset];
    if (rowId === undefined || !cells) return null;
    return { rowId, cells };
  }, []);

  // ── Selection prefetch (clipboard) ─────────────────────────────────

  useEffect(() => {
    if (!selection || !schema) return;
    const { r0, r1 } = normalizedRange(selection);
    if ((r1 - r0 + 1) * schema.columns.length > COPY_CELL_CAP) return;
    let cancelled = false;
    void (async () => {
      const rows = new Map<number, TableCellValue[]>();
      for (let start = r0; start <= r1; start += PAGE_SIZE) {
        const page = await provider.rows(start, Math.min(PAGE_SIZE, r1 - start + 1));
        if (cancelled) return;
        page.cells.forEach((cells, index) => rows.set(page.start + index, cells));
      }
      selectionCells.current = rows;
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, schema, selection]);

  const handleCopy = useCallback(
    (event: React.ClipboardEvent) => {
      if (!selection || !schema || editing) return;
      // Copying text selected INSIDE the filter inputs must stay a normal
      // text copy, not a grid-selection copy.
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      const { r0, r1, c0, c1 } = normalizedRange(selection);
      const capRows = Math.floor(COPY_CELL_CAP / Math.max(1, c1 - c0 + 1));
      const lastRow = Math.min(r1, r0 + capRows - 1);
      const lines: string[] = [];
      const htmlRows: string[] = [];
      for (let row = r0; row <= lastRow; row++) {
        const cells = selectionCells.current.get(row) ?? cellAt(row)?.cells;
        const values: string[] = [];
        for (let col = c0; col <= c1; col++) values.push(cellDisplay(cells?.[col] ?? null));
        lines.push(values.join('\t'));
        htmlRows.push(`<tr>${values.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`);
      }
      event.clipboardData.setData('text/plain', lines.join('\n'));
      event.clipboardData.setData('text/html', `<table>${htmlRows.join('')}</table>`);
      if (lastRow < r1) {
        setAnnounce(`Copy truncated to ${lastRow - r0 + 1} rows (${COPY_CELL_CAP} cell cap).`);
      } else {
        setAnnounce(`Copied ${lastRow - r0 + 1}×${c1 - c0 + 1} cells.`);
      }
    },
    [cellAt, editing, schema, selection],
  );

  // ── Editing ────────────────────────────────────────────────────────

  const beginEdit = useCallback(
    (pos: CellPos, seed?: string) => {
      if (!editable || !schema) return;
      const current = cellAt(pos.row);
      if (current && isCellLocked?.(current.rowId, pos.col)) {
        setAnnounce(lockedReason ?? 'This cell is locked');
        return;
      }
      // A formula cell edits as its SOURCE, not its display value.
      const formula = current ? formulaSupport?.getFormula(current.rowId, pos.col) : undefined;
      setEditing({
        ...pos,
        draft:
          seed ??
          (formula !== undefined ? `=${formula}` : cellDisplay(current?.cells[pos.col] ?? null)),
      });
    },
    [cellAt, editable, schema, isCellLocked, lockedReason, formulaSupport],
  );

  /** Patch loaded page caches after a multi-cell (formula recalc) update. */
  const applyCacheUpdates = useCallback((edits: readonly TableCellEdit[]) => {
    if (edits.length === 0) return;
    const byRowId = new Map<number, TableCellEdit[]>();
    for (const edit of edits) {
      const list = byRowId.get(edit.rowId) ?? [];
      list.push(edit);
      byRowId.set(edit.rowId, list);
    }
    for (const page of cache.current.pages.values()) {
      for (let offset = 0; offset < page.rowIds.length; offset++) {
        const rowEdits = byRowId.get(page.rowIds[offset]!);
        if (!rowEdits) continue;
        for (const edit of rowEdits) {
          page.cells[offset]![edit.col] = edit.value;
        }
      }
    }
    setFetchTick((t) => t + 1);
  }, []);

  const commitEdit = useCallback(async (): Promise<boolean> => {
    if (!editing || !schema || !journal || !provider.applyEdits) return true;

    // Formula path: `=…` drafts route through the host's engine, which
    // returns the edited cell plus every recalculated dependent.
    if (formulaSupport && editing.draft.trim().startsWith('=')) {
      const located = cellAt(editing.row);
      if (!located) {
        setEditing(null);
        return true;
      }
      const result = await formulaSupport.commitFormula(
        located.rowId,
        editing.col,
        editing.draft.trim().slice(1),
      );
      if (!result.ok) {
        setEditing({ ...editing, error: result.error ?? 'formula rejected' });
        return false;
      }
      setEditing(null);
      if (result.updates && result.updates.length > 0) {
        const applied = await provider.applyEdits(result.updates);
        if (applied.staleView) setStaleView(true);
        applyCacheUpdates(result.updates);
      }
      setDirtyTick((t) => t + 1);
      return true;
    }

    const kind = schema.columns[editing.col]?.kind ?? 'string';
    const coerced = coerceInput(editing.draft, kind);
    if (typeof coerced === 'object' && coerced !== null && 'error' in coerced) {
      setEditing({ ...editing, error: coerced.error });
      return false;
    }
    const located = cellAt(editing.row);
    if (!located) {
      setEditing(null);
      return true;
    }
    const prev = located.cells[editing.col] ?? null;
    const next = coerced as TableCellValue;
    setEditing(null);
    if (prev === next) return true;
    journal.commit([{ rowId: located.rowId, col: editing.col, prev, next }]);
    located.cells[editing.col] = next; // optimistic cache update
    const result = await provider.applyEdits([
      { rowId: located.rowId, col: editing.col, value: next },
    ]);
    if (result.staleView) setStaleView(true);
    // Let the host mirror the edit (e.g. into its calculation engine);
    // returned dependent updates recalc the visible grid live.
    const dependents = await onCellEdited?.({
      rowId: located.rowId,
      col: editing.col,
      value: next,
    });
    if (dependents && dependents.length > 0) {
      const applied = await provider.applyEdits(dependents);
      if (applied.staleView) setStaleView(true);
      applyCacheUpdates(dependents);
    }
    setDirtyTick((t) => t + 1);
    return true;
  }, [applyCacheUpdates, cellAt, editing, formulaSupport, journal, onCellEdited, provider, schema]);

  const runJournal = useCallback(
    async (direction: 'undo' | 'redo') => {
      if (!journal || !provider.applyEdits) return;
      const edits = direction === 'undo' ? journal.undo() : journal.redo();
      if (edits.length === 0) return;
      const result = await provider.applyEdits(edits);
      if (result.staleView) setStaleView(true);
      cache.current.pages.clear();
      setDirtyTick((t) => t + 1);
      setFetchTick((t) => t + 1);
    },
    [journal, provider],
  );

  // ── Sort/filter interactions ───────────────────────────────────────

  const cycleSort = useCallback(
    (columnName: string, additive: boolean) => {
      const current = viewRef.current;
      const existing = current.sort.find((term) => term.column === columnName);
      let nextTerms = additive ? [...current.sort] : [];
      if (!existing) {
        nextTerms = additive
          ? [...nextTerms, { column: columnName, dir: 'asc' as const }]
          : [{ column: columnName, dir: 'asc' as const }];
      } else if (existing.dir === 'asc') {
        nextTerms = (additive ? current.sort : [existing]).map((term) =>
          term.column === columnName ? { ...term, dir: 'desc' as const } : term,
        );
      } else {
        nextTerms = (additive ? current.sort : []).filter((term) => term.column !== columnName);
      }
      onViewChange?.({ ...current, sort: nextTerms });
    },
    [onViewChange],
  );

  /** The header filter row owns ONE clause per column, whatever its op. */
  const setColumnFilter = useCallback(
    (columnName: string, text: string, op: FilterOp, caseSensitive: boolean) => {
      const current = viewRef.current;
      const others = current.filter.filter((clause) => clause.column !== columnName);
      onViewChange?.({
        ...current,
        filter:
          text.trim() === ''
            ? others
            : [
                ...others,
                {
                  column: columnName,
                  op,
                  value: text,
                  ...(caseSensitive && CASE_CAPABLE_OPS.includes(op)
                    ? { caseSensitive: true }
                    : {}),
                },
              ],
      });
    },
    [onViewChange],
  );

  /** Resolve a column's operator state: local choice ▸ view clause ▸ kind default. */
  const opStateFor = useCallback(
    (col: number, columnName: string): { op: FilterOp; caseSensitive: boolean } => {
      const local = filterOps[col];
      if (local) return local;
      const clause = viewRef.current.filter.find((entry) => entry.column === columnName);
      if (clause) return { op: clause.op, caseSensitive: clause.caseSensitive === true };
      return { op: defaultOpFor(schema?.columns[col]?.kind ?? 'string'), caseSensitive: false };
    },
    [filterOps, schema],
  );

  const chooseFilterOp = useCallback(
    (col: number, columnName: string, next: { op: FilterOp; caseSensitive: boolean }) => {
      setFilterOps((prev) => ({ ...prev, [col]: next }));
      setOpMenuCol(null);
      const clause = viewRef.current.filter.find((entry) => entry.column === columnName);
      if (clause && clause.value.trim() !== '') {
        setColumnFilter(columnName, clause.value, next.op, next.caseSensitive);
      }
    },
    [setColumnFilter],
  );

  // ── Keyboard ───────────────────────────────────────────────────────

  const moveFocus = useCallback(
    (rowDelta: number, colDelta: number, extend: boolean, absolute?: Partial<CellPos>) => {
      if (!schema) return;
      setSelection((prev) => {
        const from = prev?.focus ?? { row: 0, col: 0 };
        const next: CellPos = {
          row: Math.max(0, Math.min(viewRowCount - 1, absolute?.row ?? from.row + rowDelta)),
          col: Math.max(
            0,
            Math.min(schema.columns.length - 1, absolute?.col ?? from.col + colDelta),
          ),
        };
        virtualizer.scrollToIndex(next.row);
        return extend && prev
          ? { anchor: prev.anchor, focus: next }
          : { anchor: next, focus: next };
      });
    },
    [schema, viewRowCount, virtualizer],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!schema) return;
      // Keys typed into a text-entry element inside the grid (the header
      // FILTER inputs) belong to that element — without this guard they
      // bubble here and the "typing opens the cell editor" branch starts
      // editing the focused cell with the filter's keystrokes. The cell
      // editor itself is exempt: its keys are governed by `editing` below.
      const target = event.target as HTMLElement | null;
      const inTextEntry =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target !== null && target.isContentEditable);
      if (inTextEntry && !editing) return;
      const meta = event.metaKey || event.ctrlKey;
      if (editing) {
        if (event.key === 'Escape') {
          setEditing(null);
          event.preventDefault();
        } else if (event.key === 'Enter') {
          void commitEdit().then((ok) => ok && moveFocus(1, 0, false));
          event.preventDefault();
        } else if (event.key === 'Tab') {
          void commitEdit().then((ok) => ok && moveFocus(0, event.shiftKey ? -1 : 1, false));
          event.preventDefault();
        }
        return;
      }

      const pageRows = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
      switch (event.key) {
        case 'ArrowDown':
          moveFocus(
            meta ? Number.POSITIVE_INFINITY : 1,
            0,
            event.shiftKey,
            meta ? { row: viewRowCount - 1 } : undefined,
          );
          break;
        case 'ArrowUp':
          moveFocus(meta ? 0 : -1, 0, event.shiftKey, meta ? { row: 0 } : undefined);
          break;
        case 'ArrowRight':
          moveFocus(
            0,
            meta ? 0 : 1,
            event.shiftKey,
            meta ? { col: schema.columns.length - 1 } : undefined,
          );
          break;
        case 'ArrowLeft':
          moveFocus(0, meta ? 0 : -1, event.shiftKey, meta ? { col: 0 } : undefined);
          break;
        case 'PageDown':
          moveFocus(pageRows, 0, event.shiftKey);
          break;
        case 'PageUp':
          moveFocus(-pageRows, 0, event.shiftKey);
          break;
        case 'Home':
          moveFocus(0, 0, event.shiftKey, meta ? { row: 0, col: 0 } : { col: 0 });
          break;
        case 'End':
          moveFocus(
            0,
            0,
            event.shiftKey,
            meta
              ? { row: viewRowCount - 1, col: schema.columns.length - 1 }
              : { col: schema.columns.length - 1 },
          );
          break;
        case 'Enter':
        case 'F2':
          if (selection) beginEdit(selection.focus);
          break;
        case 'a':
        case 'A':
          if (meta) {
            setSelection({
              anchor: { row: 0, col: 0 },
              focus: { row: viewRowCount - 1, col: schema.columns.length - 1 },
            });
            break;
          }
          if (selection && !meta) beginEdit(selection.focus, event.key);
          else return;
          break;
        case 'z':
        case 'Z':
          if (meta) {
            void runJournal(event.shiftKey ? 'redo' : 'undo');
            break;
          }
          if (selection) beginEdit(selection.focus, event.key);
          else return;
          break;
        default:
          if (selection && event.key.length === 1 && !meta && !event.altKey) {
            beginEdit(selection.focus, event.key);
            break;
          }
          return;
      }
      event.preventDefault();
    },
    [
      beginEdit,
      commitEdit,
      editing,
      height,
      moveFocus,
      runJournal,
      schema,
      selection,
      viewRowCount,
    ],
  );

  // ── Column resize ──────────────────────────────────────────────────

  const startResize = useCallback((col: number, startX: number, startWidth: number) => {
    const onMove = (event: PointerEvent): void => {
      setColWidths((widths) => ({
        ...widths,
        [col]: Math.max(60, startWidth + (event.clientX - startX)),
      }));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────

  const gridTemplate = useMemo(() => {
    const count = schema?.columns.length ?? 0;
    return Array.from(
      { length: count },
      (_, col) => `${colWidths[col] ?? DEFAULT_COL_WIDTH}px`,
    ).join(' ');
  }, [colWidths, schema]);

  const range = selection ? normalizedRange(selection) : null;
  const filterValueFor = (name: string): string =>
    view.filter.find((clause) => clause.column === name)?.value ?? '';

  return (
    <div
      className={`squisq-grid${className ? ` ${className}` : ''}`}
      role="grid"
      aria-rowcount={viewRowCount + 1}
      aria-colcount={schema?.columns.length ?? 0}
      aria-multiselectable="true"
      onKeyDown={handleKeyDown}
      onCopy={handleCopy}
      onMouseDownCapture={(event) => {
        // Any press outside the operator menu/button closes it (the widget's
        // event containment means a document-level listener can't be trusted).
        if (opMenuCol === null) return;
        const target = event.target as HTMLElement | null;
        if (!target?.closest('.squisq-grid-opmenu, .squisq-grid-opbutton')) setOpMenuCol(null);
      }}
      onKeyDownCapture={(event) => {
        if (opMenuCol !== null && event.key === 'Escape') setOpMenuCol(null);
      }}
    >
      <div className="squisq-grid-scroller" ref={bodyRef} style={{ height }}>
        <div
          className="squisq-grid-header"
          role="row"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {schema?.columns.map((column, col) => {
            const term = view.sort.find((entry) => entry.column === column.name);
            const ariaSort = term ? (term.dir === 'asc' ? 'ascending' : 'descending') : 'none';
            return (
              <div
                key={col}
                role="columnheader"
                aria-sort={ariaSort}
                className="squisq-grid-headercell"
              >
                <button
                  type="button"
                  className="squisq-grid-sortbutton"
                  onClick={(event) => cycleSort(column.name, event.shiftKey)}
                  title={`Sort by ${column.name}`}
                >
                  <span className="squisq-grid-colname">{column.name}</span>
                  {term && (
                    <span className="squisq-grid-sortmark" aria-hidden="true">
                      {term.dir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </button>
                <div className="squisq-grid-filterrow">
                  {(() => {
                    const opState = opStateFor(col, column.name);
                    const caseCapable = column.kind !== 'number' && column.kind !== 'boolean';
                    return (
                      <>
                        <button
                          type="button"
                          className={`squisq-grid-opbutton${
                            opState.caseSensitive ? ' squisq-grid-opbutton--cs' : ''
                          }`}
                          aria-label={`Filter operator for ${column.name}`}
                          aria-expanded={opMenuCol === col}
                          title={`${
                            opChoicesFor(column.kind).find((c) => c.op === opState.op)?.label ??
                            opState.op
                          }${opState.caseSensitive ? ' (case-sensitive)' : ''}`}
                          onClick={() => setOpMenuCol((open) => (open === col ? null : col))}
                        >
                          <span className="squisq-grid-opglyph">
                            {glyphFor(column.kind, opState.op)}
                          </span>
                          <span className="squisq-grid-opcaret" aria-hidden="true">
                            ▾
                          </span>
                        </button>
                        {opMenuCol === col && (
                          <div className="squisq-grid-opmenu" role="menu">
                            {opChoicesFor(column.kind).map((choice) => (
                              <button
                                key={choice.op}
                                type="button"
                                role="menuitemradio"
                                aria-checked={choice.op === opState.op}
                                className={`squisq-grid-opoption${
                                  choice.op === opState.op ? ' squisq-grid-opoption--active' : ''
                                }`}
                                onClick={() =>
                                  chooseFilterOp(col, column.name, {
                                    op: choice.op,
                                    caseSensitive: opState.caseSensitive,
                                  })
                                }
                              >
                                <span className="squisq-grid-opglyph">{choice.glyph}</span>
                                {choice.label}
                              </button>
                            ))}
                            {caseCapable && (
                              <label className="squisq-grid-opcase">
                                <input
                                  type="checkbox"
                                  checked={opState.caseSensitive}
                                  onChange={(event) =>
                                    chooseFilterOp(col, column.name, {
                                      op: opState.op,
                                      caseSensitive: event.target.checked,
                                    })
                                  }
                                />
                                Case sensitive
                              </label>
                            )}
                          </div>
                        )}
                        <input
                          className="squisq-grid-filterinput"
                          aria-label={`Filter ${column.name}`}
                          placeholder="filter"
                          value={filterValueFor(column.name)}
                          onChange={(event) =>
                            setColumnFilter(
                              column.name,
                              event.target.value,
                              opState.op,
                              opState.caseSensitive,
                            )
                          }
                        />
                      </>
                    );
                  })()}
                </div>
                <div
                  className="squisq-grid-resizer"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    startResize(col, event.clientX, colWidths[col] ?? DEFAULT_COL_WIDTH);
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="squisq-grid-body" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((item) => {
            const located = cellAt(item.index);
            return (
              <div
                key={item.key}
                role="row"
                aria-rowindex={item.index + 2}
                className="squisq-grid-row"
                style={{
                  transform: `translateY(${item.start}px)`,
                  gridTemplateColumns: gridTemplate,
                  height: ROW_HEIGHT,
                }}
              >
                {schema?.columns.map((column, col) => {
                  const inRange =
                    range &&
                    item.index >= range.r0 &&
                    item.index <= range.r1 &&
                    col >= range.c0 &&
                    col <= range.c1;
                  const isFocus =
                    selection && selection.focus.row === item.index && selection.focus.col === col;
                  const isEditing = editing && editing.row === item.index && editing.col === col;
                  const dirty = located && journal ? journal.isDirty(located.rowId, col) : false;
                  const locked =
                    editable && located ? (isCellLocked?.(located.rowId, col) ?? false) : false;
                  const formula =
                    located && formulaSupport
                      ? formulaSupport.getFormula(located.rowId, col)
                      : undefined;
                  const classes = [
                    'squisq-grid-cell',
                    column.kind === 'number' ? 'squisq-grid-cell--num' : '',
                    inRange ? 'squisq-grid-cell--selected' : '',
                    isFocus ? 'squisq-grid-cell--focus' : '',
                    dirty ? 'squisq-grid-cell--dirty' : '',
                    locked ? 'squisq-grid-cell--locked' : '',
                    formula !== undefined ? 'squisq-grid-cell--formula' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <div
                      key={col}
                      role="gridcell"
                      aria-colindex={col + 1}
                      aria-selected={inRange ? 'true' : undefined}
                      {...(dirty ? { 'aria-description': 'edited, unsaved' } : {})}
                      {...(locked && lockedReason
                        ? { title: lockedReason }
                        : formula !== undefined
                          ? { title: `=${formula}` }
                          : {})}
                      {...(locked ? { 'aria-readonly': 'true' } : {})}
                      className={classes}
                      tabIndex={isFocus ? 0 : -1}
                      ref={isFocus ? focusRef : undefined}
                      onMouseDown={(event) => {
                        const pos = { row: item.index, col };
                        setSelection((prev) =>
                          event.shiftKey && prev
                            ? { anchor: prev.anchor, focus: pos }
                            : { anchor: pos, focus: pos },
                        );
                      }}
                      onDoubleClick={() => beginEdit({ row: item.index, col })}
                    >
                      {isEditing ? (
                        <input
                          className={`squisq-grid-editor${editing.error ? ' squisq-grid-editor--error' : ''}`}
                          autoFocus
                          value={editing.draft}
                          title={editing.error}
                          onChange={(event) =>
                            setEditing({ ...editing, draft: event.target.value, error: undefined })
                          }
                          onBlur={() => void commitEdit()}
                        />
                      ) : (
                        cellDisplay(located?.cells[col] ?? null)
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="squisq-grid-footer">
        <span className="squisq-grid-status" aria-live="polite">
          {announce ||
            `${viewRowCount.toLocaleString()} rows${
              schema && viewRowCount !== schema.rowCount
                ? ` (of ${schema.rowCount.toLocaleString()})`
                : ''
            }`}
          {issueNote ? ` · ${issueNote}` : ''}
          {!viewPersisted && (view.sort.length > 0 || view.filter.length > 0)
            ? ' · view not saved to document'
            : ''}
        </span>
        {staleView && (
          <button
            type="button"
            className="squisq-grid-refresh"
            onClick={() => void applyView(viewRef.current)}
          >
            order may be outdated — refresh
          </button>
        )}
        {readOnlyReason && <span className="squisq-grid-readonly">{readOnlyReason}</span>}
        {editable && dirtyCount + extraDirtyCount > 0 && (
          <span className="squisq-grid-dirtybar">
            {(dirtyCount + extraDirtyCount).toLocaleString()} unsaved edit
            {dirtyCount + extraDirtyCount === 1 ? '' : 's'}
            <button
              type="button"
              className="squisq-grid-save"
              disabled={saving}
              onClick={() => void onSave?.()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="squisq-grid-discard"
              disabled={saving}
              onClick={() => {
                void (async () => {
                  while (journal?.canUndo) await runJournal('undo');
                  if (onDiscardExtra) {
                    await onDiscardExtra();
                    cache.current.pages.clear();
                    setFetchTick((t) => t + 1);
                    setDirtyTick((t) => t + 1);
                  }
                })();
              }}
            >
              Discard
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default DataGrid;

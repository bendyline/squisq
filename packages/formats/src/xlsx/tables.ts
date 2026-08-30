/**
 * XLSX → typed tables, for consumers reading a workbook as **data**.
 *
 * `xlsxToMarkdownDoc` renders a workbook for people: it flattens each cell to
 * the string the sheet displays. That rendering is lossy in exactly the ways
 * arithmetic cares about — a percent-formatted `0.15` becomes `"15.0%"`, a
 * date becomes text, a zero-padded `7` becomes `"007"` — so anything that
 * needs to sum, average or compare must not go through it.
 *
 * This module is the other path. It reuses the same region detection (a sheet
 * is not one table; it is several islands with labels and totals in the gaps)
 * and emits each island's cells as their underlying values, with the type the
 * sheet gave them.
 *
 * Two kinds of region are deliberately excluded from the result. A
 * `formulas` companion is presentation — the same cells again, showing their
 * expressions rather than their results — and a `loose` bucket is stray labels
 * and notes, which have no columns to speak of. Both are useful to a reader
 * and meaningless to a query, so a consumer asking for tables gets neither.
 */

import { type CellRect, type XlsxCell, type XlsxCellKind, isOccupied } from './cells.js';
import { detectRegions } from './regions.js';

/** One column of a detected table. */
export interface XlsxTableColumn {
  /** Header text when the region has a header row; otherwise a column letter. */
  name: string;
  /**
   * The dominant cell kind in the column's body, so a consumer can pick a
   * storage type without re-sniffing. `mixed` when no single kind holds a
   * majority — the honest answer for a column that really is heterogeneous.
   */
  kind: XlsxCellKind | 'mixed';
}

/** One data island, as values rather than as display text. */
export interface XlsxTable {
  /** Worksheet name. */
  sheet: string;
  /** A1 address of the region's top-left cell, e.g. `B4`. */
  anchor: string;
  /** Caption absorbed from directly above the region, when there was one. */
  title?: string;
  columns: XlsxTableColumn[];
  /** True when row 0 was read as a header and is therefore not a data row. */
  hasHeader: boolean;
  /**
   * Body rows, header excluded. A cell with no value — blank, or an error —
   * is `null` rather than absent, so every row has the same arity as
   * `columns`.
   */
  rows: (string | number | boolean | null)[][];
}

export interface XlsxTablesOptions {
  /** Restrict to one sheet, by zero-based index or by name. */
  sheet?: number | string;
  maxRegionsPerSheet?: number;
  minRegionCells?: number;
  /** Skip regions with fewer than this many body rows. Default 1. */
  minRows?: number;
  signal?: AbortSignal;
}

/** `0` → `A`, `26` → `AA`. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** A1 address for a zero-based cell position. */
export function a1(row: number, col: number): string {
  return `${columnLetter(col)}${row + 1}`;
}

/**
 * Whether row 0 of a region reads as a header.
 *
 * Same rule the markdown path uses — a complete, wholly textual first row —
 * kept identical on purpose so the two views of a workbook never disagree
 * about where the data starts.
 */
export function regionHasHeader(cells: readonly (readonly XlsxCell[])[]): boolean {
  if (cells.length < 2) return false;
  const first = cells[0];
  if (!first || first.length === 0) return false;
  return first.every((cell) => cell.kind === 'string');
}

/** The value a consumer should store for this cell. */
export function cellValue(cell: XlsxCell): string | number | boolean | null {
  if (cell.kind === 'empty' || cell.kind === 'error') return null;
  if (cell.value !== undefined) return cell.value;
  // A formula whose result was never cached has no value; its text is empty
  // and its expression is not a datum.
  return cell.text === '' ? null : cell.text;
}

/** The dominant kind among a column's body cells. */
export function dominantKind(kinds: readonly XlsxCellKind[]): XlsxCellKind | 'mixed' {
  const counts = new Map<XlsxCellKind, number>();
  let total = 0;
  for (const kind of kinds) {
    if (kind === 'empty') continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return 'empty';
  let best: XlsxCellKind = 'string';
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  // A strict majority, not a plurality: two kinds at 50/50 is genuinely mixed,
  // and claiming one of them would send a consumer to the wrong storage type.
  return bestCount * 2 > total ? best : 'mixed';
}

/** Slice a region's rectangle out of the sheet grid. */
function sliceRegion(grid: readonly (readonly XlsxCell[])[], rect: CellRect): XlsxCell[][] {
  const out: XlsxCell[][] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const row: XlsxCell[] = [];
    for (let c = rect.left; c <= rect.right; c++) {
      row.push(grid[r]?.[c] ?? { text: '', kind: 'empty' });
    }
    out.push(row);
  }
  return out;
}

/** Turn one detected region into a table, or null when it holds no data. */
export function regionToTable(
  sheet: string,
  grid: readonly (readonly XlsxCell[])[],
  rect: CellRect,
  title: string | undefined,
  minRows: number,
): XlsxTable | null {
  const cells = sliceRegion(grid, rect);
  if (cells.length === 0) return null;

  const hasHeader = regionHasHeader(cells);
  const body = hasHeader ? cells.slice(1) : cells;
  if (body.length < minRows) return null;
  if (!body.some((row) => row.some(isOccupied))) return null;

  const width = cells.reduce((max, row) => Math.max(max, row.length), 0);
  const columns: XlsxTableColumn[] = [];
  for (let c = 0; c < width; c++) {
    // A headerless region still needs stable column names, and the sheet's own
    // column letters are the only ones a user can also see in Excel.
    const header = hasHeader ? (cells[0]?.[c]?.text ?? '') : '';
    columns.push({
      name: header.trim() || columnLetter(rect.left + c),
      kind: dominantKind(body.map((row) => row[c]?.kind ?? 'empty')),
    });
  }

  return {
    sheet,
    anchor: a1(rect.top, rect.left),
    ...(title ? { title } : {}),
    columns,
    hasHeader,
    rows: body.map((row) =>
      Array.from({ length: width }, (_, c) => cellValue(row[c] ?? { text: '', kind: 'empty' })),
    ),
  };
}

/**
 * Split one sheet's grid into typed tables.
 *
 * Exported separately from the workbook entry point so a caller that already
 * has a grid — a test, or a consumer streaming sheets itself — does not have
 * to re-open the package.
 */
export function gridToTables(
  sheet: string,
  grid: readonly (readonly XlsxCell[])[],
  merges: readonly CellRect[] = [],
  options: XlsxTablesOptions = {},
): XlsxTable[] {
  if (grid.length === 0) return [];
  const minRows = options.minRows ?? 1;

  const plan = detectRegions(grid as XlsxCell[][], merges, {
    ...(options.maxRegionsPerSheet !== undefined
      ? { maxRegionsPerSheet: options.maxRegionsPerSheet }
      : {}),
    ...(options.minRegionCells !== undefined ? { minRegionCells: options.minRegionCells } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  // Detection declining is a functional outcome, not a failure: the sheet
  // still yields data, just as one table instead of several.
  if (plan.degraded || plan.regions.length === 0) {
    const rect: CellRect = {
      top: 0,
      left: 0,
      bottom: grid.length - 1,
      right: grid.reduce((max, row) => Math.max(max, row.length), 1) - 1,
    };
    const whole = regionToTable(sheet, grid, rect, undefined, minRows);
    return whole ? [whole] : [];
  }

  const out: XlsxTable[] = [];
  for (const region of plan.regions) {
    const table = regionToTable(sheet, grid, region.rect, region.title, minRows);
    if (table) out.push(table);
  }
  // `plan.strays` is deliberately dropped: a lone label or a footnote is not a
  // table, and inventing a one-column table per stray would bury the real ones.
  return out;
}

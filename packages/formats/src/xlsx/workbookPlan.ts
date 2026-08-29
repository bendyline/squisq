/**
 * Markdown document → placed workbook cells.
 *
 * The planning half of XLSX export: it decides which worksheet each table
 * belongs to and which cell each value lands in. `export.ts` then only has to
 * write XML.
 *
 * Two placement modes coexist:
 *
 * - **Anchored** — the table's heading carries `{[dataTable sheet=… anchor=…]}`,
 *   which is what `xlsxToMarkdownDoc` emits for every region it finds. Tables
 *   sharing a `sheet` are grouped onto one worksheet and each lands at its own
 *   anchor, so a sheet that came in as six mini tables goes back out as six mini
 *   tables at their original addresses. A `role=formulas` table overlays
 *   formulas onto the region it names; a `role=loose` table is an address-keyed
 *   list of individual cells.
 *
 * - **Positional** — no `sheet` param. This is the historical behavior and is
 *   preserved exactly: one worksheet per table, named after the nearest
 *   preceding heading, grid starting at A1.
 *
 * Nothing here throws. A markdown file is hand-editable, so a malformed anchor
 * is a warning and a fallback, never a failed conversion — `maxCells` remains
 * the export's only hard error, raised by the caller.
 */

import type {
  MarkdownBlockNode,
  MarkdownDocument,
  MarkdownHeading,
  MarkdownTable,
  MarkdownTableRow,
} from '@bendyline/squisq/markdown';
import { extractPlainText } from '../shared/text.js';
import type { MarkdownInlineNode } from '@bendyline/squisq/markdown';
import {
  MAX_COL_INDEX,
  MAX_ROW_INDEX,
  columnIndexFromLetters,
  formatCellRef,
  parseCellRef,
} from './cells.js';

/** One cell as it will be written. */
export interface PlannedCell {
  text: string;
  /** Formula source without its leading `=`. */
  formula?: string;
  /**
   * The cell's inline content, kept ONLY when it carries superscript or
   * subscript runs — the one piece of markdown inline formatting a worksheet
   * cell can actually represent. Everything else about placement and typing
   * still runs off `text`, so this cannot change where a cell lands or how it
   * is typed; it only lets `cellXml` emit rich `<r>` runs instead of one flat
   * `<t>`, which is what makes an imported footnote marker survive a re-export.
   */
  rich?: MarkdownInlineNode[];
}

/** Whether an inline subtree contains anything a worksheet cell can express. */
export function hasRichCellContent(nodes: MarkdownInlineNode[]): boolean {
  return nodes.some(
    (n) =>
      n.type === 'superscript' ||
      n.type === 'subscript' ||
      ('children' in n && Array.isArray(n.children) && hasRichCellContent(n.children)),
  );
}

/** Row-major key, so a sheet's cells sort into write order numerically. */
const KEY_STRIDE = MAX_COL_INDEX + 1;

export function cellKey(row: number, col: number): number {
  return row * KEY_STRIDE + col;
}

export function keyRow(key: number): number {
  return Math.floor(key / KEY_STRIDE);
}

export function keyCol(key: number): number {
  return key - keyRow(key) * KEY_STRIDE;
}

/** One worksheet's placed cells. */
export interface SheetPlan {
  name: string;
  cells: Map<number, PlannedCell>;
  /** True when the tables placed here carried a `sheet=` anchor. */
  anchored: boolean;
}

export interface WorkbookPlan {
  sheets: SheetPlan[];
  warnings: string[];
  /** Total cells that will be written. */
  cellCount: number;
}

export interface PlanOptions {
  /** Prefix for auto-named sheets when no heading precedes a table. */
  sheetNamePrefix: string;
  /** Sanitize + de-duplicate a candidate name against those already used. */
  sanitize: (candidate: string, used: Set<string>, fallback: string) => string;
}

type Role = 'values' | 'formulas' | 'loose';

interface TableEntry {
  table: MarkdownTable;
  headingText: string;
  params: Record<string, string>;
  /** Raw `sheet` param — the grouping key, deliberately pre-sanitization. */
  sheetKey: string | null;
  role: Role;
}

function tableToGrid(table: MarkdownTable): string[][] {
  return table.children.map((row: MarkdownTableRow) =>
    row.children.map((cell) => extractPlainText(cell.children)),
  );
}

/** The same grid as {@link tableToGrid}, but keeping rich cells' inline nodes. */
function tableToRichGrid(table: MarkdownTable): (MarkdownInlineNode[] | undefined)[][] {
  return table.children.map((row: MarkdownTableRow) =>
    row.children.map((cell) => (hasRichCellContent(cell.children) ? cell.children : undefined)),
  );
}

function readRole(raw: string | undefined): Role {
  return raw === 'formulas' || raw === 'loose' ? raw : 'values';
}

/**
 * Walk the document once, pairing each table with the nearest preceding heading
 * and that heading's `{[...]}` params.
 *
 * The pending heading is cleared after a table consumes it, so a second table
 * under one heading falls back to an auto name — the long-standing behavior.
 */
function collectEntries(nodes: MarkdownBlockNode[]): TableEntry[] {
  const entries: TableEntry[] = [];
  let pending: MarkdownHeading | null = null;

  for (const node of nodes) {
    if (node.type === 'heading') {
      pending = node;
      continue;
    }
    if (node.type !== 'table') continue;
    const params = pending?.templateAnnotation?.params ?? {};
    const sheetKey = typeof params.sheet === 'string' && params.sheet !== '' ? params.sheet : null;
    entries.push({
      table: node,
      headingText: pending ? extractPlainText(pending.children) : '',
      params,
      sheetKey,
      role: readRole(params.role),
    });
    pending = null;
  }
  return entries;
}

/** A worksheet under construction, before names are sanitized. */
interface Group {
  candidate: string | null;
  entries: TableEntry[];
  anchored: boolean;
}

/**
 * Group entries into worksheets, in order of first appearance.
 *
 * Anchored tables group by their raw `sheet` string. Grouping on the sanitized
 * name would be wrong: sanitization de-duplicates case-insensitively, so it
 * would split one group across `Name` and `Name2`.
 */
function groupEntries(entries: TableEntry[]): Group[] {
  const groups: Group[] = [];
  const bySheet = new Map<string, Group>();

  for (const entry of entries) {
    if (entry.sheetKey !== null) {
      let group = bySheet.get(entry.sheetKey);
      if (!group) {
        group = { candidate: entry.sheetKey, entries: [], anchored: true };
        bySheet.set(entry.sheetKey, group);
        groups.push(group);
      }
      group.entries.push(entry);
      continue;
    }
    groups.push({ candidate: entry.headingText || null, entries: [entry], anchored: false });
  }
  return groups;
}

/** Record a cell, noting a collision when one is overwritten. */
function place(
  cells: Map<number, PlannedCell>,
  row: number,
  col: number,
  cell: PlannedCell,
  clashes: string[],
): void {
  const key = cellKey(row, col);
  if (cells.has(key)) clashes.push(formatCellRef(row, col));
  cells.set(key, cell);
}

/** Merge a formula into an already-placed cell, or create a formula-only cell. */
function overlayFormula(
  cells: Map<number, PlannedCell>,
  row: number,
  col: number,
  formula: string,
): void {
  const key = cellKey(row, col);
  const existing = cells.get(key);
  cells.set(key, { text: existing?.text ?? '', formula });
}

/** Strip one leading `=` from an authored formula cell. */
function formulaSource(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;
}

function placeValues(
  entry: TableEntry,
  cells: Map<number, PlannedCell>,
  warnings: string[],
  sheetName: string,
  clashes: string[],
): void {
  const grid = tableToGrid(entry.table);
  const richGrid = tableToRichGrid(entry.table);
  const anchorRaw = entry.params.anchor ?? 'A1';
  let anchor = parseCellRef(anchorRaw);
  if (!anchor) {
    warnings.push(
      `Sheet "${sheetName}": anchor "${anchorRaw}" is not a valid cell reference; placed at A1 instead.`,
    );
    anchor = { row: 0, col: 0 };
  }
  const height = grid.length;
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  if (anchor.row + height - 1 > MAX_ROW_INDEX || anchor.col + width - 1 > MAX_COL_INDEX) {
    warnings.push(
      `Sheet "${sheetName}": a table anchored at ${anchorRaw} runs past the end of the sheet; placed at A1 instead.`,
    );
    anchor = { row: 0, col: 0 };
  }

  // A heading absorbed from a caption cell goes back where it came from.
  const titleRef = entry.params.titleAnchor;
  if (titleRef !== undefined && entry.headingText !== '') {
    const at = parseCellRef(titleRef);
    if (at) place(cells, at.row, at.col, { text: entry.headingText }, clashes);
  }

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]!;
    for (let c = 0; c < row.length; c++) {
      const text = row[c]!;
      if (text === '') continue;
      const rich = richGrid[r]?.[c];
      place(cells, anchor.row + r, anchor.col + c, rich ? { text, rich } : { text }, clashes);
    }
  }
}

/**
 * Overlay a `role=formulas` companion.
 *
 * Its header row holds the SOURCE COLUMN LETTERS rather than a repeat of the
 * value headers. That is what lets its body rows cover every source row —
 * including the region's own first row — and makes each column's sheet address
 * explicit instead of positional.
 */
function placeFormulas(
  entry: TableEntry,
  cells: Map<number, PlannedCell>,
  warnings: string[],
  sheetName: string,
): void {
  const grid = tableToGrid(entry.table);
  if (grid.length < 2) return;
  const anchorRaw = entry.params.anchor ?? 'A1';
  const anchor = parseCellRef(anchorRaw);
  if (!anchor) {
    warnings.push(
      `Sheet "${sheetName}": formulas block anchor "${anchorRaw}" is not a valid cell reference; skipped.`,
    );
    return;
  }

  const columns = grid[0]!.map((letters) => {
    const trimmed = letters.trim();
    if (!/^[A-Za-z]{1,3}$/.test(trimmed)) return -1;
    const col = columnIndexFromLetters(trimmed);
    return col >= 0 && col <= MAX_COL_INDEX ? col : -1;
  });

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r]!;
    for (let c = 0; c < row.length; c++) {
      const raw = row[c]!;
      if (raw.trim() === '') continue;
      // Fall back to the anchor's own column run when a header cell is not a
      // column letter, so a hand-edited block still places something sensible.
      const mapped = columns[c];
      const col = mapped !== undefined && mapped >= 0 ? mapped : anchor.col + c;
      const targetRow = anchor.row + r - 1;
      if (targetRow > MAX_ROW_INDEX) continue;
      overlayFormula(cells, targetRow, col, formulaSource(raw));
    }
  }
}

/** Expand a `role=loose` table: one row per cell, addressed by its first column. */
function placeLoose(
  entry: TableEntry,
  cells: Map<number, PlannedCell>,
  warnings: string[],
  sheetName: string,
  clashes: string[],
): void {
  const grid = tableToGrid(entry.table);
  const richGrid = tableToRichGrid(entry.table);
  let skipped = 0;
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r]!;
    const ref = (row[0] ?? '').trim();
    if (ref === '') continue;
    const at = parseCellRef(ref);
    if (!at) {
      skipped++;
      continue;
    }
    const text = row[1] ?? '';
    const formula = formulaSource(row[2] ?? '');
    const rich = richGrid[r]?.[1];
    const planned: PlannedCell = { text };
    if (formula !== '') planned.formula = formula;
    if (rich) planned.rich = rich;
    place(cells, at.row, at.col, planned, clashes);
  }
  if (skipped > 0) {
    warnings.push(
      `Sheet "${sheetName}": ${skipped} loose-cell row(s) had an invalid cell reference and were skipped.`,
    );
  }
}

/** Plan every worksheet in the document. */
export function planWorkbook(doc: MarkdownDocument, options: PlanOptions): WorkbookPlan {
  const warnings: string[] = [];
  const groups = groupEntries(collectEntries(doc.children));
  const used = new Set<string>();
  const sheets: SheetPlan[] = [];

  groups.forEach((group, index) => {
    const fallback = `${options.sheetNamePrefix}${index + 1}`;
    const name = options.sanitize(group.candidate ?? fallback, used, fallback);
    const cells = new Map<number, PlannedCell>();
    const clashes: string[] = [];

    // Values first: a formulas companion may legitimately precede its region
    // once a document has been reordered by hand.
    for (const entry of group.entries) {
      if (entry.role === 'values') placeValues(entry, cells, warnings, name, clashes);
    }
    for (const entry of group.entries) {
      if (entry.role === 'formulas') placeFormulas(entry, cells, warnings, name);
    }
    for (const entry of group.entries) {
      if (entry.role === 'loose') placeLoose(entry, cells, warnings, name, clashes);
    }

    if (clashes.length > 0) {
      const shown = clashes.slice(0, 5).join(', ');
      const rest = clashes.length > 5 ? ', and more' : '';
      warnings.push(
        `Sheet "${name}": ${clashes.length} overlapping cell(s) (${shown}${rest}); the later block won.`,
      );
    }
    sheets.push({ name, cells, anchored: group.anchored });
  });

  let cellCount = 0;
  for (const sheet of sheets) cellCount += sheet.cells.size;
  return { sheets, warnings, cellCount };
}

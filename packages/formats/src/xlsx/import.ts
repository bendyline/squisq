/**
 * XLSX import — SpreadsheetML (.xlsx) → MarkdownDocument.
 *
 * Reuses the shared ooxml/ reader (zip + DOMParser). Reads the workbook's sheet
 * list, resolves each sheet part via relationships, pulls shared strings, and
 * turns each worksheet into markdown. By default every sheet is imported, each
 * preceded by an H1 of the sheet name; pass `options.sheet` (index or name) to
 * import just one.
 *
 * A sheet is NOT one table. It is usually several tables scattered across the
 * grid with stray labels and notes in the gaps, so by default each worksheet is
 * split into its contiguous data islands (see `regions.ts`) and every island
 * becomes its own block:
 *
 * ```markdown
 * ## Q3 Revenue {[dataTable sheet=Sales anchor=B7]}
 * ```
 *
 * The `sheet`/`anchor` params on the heading annotation are what let
 * `markdownDocToXlsx` put each table back where it came from, so the round trip
 * reproduces addresses rather than piling everything at A1. A region holding
 * formulas additionally emits a `role=formulas` companion table, and every
 * left-over single cell on a sheet collects into one `role=loose` table.
 *
 * Pass `{ regions: false }` for the historical behavior: one table per sheet,
 * spanning the whole used range.
 */

import type {
  MarkdownBlockNode,
  MarkdownDocument,
  MarkdownHeading,
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableRow,
} from '@bendyline/squisq/markdown';
import {
  getPartXml,
  getPartRelationships,
  openPackage,
  requireMainPartPath,
} from '../ooxml/reader.js';
import type { OoxmlOpenOptions } from '../ooxml/reader.js';
import type { OoxmlPackage } from '../ooxml/types.js';
import { baseDirOf } from '../ooxml/readUtils.js';
import { NS_R, NS_SML } from '../ooxml/namespaces.js';
import {
  EMPTY_CELL,
  colIndex,
  columnLetter,
  formatCellRef,
  isOccupied,
  parseRangeRef,
  translateFormula,
  type CellRect,
  type XlsxCell,
  type XlsxCellKind,
} from './cells.js';
import { detectRegions, sliceRect, type StrayCell } from './regions.js';

/** Conventional main part path; the root `officeDocument` rel wins when present. */
const XLSX_MAIN_PART = 'xl/workbook.xml';

export interface XlsxImportOptions extends OoxmlOpenOptions {
  /** Which sheet to import (0-based index or sheet name). Default: all sheets. */
  sheet?: number | string;
  /**
   * Split each sheet into its contiguous data islands, one block each, anchored
   * with `{[dataTable sheet=… anchor=…]}`. Default true. Set false for the
   * historical one-table-per-sheet output.
   */
  regions?: boolean;
  /**
   * Emit a `role=formulas` companion table for regions that contain formulas.
   * Default true. Ignored when `regions` is false.
   */
  formulas?: boolean;
  /** Cap on region tables per sheet before the rest fold into loose cells. Default 64. */
  maxRegionsPerSheet?: number;
  /** Smallest island that stays a table of its own. Default 2 — single cells coalesce. */
  minRegionCells?: number;
}

interface SheetRef {
  name: string;
  path: string;
}

interface WorkbookInfo {
  sheets: SheetRef[];
  date1904: boolean;
}

interface CellStyle {
  numFmtId: number;
  formatCode: string;
}

function attrNS(el: Element, ns: string, local: string, fallback: string): string | null {
  return el.getAttributeNS(ns, local) ?? el.getAttribute(fallback);
}

/** Resolve a relationship target (relative to its part's dir) to a zip path. */
function resolveTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\//, '');
  const stack = baseDir ? baseDir.split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '..') stack.pop();
    else if (seg !== '.') stack.push(seg);
  }
  return stack.join('/');
}

async function readWorkbook(pkg: OoxmlPackage, mainPart: string): Promise<WorkbookInfo> {
  const wb = await getPartXml(pkg, mainPart);
  if (!wb) {
    throw new Error(`Invalid XLSX package: workbook part "${mainPart}" could not be parsed.`);
  }
  const rels = await getPartRelationships(pkg, mainPart);
  const relById = new Map(rels.map((r) => [r.id, r.target]));
  const out: SheetRef[] = [];
  const sheetEls = wb.getElementsByTagNameNS(NS_SML, 'sheet');
  for (let i = 0; i < sheetEls.length; i++) {
    const el = sheetEls[i]!;
    const name = el.getAttribute('name') ?? `Sheet${i + 1}`;
    const rid = attrNS(el, NS_R, 'id', 'r:id');
    const target = rid ? relById.get(rid) : undefined;
    if (target) out.push({ name, path: resolveTarget(baseDirOf(mainPart), target) });
  }
  const workbookPr = wb.getElementsByTagNameNS(NS_SML, 'workbookPr')[0];
  const date1904Value = workbookPr?.getAttribute('date1904');
  return {
    sheets: out,
    date1904: date1904Value === '1' || date1904Value === 'true',
  };
}

/** True when `el` has an `<rPh>` (phonetic guide) ancestor at or below `root`. */
function isPhonetic(el: Element, root: Element): boolean {
  for (let node: Node | null = el.parentNode; node && node !== root; node = node.parentNode) {
    if (node.nodeType !== 1) continue;
    const parent = node as Element;
    if (parent.localName === 'rPh' && parent.namespaceURI === NS_SML) return true;
  }
  return false;
}

/**
 * Text of a SpreadsheetML string item — a shared `<si>` or an inline `<is>`.
 *
 * Both may carry rich text as a sequence of `<r>` runs, so every `<t>` has to
 * be concatenated; reading only the first drops all but the opening run.
 *
 * `textContent` is not a valid shortcut either: `<si>` may also hold `<rPh>`
 * phonetic (furigana) guides, whose `<t>` is a *pronunciation annotation* of
 * the neighbouring run rather than part of the cell's value. Splicing those in
 * turns Japanese "漢字" into "漢字かんじ". Skip any `<t>` under an `<rPh>`.
 */
function stringItemText(root: Element): string {
  const tEls = root.getElementsByTagNameNS(NS_SML, 't');
  let out = '';
  for (let i = 0; i < tEls.length; i++) {
    const t = tEls[i]!;
    if (isPhonetic(t, root)) continue;
    out += t.textContent ?? '';
  }
  return out;
}

async function readSharedStrings(pkg: OoxmlPackage): Promise<string[]> {
  const doc = await getPartXml(pkg, 'xl/sharedStrings.xml');
  if (!doc) return [];
  const siEls = doc.getElementsByTagNameNS(NS_SML, 'si');
  const out: string[] = [];
  for (let i = 0; i < siEls.length; i++) out.push(stringItemText(siEls[i]!));
  return out;
}

const BUILTIN_NUMBER_FORMATS: Readonly<Record<number, string>> = Object.freeze({
  9: '0%',
  10: '0.00%',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
});

async function readCellStyles(pkg: OoxmlPackage): Promise<CellStyle[]> {
  const doc = await getPartXml(pkg, 'xl/styles.xml');
  if (!doc) return [];

  const custom = new Map<number, string>();
  const numFmtEls = doc.getElementsByTagNameNS(NS_SML, 'numFmt');
  for (let i = 0; i < numFmtEls.length; i++) {
    const el = numFmtEls[i]!;
    const id = Number.parseInt(el.getAttribute('numFmtId') ?? '', 10);
    const code = el.getAttribute('formatCode');
    if (Number.isFinite(id) && code) custom.set(id, code);
  }

  const cellXfs = doc.getElementsByTagNameNS(NS_SML, 'cellXfs')[0];
  if (!cellXfs) return [];
  const xfEls = cellXfs.getElementsByTagNameNS(NS_SML, 'xf');
  const out: CellStyle[] = [];
  for (let i = 0; i < xfEls.length; i++) {
    const numFmtId = Number.parseInt(xfEls[i]!.getAttribute('numFmtId') ?? '0', 10);
    out.push({
      numFmtId,
      formatCode: custom.get(numFmtId) ?? BUILTIN_NUMBER_FORMATS[numFmtId] ?? 'General',
    });
  }
  return out;
}

type NumberFormatKind = 'date' | 'time' | 'datetime' | 'percent' | 'zero-pad' | 'general';

function normalizeFormatCode(formatCode: string): string {
  return formatCode
    .split(';', 1)[0]!
    .replace(/"(?:[^"]|"")*"/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, '')
    .toLowerCase();
}

function numberFormatKind(formatCode: string): NumberFormatKind {
  const normalized = normalizeFormatCode(formatCode);
  if (normalized === 'general') return 'general';
  if (normalized.includes('%')) return 'percent';
  if (/^0+$/.test(normalized)) return 'zero-pad';
  const hasDate = /[yd]/.test(normalized);
  const hasTime = /[hs]|\[[hms]+\]/.test(normalized);
  if (hasDate && hasTime) return 'datetime';
  if (hasDate) return 'date';
  if (hasTime) return 'time';
  return 'general';
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function excelDateText(serial: number, date1904: boolean): string | null {
  const wholeDays = Math.floor(serial);
  if (!date1904 && wholeDays === 60) return '1900-02-29';
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const adjustedDays = !date1904 && wholeDays > 60 ? wholeDays - 1 : wholeDays;
  const date = new Date(epoch + adjustedDays * 86_400_000);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${twoDigits(date.getUTCMonth() + 1)}-${twoDigits(date.getUTCDate())}`;
}

function excelTimeText(serial: number, includeSeconds: boolean, elapsedHours: boolean): string {
  const totalSeconds = Math.round((serial - Math.floor(serial)) * 86_400);
  const hours = elapsedHours ? Math.floor(serial * 24) : Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  return `${twoDigits(hours)}:${twoDigits(minutes)}${includeSeconds ? `:${twoDigits(seconds)}` : ''}`;
}

function formattedNumberText(raw: string, style: CellStyle | undefined, date1904: boolean): string {
  if (!style) return raw;
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  const normalized = normalizeFormatCode(style.formatCode);
  const kind = numberFormatKind(style.formatCode);
  if (kind === 'date') return excelDateText(value, date1904) ?? raw;
  if (kind === 'time') {
    return excelTimeText(value, /s/.test(normalized), /\[[h]+\]/.test(normalized));
  }
  if (kind === 'datetime') {
    const date = excelDateText(value, date1904);
    return date ? `${date} ${excelTimeText(value, /s/.test(normalized), false)}` : raw;
  }
  if (kind === 'percent') {
    const decimals = /0\.(0+)%/.exec(normalized)?.[1]?.length ?? 0;
    return `${(value * 100).toFixed(decimals)}%`;
  }
  if (kind === 'zero-pad' && Number.isInteger(value)) {
    const width = normalized.length;
    const sign = value < 0 ? '-' : '';
    return `${sign}${String(Math.abs(value)).padStart(width, '0')}`;
  }
  return raw;
}

/** The master text of a shared formula, plus where it was written. */
interface SharedFormula {
  text: string;
  row: number;
  col: number;
}

interface SheetReadContext {
  shared: string[];
  styles: CellStyle[];
  date1904: boolean;
  /** `si` → master, built as the sheet is read. Masters always precede followers. */
  sharedFormulas: Map<string, SharedFormula>;
}

/**
 * The formula source of a cell, without its leading `=`.
 *
 * A shared formula is written once, on the master cell, as
 * `<f t="shared" si="0" ref="D2:D10">B2*C2</f>`; every follower in the range is
 * an empty `<f t="shared" si="0"/>` whose real formula is "the master's, shifted
 * to here". `translateFormula` performs that shift, so followers come back with
 * their own text rather than being silently dropped.
 */
function readFormula(cell: Element, row: number, col: number, ctx: SheetReadContext): string {
  const fEls = cell.getElementsByTagNameNS(NS_SML, 'f');
  const f = fEls.length ? fEls[0]! : null;
  if (!f) return '';
  const text = (f.textContent ?? '').trim();
  if (f.getAttribute('t') !== 'shared') return text;

  const si = f.getAttribute('si');
  if (si === null) return text;
  if (text !== '') {
    ctx.sharedFormulas.set(si, { text, row, col });
    return text;
  }
  const master = ctx.sharedFormulas.get(si);
  if (!master) return '';
  try {
    return translateFormula(master.text, row - master.row, col - master.col);
  } catch {
    // A formula we cannot confidently shift is better dropped than guessed at.
    return '';
  }
}

/** Read one `<c>` element into the richer cell model. */
function readCell(cell: Element, row: number, col: number, ctx: SheetReadContext): XlsxCell {
  const formula = readFormula(cell, row, col, ctx);
  const withFormula = (text: string, kind: XlsxCellKind): XlsxCell => {
    const out: XlsxCell = { text, kind: text === '' ? 'empty' : kind };
    if (formula !== '') out.formula = formula;
    return out;
  };

  const t = cell.getAttribute('t');
  if (t === 'inlineStr') {
    const is = cell.getElementsByTagNameNS(NS_SML, 'is')[0];
    return withFormula(is ? stringItemText(is) : '', 'string');
  }
  const vEls = cell.getElementsByTagNameNS(NS_SML, 'v');
  const v = vEls.length ? (vEls[0]!.textContent ?? '') : '';
  // A cell with a style but no value — `<c r="A1" s="1"/>`, which Excel writes
  // across whole formatted-but-blank ranges — is EMPTY. Decoding it as a number
  // would run `Number('')` → 0 through the format code and yield `1899-12-31`
  // for a date column or `FALSE` for a boolean one, filling the sheet with
  // phantom content. Under region splitting that is fatal rather than merely
  // untidy: a styled blank range is a fully occupied rectangle, and it would
  // fuse every island on the sheet into one.
  if (v === '') return withFormula('', 'empty');
  if (t === 's') return withFormula(ctx.shared[Number.parseInt(v, 10)] ?? '', 'string');
  if (t === 'b') return withFormula(v === '1' ? 'TRUE' : 'FALSE', 'bool');
  if (t === 'e') return withFormula(v, 'error');
  if (t === 'str') return withFormula(v, 'string');

  const style = ctx.styles[Number.parseInt(cell.getAttribute('s') ?? '0', 10)];
  const text = formattedNumberText(v, style, ctx.date1904);
  const dateLike = style ? numberFormatKind(style.formatCode) : 'general';
  const kind: XlsxCellKind =
    dateLike === 'date' || dateLike === 'time' || dateLike === 'datetime' ? 'date' : 'number';
  return withFormula(text, kind);
}

/** One worksheet's cells plus the merge ranges that inform region detection. */
interface SheetContent {
  cells: XlsxCell[][];
  merges: CellRect[];
}

async function sheetToCells(
  pkg: OoxmlPackage,
  path: string,
  shared: string[],
  styles: CellStyle[],
  date1904: boolean,
): Promise<SheetContent> {
  const doc = await getPartXml(pkg, path);
  if (!doc) return { cells: [], merges: [] };
  const ctx: SheetReadContext = { shared, styles, date1904, sharedFormulas: new Map() };
  const rowEls = doc.getElementsByTagNameNS(NS_SML, 'row');

  // SpreadsheetML OMITS empty rows entirely — a sheet whose data starts at
  // row 3 simply has no <row r="1">/<row r="2">. Reading rows in document
  // order and appending would slide that data up, silently promoting the
  // first data row to the markdown table's HEADER. The `r` attribute is
  // 1-based and authoritative, so use it to restore row gaps the same way
  // cell refs restore column gaps.
  const byIndex = new Map<number, XlsxCell[]>();
  let maxContentIdx = -1;
  let fallbackIdx = 0;
  for (let r = 0; r < rowEls.length; r++) {
    const rowEl = rowEls[r]!;
    const rowRef = Number.parseInt(rowEl.getAttribute('r') ?? '', 10);
    // Resolve the row index BEFORE reading cells: a shared-formula follower is
    // translated by its offset from the master, so it needs its own address.
    const rowIdx = Number.isFinite(rowRef) && rowRef > 0 ? rowRef - 1 : fallbackIdx;
    fallbackIdx = rowIdx + 1;

    const cells = rowEl.getElementsByTagNameNS(NS_SML, 'c');
    const rowArr: XlsxCell[] = [];
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c]!;
      const ref = cell.getAttribute('r');
      const idx = ref ? colIndex(ref) : rowArr.length;
      while (rowArr.length < idx) rowArr.push(EMPTY_CELL);
      rowArr[idx] = readCell(cell, rowIdx, idx, ctx);
    }
    byIndex.set(rowIdx, rowArr);
    // Excel also writes style-only rows (`<row r="5000" s="1"/>`) far below
    // the data. Tracking the last row with actual CONTENT means those don't
    // materialize thousands of trailing blank table rows — while leading and
    // interior blanks, which are structural, are preserved.
    if (rowArr.some(isOccupied)) maxContentIdx = Math.max(maxContentIdx, rowIdx);
  }

  const grid: XlsxCell[][] = [];
  for (let i = 0; i <= maxContentIdx; i++) grid.push(byIndex.get(i) ?? []);

  const merges: CellRect[] = [];
  const mergeEls = doc.getElementsByTagNameNS(NS_SML, 'mergeCell');
  for (let i = 0; i < mergeEls.length; i++) {
    const rect = parseRangeRef(mergeEls[i]!.getAttribute('ref') ?? '');
    if (rect) merges.push(rect);
  }

  return { cells: grid, merges };
}

/** Build a GFM table from a text matrix; row 0 occupies the header slot. */
function textGridToTable(grid: string[][]): MarkdownTable {
  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 1);
  const rows: MarkdownTableRow[] = grid.map((cells, rowIdx) => {
    const children: MarkdownTableCell[] = [];
    for (let c = 0; c < maxCols; c++) {
      const value = cells[c] ?? '';
      children.push({
        type: 'tableCell',
        ...(rowIdx === 0 ? { isHeader: true } : {}),
        children: value ? [{ type: 'text', value }] : [],
      });
    }
    return { type: 'tableRow', children };
  });
  return { type: 'table', children: rows };
}

function cellsToTable(cells: XlsxCell[][]): MarkdownTable {
  return textGridToTable(cells.map((row) => row.map((cell) => cell.text)));
}

/**
 * Whether row 0 of a region reads as a header.
 *
 * A header row is complete and textual — every cell filled, none of them a
 * number or a date. That is informational only: GFM requires a header row, so
 * row 0 sits in the header slot either way and maps to the anchor row on the
 * way back. What it changes is the `header=false` marker an author or a later
 * importer can act on.
 */
function inferHeader(cells: XlsxCell[][]): boolean {
  if (cells.length < 2) return false;
  const first = cells[0]!;
  if (first.length === 0) return false;
  return first.every((cell) => cell.kind === 'string');
}

/**
 * The companion formulas table for a region, or null when it holds no formulas.
 *
 * Its header row is the region's SOURCE COLUMN LETTERS rather than a repeat of
 * the value headers. That buys two things: the body rows then cover every source
 * row including the anchor row (a formula in the header row is representable),
 * and each column announces which sheet column it belongs to.
 */
function formulasTable(cells: XlsxCell[][], rect: CellRect): MarkdownTable | null {
  if (!cells.some((row) => row.some((cell) => cell.formula))) return null;
  const header: string[] = [];
  for (let c = rect.left; c <= rect.right; c++) header.push(columnLetter(c));
  const body = cells.map((row) => row.map((cell) => (cell.formula ? `=${cell.formula}` : '')));
  return textGridToTable([header, ...body]);
}

/** The sheet's left-over single cells as one address-keyed table. */
function looseTable(strays: readonly StrayCell[]): MarkdownTable {
  const withFormula = strays.some((s) => s.cell.formula);
  const header = withFormula ? ['Cell', 'Value', 'Formula'] : ['Cell', 'Value'];
  const body = strays.map((s) => {
    const ref = formatCellRef(s.row, s.col);
    return withFormula
      ? [ref, s.cell.text, s.cell.formula ? `=${s.cell.formula}` : '']
      : [ref, s.cell.text];
  });
  return textGridToTable([header, ...body]);
}

/** A heading carrying a `{[dataTable …]}` annotation. */
function annotatedHeading(
  depth: 1 | 2,
  text: string,
  params: Record<string, string>,
): MarkdownHeading {
  return {
    type: 'heading',
    depth,
    children: [{ type: 'text', value: text }],
    templateAnnotation: { template: 'dataTable', params },
  };
}

export async function xlsxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options: XlsxImportOptions = {},
): Promise<MarkdownDocument> {
  const pkg = await openPackage(data, options);
  const mainPart = requireMainPartPath(pkg, XLSX_MAIN_PART, 'XLSX');
  const [{ sheets, date1904 }, shared, styles] = await Promise.all([
    readWorkbook(pkg, mainPart),
    readSharedStrings(pkg),
    readCellStyles(pkg),
  ]);

  let selected = sheets;
  if (options.sheet !== undefined) {
    const picked =
      typeof options.sheet === 'number'
        ? sheets[options.sheet]
        : sheets.find((s) => s.name === options.sheet);
    selected = picked ? [picked] : [];
  }

  const children: MarkdownBlockNode[] = [];
  const single = selected.length === 1 && options.sheet !== undefined;
  const useRegions = options.regions !== false;
  const withFormulas = options.formulas !== false;

  for (const sheet of selected) {
    const { cells, merges } = await sheetToCells(pkg, sheet.path, shared, styles, date1904);
    if (!single) {
      children.push({ type: 'heading', depth: 1, children: [{ type: 'text', value: sheet.name }] });
    }
    if (cells.length === 0) continue;

    if (!useRegions) {
      children.push(cellsToTable(cells));
      continue;
    }

    const plan = detectRegions(cells, merges, {
      ...(options.maxRegionsPerSheet !== undefined
        ? { maxRegionsPerSheet: options.maxRegionsPerSheet }
        : {}),
      ...(options.minRegionCells !== undefined ? { minRegionCells: options.minRegionCells } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    // Detection degrading is a functional outcome, not a failure: the sheet
    // still imports, just as one grid instead of several tables.
    for (const warning of plan.warnings) console.warn(`XLSX import: ${sheet.name}: ${warning}`);
    if (plan.degraded || (plan.regions.length === 0 && plan.strays.length === 0)) {
      children.push(cellsToTable(cells));
      continue;
    }

    const depth: 1 | 2 = single ? 1 : 2;
    for (const region of plan.regions) {
      const slice = sliceRect(cells, region.rect, EMPTY_CELL);
      const anchor = formatCellRef(region.rect.top, region.rect.left);
      const title = region.title ?? `${sheet.name} — ${anchor}`;
      children.push(
        annotatedHeading(depth, title, {
          sheet: sheet.name,
          anchor,
          // Omit the common case: `headerRow=true` is what a GFM table already
          // says. (`headerRow`, not `header` — `dataTable` already declares a
          // `headers` input, and two params one letter apart in the same
          // annotation is a trap for anyone reading or editing the markdown.)
          ...(inferHeader(slice) ? {} : { headerRow: 'false' }),
          // A caption promoted into the heading has left its cell behind;
          // record where, so the reverse path can put the text back.
          ...(region.titleCell
            ? { titleAnchor: formatCellRef(region.titleCell.row, region.titleCell.col) }
            : {}),
        }),
        cellsToTable(slice),
      );

      if (!withFormulas) continue;
      const formulas = formulasTable(slice, region.rect);
      if (!formulas) continue;
      children.push(
        annotatedHeading(depth, `${title} — formulas`, {
          sheet: sheet.name,
          anchor,
          role: 'formulas',
        }),
        formulas,
      );
    }

    if (plan.strays.length > 0) {
      children.push(
        annotatedHeading(depth, `${sheet.name} — loose cells`, {
          sheet: sheet.name,
          role: 'loose',
        }),
        looseTable(plan.strays),
      );
    }
  }
  return { type: 'document', children };
}

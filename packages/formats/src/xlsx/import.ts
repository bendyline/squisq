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
  MarkdownInlineNode,
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
import { type XlsxTable, type XlsxTablesOptions, gridToTables } from './tables.js';
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import { MemoryContentContainer, type ContentContainer } from '@bendyline/squisq/storage';
import { planDataSidecar } from '../data/sidecar.js';

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
  /**
   * Sidecar spill mode — only honored by `xlsxToContainer`, which can actually
   * write the sidecar file the reference points at. `'auto'` (default) spills a
   * region past the inline thresholds to a `{[dataTable src=…]}` reference;
   * `'always'` spills every region; `'never'` keeps everything inline
   * (`xlsxToMarkdownDoc`'s only behavior — a doc-only import has nowhere to
   * put the bytes, and a `src` with no sidecar is a broken reference).
   */
  sidecar?: 'auto' | 'always' | 'never';
  /** Max data rows a region keeps inline before spilling (container import). Default 100. */
  maxInlineRows?: number;
  /** Max cells a region keeps inline before spilling (container import). Default 2000. */
  maxInlineCells?: number;
}

/** Options for {@link xlsxToContainer}. */
export interface XlsxContainerOptions extends XlsxImportOptions {
  /**
   * Source file name (e.g. `'Q3 Report.xlsx'`) — names the document
   * (`q3-report.md`) and the sidecar path
   * (`q3-report_files/data/Q3 Report.xlsx`). Default `'workbook.xlsx'`.
   */
  sourceName?: string;
}

/** Spill state threaded through one container import. */
interface SpillConfig {
  /** Container path the `src` param references. */
  src: string;
  /** Sidecar file name, for body link text. */
  fileName: string;
  mode: 'auto' | 'always';
  maxInlineRows: number;
  maxInlineCells: number;
  /** Set when at least one region spilled — the sidecar must be written. */
  used: boolean;
}

export interface SheetRef {
  name: string;
  path: string;
}

interface WorkbookInfo {
  sheets: SheetRef[];
  date1904: boolean;
  /**
   * `<calcPr fullCalcOnLoad="1"/>` — the producer telling Excel the cached
   * formula values in this file are NOT to be trusted and must be recomputed
   * on open. A cached-value oracle must exclude such files; squisq's own
   * exporter sets it unconditionally on formula workbooks.
   */
  fullCalcOnLoad: boolean;
}

export interface CellStyle {
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

/**
 * List the workbook's sheets — name plus resolved worksheet part path, in
 * workbook order. Shared by import and the in-place cell patcher.
 */
export async function listSheetParts(pkg: OoxmlPackage, mainPart: string): Promise<SheetRef[]> {
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
  return out;
}

async function readWorkbook(pkg: OoxmlPackage, mainPart: string): Promise<WorkbookInfo> {
  const wb = await getPartXml(pkg, mainPart);
  if (!wb) {
    throw new Error(`Invalid XLSX package: workbook part "${mainPart}" could not be parsed.`);
  }
  const sheets = await listSheetParts(pkg, mainPart);
  const workbookPr = wb.getElementsByTagNameNS(NS_SML, 'workbookPr')[0];
  const date1904Value = workbookPr?.getAttribute('date1904');
  const calcPr = wb.getElementsByTagNameNS(NS_SML, 'calcPr')[0];
  const fullCalcValue = calcPr?.getAttribute('fullCalcOnLoad');
  return {
    sheets,
    date1904: date1904Value === '1' || date1904Value === 'true',
    fullCalcOnLoad: fullCalcValue === '1' || fullCalcValue === 'true',
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
 * Vertical alignment of a rich-text run, from its `<rPr><vertAlign val="…"/>`.
 *
 * This is how a spreadsheet records a footnote marker: the `1` in `Fresh¹` is
 * an ordinary character in an ordinary cell, distinguished only by a run
 * property. Reading only `<t>` text — as this importer used to — turns the
 * marker into a literal digit welded onto the end of the word, which is both
 * wrong on the page and wrong for anything that later parses the value.
 */
function runVertAlign(run: Element): 'superscript' | 'subscript' | null {
  const rPr = run.getElementsByTagNameNS(NS_SML, 'rPr')[0];
  if (!rPr) return null;
  const va = rPr.getElementsByTagNameNS(NS_SML, 'vertAlign')[0];
  const val = va?.getAttribute('val');
  return val === 'superscript' || val === 'subscript' ? val : null;
}

/** A string item's display text plus, when it has any, its formatted runs. */
interface StringItem {
  text: string;
  /**
   * Inline markdown for the item, present ONLY when a run carries formatting
   * this importer preserves. Left undefined for the overwhelmingly common
   * unformatted cell so that nothing downstream has to care.
   */
  rich?: MarkdownInlineNode[];
}

/**
 * Read a SpreadsheetML string item — a shared `<si>` or an inline `<is>`.
 *
 * An item is either a single unformatted `<t>` or a sequence of `<r>` runs,
 * each with its own optional `<rPr>`. Every `<t>` has to be concatenated for
 * the display text; reading only the first drops all but the opening run.
 *
 * `textContent` is not a valid shortcut either: `<si>` may also hold `<rPh>`
 * phonetic (furigana) guides, whose `<t>` is a *pronunciation annotation* of
 * the neighbouring run rather than part of the cell's value. Splicing those in
 * turns Japanese "漢字" into "漢字かんじ". Skip any `<t>` under an `<rPh>`.
 */
function readStringItem(root: Element): StringItem {
  const tEls = root.getElementsByTagNameNS(NS_SML, 't');
  const rich: MarkdownInlineNode[] = [];
  let text = '';
  let formatted = false;

  for (let i = 0; i < tEls.length; i++) {
    const t = tEls[i]!;
    if (isPhonetic(t, root)) continue;
    const value = t.textContent ?? '';
    if (value === '') continue;
    text += value;

    // `<t>`'s parent is the `<r>` run when the item is rich text, and the
    // `<si>`/`<is>` itself when it is a bare string.
    const parent = t.parentNode;
    const run = parent && (parent as Element).localName === 'r' ? (parent as Element) : null;
    const vertAlign = run ? runVertAlign(run) : null;
    if (vertAlign) {
      formatted = true;
      rich.push({ type: vertAlign, children: [{ type: 'text', value }] });
    } else {
      rich.push({ type: 'text', value });
    }
  }

  return formatted ? { text, rich: mergeAdjacentText(rich) } : { text };
}

/**
 * Collapse runs that ended up as neighbouring plain-text nodes.
 *
 * Excel splits a string at every formatting boundary, so "Juice, ready to
 * drink" plus a superscript "2" can arrive as four runs of which three are
 * unformatted. Merging them keeps the emitted markdown as close as possible to
 * what a person would have typed.
 */
function mergeAdjacentText(nodes: MarkdownInlineNode[]): MarkdownInlineNode[] {
  const out: MarkdownInlineNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (node.type === 'text' && prev?.type === 'text') prev.value += node.value;
    else out.push(node);
  }
  return out;
}

async function readSharedStrings(pkg: OoxmlPackage): Promise<StringItem[]> {
  const doc = await getPartXml(pkg, 'xl/sharedStrings.xml');
  if (!doc) return [];
  const siEls = doc.getElementsByTagNameNS(NS_SML, 'si');
  const out: StringItem[] = [];
  for (let i = 0; i < siEls.length; i++) out.push(readStringItem(siEls[i]!));
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

export async function readCellStyles(pkg: OoxmlPackage): Promise<CellStyle[]> {
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

export type NumberFormatKind = 'date' | 'time' | 'datetime' | 'percent' | 'zero-pad' | 'general';

function normalizeFormatCode(formatCode: string): string {
  return formatCode
    .split(';', 1)[0]!
    .replace(/"(?:[^"]|"")*"/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, '')
    .toLowerCase();
}

export function numberFormatKind(formatCode: string): NumberFormatKind {
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

/**
 * A date/time cell's value as an unambiguous ISO string.
 *
 * Mirrors {@link formattedNumberText}'s branches, but emits a fixed machine
 * shape rather than the sheet's display format: a consumer storing this in a
 * typed column needs `2026-08-04`, not `04/08/26`, and must not have to guess
 * which of the day and month came first.
 */
function dateValueText(
  serial: number,
  kind: NumberFormatKind,
  style: CellStyle | undefined,
  date1904: boolean,
): string | null {
  if (!Number.isFinite(serial)) return null;
  const normalized = style ? normalizeFormatCode(style.formatCode) : '';
  if (kind === 'time')
    return excelTimeText(serial, /s/.test(normalized), /\[[h]+\]/.test(normalized));
  const date = excelDateText(serial, date1904);
  if (!date) return null;
  if (kind === 'datetime') return `${date} ${excelTimeText(serial, /s/.test(normalized), false)}`;
  return date;
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
  shared: StringItem[];
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
interface ReadFormulaResult {
  text: string;
  sharedRole?: 'master' | 'follower';
}

function readFormula(
  cell: Element,
  row: number,
  col: number,
  ctx: SheetReadContext,
): ReadFormulaResult {
  const fEls = cell.getElementsByTagNameNS(NS_SML, 'f');
  const f = fEls.length ? fEls[0]! : null;
  if (!f) return { text: '' };
  const text = (f.textContent ?? '').trim();
  if (f.getAttribute('t') !== 'shared') return { text };

  const si = f.getAttribute('si');
  if (si === null) return { text };
  if (text !== '') {
    ctx.sharedFormulas.set(si, { text, row, col });
    return { text, sharedRole: 'master' };
  }
  const master = ctx.sharedFormulas.get(si);
  if (!master) return { text: '', sharedRole: 'follower' };
  try {
    return {
      text: translateFormula(master.text, row - master.row, col - master.col),
      sharedRole: 'follower',
    };
  } catch {
    // A formula we cannot confidently shift is better dropped than guessed at.
    return { text: '', sharedRole: 'follower' };
  }
}

/** Read one `<c>` element into the richer cell model. */
function readCell(cell: Element, row: number, col: number, ctx: SheetReadContext): XlsxCell {
  const { text: formula, sharedRole } = readFormula(cell, row, col, ctx);
  // `value` is set alongside `text` at every branch rather than derived from
  // it afterwards, because by then the information is already gone: `"15.0%"`
  // cannot be turned back into `0.15` without knowing the format code, and
  // `"007"` cannot be told from a genuine string.
  const withFormula = (
    text: string,
    kind: XlsxCellKind,
    value?: number | boolean | string,
  ): XlsxCell => {
    const out: XlsxCell = { text, kind: text === '' ? 'empty' : kind };
    if (formula !== '') out.formula = formula;
    if (sharedRole !== undefined) out.sharedFormulaRole = sharedRole;
    if (value !== undefined && out.kind !== 'empty') out.value = value;
    return out;
  };
  const stringCell = (item: StringItem): XlsxCell => {
    const out = withFormula(item.text, 'string', item.text);
    // An empty cell has nothing to format, so never attach runs to one.
    if (item.rich && out.kind !== 'empty') out.richText = item.rich;
    return out;
  };

  const t = cell.getAttribute('t');
  if (t === 'inlineStr') {
    const is = cell.getElementsByTagNameNS(NS_SML, 'is')[0];
    return stringCell(is ? readStringItem(is) : { text: '' });
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
  if (t === 's') return stringCell(ctx.shared[Number.parseInt(v, 10)] ?? { text: '' });
  if (t === 'b') return withFormula(v === '1' ? 'TRUE' : 'FALSE', 'bool', v === '1');
  // An error cell has no value worth carrying — `#REF!` is a condition, not
  // a datum — so `text` alone represents it.
  if (t === 'e') return withFormula(v, 'error');
  if (t === 'str') return withFormula(v, 'string', v);

  const style = ctx.styles[Number.parseInt(cell.getAttribute('s') ?? '0', 10)];
  const text = formattedNumberText(v, style, ctx.date1904);
  const dateLike = style ? numberFormatKind(style.formatCode) : 'general';
  const kind: XlsxCellKind =
    dateLike === 'date' || dateLike === 'time' || dateLike === 'datetime' ? 'date' : 'number';
  const numeric = Number(v);
  if (kind === 'date') {
    // Normalized to ISO rather than left as a serial: the serial's meaning
    // depends on the workbook's 1900/1904 epoch, which is context a consumer
    // reading one cell cannot be expected to carry.
    const iso = dateValueText(numeric, dateLike, style, ctx.date1904);
    return withFormula(text, kind, iso ?? text);
  }
  return withFormula(text, kind, Number.isFinite(numeric) ? numeric : v);
}

/** One worksheet's cells plus the merge ranges that inform region detection. */
interface SheetContent {
  cells: XlsxCell[][];
  merges: CellRect[];
}

async function sheetToCells(
  pkg: OoxmlPackage,
  path: string,
  shared: StringItem[],
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

/** Build a GFM table from an inline-content matrix; row 0 is the header slot. */
function inlineGridToTable(grid: MarkdownInlineNode[][][]): MarkdownTable {
  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 1);
  const rows: MarkdownTableRow[] = grid.map((cells, rowIdx) => {
    const children: MarkdownTableCell[] = [];
    for (let c = 0; c < maxCols; c++) {
      children.push({
        type: 'tableCell',
        ...(rowIdx === 0 ? { isHeader: true } : {}),
        children: cells[c] ?? [],
      });
    }
    return { type: 'tableRow', children };
  });
  return { type: 'table', children: rows };
}

/** Build a GFM table from a text matrix; row 0 occupies the header slot. */
function textGridToTable(grid: string[][]): MarkdownTable {
  return inlineGridToTable(
    grid.map((row) => row.map((value) => (value ? [{ type: 'text', value }] : []))),
  );
}

function cellsToTable(cells: XlsxCell[][]): MarkdownTable {
  return inlineGridToTable(cells.map((row) => row.map(cellInline)));
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

/** Inline content for one cell — its rich runs when it has them, else its text. */
function cellInline(cell: XlsxCell): MarkdownInlineNode[] {
  return cell.richText ?? (cell.text ? [{ type: 'text', value: cell.text }] : []);
}

/** Plain inline content for a string that is never rich (a ref, a formula). */
function textInline(value: string): MarkdownInlineNode[] {
  return value ? [{ type: 'text', value }] : [];
}

/**
 * The sheet's left-over single cells as one address-keyed table.
 *
 * The Value column goes through {@link cellInline} rather than `.text`: a
 * footnote line like "¹USDA, Agricultural Research Service" is a stray cell,
 * and it carries exactly the superscript that makes it a footnote.
 */
function looseTable(strays: readonly StrayCell[]): MarkdownTable {
  const withFormula = strays.some((s) => s.cell.formula);
  const header = withFormula ? ['Cell', 'Value', 'Formula'] : ['Cell', 'Value'];
  const body = strays.map((s) => {
    const ref = textInline(formatCellRef(s.row, s.col));
    const value = cellInline(s.cell);
    return withFormula
      ? [ref, value, textInline(s.cell.formula ? `=${s.cell.formula}` : '')]
      : [ref, value];
  });
  return inlineGridToTable([header.map(textInline), ...body]);
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

/**
 * Read a workbook as typed tables rather than as a document.
 *
 * The data counterpart to {@link xlsxToMarkdownDoc}: same package, same sheet
 * selection, same region detection — but each island's cells arrive as their
 * underlying values, so a consumer can sum a column without first undoing a
 * number format.
 */
export async function xlsxToTables(
  data: ArrayBuffer | Blob,
  options: XlsxImportOptions & XlsxTablesOptions = {},
): Promise<XlsxTable[]> {
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

  const out: XlsxTable[] = [];
  for (const sheet of selected) {
    const { cells, merges } = await sheetToCells(pkg, sheet.path, shared, styles, date1904);
    out.push(...gridToTables(sheet.name, cells, merges, options));
  }
  return out;
}

/** One worksheet's raw cell grid, as parsed (formulas + cached values intact). */
export interface XlsxSheetGrid {
  name: string;
  /** Row-major grid; rows may be ragged. Each cell keeps `formula` AND `value`. */
  cells: XlsxCell[][];
  merges: CellRect[];
}

/** A workbook as raw cell grids, plus the workbook-level calc facts. */
export interface XlsxWorkbookGrids {
  sheets: XlsxSheetGrid[];
  date1904: boolean;
  /**
   * `<calcPr fullCalcOnLoad="1"/>`: the producer disowned its cached formula
   * values. A cached-value oracle must skip such workbooks, and a consumer
   * re-hosting the formulas in a calculation engine should recompute rather
   * than trust `value`.
   */
  fullCalcOnLoad: boolean;
}

/**
 * Read a workbook as raw cell grids — the lowest-level public view.
 *
 * Unlike {@link xlsxToTables} (typed regions, formulas dropped) and
 * {@link xlsxToMarkdownDoc} (rendered for people), this hands over every
 * parsed cell with its formula and cached value colocated. Two consumers:
 * the corpus cached-value oracle (compare `formula` results against `value`)
 * and calculation-engine feeding (`setUserInput`-style APIs need the raw
 * grid, not a detected region).
 */
export async function xlsxToCellGrids(
  data: ArrayBuffer | Blob,
  options: XlsxImportOptions = {},
): Promise<XlsxWorkbookGrids> {
  const pkg = await openPackage(data, options);
  const mainPart = requireMainPartPath(pkg, XLSX_MAIN_PART, 'XLSX');
  const [{ sheets, date1904, fullCalcOnLoad }, shared, styles] = await Promise.all([
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

  const out: XlsxSheetGrid[] = [];
  for (const sheet of selected) {
    const { cells, merges } = await sheetToCells(pkg, sheet.path, shared, styles, date1904);
    out.push({ name: sheet.name, cells, merges });
  }
  return { sheets: out, date1904, fullCalcOnLoad };
}

export async function xlsxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options: XlsxImportOptions = {},
): Promise<MarkdownDocument> {
  return workbookToMarkdown(data, options, undefined);
}

/** True when a region's size crosses the inline thresholds. */
function shouldSpillRegion(spill: SpillConfig, rect: CellRect, hasHeader: boolean): boolean {
  if (spill.mode === 'always') return true;
  const height = rect.bottom - rect.top + 1;
  const width = rect.right - rect.left + 1;
  const dataRows = height - (hasHeader ? 1 : 0);
  return dataRows > spill.maxInlineRows || height * width > spill.maxInlineCells;
}

/** Whole-grid variant of {@link shouldSpillRegion} for the non-region paths. */
function shouldSpillGrid(spill: SpillConfig, cells: readonly (readonly XlsxCell[])[]): boolean {
  if (spill.mode === 'always') return true;
  const width = cells.reduce((max, row) => Math.max(max, row.length), 0);
  return cells.length - 1 > spill.maxInlineRows || cells.length * width > spill.maxInlineCells;
}

/** The graceful-degradation body link under a spilled reference heading. */
function sidecarLinkParagraph(spill: SpillConfig): MarkdownBlockNode {
  return {
    type: 'paragraph',
    children: [
      { type: 'link', url: spill.src, children: [{ type: 'text', value: spill.fileName }] },
    ],
  };
}

async function workbookToMarkdown(
  data: ArrayBuffer | Blob,
  options: XlsxImportOptions,
  spill: SpillConfig | undefined,
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
      if (spill && shouldSpillGrid(spill, cells)) {
        children.push(
          annotatedHeading(single ? 1 : 2, sheet.name, { src: spill.src, sheet: sheet.name }),
          sidecarLinkParagraph(spill),
        );
        spill.used = true;
        continue;
      }
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
      if (spill && shouldSpillGrid(spill, cells)) {
        children.push(
          annotatedHeading(single ? 1 : 2, sheet.name, { src: spill.src, sheet: sheet.name }),
          sidecarLinkParagraph(spill),
        );
        spill.used = true;
        continue;
      }
      children.push(cellsToTable(cells));
      continue;
    }

    const depth: 1 | 2 = single ? 1 : 2;
    for (const region of plan.regions) {
      const slice = sliceRect(cells, region.rect, EMPTY_CELL);
      const anchor = formatCellRef(region.rect.top, region.rect.left);
      const title = region.title ?? `${sheet.name} — ${anchor}`;
      const hasHeaderRow = inferHeader(slice);

      if (spill && shouldSpillRegion(spill, region.rect, hasHeaderRow)) {
        // An oversized region becomes a reference into the sidecar workbook:
        // same sheet/anchor vocabulary, plus `src` naming the file. Formulas
        // stay intact inside the sidecar itself, so no `role=formulas`
        // companion is emitted for a spilled region.
        children.push(
          annotatedHeading(depth, title, {
            src: spill.src,
            sheet: sheet.name,
            anchor,
            ...(hasHeaderRow ? {} : { headerRow: 'false' }),
            ...(region.titleCell
              ? { titleAnchor: formatCellRef(region.titleCell.row, region.titleCell.col) }
              : {}),
          }),
          sidecarLinkParagraph(spill),
        );
        spill.used = true;
        continue;
      }

      children.push(
        annotatedHeading(depth, title, {
          sheet: sheet.name,
          anchor,
          // Omit the common case: `headerRow=true` is what a GFM table already
          // says. (`headerRow`, not `header` — `dataTable` already declares a
          // `headers` input, and two params one letter apart in the same
          // annotation is a trap for anyone reading or editing the markdown.)
          ...(hasHeaderRow ? {} : { headerRow: 'false' }),
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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Import a workbook into a ContentContainer: the markdown document plus, when
 * a region crossed the inline thresholds (or `sidecar: 'always'`), the
 * ORIGINAL workbook bytes as a `<docbasename>_files/data/<name>` sidecar that
 * spilled regions reference via `{[dataTable src=… sheet=… anchor=…]}`.
 *
 * Small regions emit byte-identically to `xlsxToMarkdownDoc` — the historical
 * round-trip contract is untouched below the thresholds, and with
 * `sidecar: 'never'` the container is just the doc-only import in a box.
 */
export async function xlsxToContainer(
  data: ArrayBuffer | Blob,
  options: XlsxContainerOptions = {},
): Promise<ContentContainer> {
  const plan = planDataSidecar(options.sourceName, 'workbook.xlsx');
  const mode = options.sidecar ?? 'auto';
  const spill: SpillConfig | undefined =
    mode === 'never'
      ? undefined
      : {
          src: plan.sidecarPath,
          fileName: plan.fileName,
          mode,
          maxInlineRows: options.maxInlineRows ?? 100,
          maxInlineCells: options.maxInlineCells ?? 2000,
          used: false,
        };

  const markdownDoc = await workbookToMarkdown(data, options, spill);
  const container = new MemoryContentContainer();
  await container.writeDocument(stringifyMarkdown(markdownDoc), plan.markdownFilename);
  if (spill?.used) {
    const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
    await container.writeFile(plan.sidecarPath, bytes, XLSX_MIME);
  }
  return container;
}

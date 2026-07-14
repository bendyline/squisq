/**
 * XLSX import — SpreadsheetML (.xlsx) → MarkdownDocument.
 *
 * Reuses the shared ooxml/ reader (zip + DOMParser). Reads the workbook's
 * sheet list, resolves each sheet part via relationships, pulls shared strings,
 * and turns each worksheet's cell grid into a markdown table (first row treated
 * as the header). By default every sheet is imported, each preceded by an H1 of
 * the sheet name; pass `options.sheet` (index or name) to import just one.
 */

import type {
  MarkdownBlockNode,
  MarkdownDocument,
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableRow,
} from '@bendyline/squisq/markdown';
import { getPartXml, getPartRelationships, openPackage } from '../ooxml/reader.js';
import type { OoxmlOpenOptions } from '../ooxml/reader.js';
import type { OoxmlPackage } from '../ooxml/types.js';
import { NS_R, NS_SML } from '../ooxml/namespaces.js';

export interface XlsxImportOptions extends OoxmlOpenOptions {
  /** Which sheet to import (0-based index or sheet name). Default: all sheets. */
  sheet?: number | string;
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

async function readWorkbook(pkg: OoxmlPackage): Promise<WorkbookInfo> {
  const wb = await getPartXml(pkg, 'xl/workbook.xml');
  if (!wb) return { sheets: [], date1904: false };
  const rels = await getPartRelationships(pkg, 'xl/workbook.xml');
  const relById = new Map(rels.map((r) => [r.id, r.target]));
  const out: SheetRef[] = [];
  const sheetEls = wb.getElementsByTagNameNS(NS_SML, 'sheet');
  for (let i = 0; i < sheetEls.length; i++) {
    const el = sheetEls[i]!;
    const name = el.getAttribute('name') ?? `Sheet${i + 1}`;
    const rid = attrNS(el, NS_R, 'id', 'r:id');
    const target = rid ? relById.get(rid) : undefined;
    if (target) out.push({ name, path: resolveTarget('xl', target) });
  }
  const workbookPr = wb.getElementsByTagNameNS(NS_SML, 'workbookPr')[0];
  const date1904Value = workbookPr?.getAttribute('date1904');
  return {
    sheets: out,
    date1904: date1904Value === '1' || date1904Value === 'true',
  };
}

async function readSharedStrings(pkg: OoxmlPackage): Promise<string[]> {
  const doc = await getPartXml(pkg, 'xl/sharedStrings.xml');
  if (!doc) return [];
  const siEls = doc.getElementsByTagNameNS(NS_SML, 'si');
  const out: string[] = [];
  for (let i = 0; i < siEls.length; i++) out.push(siEls[i]!.textContent ?? '');
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

/** Column letters of a cell ref ("B7" → 1, "AA1" → 26). */
function colIndex(ref: string): number {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]!.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
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

function cellText(cell: Element, shared: string[], styles: CellStyle[], date1904: boolean): string {
  const t = cell.getAttribute('t');
  if (t === 'inlineStr') {
    const is = cell.getElementsByTagNameNS(NS_SML, 't');
    return is.length ? (is[0]!.textContent ?? '') : '';
  }
  const vEls = cell.getElementsByTagNameNS(NS_SML, 'v');
  const v = vEls.length ? (vEls[0]!.textContent ?? '') : '';
  if (t === 's') return shared[Number.parseInt(v, 10)] ?? '';
  if (t === 'b') return v === '1' ? 'TRUE' : 'FALSE';
  const styleIndex = Number.parseInt(cell.getAttribute('s') ?? '0', 10);
  return formattedNumberText(v, styles[styleIndex], date1904);
}

async function sheetToGrid(
  pkg: OoxmlPackage,
  path: string,
  shared: string[],
  styles: CellStyle[],
  date1904: boolean,
): Promise<string[][]> {
  const doc = await getPartXml(pkg, path);
  if (!doc) return [];
  const rowEls = doc.getElementsByTagNameNS(NS_SML, 'row');
  const grid: string[][] = [];
  for (let r = 0; r < rowEls.length; r++) {
    const cells = rowEls[r]!.getElementsByTagNameNS(NS_SML, 'c');
    const rowArr: string[] = [];
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c]!;
      const ref = cell.getAttribute('r');
      const idx = ref ? colIndex(ref) : rowArr.length;
      while (rowArr.length < idx) rowArr.push('');
      rowArr[idx] = cellText(cell, shared, styles, date1904);
    }
    grid.push(rowArr);
  }
  return grid;
}

function gridToTable(grid: string[][]): MarkdownTable {
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

export async function xlsxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options: XlsxImportOptions = {},
): Promise<MarkdownDocument> {
  const pkg = await openPackage(data, options);
  const [{ sheets, date1904 }, shared, styles] = await Promise.all([
    readWorkbook(pkg),
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
  for (const sheet of selected) {
    const grid = await sheetToGrid(pkg, sheet.path, shared, styles, date1904);
    if (!single) {
      children.push({ type: 'heading', depth: 1, children: [{ type: 'text', value: sheet.name }] });
    }
    if (grid.length > 0) children.push(gridToTable(grid));
  }
  return { type: 'document', children };
}

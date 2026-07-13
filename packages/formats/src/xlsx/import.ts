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

async function readSheets(pkg: OoxmlPackage): Promise<SheetRef[]> {
  const wb = await getPartXml(pkg, 'xl/workbook.xml');
  if (!wb) return [];
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
  return out;
}

async function readSharedStrings(pkg: OoxmlPackage): Promise<string[]> {
  const doc = await getPartXml(pkg, 'xl/sharedStrings.xml');
  if (!doc) return [];
  const siEls = doc.getElementsByTagNameNS(NS_SML, 'si');
  const out: string[] = [];
  for (let i = 0; i < siEls.length; i++) out.push(siEls[i]!.textContent ?? '');
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

function cellText(cell: Element, shared: string[]): string {
  const t = cell.getAttribute('t');
  if (t === 'inlineStr') {
    const is = cell.getElementsByTagNameNS(NS_SML, 't');
    return is.length ? (is[0]!.textContent ?? '') : '';
  }
  const vEls = cell.getElementsByTagNameNS(NS_SML, 'v');
  const v = vEls.length ? (vEls[0]!.textContent ?? '') : '';
  if (t === 's') return shared[Number.parseInt(v, 10)] ?? '';
  if (t === 'b') return v === '1' ? 'TRUE' : 'FALSE';
  return v;
}

async function sheetToGrid(pkg: OoxmlPackage, path: string, shared: string[]): Promise<string[][]> {
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
      rowArr[idx] = cellText(cell, shared);
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
  const sheets = await readSheets(pkg);
  const shared = await readSharedStrings(pkg);

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
    const grid = await sheetToGrid(pkg, sheet.path, shared);
    if (!single) {
      children.push({ type: 'heading', depth: 1, children: [{ type: 'text', value: sheet.name }] });
    }
    if (grid.length > 0) children.push(gridToTable(grid));
  }
  return { type: 'document', children };
}

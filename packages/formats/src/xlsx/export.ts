/**
 * XLSX export — MarkdownDocument → SpreadsheetML (.xlsx).
 *
 * Tables-only fidelity (honestly documented): every `table` node in the
 * markdown AST becomes worksheet cells; all other content (prose, lists,
 * images, …) is dropped, and headings survive only as sheet names and as the
 * carrier of placement metadata.
 *
 * Placement has two modes, decided per table by `workbookPlan.ts`. A table
 * whose heading carries `{[dataTable sheet=… anchor=…]}` — what
 * `xlsxToMarkdownDoc` emits for every data island it finds — is placed on the
 * named sheet at the named cell, so several mini tables share one worksheet at
 * their original addresses and formulas ride along. A table with no such
 * annotation keeps the historical behavior exactly: its own worksheet, named
 * from the nearest preceding heading, starting at A1.
 *
 * Cells are emitted as inline strings (`t="inlineStr"`) by default so no
 * sharedStrings part is needed and identifier-like numbers remain lossless.
 * Callers can explicitly opt into conservative numeric inference. The package
 * is assembled with the shared ooxml/ writer (auto-generates
 * `[Content_Types].xml` + `_rels`), so only the SpreadsheetML-specific parts
 * (workbook, worksheets, styles) are written here.
 *
 * @example
 * ```ts
 * import { parseMarkdown } from '@bendyline/squisq/markdown';
 * import { markdownDocToXlsx } from '@bendyline/squisq-formats/xlsx';
 *
 * const md = parseMarkdown('# Metrics\n\n| A | B |\n| - | - |\n| 1 | 2 |');
 * const buffer = await markdownDocToXlsx(md);
 * ```
 */

import type { Doc } from '@bendyline/squisq/schemas';
import { docToMarkdown } from '@bendyline/squisq/doc';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';

import { createPackage } from '../ooxml/writer.js';
import { xmlDeclaration, escapeXml } from '../ooxml/xmlUtils.js';
import { columnLetter } from './cells.js';
import { keyCol, keyRow, planWorkbook, type PlannedCell, type SheetPlan } from './workbookPlan.js';
import {
  NS_SML,
  NS_R,
  REL_OFFICE_DOCUMENT,
  REL_STYLES,
  REL_WORKSHEET,
  CONTENT_TYPE_XLSX_WORKBOOK,
  CONTENT_TYPE_XLSX_WORKSHEET,
  CONTENT_TYPE_XLSX_STYLES,
} from '../ooxml/namespaces.js';

/**
 * Options for XLSX export.
 */
export interface XlsxExportOptions {
  /** Cancel at bounded export checkpoints. */
  signal?: AbortSignal;
  /** Maximum cells emitted. Default: 100,000. */
  maxCells?: number;
  /** Workbook title (written to core properties). */
  title?: string;
  /** Workbook author (written to core properties). */
  author?: string;
  /** Prefix used for auto-named sheets when no heading precedes a table. Default: "Sheet". */
  sheetNamePrefix?: string;
  /**
   * Emit canonical, Excel-safe number strings as numeric cells.
   *
   * Defaults to false for hand-authored documents — markdown tables have no
   * column schema, so preserving authored text is the only lossless choice —
   * and to true when the document carries `sheet=` anchors, which only an XLSX
   * import produces. Leading-zero and >15-significant-digit values remain
   * strings either way. Set explicitly to override both defaults.
   */
  inferNumericCells?: boolean;
  /**
   * Called for each non-fatal placement problem (a malformed anchor, an
   * overlapping region, an unusable loose-cell reference). Export never throws
   * for these — a hand-edited markdown file must still convert.
   */
  onWarning?: (message: string) => void;
}

/** A plain integer or decimal (optionally negative) — emitted as a numeric cell. */
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

function isSafeNumericCell(value: string): boolean {
  if (!NUMERIC_RE.test(value)) return false;
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integer] = unsigned.split('.');
  if (integer!.length > 1 && integer!.startsWith('0')) return false;
  const significantDigits = unsigned.replace('.', '').replace(/^0+/, '');
  if (significantDigits.length > 15) return false;
  return Number.isFinite(Number(value));
}

/**
 * Sanitize a candidate name into a valid, unique Excel sheet name.
 * Strips characters Excel forbids (`[]:*?/\`), caps at 31 chars, and
 * de-duplicates against already-used names by appending 2, 3, …
 */
function cleanSheetName(raw: string): string {
  return raw
    .replace(/[[\]:*?/\\]/g, '')
    .trim()
    .slice(0, 31)
    .trim()
    .replace(/^'+|'+$/g, '');
}

function sanitizeSheetName(candidate: string, used: Set<string>, fallback: string): string {
  let base = cleanSheetName(candidate) || cleanSheetName(fallback) || 'Sheet';
  let name = base;
  let n = 2;
  while (used.has(name.toLocaleLowerCase('en-US'))) {
    const suffix = String(n++);
    base = base.slice(0, 31 - suffix.length);
    name = `${base}${suffix}`;
  }
  used.add(name.toLocaleLowerCase('en-US'));
  return name;
}

/** An Excel error literal, e.g. `#DIV/0!` or `#N/A`. */
const ERROR_VALUE_RE = /^#[A-Z0-9_/]+[!?]?$/;

/**
 * One `<c>` element.
 *
 * A formula cell cannot use `t="inlineStr"` — that type carries an `<is>`
 * child, and `<f>` has nowhere to live beside it — so a formula whose cached
 * result is text uses `t="str"` (the formula-string type) instead, and one
 * whose result is an error uses `t="e"`.
 */
function cellXml(cell: PlannedCell, ref: string, inferNumericCells: boolean): string {
  const { text, formula } = cell;

  if (formula !== undefined && formula !== '') {
    const f = `<f>${escapeXml(formula)}</f>`;
    if (text === '') return `<c r="${ref}">${f}</c>`;
    if (isSafeNumericCell(text)) return `<c r="${ref}">${f}<v>${escapeXml(text)}</v></c>`;
    if (ERROR_VALUE_RE.test(text)) return `<c r="${ref}" t="e">${f}<v>${escapeXml(text)}</v></c>`;
    return `<c r="${ref}" t="str">${f}<v>${escapeXml(text)}</v></c>`;
  }

  if (inferNumericCells && isSafeNumericCell(text)) {
    return `<c r="${ref}"><v>${escapeXml(text)}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

/**
 * A worksheet from a sparse cell map.
 *
 * Rows and cells are emitted in ascending order and blanks are skipped
 * entirely. Both matter now that placement is anchored rather than dense: the
 * gaps between islands must cost nothing, and readers rely on ascending refs,
 * which a dense grid used to give for free.
 */
function worksheetXml(sheet: SheetPlan, inferNumericCells: boolean): string {
  const keys = [...sheet.cells.keys()].sort((a, b) => a - b);
  const rows: string[] = [];
  let maxRow = 0;
  let maxCol = 0;

  let i = 0;
  while (i < keys.length) {
    const rowIdx = keyRow(keys[i]!);
    let cellsXml = '';
    while (i < keys.length && keyRow(keys[i]!) === rowIdx) {
      const key = keys[i]!;
      const col = keyCol(key);
      if (col > maxCol) maxCol = col;
      cellsXml += cellXml(
        sheet.cells.get(key)!,
        `${columnLetter(col)}${rowIdx + 1}`,
        inferNumericCells,
      );
      i++;
    }
    if (rowIdx > maxRow) maxRow = rowIdx;
    rows.push(`<row r="${rowIdx + 1}">${cellsXml}</row>`);
  }

  const dimension = keys.length > 0 ? `A1:${columnLetter(maxCol)}${maxRow + 1}` : 'A1';
  return (
    `${xmlDeclaration()}\n` +
    `<worksheet xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    `</worksheet>`
  );
}

function workbookXml(sheets: SheetPlan[], hasFormulas: boolean): string {
  const sheetEls = sheets
    .map(
      (sheet, i) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('');
  // Cached results are only as fresh as the markdown they came from, and a
  // formula cell may carry none at all. Asking for a full recalculation on load
  // is what stops Excel from showing a blank where a value belongs.
  const calcPr = hasFormulas ? `<calcPr calcId="0" fullCalcOnLoad="1"/>` : '';
  return (
    `${xmlDeclaration()}\n` +
    `<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
    `<sheets>${sheetEls}</sheets>${calcPr}` +
    `</workbook>`
  );
}

/** Minimal but valid styles part (Excel expects the referenced collections to exist). */
function stylesXml(): string {
  return (
    `${xmlDeclaration()}\n` +
    `<styleSheet xmlns="${NS_SML}">` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
    `</styleSheet>`
  );
}

/**
 * Convert a MarkdownDocument to a .xlsx file (tables-only fidelity).
 *
 * Each markdown `table` becomes one worksheet; a document with no tables
 * yields a single empty sheet (a valid, openable file — never throws).
 */
export async function markdownDocToXlsx(
  doc: MarkdownDocument,
  options: XlsxExportOptions = {},
): Promise<ArrayBuffer> {
  options.signal?.throwIfAborted();
  const prefix = cleanSheetName(options.sheetNamePrefix ?? 'Sheet') || 'Sheet';
  const maxCells = options.maxCells ?? 100_000;
  if (!Number.isSafeInteger(maxCells) || maxCells < 0) {
    throw new RangeError('maxCells must be a non-negative safe integer');
  }

  const plan = planWorkbook(doc, { sheetNamePrefix: prefix, sanitize: sanitizeSheetName });
  for (const warning of plan.warnings) options.onWarning?.(warning);
  if (plan.cellCount > maxCells) {
    throw new RangeError(`XLSX export exceeds the ${maxCells}-cell safety limit`);
  }

  let sheets = plan.sheets;
  // Zero tables → one empty sheet so the file is still valid.
  if (sheets.length === 0) {
    sheets = [
      {
        name: sanitizeSheetName(`${prefix}1`, new Set(), 'Sheet1'),
        cells: new Map(),
        anchored: false,
      },
    ];
  }

  // A table that carries a `sheet=` anchor is provably spreadsheet-origin — no
  // hand-authored markdown produces one — so its canonical numbers can safely
  // go back as numbers. An unannotated table keeps the conservative default,
  // where preserving the authored text is the only lossless choice.
  const anchored = sheets.some((sheet) => sheet.anchored);
  const inferNumericCells = options.inferNumericCells ?? anchored;
  const hasFormulas = sheets.some((sheet) => {
    for (const cell of sheet.cells.values()) if (cell.formula) return true;
    return false;
  });

  const pkg = createPackage();

  // Worksheets + workbook→worksheet relationships.
  sheets.forEach((sheet, i) => {
    if ((i & 31) === 0) options.signal?.throwIfAborted();
    const sheetPath = `xl/worksheets/sheet${i + 1}.xml`;
    pkg.addPart(sheetPath, worksheetXml(sheet, inferNumericCells), CONTENT_TYPE_XLSX_WORKSHEET);
    pkg.addRelationship('xl/workbook.xml', {
      id: `rId${i + 1}`,
      type: REL_WORKSHEET,
      target: `worksheets/sheet${i + 1}.xml`,
    });
  });

  // Styles part (referenced after the sheet relationships).
  pkg.addPart('xl/styles.xml', stylesXml(), CONTENT_TYPE_XLSX_STYLES);
  pkg.addRelationship('xl/workbook.xml', {
    id: `rId${sheets.length + 1}`,
    type: REL_STYLES,
    target: 'styles.xml',
  });

  // Workbook + root relationship.
  pkg.addPart('xl/workbook.xml', workbookXml(sheets, hasFormulas), CONTENT_TYPE_XLSX_WORKBOOK);
  pkg.addRelationship('', {
    id: 'rId1',
    type: REL_OFFICE_DOCUMENT,
    target: 'xl/workbook.xml',
  });

  if (options.title || options.author) {
    pkg.setCoreProperties({
      title: options.title,
      creator: options.author,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
  }

  return pkg.toArrayBuffer();
}

/**
 * Convert a squisq Doc to a .xlsx file (via the markdown table model).
 */
export async function docToXlsx(doc: Doc, options?: XlsxExportOptions): Promise<ArrayBuffer> {
  return markdownDocToXlsx(docToMarkdown(doc), options);
}

/**
 * XLSX export — MarkdownDocument → SpreadsheetML (.xlsx).
 *
 * Tables-only fidelity (honestly documented): every `table` node in the
 * markdown AST becomes one worksheet; all other content (headings, prose,
 * lists, images, …) is dropped except that the nearest preceding heading is
 * used to name the sheet. This mirrors the import side (`xlsxToMarkdownDoc`),
 * which turns each worksheet grid back into a markdown table.
 *
 * Cells are emitted as inline strings (`t="inlineStr"`) so no sharedStrings
 * part is needed, except values matching a plain-number pattern, which are
 * emitted as numeric cells. The package is assembled with the shared ooxml/
 * writer (auto-generates `[Content_Types].xml` + `_rels`), so only the
 * SpreadsheetML-specific parts (workbook, worksheets, styles) are written here.
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
import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownTable,
  MarkdownTableRow,
} from '@bendyline/squisq/markdown';

import { createPackage } from '../ooxml/writer.js';
import { xmlDeclaration, escapeXml } from '../ooxml/xmlUtils.js';
import { extractPlainText } from '../shared/text.js';
import {
  NS_SML,
  NS_R,
  REL_OFFICE_DOCUMENT,
  REL_STYLES,
  CONTENT_TYPE_XLSX_WORKBOOK,
} from '../ooxml/namespaces.js';

// SpreadsheetML-specific constants not exported from the shared namespaces module.
const CONTENT_TYPE_XLSX_WORKSHEET =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const CONTENT_TYPE_XLSX_STYLES =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml';
const REL_WORKSHEET =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

/**
 * Options for XLSX export.
 */
export interface XlsxExportOptions {
  /** Workbook title (written to core properties). */
  title?: string;
  /** Workbook author (written to core properties). */
  author?: string;
  /** Prefix used for auto-named sheets when no heading precedes a table. Default: "Sheet". */
  sheetNamePrefix?: string;
}

interface SheetData {
  name: string;
  /** Grid of cell text: first row is the header. */
  grid: string[][];
}

/** A plain integer or decimal (optionally negative) — emitted as a numeric cell. */
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/**
 * Sanitize a candidate name into a valid, unique Excel sheet name.
 * Strips characters Excel forbids (`[]:*?/\`), caps at 31 chars, and
 * de-duplicates against already-used names by appending 2, 3, …
 */
function sanitizeSheetName(raw: string, used: Set<string>, fallback: string): string {
  let name = raw.replace(/[[\]:*?/\\]/g, '').trim();
  if (name.length === 0) name = fallback;
  name = name.slice(0, 31);

  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  // Dedupe: "Name", "Name2", "Name3", … keeping within the 31-char cap.
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const base = name.slice(0, 31 - suffix.length);
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** Convert a table node into a grid of plain-text cells. */
function tableToGrid(table: MarkdownTable): string[][] {
  return table.children.map((row: MarkdownTableRow) =>
    row.children.map((cell) => extractPlainText(cell.children)),
  );
}

/** Walk the document, pairing each table with the nearest preceding heading. */
function collectSheets(doc: MarkdownDocument, prefix: string): SheetData[] {
  const used = new Set<string>();
  const sheets: SheetData[] = [];
  let pendingHeading: string | null = null;

  const visit = (nodes: MarkdownBlockNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'heading') {
        pendingHeading = extractPlainText(node.children);
      } else if (node.type === 'table') {
        const fallback = `${prefix}${sheets.length + 1}`;
        const name = sanitizeSheetName(pendingHeading ?? fallback, used, fallback);
        sheets.push({ name, grid: tableToGrid(node) });
        pendingHeading = null;
      }
    }
  };

  visit(doc.children);
  return sheets;
}

/** Column letters for a zero-based index (0 → "A", 26 → "AA"). */
function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function cellXml(value: string, ref: string): string {
  if (NUMERIC_RE.test(value)) {
    return `<c r="${ref}"><v>${escapeXml(value)}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(grid: string[][]): string {
  const rows: string[] = [];
  for (let r = 0; r < grid.length; r++) {
    const cells = grid[r]!;
    const cellsXml = cells.map((value, c) => cellXml(value, `${columnLetter(c)}${r + 1}`)).join('');
    rows.push(`<row r="${r + 1}">${cellsXml}</row>`);
  }
  return (
    `${xmlDeclaration()}\n` +
    `<worksheet xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
    `<sheetData>${rows.join('')}</sheetData>` +
    `</worksheet>`
  );
}

function workbookXml(sheets: SheetData[]): string {
  const sheetEls = sheets
    .map(
      (sheet, i) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('');
  return (
    `${xmlDeclaration()}\n` +
    `<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
    `<sheets>${sheetEls}</sheets>` +
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
  const prefix = options.sheetNamePrefix ?? 'Sheet';
  let sheets = collectSheets(doc, prefix);

  // Zero tables → one empty sheet so the file is still valid.
  if (sheets.length === 0) {
    sheets = [{ name: `${prefix}1`, grid: [] }];
  }

  const pkg = createPackage();

  // Worksheets + workbook→worksheet relationships.
  sheets.forEach((sheet, i) => {
    const sheetPath = `xl/worksheets/sheet${i + 1}.xml`;
    pkg.addPart(sheetPath, worksheetXml(sheet.grid), CONTENT_TYPE_XLSX_WORKSHEET);
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
  pkg.addPart('xl/workbook.xml', workbookXml(sheets), CONTENT_TYPE_XLSX_WORKBOOK);
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

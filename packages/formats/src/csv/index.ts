/**
 * @bendyline/squisq-formats CSV Module
 *
 * Bridges CSV ↔ the squisq markdown table model. CSV isn't OOXML, so this
 * module is self-contained (no jszip / DOMParser): a small RFC-4180 parser on
 * the import side and a serializer on the export side. The first row is treated
 * as the table header by default.
 *
 * @example
 * ```ts
 * import { csvToMarkdownDoc, markdownDocToCsv } from '@bendyline/squisq-formats/csv';
 * ```
 */

import { markdownToDoc } from '@bendyline/squisq/doc';
import type {
  MarkdownDocument,
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableRow,
} from '@bendyline/squisq/markdown';
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';
import { MemoryContentContainer, type ContentContainer } from '@bendyline/squisq/storage';
import { planDataSidecar, sidecarReferenceDoc } from '../data/sidecar.js';

export interface CsvImportOptions {
  /** Field delimiter. Default `,`. */
  delimiter?: string;
  /** Treat the first row as a header row. Default true. */
  hasHeader?: boolean;
  /** Maximum parsed cells. Default: 100,000. */
  maxCells?: number;
  /** Maximum rows. Default: 10,000. */
  maxRows?: number;
  /** Maximum characters in one field. Default: 1 MiB. */
  maxFieldChars?: number;
  /** Cancel during parsing checkpoints. */
  signal?: AbortSignal;
  /**
   * Sidecar spill mode — only honored by `csvToContainer`, which can actually
   * write the sidecar file. `'auto'` (default) spills past the inline
   * thresholds; `'always'` always sidecars (the CSV-open-as-document mode:
   * opening a data file means the FILE is the content); `'never'` keeps the
   * inline table (`csvToMarkdownDoc`'s only behavior).
   */
  sidecar?: 'auto' | 'always' | 'never';
  /** Max data rows kept inline before spilling (container import). Default 100. */
  maxInlineRows?: number;
  /** Max source bytes kept inline before spilling (container import). Default 256 KiB. */
  maxInlineBytes?: number;
}

/** Options for {@link csvToContainer}. */
export interface CsvContainerOptions extends CsvImportOptions {
  /**
   * Source file name (e.g. `'Q3 Transactions.csv'`) — names the document
   * (`q3-transactions.md`) and the sidecar path
   * (`q3-transactions_files/data/Q3 Transactions.csv`). Default `'data.csv'`.
   */
  sourceName?: string;
}

export interface CsvExportOptions {
  /** Field delimiter. Default `,`. */
  delimiter?: string;
  /**
   * How to handle values that spreadsheet applications may execute as
   * formulas. The safe default, `escape`, prefixes a leading apostrophe when
   * the first non-space character is `=`, `+`, `-`, or `@`. Use `preserve`
   * only when the CSV will not be opened by a spreadsheet application.
   */
  formulaHandling?: 'escape' | 'preserve';
  /**
   * Zero-based index of the table to export when the document contains more
   * than one. Default 0 (the first table). An explicitly provided index that
   * doesn't match a table in the document is an error.
   */
  tableIndex?: number;
  /** Maximum cells emitted. Default: 100,000. */
  maxCells?: number;
  /** Cancel during export checkpoints. */
  signal?: AbortSignal;
}

export interface CsvSafetyLimits {
  maxCells?: number;
  maxRows?: number;
  maxFieldChars?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_CSV_CELLS = 100_000;
const DEFAULT_MAX_CSV_ROWS = 10_000;
const DEFAULT_MAX_CSV_FIELD_CHARS = 1024 * 1024;

/**
 * Generous caps for the DATA-SIDECAR tier — the grid ingest and the
 * full-body sidecar readers. The conservative `parseCsv` defaults protect
 * the INLINE pipeline (a 100k-cell markdown table can't reparse anyway),
 * but sidecar data exists precisely because it is big: it renders windowed
 * and virtualized, so the ceiling here is the columnar store's ~20M-cell
 * design wall, not the editor debounce. Every sidecar-path caller passes
 * these; without them a 20 MB upload silently dead-ends at the parser cap.
 */
export const SIDECAR_CSV_LIMITS: CsvSafetyLimits = Object.freeze({
  maxCells: 20_000_000,
  maxRows: 2_000_000,
});

async function toText(data: ArrayBuffer | Blob | string): Promise<string> {
  if (typeof data === 'string') return data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return new TextDecoder().decode(new Uint8Array(data as ArrayBuffer));
}

function validateDelimiter(delimiter: string): string {
  if ([...delimiter].length !== 1 || /["\r\n\uFEFF]/u.test(delimiter)) {
    throw new TypeError(
      'CSV delimiter must be exactly one character and cannot be a quote, line break, or BOM',
    );
  }
  return delimiter;
}

/** Parse CSV text into a grid of string cells (RFC 4180: quotes, escaped quotes). */
export function parseCsv(text: string, delimiter = ',', limits: CsvSafetyLimits = {}): string[][] {
  delimiter = validateDelimiter(delimiter);
  const maxCells = safetyInteger('maxCells', limits.maxCells ?? DEFAULT_MAX_CSV_CELLS);
  const maxRows = safetyInteger('maxRows', limits.maxRows ?? DEFAULT_MAX_CSV_ROWS);
  const maxFieldChars = safetyInteger(
    'maxFieldChars',
    limits.maxFieldChars ?? DEFAULT_MAX_CSV_FIELD_CHARS,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;
  let cellCount = 0;
  const pushField = () => {
    if (++cellCount > maxCells)
      throw new RangeError(`CSV exceeds the ${maxCells}-cell safety limit`);
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    if (rows.length >= maxRows) throw new RangeError(`CSV exceeds the ${maxRows}-row safety limit`);
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    if ((i & 16383) === 0) limits.signal?.throwIfAborted();
    let ch = text[i]!;
    if (delimiter.length === 2 && text.slice(i, i + 2) === delimiter) {
      ch = delimiter;
      i++;
    }
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
        if (field.length > maxFieldChars) {
          throw new RangeError(`CSV field exceeds the ${maxFieldChars}-character safety limit`);
        }
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAny = true;
      continue;
    }
    if (ch === delimiter) {
      sawAny = true;
      pushField();
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      sawAny = false;
      continue;
    }
    sawAny = true;
    field += ch;
    if (field.length > maxFieldChars) {
      throw new RangeError(`CSV field exceeds the ${maxFieldChars}-character safety limit`);
    }
  }
  // Flush a trailing field/row only if the last line wasn't terminated.
  if (field !== '' || row.length > 0 || sawAny) pushRow();
  return rows;
}

function safetyInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function rowsToTable(rows: string[][], hasHeader: boolean): MarkdownTable {
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const mdRows: MarkdownTableRow[] = rows.map((cells, rowIdx) => {
    const children: MarkdownTableCell[] = [];
    for (let c = 0; c < maxCols; c++) {
      const value = cells[c] ?? '';
      children.push({
        type: 'tableCell',
        ...(hasHeader && rowIdx === 0 ? { isHeader: true } : {}),
        children: value ? [{ type: 'text', value }] : [],
      });
    }
    return { type: 'tableRow', children };
  });
  return { type: 'table', children: mdRows };
}

/** Convert CSV to a MarkdownDocument containing a single table. */
export async function csvToMarkdownDoc(
  data: ArrayBuffer | Blob | string,
  options: CsvImportOptions = {},
): Promise<MarkdownDocument> {
  const text = (await toText(data)).replace(/^\uFEFF/, '');
  const rows = parseCsv(text, options.delimiter ?? ',', options);
  const hasHeader = options.hasHeader ?? true;
  const children = rows.length > 0 ? [rowsToTable(rows, hasHeader)] : [];
  return { type: 'document', children };
}

/** Convert CSV to a squisq Doc. */
export async function csvToDoc(
  data: ArrayBuffer | Blob | string,
  options: CsvImportOptions = {},
): Promise<Doc> {
  return markdownToDoc(await csvToMarkdownDoc(data, options));
}

/**
 * Import a CSV into a ContentContainer: the markdown document plus, when the
 * data crosses the inline thresholds (or `sidecar: 'always'`), the ORIGINAL
 * bytes as a `<docbasename>_files/data/<name>` sidecar referenced via
 * `{[dataTable src=…]}` with a body link.
 *
 * Below the thresholds the markdown is byte-identical to `csvToMarkdownDoc`'s
 * output and no sidecar is written.
 */
export async function csvToContainer(
  data: ArrayBuffer | Blob | string,
  options: CsvContainerOptions = {},
): Promise<ContentContainer> {
  const plan = planDataSidecar(options.sourceName, 'data.csv');
  const mode = options.sidecar ?? 'auto';
  const text = (await toText(data)).replace(/^\uFEFF/, '');
  const maxInlineRows = options.maxInlineRows ?? 100;
  const maxInlineBytes = options.maxInlineBytes ?? 256 * 1024;

  const originalBytes: ArrayBuffer =
    typeof data === 'string'
      ? (new TextEncoder().encode(data).buffer as ArrayBuffer)
      : data instanceof Blob
        ? await data.arrayBuffer()
        : data;

  // Size checks stay parse-free: byte length, then a newline count (an
  // over-estimate when fields embed newlines, which only errs toward
  // spilling). Parsing a file that is about to spill anyway would trip the
  // parser's own safety caps on exactly the large inputs this path exists for.
  let spillNeeded = mode === 'always';
  if (!spillNeeded && mode === 'auto') {
    const hasHeader = options.hasHeader ?? true;
    const lineCount = (text.match(/\n/g) ?? []).length + (text.endsWith('\n') || !text ? 0 : 1);
    const dataRows = Math.max(lineCount - (hasHeader ? 1 : 0), 0);
    spillNeeded = originalBytes.byteLength > maxInlineBytes || dataRows > maxInlineRows;
  }

  const markdownDoc = spillNeeded
    ? sidecarReferenceDoc(plan)
    : await csvToMarkdownDoc(text, options);

  const container = new MemoryContentContainer();
  await container.writeDocument(stringifyMarkdown(markdownDoc), plan.markdownFilename);
  if (spillNeeded) {
    await container.writeFile(plan.sidecarPath, originalBytes, 'text/csv');
  }
  return container;
}

/** Options for {@link serializeCsvRows}. */
export interface SerializeCsvRowsOptions {
  /** Field delimiter. Default `,`. */
  delimiter?: string;
  /** Line terminator. Default `\n`. */
  newline?: '\r\n' | '\n';
  /** Emit a terminating newline after the last row. Default true. */
  trailingNewline?: boolean;
  /**
   * Formula neutralization. Default **`'preserve'`** — the OPPOSITE of the
   * export default, deliberately: this API re-serializes EXISTING data (the
   * grid's save path), and `SPREADSHEET_FORMULA_PREFIX` matches a leading
   * `-`/`+`, so blanket escaping would corrupt every negative number in a
   * re-saved file. Callers neutralize specific cells themselves (the grid
   * escapes only journal-edited, non-numeric cells).
   */
  formulaHandling?: 'escape' | 'preserve';
}

/**
 * Serialize a plain row matrix to CSV text — the write half of `parseCsv`,
 * used by the grid's sidecar save. RFC-4180 quoting via the same escaper
 * the exporter uses.
 */
export function serializeCsvRows(
  rows: readonly (readonly string[])[],
  options: SerializeCsvRowsOptions = {},
): string {
  const delimiter = validateDelimiter(options.delimiter ?? ',');
  const newline = options.newline ?? '\n';
  const handling = options.formulaHandling ?? 'preserve';
  const body = rows
    .map((row) =>
      row
        .map((cell) => escapeCsvField(neutralizeSpreadsheetFormula(cell, handling), delimiter))
        .join(delimiter),
    )
    .join(newline);
  return options.trailingNewline === false ? body : `${body}${newline}`;
}

function escapeCsvField(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || /[\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const SPREADSHEET_FORMULA_PREFIX = /^[\t\r\n \uFEFF]*[=+\-@]/;

function neutralizeSpreadsheetFormula(
  value: string,
  handling: CsvExportOptions['formulaHandling'],
): string {
  if (handling === 'preserve' || !SPREADSHEET_FORMULA_PREFIX.test(value)) return value;
  return `'${value}`;
}

function cellText(cell: MarkdownTableCell): string {
  // Flatten inline children to plain text (CSV has no formatting).
  const walk = (nodes: unknown[]): string =>
    nodes
      .map((n) => {
        const node = n as { type?: string; value?: string; children?: unknown[] };
        if (node.value !== undefined) return node.value;
        if (Array.isArray(node.children)) return walk(node.children);
        return '';
      })
      .join('');
  return walk(cell.children);
}

/**
 * Serialize one table in a MarkdownDocument to CSV text.
 *
 * By default the first table is exported. Documents with multiple tables can
 * select another via `options.tableIndex` (zero-based). An explicit
 * `tableIndex` that is out of range throws; the implicit first-table default
 * on a table-less document returns an empty string (back-compat).
 */
export function markdownDocToCsv(doc: MarkdownDocument, options: CsvExportOptions = {}): string {
  const delimiter = validateDelimiter(options.delimiter ?? ',');
  const formulaHandling = options.formulaHandling ?? 'escape';
  const tables = doc.children.filter((n): n is MarkdownTable => n.type === 'table');
  const index = options.tableIndex ?? 0;
  if (
    options.tableIndex !== undefined &&
    (!Number.isInteger(index) || index < 0 || index >= tables.length)
  ) {
    throw new Error(
      `CSV export: tableIndex ${index} is out of range — the document contains ${tables.length} table(s).`,
    );
  }
  const table = tables[index];
  if (!table) return '';
  const maxCells = safetyInteger('maxCells', options.maxCells ?? DEFAULT_MAX_CSV_CELLS);
  const cellCount = table.children.reduce((count, row) => count + row.children.length, 0);
  if (cellCount > maxCells) throw new RangeError(`CSV exceeds the ${maxCells}-cell safety limit`);
  return table.children
    .map((row, rowIndex) => {
      if ((rowIndex & 255) === 0) options.signal?.throwIfAborted();
      return row.children
        .map((cell) =>
          escapeCsvField(neutralizeSpreadsheetFormula(cellText(cell), formulaHandling), delimiter),
        )
        .join(delimiter);
    })
    .join('\r\n');
}

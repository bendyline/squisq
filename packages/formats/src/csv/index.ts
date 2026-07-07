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
import type { Doc } from '@bendyline/squisq/schemas';

export interface CsvImportOptions {
  /** Field delimiter. Default `,`. */
  delimiter?: string;
  /** Treat the first row as a header row. Default true. */
  hasHeader?: boolean;
}

export interface CsvExportOptions {
  /** Field delimiter. Default `,`. */
  delimiter?: string;
  /**
   * Zero-based index of the table to export when the document contains more
   * than one. Default 0 (the first table). An explicitly provided index that
   * doesn't match a table in the document is an error.
   */
  tableIndex?: number;
}

async function toText(data: ArrayBuffer | Blob | string): Promise<string> {
  if (typeof data === 'string') return data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return new TextDecoder().decode(new Uint8Array(data as ArrayBuffer));
}

/** Parse CSV text into a grid of string cells (RFC 4180: quotes, escaped quotes). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
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
  }
  // Flush a trailing field/row only if the last line wasn't terminated.
  if (field !== '' || row.length > 0 || sawAny) pushRow();
  return rows;
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
  const text = await toText(data);
  const rows = parseCsv(text, options.delimiter ?? ',');
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

function escapeCsvField(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || /[\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
  const delimiter = options.delimiter ?? ',';
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
  return table.children
    .map((row) =>
      row.children.map((cell) => escapeCsvField(cellText(cell), delimiter)).join(delimiter),
    )
    .join('\r\n');
}

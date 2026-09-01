/**
 * Sidecar data readers — the format implementations behind core's
 * `DataSourceReader` seam (`resolveDataReferences`).
 *
 * Core stays parser-free; these readers decode the actual bytes of a
 * `{[dataTable src=…]}` sidecar into the bounded `DataSourceTable` window the
 * projections render. CSV/TSV wrap the RFC-4180 parser, XLSX reuses the
 * import pipeline's typed region detection (`xlsxToTables`), and parquet
 * loads hyparquet lazily so its bytes never reach consumers that don't
 * reference parquet files.
 */

import type {
  DataSourceReader,
  DataSourceReadOptions,
  DataSourceTable,
} from '@bendyline/squisq/doc';
import { parseCsv } from '../csv/index.js';
import { xlsxToTables } from '../xlsx/import.js';
import { columnLetter, type XlsxTable } from '../xlsx/tables.js';
import { parseCellRef } from '../xlsx/cells.js';

// ── CSV / TSV ────────────────────────────────────────────────────────

function csvToTable(rows: string[][], opts: DataSourceReadOptions): DataSourceTable {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const pad = (row: string[]): string[] =>
    row.length === width ? row : [...row, ...Array<string>(width - row.length).fill('')];

  const headerRow = opts.headerRow !== false;
  const headers =
    headerRow && rows.length > 0
      ? pad(rows[0])
      : Array.from({ length: width }, (_, i) => columnLetter(i));
  const body = headerRow ? rows.slice(1) : rows;

  return {
    headers,
    rows: body.slice(0, opts.maxRows).map(pad),
    totalRows: body.length,
    totalCols: width,
  };
}

export const csvDataReader: DataSourceReader = {
  extensions: ['csv', 'tsv'],
  async read(data, opts) {
    const text = new TextDecoder().decode(data);
    // Delimiter follows the extension the src named; the resolver picked this
    // reader by extension, but the bytes don't say which one — sniff tabs in
    // the first line so a `.tsv` splits correctly.
    const firstLine = text.slice(0, text.indexOf('\n') + 1 || text.length);
    const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
    return csvToTable(parseCsv(text, delimiter), opts);
  },
};

// ── XLSX ─────────────────────────────────────────────────────────────

/** Zero-based rect a table occupies, derived from its anchor + shape. */
function tableRect(
  table: XlsxTable,
): { top: number; left: number; bottom: number; right: number } | null {
  const ref = parseCellRef(table.anchor);
  if (!ref) return null;
  const height = table.rows.length + (table.hasHeader ? 1 : 0);
  return {
    top: ref.row,
    left: ref.col,
    bottom: ref.row + Math.max(height - 1, 0),
    right: ref.col + Math.max(table.columns.length - 1, 0),
  };
}

/**
 * Pick the region an `anchor` param addresses: exact anchor match first, then
 * the region containing the anchor cell (the sheet may have shifted a row
 * since import), then the largest region on the sheet.
 */
function pickTable(tables: XlsxTable[], anchor: string | undefined): XlsxTable | null {
  if (tables.length === 0) return null;
  if (anchor) {
    const exact = tables.find((t) => t.anchor.toUpperCase() === anchor.toUpperCase());
    if (exact) return exact;
    const target = parseCellRef(anchor);
    if (target) {
      const containing = tables.find((t) => {
        const rect = tableRect(t);
        return (
          !!rect &&
          target.row >= rect.top &&
          target.row <= rect.bottom &&
          target.col >= rect.left &&
          target.col <= rect.right
        );
      });
      if (containing) return containing;
    }
  }
  return tables.reduce((best, t) =>
    t.rows.length * t.columns.length > best.rows.length * best.columns.length ? t : best,
  );
}

function stringifyCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

export const xlsxDataReader: DataSourceReader = {
  extensions: ['xlsx'],
  async read(data, opts) {
    const tables = await xlsxToTables(data, {
      ...(opts.sheet !== undefined ? { sheet: opts.sheet } : {}),
    });
    if (opts.sheet !== undefined && tables.length === 0) {
      throw new Error(`worksheet "${opts.sheet}" not found or holds no tabular data`);
    }
    const table = pickTable(tables, opts.anchor);
    if (!table) {
      throw new Error('no tabular data found in workbook');
    }

    // `hasHeader` is region inference; an explicit `headerRow=false` param is
    // the author overriding it — the inferred header row is really data, and
    // columns fall back to sheet letters.
    const ref = parseCellRef(table.anchor);
    const demoteHeader = opts.headerRow === false && table.hasHeader;
    const headers = demoteHeader
      ? table.columns.map((_, i) => columnLetter((ref?.col ?? 0) + i))
      : table.columns.map((c) => c.name);
    const body = demoteHeader
      ? [table.columns.map((c) => c.name), ...table.rows.map((row) => row.map(stringifyCell))]
      : table.rows.map((row) => row.map(stringifyCell));

    return {
      headers,
      rows: body.slice(0, opts.maxRows),
      totalRows: body.length,
      totalCols: table.columns.length,
    };
  },
};

// ── Parquet ──────────────────────────────────────────────────────────

/**
 * The slice of hyparquet's API this reader touches, typed structurally so the
 * module name never appears in published declarations (the optional-peer
 * contract `harperOptionalPeer.test.ts` enforces for harper.js).
 */
interface HyparquetModule {
  parquetMetadata(buffer: ArrayBuffer): { num_rows: number | bigint };
  parquetSchema(metadata: unknown): { children: { element: { name: string } }[] };
  parquetRead(options: {
    file: ArrayBuffer;
    metadata?: unknown;
    rowStart?: number;
    rowEnd?: number;
    onComplete?: (rows: unknown[][]) => void;
  }): Promise<void>;
}

export const parquetDataReader: DataSourceReader = {
  extensions: ['parquet'],
  async read(data, opts) {
    // hyparquet is an OPTIONAL PEER reached only through this dynamic import
    // (the harper.js / ffmpegWasm semantics): consumers that never reference
    // a .parquet file ship zero bytes of it, and a build without the package
    // degrades to a clear per-block diagnostic instead of an install failure.
    let hyparquet: HyparquetModule;
    try {
      hyparquet = (await import('hyparquet')) as unknown as HyparquetModule;
    } catch {
      throw new Error('parquet support is not installed (missing optional dependency "hyparquet")');
    }

    const buffer =
      data instanceof ArrayBuffer ? data : (new Uint8Array(data).slice().buffer as ArrayBuffer);
    const metadata = hyparquet.parquetMetadata(buffer);
    const totalRows = Number(metadata.num_rows);
    const columnNames = hyparquet.parquetSchema(metadata).children.map((c) => c.element.name);

    const rows: string[][] = [];
    await hyparquet.parquetRead({
      file: buffer,
      metadata,
      rowStart: 0,
      rowEnd: Math.min(opts.maxRows, totalRows),
      onComplete(read) {
        for (const row of read) {
          rows.push(row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
        }
      },
    });

    return {
      headers: columnNames,
      rows,
      totalRows,
      totalCols: columnNames.length,
    };
  },
};

/** The full reader set for `resolveDataReferences({ readers })`. */
export function defaultDataReaders(): DataSourceReader[] {
  return [csvDataReader, xlsxDataReader, parquetDataReader];
}

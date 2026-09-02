/**
 * Sidecar bytes → the grid's neutral `IngestTable`, via lazy formats
 * imports (the `processTextFile`-docx precedent — formats stays out of the
 * static graph).
 *
 * CSV/TSV additionally sniff and RETAIN the source conventions the save
 * path must reproduce (delimiter, newline flavor, trailing newline, BOM)
 * plus the original parsed `string[][]` — unedited cells re-serialize from
 * the parse product, never from typed columns, so untouched values have no
 * float-rendering drift. XLSX resolves the heading's `sheet`/`anchor`
 * region (the summary card used to ignore those), keeps typed cell values,
 * and carries the address map + per-cell formula/date locks the in-place
 * patch save needs; parquet stays read-only.
 */

import type { IngestCell, IngestTable } from '@bendyline/squisq-grid-react';
import type { XlsxWorkbookGrids } from '@bendyline/squisq-formats/xlsx';

export interface CsvSourceMeta {
  delimiter: string;
  newline: '\r\n' | '\n';
  trailingNewline: boolean;
  bom: boolean;
  /** The parsed source rows INCLUDING the header row — the save baseline. */
  rows: string[][];
  hasHeader: boolean;
}

export interface XlsxSourceMeta {
  /** Worksheet the region lives on. */
  sheet: string;
  /** 0-based grid row/col of the region's top-left cell (the header row, when there is one). */
  anchorRow: number;
  anchorCol: number;
  hasHeader: boolean;
  /**
   * Body cells (`"row:col"`, body coordinates) locked WITHOUT a calculation
   * engine: formula cells + date-styled cells. With an engine session,
   * formula cells unlock and only `dateLocked` + `masterLocked` remain.
   */
  locked: ReadonlySet<string>;
  /** Date-styled body cells — locked in every mode this milestone. */
  dateLocked: ReadonlySet<string>;
  /**
   * Shared-formula MASTERS — locked even with an engine, because the
   * in-place patcher refuses to replace them (their followers' `si` would
   * dangle). Followers edit freely (they simply leave the group).
   */
  masterLocked: ReadonlySet<string>;
  /** Body-cell formulas (no leading `=`), for display + engine seeding. */
  formulas: ReadonlyMap<string, string>;
  /** The full raw workbook — the calc engine seeds from ALL sheets, since
   * region formulas routinely reference cells outside the region. */
  grids: XlsxWorkbookGrids;
}

export interface IngestedSidecar {
  ingest: IngestTable;
  /** Present only for CSV/TSV. */
  csv?: CsvSourceMeta;
  /** Present only for XLSX — the address map + per-cell locks the save needs. */
  xlsx?: XlsxSourceMeta;
  /** Present when editing is unavailable, with the user-facing reason. */
  readOnlyReason?: string;
}

/** Tooltip shown on locked XLSX cells. */
export const XLSX_LOCKED_REASON =
  'Formula and date cells become editable with the calculation engine (Phase 3)';

const PARQUET_READONLY_REASON = 'Parquet sidecars are read-only';

function sniffNewline(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export async function ingestSidecarBytes(
  bytes: ArrayBuffer,
  ext: string,
  params: { sheet?: string; anchor?: string; headerRow?: boolean },
): Promise<IngestedSidecar> {
  if (ext === 'csv' || ext === 'tsv') {
    const { SIDECAR_CSV_LIMITS, parseCsv } = await import('@bendyline/squisq-formats/csv');
    // Detect the BOM from the raw bytes; TextDecoder strips it by default,
    // so the decoded string never carries it.
    const view = new Uint8Array(bytes);
    const bom = view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf;
    const text = new TextDecoder().decode(bytes);
    const firstLine = text.slice(0, text.indexOf('\n') + 1 || text.length);
    const delimiter =
      ext === 'tsv' || (firstLine.includes('\t') && !firstLine.includes(',')) ? '\t' : ',';
    const rows = parseCsv(text, delimiter, SIDECAR_CSV_LIMITS);
    const hasHeader = params.headerRow !== false && rows.length > 0;
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const headers = hasHeader
      ? [...(rows[0] ?? []), ...Array(Math.max(0, width - (rows[0]?.length ?? 0))).fill('')].map(
          (header, index) => (header === '' ? `Column ${index + 1}` : header),
        )
      : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
    const body = hasHeader ? rows.slice(1) : rows;
    return {
      ingest: {
        headers,
        cells: body.map((row) =>
          Array.from({ length: width }, (_, col) => (row[col] === '' ? null : (row[col] ?? null))),
        ),
      },
      csv: {
        delimiter,
        newline: sniffNewline(text),
        trailingNewline: text.endsWith('\n'),
        bom,
        rows,
        hasHeader,
      },
    };
  }

  if (ext === 'xlsx') {
    const { xlsxToCellGrids, gridToTables, parseCellRef } =
      await import('@bendyline/squisq-formats/xlsx');
    // Read the RAW grid once and derive both views from it: the region table
    // the grid displays, and the per-cell formula/date facts the save path's
    // lock predicate needs (xlsxToTables discards them).
    const grids = await xlsxToCellGrids(bytes, {
      ...(params.sheet !== undefined ? { sheet: params.sheet } : {}),
    });
    const bySheet = new Map(grids.sheets.map((sheet) => [sheet.name, sheet]));
    const tables = grids.sheets.flatMap((sheet) =>
      gridToTables(sheet.name, sheet.cells, sheet.merges),
    );
    const table =
      (params.anchor &&
        tables.find((t) => t.anchor.toUpperCase() === params.anchor!.toUpperCase())) ||
      tables.reduce<(typeof tables)[number] | null>(
        (best, candidate) =>
          !best ||
          candidate.rows.length * candidate.columns.length > best.rows.length * best.columns.length
            ? candidate
            : best,
        null,
      );
    if (!table) throw new Error('no tabular data found in workbook');

    const anchor = parseCellRef(table.anchor);
    const sheetGrid = bySheet.get(table.sheet);
    const locked = new Set<string>();
    const dateLocked = new Set<string>();
    const masterLocked = new Set<string>();
    const formulas = new Map<string, string>();
    let xlsxMeta: XlsxSourceMeta | undefined;
    if (anchor && sheetGrid) {
      const bodyTop = anchor.row + (table.hasHeader ? 1 : 0);
      for (let row = 0; row < table.rows.length; row++) {
        for (let col = 0; col < table.columns.length; col++) {
          const raw = sheetGrid.cells[bodyTop + row]?.[anchor.col + col];
          if (!raw) continue;
          const key = `${row}:${col}`;
          if (raw.formula !== undefined || raw.kind === 'date') locked.add(key);
          if (raw.kind === 'date') dateLocked.add(key);
          if (raw.formula !== undefined) formulas.set(key, raw.formula);
          if (raw.sharedFormulaRole === 'master') masterLocked.add(key);
        }
      }
      xlsxMeta = {
        sheet: table.sheet,
        anchorRow: anchor.row,
        anchorCol: anchor.col,
        hasHeader: table.hasHeader,
        locked,
        dateLocked,
        masterLocked,
        formulas,
        grids,
      };
    }

    return {
      ingest: {
        headers: table.columns.map((column) => column.name),
        cells: table.rows.map((row) => row.map((cell): IngestCell => cell)),
        hints: table.columns.map((column) =>
          column.kind === 'number' || column.kind === 'bool' || column.kind === 'date'
            ? { kind: column.kind === 'bool' ? 'boolean' : column.kind }
            : undefined,
        ),
      },
      ...(xlsxMeta
        ? { xlsx: xlsxMeta }
        : { readOnlyReason: 'workbook region could not be addressed for editing' }),
    };
  }

  if (ext === 'parquet') {
    const { parquetDataReader } = await import('@bendyline/squisq-formats/data');
    const table = await parquetDataReader.read(bytes, { maxRows: Number.POSITIVE_INFINITY });
    return {
      ingest: {
        headers: table.headers,
        cells: table.rows.map((row) => row.map((cell) => (cell === '' ? null : cell))),
      },
      readOnlyReason: PARQUET_READONLY_REASON,
    };
  }

  throw new Error(`unsupported data extension ".${ext}"`);
}

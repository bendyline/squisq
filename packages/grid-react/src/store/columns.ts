/**
 * Columnar ingestion: a format-neutral cell grid → typed columns the worker
 * kernel operates on. grid-react never parses files itself — the editor
 * adapter feeds an `IngestTable` built from the lazy formats readers (CSV
 * strings with a typing pass; XLSX typed `XlsxCell.value`s).
 *
 * Layout per column kind:
 *  - `number`  → `Float64Array data` + `Uint8Array valid` (an explicit blank
 *    mask — NaN-as-sentinel is rejected because a coercion bug could
 *    legitimately produce NaN, and masks make blank semantics testable)
 *  - `string`/`date` → DICTIONARY-encoded: `Int32Array codes` (−1 = blank) +
 *    `string[] dict`. Chosen because (1) the code array is transferable, so
 *    the bulk of the bytes move to the worker rather than being cloned;
 *    (2) locale-aware sort is one `rank` array over unique values instead of
 *    per-row collation; (3) `contains` lowercasing happens once per dict
 *    entry. High-cardinality columns degrade gracefully (dict length = row
 *    count — no worse than `string[]`).
 *  - `boolean` → `Uint8Array data` + `Uint8Array valid`
 *
 * Column typing follows the SHARED rule in `@bendyline/squisq/table`
 * (`isNumericCellText`: all non-blank cells numeric, no leading-zero
 * strings) so kernel results stay parity-testable against
 * `applyTableViewState`.
 */

import { isNumericCellText } from '@bendyline/squisq/table';
import type { TableColumnKind, TableCellValue } from '@bendyline/squisq/table';

/** A format-neutral cell: `null` = blank. */
export type IngestCell = TableCellValue;

export interface IngestColumnHint {
  /** Force a column kind (XLSX adapters know; CSV lets inference decide). */
  kind?: TableColumnKind;
}

export interface IngestTable {
  headers: string[];
  /** Row-major cells; ragged rows are padded with blanks. */
  cells: IngestCell[][];
  /** Optional per-column hints, index-aligned with `headers`. */
  hints?: (IngestColumnHint | undefined)[];
}

export interface NumberColumn {
  kind: 'number';
  name: string;
  data: Float64Array;
  valid: Uint8Array;
}

export interface DictColumn {
  kind: 'string' | 'date';
  name: string;
  /** Dictionary code per row; −1 = blank. */
  codes: Int32Array;
  dict: string[];
}

export interface BooleanColumn {
  kind: 'boolean';
  name: string;
  data: Uint8Array;
  valid: Uint8Array;
}

export type StoreColumn = NumberColumn | DictColumn | BooleanColumn;

export interface ColumnarTable {
  columns: StoreColumn[];
  rowCount: number;
}

function inferKind(cells: IngestCell[][], col: number): TableColumnKind {
  let sawNumber = false;
  let sawBoolean = false;
  let sawValue = false;
  for (const row of cells) {
    const cell = row[col];
    if (cell === null || cell === undefined || cell === '') continue;
    sawValue = true;
    if (typeof cell === 'number') {
      sawNumber = true;
      continue;
    }
    if (typeof cell === 'boolean') {
      sawBoolean = true;
      continue;
    }
    const text = String(cell);
    if (isNumericCellText(text)) {
      sawNumber = true;
      continue;
    }
    if (/^(?:true|false)$/i.test(text.trim())) {
      sawBoolean = true;
      continue;
    }
    return 'string';
  }
  if (!sawValue) return 'string';
  if (sawNumber && !sawBoolean) return 'number';
  if (sawBoolean && !sawNumber) return 'boolean';
  return 'string';
}

function isBlank(cell: IngestCell): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');
}

/** Build typed columns from a neutral cell grid. */
export function buildColumnarTable(table: IngestTable): ColumnarTable {
  const rowCount = table.cells.length;
  const columns: StoreColumn[] = table.headers.map((name, col) => {
    const kind = table.hints?.[col]?.kind ?? inferKind(table.cells, col);

    if (kind === 'number') {
      const data = new Float64Array(rowCount);
      const valid = new Uint8Array(rowCount);
      for (let row = 0; row < rowCount; row++) {
        const cell = table.cells[row]?.[col];
        if (isBlank(cell)) continue;
        const value = typeof cell === 'number' ? cell : Number(String(cell).trim());
        if (!Number.isFinite(value)) continue; // stray non-numeric under a hint: blank
        data[row] = value;
        valid[row] = 1;
      }
      return { kind, name, data, valid };
    }

    if (kind === 'boolean') {
      const data = new Uint8Array(rowCount);
      const valid = new Uint8Array(rowCount);
      for (let row = 0; row < rowCount; row++) {
        const cell = table.cells[row]?.[col];
        if (isBlank(cell)) continue;
        const truthy = typeof cell === 'boolean' ? cell : /^true$/i.test(String(cell).trim());
        data[row] = truthy ? 1 : 0;
        valid[row] = 1;
      }
      return { kind, name, data, valid };
    }

    const codes = new Int32Array(rowCount);
    const dict: string[] = [];
    const codeByValue = new Map<string, number>();
    for (let row = 0; row < rowCount; row++) {
      const cell = table.cells[row]?.[col];
      if (isBlank(cell)) {
        codes[row] = -1;
        continue;
      }
      const text = typeof cell === 'string' ? cell : String(cell);
      let code = codeByValue.get(text);
      if (code === undefined) {
        code = dict.length;
        dict.push(text);
        codeByValue.set(text, code);
      }
      codes[row] = code;
    }
    return { kind, name, codes, dict };
  });

  return { columns, rowCount };
}

/** Read one cell back out of typed columns (`null` = blank). */
export function columnCellValue(column: StoreColumn, row: number): TableCellValue {
  if (column.kind === 'number') {
    return column.valid[row] ? column.data[row]! : null;
  }
  if (column.kind === 'boolean') {
    return column.valid[row] ? column.data[row] === 1 : null;
  }
  const code = column.codes[row]!;
  return code < 0 ? null : column.dict[code]!;
}

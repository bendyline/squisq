/**
 * TableQueryProvider — the async, worker-ready contract a data grid renders
 * against and a query backend implements. The default implementation is the
 * in-house columnar worker store in `@bendyline/squisq-grid-react`; heavier
 * backends (SQL engines, remote services) implement the same surface later.
 *
 * Design constraints baked in:
 *  - Everything is async: the reference backend lives in a Web Worker, and
 *    retrofitting async under a sync grid API is painful — so the contract
 *    is async from day one and renderers use windowed prefetch.
 *  - View state (sort/filter) is provider-side: the renderer never holds
 *    more than a window of rows, so ordering/filtering must happen where
 *    the full dataset lives.
 *  - Row identity is the immutable SOURCE row index (`rowId`), assigned at
 *    ingest — stable under any permutation and unaffected by edits changing
 *    sort keys.
 */

import type { TableViewState, ViewIssue } from './viewState.js';

export type TableColumnKind = 'number' | 'string' | 'date' | 'boolean';

export interface TableColumnSchema {
  name: string;
  kind: TableColumnKind;
}

export interface TableSchema {
  columns: TableColumnSchema[];
  /** Total data rows in the source (before any filter). */
  rowCount: number;
}

/** A cell value as providers exchange it. `null` = blank. */
export type TableCellValue = string | number | boolean | null;

export interface TableRowsPage {
  /** View-coordinate index of the first returned row. */
  start: number;
  /** Source row id per returned row (edit/selection identity). */
  rowIds: number[];
  /** Raw values; formatting is the renderer's job. */
  cells: TableCellValue[][];
}

export interface TableViewResult {
  /** Row count AFTER the active filter (the virtualizer's row count). */
  viewRowCount: number;
  issues: ViewIssue[];
}

export interface TableCellEdit {
  rowId: number;
  col: number;
  value: TableCellValue;
}

export interface TableEditResult {
  /**
   * True when an edited cell touched an active sort/filter column — the
   * current permutation may be outdated. Providers NEVER auto re-sort on
   * edit (a row teleporting out from under the caret is hostile); the
   * renderer offers an explicit refresh.
   */
  staleView: boolean;
}

/** Result of a {@link TableQueryProvider.distinct} sweep over one column. */
export interface TableDistinctResult {
  /**
   * Distinct non-blank values as display text, sorted (numerically for
   * numeric columns, collated otherwise), capped at the requested limit.
   */
  values: string[];
  /** Total distinct non-blank values in the column (may exceed `values`). */
  totalDistinct: number;
  /** Whether any cell in the column is blank. */
  hasBlank: boolean;
}

export interface TableQueryProvider {
  describe(): Promise<TableSchema>;
  /** Apply a view; subsequent `rows()` windows are in view coordinates. */
  setView(view: TableViewState): Promise<TableViewResult>;
  rows(start: number, count: number): Promise<TableRowsPage>;
  /** Optional: providers without write support omit it (read-only grid). */
  applyEdits?(edits: TableCellEdit[]): Promise<TableEditResult>;
  /**
   * Optional: distinct values of one column over the FULL source (not the
   * filtered view), for value-picker UIs. Cheap for the columnar store —
   * string columns are dictionary-encoded — so renderers feature-detect
   * this rather than aggregating rows themselves.
   */
  distinct?(col: number, limit: number): Promise<TableDistinctResult>;
  dispose(): void;
}

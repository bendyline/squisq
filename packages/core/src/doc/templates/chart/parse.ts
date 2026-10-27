/**
 * Numeric parsing + column-role resolution for the chart engine.
 *
 * Table cells arrive as plain strings (the markdown table projection).
 * The parser is tolerant of the formatting people actually put in tables
 * — currency symbols, thousands separators, percent signs, accounting
 * negatives — but never invents data: a cell that doesn't parse is
 * `null` (a gap), not zero.
 *
 * Blocks authored as JSON (typed `headers`/`rows` rather than a markdown
 * table) naturally carry numbers — `["Birds", 216]`. `normalizeChartTable`
 * stringifies every cell where the table enters the engine, so those plot
 * like their markdown equivalents instead of throwing.
 */

import type { ChartData, ChartTableData } from './types.js';

/** Share of non-empty cells that must parse for a column to count as numeric. */
const NUMERIC_COLUMN_THRESHOLD = 0.6;

function cellText(cell: unknown): string {
  if (typeof cell === 'string') return cell;
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  return typeof cell === 'object' ? '' : String(cell);
}

/**
 * Coerce a typed table to the all-string shape the engine parses: numeric
 * and boolean cells become their text, missing/null/object cells become
 * empty, and non-array rows are dropped.
 */
export function normalizeChartTable(table: { headers?: unknown; rows?: unknown }): ChartTableData {
  const headers = Array.isArray(table.headers) ? table.headers.map(cellText) : [];
  const rows = Array.isArray(table.rows)
    ? table.rows.filter(Array.isArray).map((row: unknown[]) => row.map(cellText))
    : [];
  return { headers, rows };
}

/**
 * Parse one table cell to a number, or null when it isn't numeric.
 *
 * Handles: `$1,234.56`, `45%`, `(300)` (accounting negative), `1 234`
 * (thin-space grouping), leading `+`/`-`. Placeholder cells (`—`, `N/A`,
 * empty) and mixed text (`12 units`) return null. K/M/B suffixes are
 * deliberately not parsed — "5m" is ambiguous between millions and metres.
 */
export function parseCellNumber(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (!text) return null;

  // Accounting negative: (1,234) → -1234
  let negative = false;
  const accounting = /^\((.*)\)$/.exec(text);
  if (accounting) {
    negative = true;
    text = accounting[1].trim();
  }

  // Leading currency symbols and trailing percent sign are formatting, not data.
  text = text.replace(/^([+-]?)\s*[$€£¥]\s*/, '$1');
  text = text.replace(/%$/, '').trim();

  // Thousands separators: commas, and spaces used as digit grouping.
  text = text.replace(/,/g, '');
  if (/^[+-]?\d{1,3}(?: \d{3})+(?:\.\d+)?$/.test(text)) {
    text = text.replace(/ /g, '');
  }

  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Whether a column holds mostly numeric data (≥60% of non-empty cells parse). */
export function isNumericColumn(rows: string[][], colIndex: number): boolean {
  let nonEmpty = 0;
  let numeric = 0;
  for (const row of rows) {
    const cell = (row[colIndex] ?? '').trim();
    if (!cell) continue;
    nonEmpty += 1;
    if (parseCellNumber(cell) !== null) numeric += 1;
  }
  return numeric > 0 && numeric / Math.max(1, nonEmpty) >= NUMERIC_COLUMN_THRESHOLD;
}

/**
 * Resolve a column reference — a header name (case-insensitive) or a
 * 0-based index — to a column index, or null when it matches nothing.
 */
export function resolveColumnRef(ref: string, headers: string[]): number | null {
  const text = String(ref).trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const byName = headers.findIndex((h) => h.trim().toLowerCase() === lower);
  if (byName >= 0) return byName;
  if (/^\d+$/.test(text)) {
    const index = Number(text);
    if (index < headers.length) return index;
  }
  return null;
}

/**
 * Map a string table + column-role options to plottable data.
 *
 * Label column defaults to the first column; value columns default to
 * every numeric column that isn't the label column. Returns null when no
 * value column resolves — the "table exists but isn't chartable" case,
 * which callers treat the same as having no table at all.
 */
export function buildChartData(
  table: ChartTableData,
  options: { labelColumn?: string; valueColumns?: string[] } = {},
): ChartData | null {
  const { headers, rows } = normalizeChartTable(table);
  if (headers.length === 0 || rows.length === 0) return null;

  const warnings: string[] = [];

  let labelIndex = 0;
  if (options.labelColumn !== undefined && String(options.labelColumn).trim() !== '') {
    const resolved = resolveColumnRef(String(options.labelColumn), headers);
    if (resolved === null) {
      warnings.push(
        `labelColumn "${options.labelColumn}" matches no column; using the first column`,
      );
    } else {
      labelIndex = resolved;
    }
  }

  let valueIndexes: number[] = [];
  const requested = (options.valueColumns ?? [])
    .map((ref) => String(ref))
    .filter((ref) => ref.trim() !== '');
  if (requested.length > 0) {
    for (const ref of requested) {
      const resolved = resolveColumnRef(ref, headers);
      if (resolved === null) {
        warnings.push(`valueColumns entry "${ref}" matches no column; skipped`);
      } else if (!valueIndexes.includes(resolved)) {
        valueIndexes.push(resolved);
      }
    }
  } else {
    valueIndexes = headers
      .map((_, index) => index)
      .filter((index) => index !== labelIndex && isNumericColumn(rows, index));
  }

  if (valueIndexes.length === 0) return null;

  return {
    labels: rows.map((row) => (row[labelIndex] ?? '').trim()),
    labelHeader: headers[labelIndex] ?? '',
    labelNumbers: rows.map((row) => parseCellNumber(row[labelIndex] ?? '')),
    series: valueIndexes.map((index) => ({
      name: (headers[index] ?? `Column ${index + 1}`).trim() || `Column ${index + 1}`,
      values: rows.map((row) => parseCellNumber(row[index] ?? '')),
    })),
    warnings,
  };
}

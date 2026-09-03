/**
 * Reference implementation of table view state over a plain string matrix —
 * the semantics contract the grid's worker kernel is parity-tested against,
 * and what the sidecar data readers apply before windowing so previews and
 * exports show the author's curated view.
 *
 * Semantics:
 *  - filter first (AND conjunction), then a STABLE multi-term sort;
 *  - a column is numeric per `inferNumericColumn` (all non-blank cells
 *    numeric, no leading-zero strings) — numeric columns compare by value,
 *    everything else via the shared collator (`numeric: true`, so "v2" <
 *    "v10" in text columns too);
 *  - blank cells sort LAST regardless of direction (Excel behavior) and
 *    match only `= ''` / `!=` filters;
 *  - text-matching ops (`= != ~ !~ ^~ $~`) are case-INSENSITIVE by default
 *    (Excel AutoFilter semantics); `clause.caseSensitive` (`*` in the
 *    grammar) makes them exact-case. Numeric equality is unaffected.
 */

import {
  type FilterClause,
  type TableViewState,
  inferNumericColumn,
  isEmptyViewState,
  isNumericCellText,
  makeTableCollator,
} from './viewState.js';

export interface AppliedTableView {
  /** Filtered + sorted rows (the same row arrays, re-ordered — not copies). */
  rows: string[][];
  /** Source-row index (0-based, header excluded) per output row. */
  rowIds: number[];
  /** Row count before filtering (equals `rows.length` with no filter). */
  unfilteredRowCount: number;
}

function matchesClause(
  cell: string,
  clause: FilterClause,
  numericColumn: boolean,
  collator: Intl.Collator,
): boolean {
  const cellTrim = cell.trim();
  const valueTrim = clause.value.trim();
  const blank = cellTrim === '';
  // Text ops fold case unless the clause is `*`-marked case-sensitive.
  const fold = (text: string): string => (clause.caseSensitive ? text : text.toLowerCase());

  switch (clause.op) {
    case '=':
      if (valueTrim === '') return blank;
      if (blank) return false;
      if (numericColumn && isNumericCellText(valueTrim)) {
        return Number(cellTrim) === Number(valueTrim);
      }
      return fold(cellTrim) === fold(valueTrim);
    case '!=':
      return !matchesClause(cell, { ...clause, op: '=' }, numericColumn, collator);
    case '~':
      return !blank && fold(cellTrim).includes(fold(valueTrim));
    case '!~':
      return !matchesClause(cell, { ...clause, op: '~' }, numericColumn, collator);
    case '^~':
      return !blank && fold(cellTrim).startsWith(fold(valueTrim));
    case '$~':
      return !blank && fold(cellTrim).endsWith(fold(valueTrim));
    case '>':
    case '<':
    case '>=':
    case '<=': {
      if (blank) return false;
      let comparison: number;
      if (numericColumn && isNumericCellText(valueTrim)) {
        comparison = Number(cellTrim) - Number(valueTrim);
      } else {
        comparison = collator.compare(cellTrim, valueTrim);
      }
      if (clause.op === '>') return comparison > 0;
      if (clause.op === '<') return comparison < 0;
      if (clause.op === '>=') return comparison >= 0;
      return comparison <= 0;
    }
  }
}

/**
 * Apply `view` to `rows`. Row identity is positional: `rowIds[i]` is the
 * index of output row `i` in the input `rows`.
 */
export function applyTableViewState(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  view: TableViewState,
): AppliedTableView {
  const asMutable = rows as string[][];
  if (isEmptyViewState(view)) {
    return {
      rows: [...asMutable],
      rowIds: rows.map((_, index) => index),
      unfilteredRowCount: rows.length,
    };
  }

  const collator = makeTableCollator();
  const columnIndex = new Map(headers.map((header, index) => [header, index] as const));
  const numericByCol = new Map<number, boolean>();
  const numericFor = (col: number): boolean => {
    let cached = numericByCol.get(col);
    if (cached === undefined) {
      cached = inferNumericColumn(rows, col);
      numericByCol.set(col, cached);
    }
    return cached;
  };

  // Filter first.
  const clauses = view.filter
    .map((clause) => ({ clause, col: columnIndex.get(clause.column) }))
    .filter((entry): entry is { clause: FilterClause; col: number } => entry.col !== undefined);

  let rowIds: number[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    let pass = true;
    for (const { clause, col } of clauses) {
      if (!matchesClause(row[col] ?? '', clause, numericFor(col), collator)) {
        pass = false;
        break;
      }
    }
    if (pass) rowIds.push(index);
  }

  // Stable multi-term sort with an explicit source-index tie-break — makes
  // stability a tested property rather than an engine property.
  const terms = view.sort
    .map((term) => ({ term, col: columnIndex.get(term.column) }))
    .filter(
      (entry): entry is { term: (typeof view.sort)[number]; col: number } =>
        entry.col !== undefined,
    );

  if (terms.length > 0) {
    for (const { col } of terms) numericFor(col);
    rowIds = [...rowIds].sort((a, b) => {
      for (const { term, col } of terms) {
        const left = (rows[a]![col] ?? '').trim();
        const right = (rows[b]![col] ?? '').trim();
        const leftBlank = left === '';
        const rightBlank = right === '';
        if (leftBlank || rightBlank) {
          if (leftBlank && rightBlank) continue;
          return leftBlank ? 1 : -1; // blanks last, direction-independent
        }
        const comparison = numericByCol.get(col)
          ? Number(left) - Number(right)
          : collator.compare(left, right);
        if (comparison !== 0) return term.dir === 'desc' ? -comparison : comparison;
      }
      return a - b;
    });
  }

  return {
    rows: rowIds.map((id) => asMutable[id]!),
    rowIds,
    unfilteredRowCount: rows.length,
  };
}

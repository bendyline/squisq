/**
 * The lookup family — where corpus accuracy actually lives (INDEX and
 * MATCH alone are 83% of real-world oracle formulas).
 *
 * Semantics encoded:
 *  - MATCH/VLOOKUP type coherence: a numeric lookup never matches a text
 *    cell and vice versa; blank cells never match anything.
 *  - MATCH match_type 1 (default) = LAST value ≤ lookup (ascending
 *    assumption); -1 = last value ≥ lookup scanning until the first
 *    smaller (descending assumption); 0 = first exact, with `*`/`?`
 *    wildcards for text.
 *  - INDEX bounds-check against the LOGICAL range size (a blank cell
 *    inside the range is a legal blank result, not #REF!), and row/col 0
 *    means "the whole row/column" — returned as a range so implicit
 *    intersection or an aggregate can consume it.
 *  - INDEX/OFFSET return RANGES (reference semantics), so `SUM(OFFSET(…))`
 *    and `A1:INDEX(…)`-style consumers keep working where supported.
 */

import { NA, REF_ERROR, VALUE_ERROR, isCalcError } from '../errors.js';
import { compareValues, hasWildcard, wildcardToRegExp } from '../coerce.js';
import {
  RangeView,
  isRangeView,
  toScalar,
  type CalcFunctionDef,
  type EvalContext,
} from '../evaluate.js';
import { parseFormula } from '../parser.js';
import type { CalcValue } from '../types.js';
import {
  argNumber,
  argRange,
  argScalar,
  argText,
  effectiveVectorLength,
  isMissing,
  vectorOf,
} from './helpers.js';

type Def = CalcFunctionDef;

function sameType(a: CalcValue, b: CalcValue): boolean {
  return typeof a === typeof b;
}

function exactMatches(cell: CalcValue, lookup: CalcValue, wildcard: RegExp | null): boolean {
  if (cell === null || isCalcError(cell)) return false;
  if (wildcard && typeof cell === 'string') return wildcard.test(cell);
  if (!sameType(cell, lookup)) return false;
  return compareValues(cell, lookup) === 0;
}

/** Core MATCH scan over a vector accessor. Returns 0-based index or -1. */
function matchScan(
  length: number,
  get: (i: number) => CalcValue,
  lookup: CalcValue,
  matchType: number,
  ctx: EvalContext,
): number {
  ctx.budget.charge(length);
  const wildcard =
    matchType === 0 && typeof lookup === 'string' && (hasWildcard(lookup) || lookup.includes('~'))
      ? wildcardToRegExp(lookup)
      : null;

  if (matchType === 0) {
    for (let i = 0; i < length; i++) {
      if (exactMatches(get(i), lookup, wildcard)) return i;
    }
    return -1;
  }

  if (matchType > 0) {
    // Last value ≤ lookup among same-type cells (ascending assumption).
    let best = -1;
    for (let i = 0; i < length; i++) {
      const cell = get(i);
      if (cell === null || isCalcError(cell) || !sameType(cell, lookup)) continue;
      const cmp = compareValues(cell, lookup);
      if (!isCalcError(cmp) && cmp <= 0) best = i;
    }
    return best;
  }

  // matchType < 0: values assumed descending; last value ≥ lookup before
  // the first smaller one.
  let best = -1;
  for (let i = 0; i < length; i++) {
    const cell = get(i);
    if (cell === null || isCalcError(cell) || !sameType(cell, lookup)) continue;
    const cmp = compareValues(cell, lookup);
    if (isCalcError(cmp)) continue;
    if (cmp >= 0) best = i;
    else break;
  }
  return best;
}

export const lookupFunctions: Record<string, Def> = {
  MATCH: {
    minArgs: 2,
    maxArgs: 3,
    fn: (args, ctx) => {
      const lookup = argScalar(args[0]!, ctx);
      if (isCalcError(lookup)) return lookup;
      const view = argRange(args[1]!, ctx);
      if (isCalcError(view)) return view;
      const vector = vectorOf(view);
      if (!vector) return NA;
      const matchType = isMissing(args[2]) ? 1 : argNumber(args[2]!, ctx);
      if (isCalcError(matchType)) return matchType;
      const length = effectiveVectorLength(view);
      const index = matchScan(length, vector.get, lookup, Math.sign(matchType), ctx);
      return index < 0 ? NA : index + 1;
    },
  },

  INDEX: {
    minArgs: 2,
    maxArgs: 4,
    fn: (args, ctx) => {
      const view = argRange(args[0]!, ctx);
      if (isCalcError(view)) return view;

      const rowArg = isMissing(args[1]) ? null : argNumber(args[1]!, ctx);
      if (rowArg !== null && isCalcError(rowArg)) return rowArg;
      const colArg = args.length < 3 || isMissing(args[2]) ? null : argNumber(args[2]!, ctx);
      if (colArg !== null && isCalcError(colArg)) return colArg;
      // 4th arg (area number) accepted but only single-area refs exist here.

      let row = rowArg === null ? null : Math.trunc(rowArg);
      let col = colArg === null ? null : Math.trunc(colArg);

      // One-argument addressing follows the range's shape: INDEX(col, n)
      // walks rows, INDEX(row, n) walks columns.
      if (col === null) {
        if (view.rows === 1 && view.cols !== 1 && row !== null) {
          col = row;
          row = 1;
        } else {
          col = view.cols === 1 ? 1 : null;
        }
      }
      if (row === null) row = view.rows === 1 ? 1 : 0;
      if (col === null) col = 0;

      if (row < 0 || col < 0 || row > view.rows || col > view.cols) return REF_ERROR;

      if (row === 0 && col === 0) return view;
      if (row === 0) {
        return new RangeView(
          ctx,
          view.sheet,
          view.startRow,
          view.startCol + col - 1,
          view.endRow,
          view.startCol + col - 1,
        );
      }
      if (col === 0) {
        return new RangeView(
          ctx,
          view.sheet,
          view.startRow + row - 1,
          view.startCol,
          view.startRow + row - 1,
          view.endCol,
        );
      }
      return new RangeView(
        ctx,
        view.sheet,
        view.startRow + row - 1,
        view.startCol + col - 1,
        view.startRow + row - 1,
        view.startCol + col - 1,
      );
    },
  },

  VLOOKUP: {
    minArgs: 3,
    maxArgs: 4,
    fn: (args, ctx) => {
      const lookup = argScalar(args[0]!, ctx);
      if (isCalcError(lookup)) return lookup;
      const view = argRange(args[1]!, ctx);
      if (isCalcError(view)) return view;
      const colIndex = argNumber(args[2]!, ctx);
      if (isCalcError(colIndex)) return colIndex;
      const col = Math.trunc(colIndex);
      if (col < 1) return VALUE_ERROR;
      if (col > view.cols) return REF_ERROR;
      const approximate = isMissing(args[3]) ? true : argScalar(args[3]!, ctx) !== false;
      const length = view.effectiveRows;
      const index = matchScan(length, (i) => view.get(i, 0), lookup, approximate ? 1 : 0, ctx);
      return index < 0 ? NA : view.get(index, col - 1);
    },
  },

  HLOOKUP: {
    minArgs: 3,
    maxArgs: 4,
    fn: (args, ctx) => {
      const lookup = argScalar(args[0]!, ctx);
      if (isCalcError(lookup)) return lookup;
      const view = argRange(args[1]!, ctx);
      if (isCalcError(view)) return view;
      const rowIndex = argNumber(args[2]!, ctx);
      if (isCalcError(rowIndex)) return rowIndex;
      const row = Math.trunc(rowIndex);
      if (row < 1) return VALUE_ERROR;
      if (row > view.rows) return REF_ERROR;
      const approximate = isMissing(args[3]) ? true : argScalar(args[3]!, ctx) !== false;
      const length = view.effectiveCols;
      const index = matchScan(length, (i) => view.get(0, i), lookup, approximate ? 1 : 0, ctx);
      return index < 0 ? NA : view.get(row - 1, index);
    },
  },

  LOOKUP: {
    minArgs: 2,
    maxArgs: 3,
    fn: (args, ctx) => {
      const lookup = argScalar(args[0]!, ctx);
      if (isCalcError(lookup)) return lookup;
      const view = argRange(args[1]!, ctx);
      if (isCalcError(view)) return view;
      const vector = vectorOf(view);
      if (!vector) return NA; // array form not supported
      const index = matchScan(effectiveVectorLength(view), vector.get, lookup, 1, ctx);
      if (index < 0) return NA;
      if (isMissing(args[2])) return vector.get(index);
      const resultView = argRange(args[2]!, ctx);
      if (isCalcError(resultView)) return resultView;
      const resultVector = vectorOf(resultView);
      if (!resultVector) return NA;
      return resultVector.get(index);
    },
  },

  XLOOKUP: {
    minArgs: 3,
    maxArgs: 6,
    fn: (args, ctx) => {
      const lookup = argScalar(args[0]!, ctx);
      if (isCalcError(lookup)) return lookup;
      const lookupView = argRange(args[1]!, ctx);
      if (isCalcError(lookupView)) return lookupView;
      const returnView = argRange(args[2]!, ctx);
      if (isCalcError(returnView)) return returnView;
      const lookupVector = vectorOf(lookupView);
      const returnVector = vectorOf(returnView);
      if (!lookupVector || !returnVector) return VALUE_ERROR;
      const matchMode = args.length > 4 && !isMissing(args[4]) ? argNumber(args[4]!, ctx) : 0;
      if (isCalcError(matchMode)) return matchMode;

      const length = effectiveVectorLength(lookupView);
      let index = -1;
      if (matchMode === 2) {
        const wildcard = typeof lookup === 'string' ? wildcardToRegExp(lookup) : null;
        ctx.budget.charge(length);
        for (let i = 0; i < length; i++) {
          if (exactMatches(lookupVector.get(i), lookup, wildcard)) {
            index = i;
            break;
          }
        }
      } else if (matchMode === 0) {
        index = matchScan(length, lookupVector.get, lookup, 0, ctx);
      } else {
        // -1: exact or next smaller; 1: exact or next larger. "Next" is by
        // VALUE, so the best candidate is tracked by comparing candidates
        // against each other, not by the sign of one comparison.
        ctx.budget.charge(length);
        let best: CalcValue = null;
        for (let i = 0; i < length; i++) {
          const cell = lookupVector.get(i);
          if (cell === null || isCalcError(cell) || !sameType(cell, lookup)) continue;
          const cmp = compareValues(cell, lookup);
          if (isCalcError(cmp)) continue;
          if (cmp === 0) {
            index = i;
            break;
          }
          const eligible = matchMode < 0 ? cmp < 0 : cmp > 0;
          if (!eligible) continue;
          const better =
            best === null ||
            (matchMode < 0 ? compareValues(cell, best) === 1 : compareValues(cell, best) === -1);
          if (better) {
            best = cell;
            index = i;
          }
        }
      }

      if (index < 0) {
        return args.length > 3 && !isMissing(args[3]) ? argScalar(args[3]!, ctx) : NA;
      }
      return returnVector.get(index);
    },
  },

  CHOOSE: {
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      const index = argNumber(args[0]!, ctx);
      if (isCalcError(index)) return index;
      const k = Math.trunc(index);
      if (k < 1 || k >= args.length) return VALUE_ERROR;
      return ctx.evaluate(args[k]!);
    },
  },

  OFFSET: {
    minArgs: 3,
    maxArgs: 5,
    volatile: true,
    fn: (args, ctx) => {
      const base = argRange(args[0]!, ctx);
      if (isCalcError(base)) return base;
      const rows = argNumber(args[1]!, ctx);
      if (isCalcError(rows)) return rows;
      const cols = argNumber(args[2]!, ctx);
      if (isCalcError(cols)) return cols;
      const height = isMissing(args[3]) ? base.rows : argNumber(args[3]!, ctx);
      if (isCalcError(height)) return height;
      const width = isMissing(args[4]) ? base.cols : argNumber(args[4]!, ctx);
      if (isCalcError(width)) return width;
      if (height < 1 || width < 1) return REF_ERROR;
      const startRow = base.startRow + Math.trunc(rows);
      const startCol = base.startCol + Math.trunc(cols);
      if (startRow < 0 || startCol < 0) return REF_ERROR;
      return new RangeView(
        ctx,
        base.sheet,
        startRow,
        startCol,
        startRow + Math.trunc(height) - 1,
        startCol + Math.trunc(width) - 1,
      );
    },
  },

  INDIRECT: {
    minArgs: 1,
    maxArgs: 2,
    volatile: true,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      // R1C1 mode (2nd arg FALSE) is not supported.
      if (!isMissing(args[1])) {
        const a1Mode = argScalar(args[1]!, ctx);
        if (a1Mode === false) return REF_ERROR;
      }
      let parsed;
      try {
        parsed = parseFormula(text);
      } catch {
        return REF_ERROR;
      }
      if (parsed.type !== 'ref' && parsed.type !== 'range') return REF_ERROR;
      const result = ctx.evaluate(parsed);
      return isRangeView(result) || isCalcError(result) ? result : REF_ERROR;
    },
  },

  ROW: {
    minArgs: 0,
    maxArgs: 1,
    fn: (args, ctx) => {
      if (args.length === 0 || isMissing(args[0])) return ctx.currentRow + 1;
      const view = argRange(args[0]!, ctx);
      if (isCalcError(view)) return view;
      return view.startRow + 1;
    },
  },
  COLUMN: {
    minArgs: 0,
    maxArgs: 1,
    fn: (args, ctx) => {
      if (args.length === 0 || isMissing(args[0])) return ctx.currentCol + 1;
      const view = argRange(args[0]!, ctx);
      if (isCalcError(view)) return view;
      return view.startCol + 1;
    },
  },
  ROWS: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const view = argRange(args[0]!, ctx);
      return isCalcError(view) ? view : view.rows;
    },
  },
  COLUMNS: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const view = argRange(args[0]!, ctx);
      return isCalcError(view) ? view : view.cols;
    },
  },

  HYPERLINK: {
    minArgs: 1,
    maxArgs: 2,
    fn: (args, ctx) => {
      // The cell VALUE is the friendly name (or the link itself) — the
      // link behavior is presentation, not calculation.
      if (args.length > 1 && !isMissing(args[1])) return argScalar(args[1]!, ctx);
      return argScalar(args[0]!, ctx);
    },
  },
};

/** Used by evaluate.ts for scalar collapse — re-exported for tests. */
export { toScalar };

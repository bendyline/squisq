/**
 * Argument plumbing shared by every function family — including the Excel
 * subtlety most reimplementations miss: aggregation functions treat DIRECT
 * arguments differently from RANGE CONTENTS. `SUM("3", TRUE)` is 4
 * (direct scalars coerce), but a range cell holding `"3"` or `TRUE`
 * contributes nothing. `visitAggregate` threads that distinction through.
 */

import type { Expr } from '../ast.js';
import { toLogical, toNumber, toText } from '../coerce.js';
import { NA, VALUE_ERROR, isCalcError } from '../errors.js';
import {
  isRangeView,
  toScalar,
  type EvalContext,
  type EvalResult,
  type RangeView,
} from '../evaluate.js';
import type { CalcErrorValue, CalcValue } from '../types.js';

export const isMissing = (node: Expr | undefined): boolean =>
  node === undefined || node.type === 'missing';

export function argResult(node: Expr, ctx: EvalContext): EvalResult {
  return ctx.evaluate(node);
}

export function argScalar(node: Expr, ctx: EvalContext): CalcValue {
  return toScalar(ctx.evaluate(node), ctx);
}

export function argNumber(node: Expr, ctx: EvalContext): number | CalcErrorValue {
  return toNumber(argScalar(node, ctx));
}

export function argText(node: Expr, ctx: EvalContext): string | CalcErrorValue {
  return toText(argScalar(node, ctx));
}

export function argLogical(node: Expr, ctx: EvalContext): boolean | CalcErrorValue {
  return toLogical(argScalar(node, ctx));
}

/** A range-shaped argument: reference/range or single value as 1×1-like. */
export function argRange(node: Expr, ctx: EvalContext): RangeView | CalcErrorValue {
  const result = ctx.evaluate(node);
  if (isRangeView(result)) return result;
  if (isCalcError(result)) return result;
  return VALUE_ERROR;
}

export interface AggVisit {
  value: CalcValue;
  /** True when the value came out of a range/array, not a direct argument. */
  viaRange: boolean;
}

/**
 * Walk every value an aggregate sees, in argument order. Errors inside
 * ranges are DELIVERED (the caller decides; SUM propagates, COUNT skips…).
 */
export function visitAggregate(
  args: Expr[],
  ctx: EvalContext,
  visit: (item: AggVisit) => void,
): void {
  for (const node of args) {
    if (isMissing(node)) continue;
    if (node.type === 'array') {
      for (const row of node.rows) {
        for (const cellNode of row) {
          visit({ value: toScalar(ctx.evaluate(cellNode), ctx), viaRange: true });
        }
      }
      continue;
    }
    const result = ctx.evaluate(node);
    if (isRangeView(result)) {
      result.forEach((value) => visit({ value, viaRange: true }));
    } else {
      visit({ value: result, viaRange: false });
    }
  }
}

/**
 * The numbers an arithmetic aggregate (SUM/AVERAGE/MIN/MAX/…) consumes:
 * range text/logicals/blanks skipped, direct scalars coerced, any error
 * propagated.
 */
export function collectAggregateNumbers(args: Expr[], ctx: EvalContext): number[] | CalcErrorValue {
  const out: number[] = [];
  let error: CalcErrorValue | null = null;
  visitAggregate(args, ctx, ({ value, viaRange }) => {
    if (error) return;
    if (isCalcError(value)) {
      error = value;
      return;
    }
    if (value === null) return;
    if (viaRange) {
      if (typeof value === 'number') out.push(value);
      return;
    }
    const coerced = toNumber(value);
    if (isCalcError(coerced)) {
      error = coerced;
      return;
    }
    out.push(coerced);
  });
  return error ?? out;
}

/** 1-D view of a range (row OR column vector) as positioned values. */
export function vectorOf(view: RangeView): { length: number; get(i: number): CalcValue } | null {
  if (view.cols === 1) {
    return { length: view.rows, get: (i) => view.get(i, 0) };
  }
  if (view.rows === 1) {
    return { length: view.cols, get: (i) => view.get(0, i) };
  }
  return null;
}

/** Effective (used-extent-clamped) length of a vector view. */
export function effectiveVectorLength(view: RangeView): number {
  return view.cols === 1 ? view.effectiveRows : view.effectiveCols;
}

export { NA, VALUE_ERROR };

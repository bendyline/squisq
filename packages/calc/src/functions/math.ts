/** Math + statistical aggregates, SUBTOTAL, and the criteria family. */

import type { Expr } from '../ast.js';
import { buildCriteria } from '../coerce.js';
import { DIV0, NUM_ERROR, VALUE_ERROR, isCalcError } from '../errors.js';
import type { CalcFunctionDef, EvalContext, EvalResult } from '../evaluate.js';
import type { CalcErrorValue, CalcValue } from '../types.js';
import {
  argNumber,
  argRange,
  argScalar,
  collectAggregateNumbers,
  isMissing,
  visitAggregate,
} from './helpers.js';

type Def = CalcFunctionDef;

const num = (
  fn: (x: number) => number | CalcErrorValue,
): ((args: Expr[], ctx: EvalContext) => EvalResult) => {
  return (args, ctx) => {
    const x = argNumber(args[0]!, ctx);
    if (isCalcError(x)) return x;
    const result = fn(x);
    if (isCalcError(result)) return result;
    return Number.isFinite(result) ? result : NUM_ERROR;
  };
};

function sumOf(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function variance(values: number[], population: boolean): number | CalcErrorValue {
  const n = values.length;
  if (n < (population ? 1 : 2)) return DIV0;
  const mean = sumOf(values) / n;
  let acc = 0;
  for (const value of values) acc += (value - mean) * (value - mean);
  return acc / (population ? n : n - 1);
}

const aggregate = (
  reduce: (values: number[]) => number | CalcErrorValue,
): ((args: Expr[], ctx: EvalContext) => EvalResult) => {
  return (args, ctx) => {
    const values = collectAggregateNumbers(args, ctx);
    if (isCalcError(values)) return values;
    return reduce(values);
  };
};

function excelRound(value: number, digits: number, mode: 'half' | 'up' | 'down'): number {
  const factor = Math.pow(10, Math.trunc(digits));
  const scaled = value * factor;
  // Excel rounds half AWAY from zero, not banker's.
  let rounded: number;
  if (mode === 'half') {
    rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
  } else if (mode === 'up') {
    rounded = Math.sign(scaled) * Math.ceil(Math.abs(scaled) - Number.EPSILON * Math.abs(scaled));
  } else {
    rounded = Math.trunc(scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled));
  }
  return rounded / factor;
}

function countIf(rangeNode: Expr, criterionNode: Expr, ctx: EvalContext): number | CalcErrorValue {
  const view = argRange(rangeNode, ctx);
  if (isCalcError(view)) return view;
  const matches = buildCriteria(argScalar(criterionNode, ctx));
  let count = 0;
  view.forEach((value) => {
    if (matches(value)) count++;
  });
  return count;
}

/** The SUBTOTAL function_num table (10x-codes ignore manual-hide — no such concept here). */
// Codes 2 (COUNT) and 3 (COUNTA) are handled inline in SUBTOTAL — they
// count by type and cannot use the numeric collector.
const SUBTOTAL_OPS: Readonly<Record<number, (values: number[]) => number | CalcErrorValue>> = {
  1: (v) => (v.length === 0 ? DIV0 : sumOf(v) / v.length),
  4: (v) => (v.length === 0 ? 0 : Math.max(...v)),
  5: (v) => (v.length === 0 ? 0 : Math.min(...v)),
  6: (v) => v.reduce((a, b) => a * b, 1),
  7: (v) => {
    const variance7 = variance(v, false);
    return isCalcError(variance7) ? variance7 : Math.sqrt(variance7);
  },
  8: (v) => {
    const variance8 = variance(v, true);
    return isCalcError(variance8) ? variance8 : Math.sqrt(variance8);
  },
  9: sumOf,
  10: (v) => variance(v, false),
  11: (v) => variance(v, true),
};

export const mathFunctions: Record<string, Def> = {
  SUM: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY, fn: aggregate(sumOf) },
  PRODUCT: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => v.reduce((a, b) => a * b, 1)),
  },
  MIN: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => (v.length === 0 ? 0 : Math.min(...v))),
  },
  MAX: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => (v.length === 0 ? 0 : Math.max(...v))),
  },
  AVERAGE: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => (v.length === 0 ? DIV0 : sumOf(v) / v.length)),
  },
  MEDIAN: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => {
      if (v.length === 0) return NUM_ERROR;
      const sorted = [...v].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }),
  },
  STDEV: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => {
      const varianceValue = variance(v, false);
      return isCalcError(varianceValue) ? varianceValue : Math.sqrt(varianceValue);
    }),
  },
  'STDEV.S': {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => {
      const varianceValue = variance(v, false);
      return isCalcError(varianceValue) ? varianceValue : Math.sqrt(varianceValue);
    }),
  },
  STDEVP: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => {
      const varianceValue = variance(v, true);
      return isCalcError(varianceValue) ? varianceValue : Math.sqrt(varianceValue);
    }),
  },
  'STDEV.P': {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => {
      const varianceValue = variance(v, true);
      return isCalcError(varianceValue) ? varianceValue : Math.sqrt(varianceValue);
    }),
  },
  VAR: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY, fn: aggregate((v) => variance(v, false)) },
  'VAR.S': {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => variance(v, false)),
  },
  VARP: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY, fn: aggregate((v) => variance(v, true)) },
  'VAR.P': {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: aggregate((v) => variance(v, true)),
  },

  COUNT: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      let count = 0;
      visitAggregate(args, ctx, ({ value, viaRange }) => {
        if (isCalcError(value) || value === null) return;
        if (typeof value === 'number') {
          count++;
          return;
        }
        // Direct args: numeric text and booleans count; range contents don't.
        if (!viaRange && (typeof value === 'boolean' || !Number.isNaN(Number(value)))) {
          if (typeof value === 'boolean' || value.trim() !== '') count++;
        }
      });
      return count;
    },
  },
  COUNTA: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      let count = 0;
      visitAggregate(args, ctx, ({ value }) => {
        if (value !== null) count++;
      });
      return count;
    },
  },
  COUNTBLANK: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const view = argRange(args[0]!, ctx);
      if (isCalcError(view)) return view;
      let blank = 0;
      view.forEach((value) => {
        if (value === null || value === '') blank++;
      });
      // Cells beyond the used extent are blank too — logical minus non-blank.
      const logical = view.rows * view.cols;
      const effective = view.effectiveRows * view.effectiveCols;
      return blank + (logical - effective);
    },
  },
  COUNTIF: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => countIf(args[0]!, args[1]!, ctx),
  },
  SUMIF: {
    minArgs: 2,
    maxArgs: 3,
    fn: (args, ctx) => {
      const view = argRange(args[0]!, ctx);
      if (isCalcError(view)) return view;
      const matches = buildCriteria(argScalar(args[1]!, ctx));
      const sumView = isMissing(args[2]) ? view : argRange(args[2]!, ctx);
      if (isCalcError(sumView)) return sumView;
      let total = 0;
      let error: CalcErrorValue | null = null;
      view.forEach((value, row, col) => {
        if (error || !matches(value)) return;
        const contribution: CalcValue = sumView === view ? value : sumView.get(row, col);
        if (isCalcError(contribution)) {
          error = contribution;
          return;
        }
        if (typeof contribution === 'number') total += contribution;
      });
      return error ?? total;
    },
  },
  AVERAGEIF: {
    minArgs: 2,
    maxArgs: 3,
    fn: (args, ctx) => {
      const view = argRange(args[0]!, ctx);
      if (isCalcError(view)) return view;
      const matches = buildCriteria(argScalar(args[1]!, ctx));
      const avgView = isMissing(args[2]) ? view : argRange(args[2]!, ctx);
      if (isCalcError(avgView)) return avgView;
      let total = 0;
      let count = 0;
      let error: CalcErrorValue | null = null;
      view.forEach((value, row, col) => {
        if (error || !matches(value)) return;
        const contribution: CalcValue = avgView === view ? value : avgView.get(row, col);
        if (isCalcError(contribution)) {
          error = contribution;
          return;
        }
        if (typeof contribution === 'number') {
          total += contribution;
          count++;
        }
      });
      if (error) return error;
      return count === 0 ? DIV0 : total / count;
    },
  },
  SUMPRODUCT: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      const views = args.map((node) => argRange(node, ctx));
      for (const view of views) if (isCalcError(view)) return view;
      const first = views[0]! as Exclude<(typeof views)[number], CalcErrorValue>;
      const rows = first.rows;
      const cols = first.cols;
      for (const view of views) {
        const v = view as Exclude<(typeof views)[number], CalcErrorValue>;
        if (v.rows !== rows || v.cols !== cols) return VALUE_ERROR;
      }
      let total = 0;
      const effRows = first.effectiveRows;
      const effCols = first.effectiveCols;
      ctx.budget.charge(effRows * effCols * views.length);
      for (let r = 0; r < effRows; r++) {
        for (let c = 0; c < effCols; c++) {
          let product = 1;
          for (const view of views) {
            const v = view as Exclude<(typeof views)[number], CalcErrorValue>;
            const value = v.get(r, c);
            if (isCalcError(value)) return value;
            product *= typeof value === 'number' ? value : 0;
          }
          total += product;
        }
      }
      return total;
    },
  },
  SUBTOTAL: {
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      const code = argNumber(args[0]!, ctx);
      if (isCalcError(code)) return code;
      const whole = Math.trunc(code);
      if ((whole > 11 && whole < 101) || whole > 111 || whole < 1) return VALUE_ERROR;
      const op = whole % 100;
      // COUNT (2) and COUNTA (3) count by TYPE, not by numeric value — they
      // cannot ride the numeric collector, which drops text wholesale.
      if (op === 2 || op === 3) {
        let count = 0;
        visitAggregate(args.slice(1), ctx, ({ value }) => {
          if (op === 2 ? typeof value === 'number' : value !== null) count++;
        });
        return count;
      }
      const reduce = SUBTOTAL_OPS[op];
      if (!reduce) return VALUE_ERROR;
      const values = collectAggregateNumbers(args.slice(1), ctx);
      if (isCalcError(values)) return values;
      return reduce(values);
    },
  },

  ABS: { minArgs: 1, maxArgs: 1, fn: num(Math.abs) },
  SQRT: { minArgs: 1, maxArgs: 1, fn: num((x) => (x < 0 ? NUM_ERROR : Math.sqrt(x))) },
  EXP: { minArgs: 1, maxArgs: 1, fn: num(Math.exp) },
  LN: { minArgs: 1, maxArgs: 1, fn: num((x) => (x <= 0 ? NUM_ERROR : Math.log(x))) },
  LOG10: { minArgs: 1, maxArgs: 1, fn: num((x) => (x <= 0 ? NUM_ERROR : Math.log10(x))) },
  LOG: {
    minArgs: 1,
    maxArgs: 2,
    fn: (args, ctx) => {
      const x = argNumber(args[0]!, ctx);
      if (isCalcError(x)) return x;
      const base = isMissing(args[1]) ? 10 : argNumber(args[1]!, ctx);
      if (isCalcError(base)) return base;
      if (x <= 0 || base <= 0 || base === 1) return NUM_ERROR;
      return Math.log(x) / Math.log(base);
    },
  },
  SIGN: { minArgs: 1, maxArgs: 1, fn: num(Math.sign) },
  INT: { minArgs: 1, maxArgs: 1, fn: num(Math.floor) },
  TRUNC: {
    minArgs: 1,
    maxArgs: 2,
    fn: (args, ctx) => {
      const x = argNumber(args[0]!, ctx);
      if (isCalcError(x)) return x;
      const digits = isMissing(args[1]) ? 0 : argNumber(args[1]!, ctx);
      if (isCalcError(digits)) return digits;
      return excelRound(x, digits, 'down');
    },
  },
  ROUND: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const x = argNumber(args[0]!, ctx);
      if (isCalcError(x)) return x;
      const digits = argNumber(args[1]!, ctx);
      if (isCalcError(digits)) return digits;
      return excelRound(x, digits, 'half');
    },
  },
  ROUNDUP: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const x = argNumber(args[0]!, ctx);
      if (isCalcError(x)) return x;
      const digits = argNumber(args[1]!, ctx);
      if (isCalcError(digits)) return digits;
      return excelRound(x, digits, 'up');
    },
  },
  ROUNDDOWN: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const x = argNumber(args[0]!, ctx);
      if (isCalcError(x)) return x;
      const digits = argNumber(args[1]!, ctx);
      if (isCalcError(digits)) return digits;
      return excelRound(x, digits, 'down');
    },
  },
  MOD: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const x = argNumber(args[0]!, ctx);
      if (isCalcError(x)) return x;
      const y = argNumber(args[1]!, ctx);
      if (isCalcError(y)) return y;
      if (y === 0) return DIV0;
      // Excel MOD takes the sign of the DIVISOR.
      return x - y * Math.floor(x / y);
    },
  },
  POWER: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const x = argNumber(args[0]!, ctx);
      if (isCalcError(x)) return x;
      const y = argNumber(args[1]!, ctx);
      if (isCalcError(y)) return y;
      const result = Math.pow(x, y);
      return Number.isFinite(result) ? result : NUM_ERROR;
    },
  },
  CEILING: {
    minArgs: 1,
    maxArgs: 2,
    fn: (args, ctx) => {
      const x = argNumber(args[0]!, ctx);
      if (isCalcError(x)) return x;
      const significance = isMissing(args[1]) ? 1 : argNumber(args[1]!, ctx);
      if (isCalcError(significance)) return significance;
      if (significance === 0) return 0;
      if (x > 0 && significance < 0) return NUM_ERROR;
      return Math.ceil(x / significance) * significance;
    },
  },
  FLOOR: {
    minArgs: 1,
    maxArgs: 2,
    fn: (args, ctx) => {
      const x = argNumber(args[0]!, ctx);
      if (isCalcError(x)) return x;
      const significance = isMissing(args[1]) ? 1 : argNumber(args[1]!, ctx);
      if (isCalcError(significance)) return significance;
      if (significance === 0) return DIV0;
      if (x > 0 && significance < 0) return NUM_ERROR;
      return Math.floor(x / significance) * significance;
    },
  },
  PI: { minArgs: 0, maxArgs: 0, fn: () => Math.PI },
  RAND: { minArgs: 0, maxArgs: 0, volatile: true, fn: () => Math.random() },
  RANDBETWEEN: {
    minArgs: 2,
    maxArgs: 2,
    volatile: true,
    fn: (args, ctx) => {
      const low = argNumber(args[0]!, ctx);
      if (isCalcError(low)) return low;
      const high = argNumber(args[1]!, ctx);
      if (isCalcError(high)) return high;
      const lo = Math.ceil(low);
      const hi = Math.floor(high);
      if (hi < lo) return NUM_ERROR;
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    },
  },
};

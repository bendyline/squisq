/**
 * Logical family. IF and the error handlers are LAZY on purpose: Excel's
 * `IF(TRUE, 1, 1/0)` is 1 — the untaken branch's error must never
 * propagate — and IFERROR's whole job is observing an error without
 * becoming one.
 */

import { VALUE_ERROR, isCalcError } from '../errors.js';
import type { CalcFunctionDef } from '../evaluate.js';
import { argLogical, argScalar, isMissing, visitAggregate } from './helpers.js';

type Def = CalcFunctionDef;

export const logicalFunctions: Record<string, Def> = {
  TRUE: { minArgs: 0, maxArgs: 0, fn: () => true },
  FALSE: { minArgs: 0, maxArgs: 0, fn: () => false },
  NOT: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const value = argLogical(args[0]!, ctx);
      return isCalcError(value) ? value : !value;
    },
  },
  IF: {
    minArgs: 1,
    maxArgs: 3,
    fn: (args, ctx) => {
      const condition = argLogical(args[0]!, ctx);
      if (isCalcError(condition)) return condition;
      if (condition) {
        return isMissing(args[1]) ? true : argScalar(args[1]!, ctx);
      }
      return isMissing(args[2]) ? false : argScalar(args[2]!, ctx);
    },
  },
  IFS: {
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const condition = argLogical(args[i]!, ctx);
        if (isCalcError(condition)) return condition;
        if (condition) return argScalar(args[i + 1]!, ctx);
      }
      return { kind: 'calc-error', code: '#N/A' } as const;
    },
  },
  IFERROR: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const value = argScalar(args[0]!, ctx);
      return isCalcError(value) ? argScalar(args[1]!, ctx) : value;
    },
  },
  IFNA: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const value = argScalar(args[0]!, ctx);
      if (isCalcError(value) && value.code === '#N/A') return argScalar(args[1]!, ctx);
      return value;
    },
  },
  AND: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      let sawLogical = false;
      let result = true;
      let error: ReturnType<typeof argLogical> | null = null;
      visitAggregate(args, ctx, ({ value, viaRange }) => {
        if (error !== null && isCalcError(error)) return;
        if (isCalcError(value)) {
          error = value;
          return;
        }
        // Range text is ignored; range numbers/booleans participate.
        if (viaRange && typeof value === 'string') return;
        if (value === null) return;
        sawLogical = true;
        result = result && (typeof value === 'number' ? value !== 0 : value === true);
      });
      if (error !== null && isCalcError(error)) return error;
      return sawLogical ? result : VALUE_ERROR;
    },
  },
  OR: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      let sawLogical = false;
      let result = false;
      let error: ReturnType<typeof argLogical> | null = null;
      visitAggregate(args, ctx, ({ value, viaRange }) => {
        if (error !== null && isCalcError(error)) return;
        if (isCalcError(value)) {
          error = value;
          return;
        }
        if (viaRange && typeof value === 'string') return;
        if (value === null) return;
        sawLogical = true;
        result = result || (typeof value === 'number' ? value !== 0 : value === true);
      });
      if (error !== null && isCalcError(error)) return error;
      return sawLogical ? result : VALUE_ERROR;
    },
  },
  XOR: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      let sawLogical = false;
      let trues = 0;
      let error: ReturnType<typeof argLogical> | null = null;
      visitAggregate(args, ctx, ({ value, viaRange }) => {
        if (error !== null && isCalcError(error)) return;
        if (isCalcError(value)) {
          error = value;
          return;
        }
        if (viaRange && typeof value === 'string') return;
        if (value === null) return;
        sawLogical = true;
        if (typeof value === 'number' ? value !== 0 : value === true) trues++;
      });
      if (error !== null && isCalcError(error)) return error;
      return sawLogical ? trues % 2 === 1 : VALUE_ERROR;
    },
  },
};

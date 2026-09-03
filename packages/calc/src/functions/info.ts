/**
 * Information family. The IS* functions are the one family that must
 * NEVER propagate an error — observing an error is their purpose.
 */

import { NA, VALUE_ERROR, isCalcError } from '../errors.js';
import type { CalcFunctionDef } from '../evaluate.js';
import { argNumber, argScalar } from './helpers.js';

type Def = CalcFunctionDef;

export const infoFunctions: Record<string, Def> = {
  ISBLANK: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => argScalar(args[0]!, ctx) === null,
  },
  ISNUMBER: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => typeof argScalar(args[0]!, ctx) === 'number',
  },
  ISTEXT: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => typeof argScalar(args[0]!, ctx) === 'string',
  },
  ISNONTEXT: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => typeof argScalar(args[0]!, ctx) !== 'string',
  },
  ISLOGICAL: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => typeof argScalar(args[0]!, ctx) === 'boolean',
  },
  ISERROR: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => isCalcError(argScalar(args[0]!, ctx)),
  },
  ISERR: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const value = argScalar(args[0]!, ctx);
      return isCalcError(value) && value.code !== '#N/A';
    },
  },
  ISNA: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const value = argScalar(args[0]!, ctx);
      return isCalcError(value) && value.code === '#N/A';
    },
  },
  ISEVEN: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const value = argNumber(args[0]!, ctx);
      if (isCalcError(value)) return VALUE_ERROR;
      return Math.trunc(value) % 2 === 0;
    },
  },
  ISODD: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const value = argNumber(args[0]!, ctx);
      if (isCalcError(value)) return VALUE_ERROR;
      return Math.abs(Math.trunc(value)) % 2 === 1;
    },
  },
  NA: { minArgs: 0, maxArgs: 0, fn: () => NA },
};

/** Text family. FIND is case-sensitive/no-wildcards; SEARCH is neither. */

import { formatGeneral, numberFromText, wildcardToRegExp } from '../coerce.js';
import { NUM_ERROR, VALUE_ERROR, isCalcError } from '../errors.js';
import type { CalcFunctionDef } from '../evaluate.js';
import { formatNumberWithPattern } from '../numfmt.js';
import { argNumber, argScalar, argText, isMissing, visitAggregate } from './helpers.js';

type Def = CalcFunctionDef;

export const textFunctions: Record<string, Def> = {
  CONCATENATE: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      let out = '';
      for (const node of args) {
        if (isMissing(node)) continue;
        const piece = argText(node, ctx);
        if (isCalcError(piece)) return piece;
        out += piece;
      }
      return out;
    },
  },
  CONCAT: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      let out = '';
      let error: ReturnType<typeof argText> | null = null;
      visitAggregate(args, ctx, ({ value }) => {
        if (error !== null && isCalcError(error)) return;
        if (isCalcError(value)) {
          error = value;
          return;
        }
        if (value === null) return;
        out +=
          typeof value === 'string'
            ? value
            : typeof value === 'boolean'
              ? value
                ? 'TRUE'
                : 'FALSE'
              : formatGeneral(value);
      });
      if (error !== null && isCalcError(error)) return error;
      return out;
    },
  },
  TEXTJOIN: {
    minArgs: 3,
    maxArgs: Number.POSITIVE_INFINITY,
    fn: (args, ctx) => {
      const delimiter = argText(args[0]!, ctx);
      if (isCalcError(delimiter)) return delimiter;
      const ignoreEmpty = argScalar(args[1]!, ctx) !== false;
      const pieces: string[] = [];
      let error: ReturnType<typeof argText> | null = null;
      visitAggregate(args.slice(2), ctx, ({ value }) => {
        if (error !== null && isCalcError(error)) return;
        if (isCalcError(value)) {
          error = value;
          return;
        }
        const text =
          value === null
            ? ''
            : typeof value === 'string'
              ? value
              : typeof value === 'boolean'
                ? value
                  ? 'TRUE'
                  : 'FALSE'
                : formatGeneral(value);
        if (ignoreEmpty && text === '') return;
        pieces.push(text);
      });
      if (error !== null && isCalcError(error)) return error;
      return pieces.join(delimiter);
    },
  },
  LEFT: {
    minArgs: 1,
    maxArgs: 2,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      const count = isMissing(args[1]) ? 1 : argNumber(args[1]!, ctx);
      if (isCalcError(count)) return count;
      if (count < 0) return VALUE_ERROR;
      return text.slice(0, Math.trunc(count));
    },
  },
  RIGHT: {
    minArgs: 1,
    maxArgs: 2,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      const count = isMissing(args[1]) ? 1 : argNumber(args[1]!, ctx);
      if (isCalcError(count)) return count;
      if (count < 0) return VALUE_ERROR;
      const n = Math.trunc(count);
      return n === 0 ? '' : text.slice(-n);
    },
  },
  MID: {
    minArgs: 3,
    maxArgs: 3,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      const start = argNumber(args[1]!, ctx);
      if (isCalcError(start)) return start;
      const count = argNumber(args[2]!, ctx);
      if (isCalcError(count)) return count;
      if (start < 1 || count < 0) return VALUE_ERROR;
      return text.slice(Math.trunc(start) - 1, Math.trunc(start) - 1 + Math.trunc(count));
    },
  },
  LEN: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      return isCalcError(text) ? text : text.length;
    },
  },
  LOWER: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      return isCalcError(text) ? text : text.toLowerCase();
    },
  },
  UPPER: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      return isCalcError(text) ? text : text.toUpperCase();
    },
  },
  PROPER: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      return text.replace(
        /([A-Za-z])([A-Za-z]*)/g,
        (_, head: string, tail: string) => head.toUpperCase() + tail.toLowerCase(),
      );
    },
  },
  TRIM: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      // Excel TRIM also collapses interior runs of spaces.
      return text.replace(/ +/g, ' ').trim();
    },
  },
  SUBSTITUTE: {
    minArgs: 3,
    maxArgs: 4,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      const oldText = argText(args[1]!, ctx);
      if (isCalcError(oldText)) return oldText;
      const newText = argText(args[2]!, ctx);
      if (isCalcError(newText)) return newText;
      if (oldText === '') return text;
      if (isMissing(args[3])) return text.split(oldText).join(newText);
      const instance = argNumber(args[3]!, ctx);
      if (isCalcError(instance)) return instance;
      const nth = Math.trunc(instance);
      if (nth < 1) return VALUE_ERROR;
      let index = -1;
      for (let found = 0; found < nth; found++) {
        index = text.indexOf(oldText, index + 1);
        if (index < 0) return text;
      }
      return text.slice(0, index) + newText + text.slice(index + oldText.length);
    },
  },
  REPLACE: {
    minArgs: 4,
    maxArgs: 4,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      const start = argNumber(args[1]!, ctx);
      if (isCalcError(start)) return start;
      const count = argNumber(args[2]!, ctx);
      if (isCalcError(count)) return count;
      const replacement = argText(args[3]!, ctx);
      if (isCalcError(replacement)) return replacement;
      if (start < 1 || count < 0) return VALUE_ERROR;
      const at = Math.trunc(start) - 1;
      return text.slice(0, at) + replacement + text.slice(at + Math.trunc(count));
    },
  },
  FIND: {
    minArgs: 2,
    maxArgs: 3,
    fn: (args, ctx) => {
      const needle = argText(args[0]!, ctx);
      if (isCalcError(needle)) return needle;
      const haystack = argText(args[1]!, ctx);
      if (isCalcError(haystack)) return haystack;
      const start = isMissing(args[2]) ? 1 : argNumber(args[2]!, ctx);
      if (isCalcError(start)) return start;
      if (start < 1 || start > haystack.length + 1) return VALUE_ERROR;
      const index = haystack.indexOf(needle, Math.trunc(start) - 1);
      return index < 0 ? VALUE_ERROR : index + 1;
    },
  },
  SEARCH: {
    minArgs: 2,
    maxArgs: 3,
    fn: (args, ctx) => {
      const needle = argText(args[0]!, ctx);
      if (isCalcError(needle)) return needle;
      const haystack = argText(args[1]!, ctx);
      if (isCalcError(haystack)) return haystack;
      const start = isMissing(args[2]) ? 1 : argNumber(args[2]!, ctx);
      if (isCalcError(start)) return start;
      if (start < 1 || start > haystack.length + 1) return VALUE_ERROR;
      const from = Math.trunc(start) - 1;
      const re = wildcardToRegExp(`*${needle}*`);
      // Wildcard-aware scan: find the earliest index where the pattern
      // matches the remainder anchored at that index.
      const anchored = new RegExp(re.source.replace(/^\^\.\*/, '^').replace(/\.\*\$$/, ''), 'i');
      for (let i = from; i <= haystack.length; i++) {
        if (anchored.test(haystack.slice(i))) return i + 1;
      }
      return VALUE_ERROR;
    },
  },
  REPT: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      const count = argNumber(args[1]!, ctx);
      if (isCalcError(count)) return count;
      if (count < 0) return VALUE_ERROR;
      const n = Math.trunc(count);
      if (text.length * n > 32_767) return VALUE_ERROR;
      return text.repeat(n);
    },
  },
  EXACT: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const a = argText(args[0]!, ctx);
      if (isCalcError(a)) return a;
      const b = argText(args[1]!, ctx);
      if (isCalcError(b)) return b;
      return a === b;
    },
  },
  VALUE: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const value = argScalar(args[0]!, ctx);
      if (isCalcError(value)) return value;
      if (typeof value === 'number') return value;
      if (value === null) return VALUE_ERROR;
      if (typeof value === 'boolean') return VALUE_ERROR;
      const parsed = numberFromText(value);
      return parsed === null ? VALUE_ERROR : parsed;
    },
  },
  T: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const value = argScalar(args[0]!, ctx);
      if (isCalcError(value)) return value;
      return typeof value === 'string' ? value : '';
    },
  },
  N: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const value = argScalar(args[0]!, ctx);
      if (isCalcError(value)) return value;
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') return value ? 1 : 0;
      return 0;
    },
  },
  CHAR: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const code = argNumber(args[0]!, ctx);
      if (isCalcError(code)) return code;
      const n = Math.trunc(code);
      if (n < 1 || n > 255) return VALUE_ERROR;
      return String.fromCharCode(n);
    },
  },
  CODE: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const text = argText(args[0]!, ctx);
      if (isCalcError(text)) return text;
      if (text.length === 0) return VALUE_ERROR;
      return text.charCodeAt(0);
    },
  },
  TEXT: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const value = argScalar(args[0]!, ctx);
      if (isCalcError(value)) return value;
      const pattern = argText(args[1]!, ctx);
      if (isCalcError(pattern)) return pattern;
      if (typeof value === 'string') return value;
      if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
      if (value === null) return formatNumberWithPattern(0, pattern, ctx.date1904) ?? '';
      const formatted = formatNumberWithPattern(value, pattern, ctx.date1904);
      return formatted ?? NUM_ERROR;
    },
  },
};

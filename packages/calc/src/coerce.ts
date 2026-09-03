/**
 * Excel's implicit coercion and comparison rules — the part of a
 * spreadsheet engine correctness actually hinges on. Encoded facts:
 *
 *  - Arithmetic coerces: blank → 0, booleans → 1/0, numeric-looking text →
 *    its number (`"3"+4` is 7); other text → #VALUE!.
 *  - Text concatenation renders numbers in General format (no trailing
 *    zeros, ≤15 significant digits) and booleans as TRUE/FALSE; blank → "".
 *  - Comparison has a TYPE ORDER: every number < every text < every
 *    logical (FALSE < TRUE). Text compares case-insensitively.
 *  - Blank compared against a typed value coerces to that type's zero
 *    (0, "", FALSE) — so `A1=""` is TRUE for an empty cell.
 *  - Criteria strings (COUNTIF/SUMIF) carry their own mini-grammar: a
 *    leading comparison operator, else equality with `*`/`?` wildcards
 *    (`~` escapes) for text.
 */

import { VALUE_ERROR, isCalcError } from './errors.js';
import type { CalcErrorValue, CalcScalar, CalcValue } from './types.js';

/** Excel's General rendering: ≤15 significant digits, no trailing zeros. */
export function formatGeneral(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const fixed = value.toPrecision(15);
  // Trim trailing zeros (and a dangling point) without touching exponents.
  if (fixed.includes('e') || fixed.includes('E')) return String(Number(fixed));
  return String(Number(fixed));
}

/** Text that Excel would accept as a number in arithmetic (incl. `%`). */
export function numberFromText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const percent = trimmed.endsWith('%');
  const body = percent ? trimmed.slice(0, -1).trim() : trimmed;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(body)) return null;
  const value = Number(body);
  if (!Number.isFinite(value)) return null;
  return percent ? value / 100 : value;
}

/** Arithmetic coercion. Errors pass through. */
export function toNumber(value: CalcValue): number | CalcErrorValue {
  if (isCalcError(value)) return value;
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const parsed = numberFromText(value);
  return parsed === null ? VALUE_ERROR : parsed;
}

/** Concatenation/text coercion. Errors pass through. */
export function toText(value: CalcValue): string | CalcErrorValue {
  if (isCalcError(value)) return value;
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return formatGeneral(value);
}

/** Logical coercion: 0/blank → FALSE, numbers → TRUE, "TRUE"/"FALSE" text. */
export function toLogical(value: CalcValue): boolean | CalcErrorValue {
  if (isCalcError(value)) return value;
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const upper = value.trim().toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return VALUE_ERROR;
}

function typeRank(value: CalcScalar): number {
  if (typeof value === 'number') return 0;
  if (typeof value === 'string') return 1;
  return 2;
}

/**
 * Excel comparison: -1 | 0 | 1. Blank coerces to the OTHER side's zero
 * value; mixed types order number < text < logical.
 */
export function compareValues(a: CalcValue, b: CalcValue): number | CalcErrorValue {
  if (isCalcError(a)) return a;
  if (isCalcError(b)) return b;
  let left: CalcScalar;
  let right: CalcScalar;
  if (a === null && b === null) return 0;
  if (a === null) {
    right = b as CalcScalar;
    left = typeof right === 'number' ? 0 : typeof right === 'string' ? '' : false;
  } else if (b === null) {
    left = a as CalcScalar;
    right = typeof left === 'number' ? 0 : typeof left === 'string' ? '' : false;
  } else {
    left = a;
    right = b;
  }

  const rankDiff = typeRank(left) - typeRank(right);
  if (rankDiff !== 0) return rankDiff < 0 ? -1 : 1;

  if (typeof left === 'number' && typeof right === 'number') {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    const l = left.toLowerCase();
    const r = right.toLowerCase();
    return l === r ? 0 : l < r ? -1 : 1;
  }
  const l = left ? 1 : 0;
  const r = right ? 1 : 0;
  return l === r ? 0 : l < r ? -1 : 1;
}

// ── Wildcards + criteria ─────────────────────────────────────────────

let wildcardCache: Map<string, RegExp> | null = null;

/** Excel wildcard pattern (`*`, `?`, `~` escape) → case-insensitive RegExp. */
export function wildcardToRegExp(pattern: string): RegExp {
  wildcardCache ??= new Map();
  const cached = wildcardCache.get(pattern);
  if (cached) return cached;
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '~' && i + 1 < pattern.length) {
      out += pattern[i + 1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    } else if (ch === '*') {
      out += '.*';
    } else if (ch === '?') {
      out += '.';
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  out += '$';
  const re = new RegExp(out, 'i');
  if (wildcardCache.size > 500) wildcardCache.clear();
  wildcardCache.set(pattern, re);
  return re;
}

export function hasWildcard(pattern: string): boolean {
  return /[*?]/.test(pattern.replace(/~[*?]/g, ''));
}

export type CriteriaPredicate = (value: CalcValue) => boolean;

/**
 * COUNTIF/SUMIF criteria: `">=10"`, `"<>done"`, `"West*"`, `10`, `"10"`.
 * A non-string criterion compares for equality by Excel rules.
 */
export function buildCriteria(criterion: CalcValue): CriteriaPredicate {
  if (isCalcError(criterion)) {
    return (value) => isCalcError(value) && value.code === criterion.code;
  }
  if (criterion === null) {
    // Blank criterion matches 0 and blank (Excel's quirky equality).
    return (value) => value === null || value === 0;
  }
  if (typeof criterion !== 'string') {
    return (value) => !isCalcError(value) && compareValues(value, criterion) === 0;
  }

  const opMatch = /^(<=|>=|<>|=|<|>)(.*)$/.exec(criterion);
  const op = opMatch ? opMatch[1]! : '=';
  const rest = opMatch ? opMatch[2]! : criterion;

  // The operand re-types itself: ">=10" compares numerically.
  const asNumber = numberFromText(rest);
  const upper = rest.trim().toUpperCase();
  const operand: CalcValue =
    asNumber !== null ? asNumber : upper === 'TRUE' ? true : upper === 'FALSE' ? false : rest;

  // `~`-escaped patterns carry no live wildcard but still need the matcher
  // to strip the escapes ("a~*b" matches literal "a*b").
  if (
    (op === '=' || op === '<>') &&
    typeof operand === 'string' &&
    (hasWildcard(operand) || operand.includes('~'))
  ) {
    const re = wildcardToRegExp(operand);
    return (value) => {
      const matches = typeof value === 'string' && re.test(value);
      return op === '=' ? matches : !matches;
    };
  }

  if (op === '=' && operand === '') {
    return (value) => value === null || value === '';
  }
  if (op === '<>' && operand === '') {
    return (value) => value !== null && value !== '';
  }

  return (value) => {
    if (isCalcError(value)) return false;
    // Excel criteria only match same-type values (">=10" never matches text).
    if (value === null) return false;
    if (typeof operand === 'number' && typeof value !== 'number') {
      if (op === '<>') return true;
      return false;
    }
    if (typeof operand === 'string' && typeof value !== 'string') {
      if (op === '<>') return true;
      return false;
    }
    if (typeof operand === 'boolean' && typeof value !== 'boolean') {
      if (op === '<>') return true;
      return false;
    }
    const cmp = compareValues(value, operand);
    if (isCalcError(cmp)) return false;
    switch (op) {
      case '=':
        return cmp === 0;
      case '<>':
        return cmp !== 0;
      case '<':
        return cmp < 0;
      case '>':
        return cmp > 0;
      case '<=':
        return cmp <= 0;
      default:
        return cmp >= 0;
    }
  };
}

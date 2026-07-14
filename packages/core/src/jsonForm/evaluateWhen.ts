/**
 * Evaluate a `SquisqWhen` rule against the current root data. Pure;
 * renderers call this on every render with fresh data.
 */

import type { SquisqWhen } from './types.js';
import { getByPointer } from './pointer.js';

const MAX_CONDITION_REGEX_LENGTH = 256;

/**
 * Reject regex features that cannot be evaluated with a predictable cost in
 * JavaScript's backtracking engine. JSON Form conditions are intended for
 * small validation-style matches, so a conservative false negative is safer
 * than allowing authored schemas to freeze the render thread.
 */
export function isSafeConditionRegex(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > MAX_CONDITION_REGEX_LENGTH) return false;
  if (/\\[1-9]|\(\?[=!<]/.test(pattern)) return false;

  const groups: Array<{ hasQuantifier: boolean; hasAlternation: boolean }> = [];
  let escaped = false;
  let inClass = false;
  let unboundedQuantifiers = 0;

  for (let index = 0; index < pattern.length; index++) {
    const ch = pattern[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;

    if (ch === '(') {
      groups.push({ hasQuantifier: false, hasAlternation: false });
      continue;
    }
    if (ch === '|') {
      const group = groups[groups.length - 1];
      if (group) group.hasAlternation = true;
      continue;
    }
    if (ch === ')') {
      const group = groups.pop();
      if (!group) return false;
      const next = pattern[index + 1];
      if (next && '*+?{'.includes(next) && (group.hasQuantifier || group.hasAlternation)) {
        return false;
      }
      if (next && '*+?{'.includes(next)) {
        const parent = groups[groups.length - 1];
        if (parent) parent.hasQuantifier = true;
      }
      continue;
    }
    if ('*+?'.includes(ch) || ch === '{') {
      if (ch === '*' || ch === '+') unboundedQuantifiers += 1;
      if (ch === '{') {
        const close = pattern.indexOf('}', index + 1);
        if (close < 0) return false;
        const bounds = pattern.slice(index + 1, close);
        if (!/^\d+(?:,\d*)?$/.test(bounds)) return false;
        const values = bounds.split(',').filter(Boolean).map(Number);
        if (values.some((value) => value > 1_000)) return false;
        if (bounds.endsWith(',')) unboundedQuantifiers += 1;
        index = close;
      }
      if (unboundedQuantifiers > 1) return false;
      const group = groups[groups.length - 1];
      if (group) group.hasQuantifier = true;
    }
  }

  return !escaped && !inClass && groups.length === 0;
}

export function evaluateWhen(when: SquisqWhen, rootData: unknown): boolean {
  const actual = getByPointer(rootData, when.field);

  if (when.equals !== undefined) {
    return deepEqual(actual, when.equals);
  }
  if (when.oneOf !== undefined) {
    return when.oneOf.some((v) => deepEqual(actual, v));
  }
  if (when.matches !== undefined) {
    if (typeof actual !== 'string' || actual.length > 100_000) return false;
    if (!isSafeConditionRegex(when.matches)) return false;
    try {
      return new RegExp(when.matches).test(actual);
    } catch {
      return false;
    }
  }
  if (when.truthy !== undefined) {
    return Boolean(actual) === when.truthy;
  }
  // No operator specified — defaults to "field has any defined value".
  return actual !== undefined && actual !== null;
}

/**
 * Resolve a `boolean | SquisqWhen` flag (used by `hidden`/`disabled`)
 * to a final boolean. Literal booleans pass through.
 */
export function resolveFlag(flag: boolean | SquisqWhen | undefined, rootData: unknown): boolean {
  if (flag === undefined) return false;
  if (typeof flag === 'boolean') return flag;
  return evaluateWhen(flag, rootData);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

/**
 * Evaluate a `SquisqWhen` rule against the current root data. Pure;
 * renderers call this on every render with fresh data.
 */

import type { SquisqWhen } from './types.js';
import { getByPointer } from './pointer.js';

export function evaluateWhen(when: SquisqWhen, rootData: unknown): boolean {
  const actual = getByPointer(rootData, when.field);

  if (when.equals !== undefined) {
    return deepEqual(actual, when.equals);
  }
  if (when.oneOf !== undefined) {
    return when.oneOf.some((v) => deepEqual(actual, v));
  }
  if (when.matches !== undefined) {
    if (typeof actual !== 'string') return false;
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
export function resolveFlag(
  flag: boolean | SquisqWhen | undefined,
  rootData: unknown,
): boolean {
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

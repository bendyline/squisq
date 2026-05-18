/**
 * JSON Pointer helpers (RFC 6901) plus immutable get/set, plus a tiny
 * dotted-path normalizer so hosts can write `user.role` instead of
 * `/user/role`. `$ref` resolution is local-only (`#/$defs/Foo`).
 */

import type { SquisqAnnotatedSchema } from './types.js';

/** Normalize a path to a JSON Pointer string. Accepts both forms. */
export function toPointer(path: string): string {
  if (path === '' || path === '/') return '';
  if (path.startsWith('/')) return path;
  // Dotted form: split on `.` and escape per RFC 6901.
  return (
    '/' +
    path
      .split('.')
      .map((seg) => seg.replace(/~/g, '~0').replace(/\//g, '~1'))
      .join('/')
  );
}

/** Split a JSON Pointer into decoded segments. Empty string → []. */
export function pointerSegments(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Read a value from data by path (dotted or pointer). Returns undefined if missing. */
export function getByPointer(data: unknown, path: string): unknown {
  const segments = pointerSegments(toPointer(path));
  let cur: unknown = data;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Return a structurally-shared copy of `data` with the value at `path`
 * replaced. Intermediate objects/arrays are cloned along the path; the
 * rest is shared by reference. Creates intermediate objects if missing.
 */
export function setByPointer<T>(data: T, path: string, value: unknown): T {
  const segments = pointerSegments(toPointer(path));
  if (segments.length === 0) return value as T;
  return setRec(data, segments, 0, value) as T;
}

function setRec(node: unknown, segments: string[], i: number, value: unknown): unknown {
  const seg = segments[i];
  const isLast = i === segments.length - 1;

  // Decide whether the slot we're about to write into is an array index.
  const nextSeg = isLast ? undefined : segments[i + 1];
  const writingArrayChild = nextSeg !== undefined && /^\d+$/.test(nextSeg);

  if (Array.isArray(node)) {
    const idx = Number(seg);
    const next = node.slice();
    next[idx] = isLast
      ? value
      : setRec(node[idx] ?? (writingArrayChild ? [] : {}), segments, i + 1, value);
    return next;
  }

  const obj = (node && typeof node === 'object' ? { ...(node as object) } : {}) as Record<
    string,
    unknown
  >;
  obj[seg] = isLast
    ? value
    : setRec(obj[seg] ?? (writingArrayChild ? [] : {}), segments, i + 1, value);
  return obj;
}

/**
 * Resolve a local `$ref` (e.g. `#/$defs/Foo`) against the root schema.
 * Returns the original schema if no `$ref` is present, or `undefined`
 * if the reference cannot be resolved. Cross-document refs are not
 * supported.
 */
export function resolveRef(
  schema: SquisqAnnotatedSchema,
  root: SquisqAnnotatedSchema,
): SquisqAnnotatedSchema | undefined {
  if (!schema.$ref) return schema;
  const ref = schema.$ref;
  if (!ref.startsWith('#/')) return undefined;
  const segments = pointerSegments(ref.slice(1));
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return (cur as SquisqAnnotatedSchema | undefined) ?? undefined;
}

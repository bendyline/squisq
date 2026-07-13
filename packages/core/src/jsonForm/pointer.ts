/**
 * JSON Pointer helpers (RFC 6901) plus immutable get/set, plus a tiny
 * dotted-path normalizer so hosts can write `user.role` instead of
 * `/user/role`. `$ref` resolution is local-only (`#/$defs/Foo`).
 */

import type { SquisqAnnotatedSchema } from './types.js';

/** Escape one object-member name for use as an RFC 6901 pointer segment. */
export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Normalize a path to a JSON Pointer string. Accepts both forms. */
export function toPointer(path: string): string {
  if (path === '') return '';
  if (path.startsWith('/')) return path;
  // Dotted form: split on `.` and escape per RFC 6901.
  return '/' + path.split('.').map(escapePointerSegment).join('/');
}

/** Append one member name to a dotted path or validated JSON Pointer. */
export function appendPointer(base: string, segment: string): string {
  const pointer = toPointer(base);
  pointerSegments(pointer); // validate explicit pointer syntax before composing
  return `${pointer}/${escapePointerSegment(segment)}`;
}

/** Split a JSON Pointer into decoded segments. Empty string → []. */
export function pointerSegments(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new TypeError(`Invalid JSON Pointer ${JSON.stringify(pointer)}: expected "" or "/..."`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map((seg) => {
      if (/~(?:[^01]|$)/.test(seg)) {
        throw new TypeError(
          `Invalid JSON Pointer ${JSON.stringify(pointer)}: "~" must be escaped as "~0"`,
        );
      }
      return seg.replace(/~1/g, '/').replace(/~0/g, '~');
    });
}

/** Parse the canonical array-index spelling used by JSON Pointer consumers. */
function arrayIndex(segment: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(segment)) return undefined;
  const index = Number(segment);
  // 2^32 - 1 is the Array length sentinel, not an element index.
  return Number.isSafeInteger(index) && index <= 0xffff_fffe ? index : undefined;
}

function ownValue(object: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, key)
    ? (object as Record<string, unknown>)[key]
    : undefined;
}

/** Define a data member without invoking Object.prototype.__proto__'s setter. */
function setOwn(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Read a value from data by path (dotted or pointer). Returns undefined if missing. */
export function getByPointer(data: unknown, path: string): unknown {
  const segments = pointerSegments(toPointer(path));
  let cur: unknown = data;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = arrayIndex(seg);
      if (idx === undefined || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = ownValue(cur, seg);
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
  const writingArrayChild = nextSeg !== undefined && arrayIndex(nextSeg) !== undefined;

  if (Array.isArray(node)) {
    const idx = arrayIndex(seg);
    if (idx === undefined) {
      throw new TypeError(`Invalid array index ${JSON.stringify(seg)} in JSON Pointer`);
    }
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
  const previous = ownValue(obj, seg);
  setOwn(
    obj,
    seg,
    isLast ? value : setRec(previous ?? (writingArrayChild ? [] : {}), segments, i + 1, value),
  );
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
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return undefined;
  try {
    return getByPointer(root, ref.slice(1)) as SquisqAnnotatedSchema | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Clone JSON-shaped runtime configuration without relying on structuredClone
 * (which is unavailable in some of the ES2020/browser runtimes core supports).
 * Data objects are recreated with safe own-property definitions so even a key
 * named `__proto__` remains ordinary data.
 */
export function cloneData<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (value === null || typeof value !== 'object') return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;

  const tag = Object.prototype.toString.call(value);
  if (tag === '[object ArrayBuffer]') {
    const source = new Uint8Array(value as unknown as ArrayBuffer);
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy.buffer as T;
  }
  if (tag === '[object Date]') {
    return new Date(Date.prototype.getTime.call(value)) as T;
  }

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneData(item, seen));
    return copy as T;
  }

  const source = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const key of Object.keys(source)) {
    Object.defineProperty(copy, key, {
      value: cloneData(source[key], seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy as T;
}

/** Recursively freeze a data graph. Cycles are supported. */
export function deepFreezeData<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreezeData((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

/** Take an immutable snapshot suitable for storing in a process registry. */
export function cloneAndFreezeData<T>(value: T): T {
  return deepFreezeData(cloneData(value));
}

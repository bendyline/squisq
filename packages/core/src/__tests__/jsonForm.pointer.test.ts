import { describe, it, expect } from 'vitest';
import {
  escapePointerSegment,
  appendPointer,
  toPointer,
  pointerSegments,
  getByPointer,
  setByPointer,
  resolveRef,
} from '../jsonForm/index.js';

describe('pointer composition', () => {
  it('escapes arbitrary member names and appends them safely', () => {
    expect(escapePointerSegment('a~/b')).toBe('a~0~1b');
    expect(appendPointer('/properties', 'a~/b')).toBe('/properties/a~0~1b');
    expect(appendPointer('', '')).toBe('/');
    expect(appendPointer('/', 'child')).toBe('//child');
  });

  it('validates an explicit base pointer before appending', () => {
    expect(() => appendPointer('/bad~2base', 'child')).toThrow(/Invalid JSON Pointer/);
  });
});

describe('toPointer', () => {
  it('keeps pointer-form paths intact', () => {
    expect(toPointer('/a/b')).toBe('/a/b');
    expect(toPointer('/0/1')).toBe('/0/1');
  });
  it('converts dotted-form to pointer-form', () => {
    expect(toPointer('user.role')).toBe('/user/role');
    expect(toPointer('a')).toBe('/a');
  });
  it('returns empty for root', () => {
    expect(toPointer('')).toBe('');
    expect(toPointer('/')).toBe('/');
  });
  it('escapes ~ and / per RFC 6901', () => {
    // dotted form does not allow / inside a segment; we test pointer-form decoding instead.
    expect(pointerSegments('/a~1b')).toEqual(['a/b']);
    expect(pointerSegments('/a~0b')).toEqual(['a~b']);
  });
  it('rejects malformed pointer syntax and escape sequences', () => {
    expect(() => pointerSegments('not/a/pointer')).toThrow(/Invalid JSON Pointer/);
    expect(() => pointerSegments('/bad~2escape')).toThrow(/Invalid JSON Pointer/);
    expect(() => pointerSegments('/dangling~')).toThrow(/Invalid JSON Pointer/);
  });
});

describe('getByPointer', () => {
  const data = { user: { role: 'admin', tags: ['a', 'b'] } };
  it('resolves nested object paths', () => {
    expect(getByPointer(data, '/user/role')).toBe('admin');
    expect(getByPointer(data, 'user.role')).toBe('admin');
  });
  it('resolves array indices', () => {
    expect(getByPointer(data, '/user/tags/1')).toBe('b');
  });
  it('returns undefined for missing paths', () => {
    expect(getByPointer(data, '/user/missing')).toBeUndefined();
    expect(getByPointer(data, '/user/tags/9')).toBeUndefined();
  });
  it('returns the data itself for empty pointer', () => {
    expect(getByPointer(data, '')).toBe(data);
  });
  it('treats "/" as the empty-string member per RFC 6901', () => {
    expect(getByPointer({ '': 'empty key' }, '/')).toBe('empty key');
  });
  it('requires canonical array indices', () => {
    expect(getByPointer({ values: ['a'] }, '/values/00')).toBeUndefined();
    expect(getByPointer({ values: ['a'] }, '/values/-')).toBeUndefined();
  });
});

describe('setByPointer', () => {
  it('writes a leaf value immutably', () => {
    const before = { a: 1, b: 2 };
    const after = setByPointer(before, '/a', 99);
    expect(after).toEqual({ a: 99, b: 2 });
    expect(before).toEqual({ a: 1, b: 2 });
  });
  it('clones intermediate objects, shares siblings', () => {
    const before = { x: { y: 1 }, z: { w: 2 } };
    const after = setByPointer(before, '/x/y', 7);
    expect(after).toEqual({ x: { y: 7 }, z: { w: 2 } });
    expect(after.z).toBe(before.z);
    expect(after.x).not.toBe(before.x);
  });
  it('writes into array indices', () => {
    const before = { items: ['a', 'b', 'c'] };
    const after = setByPointer(before, '/items/1', 'B');
    expect(after.items).toEqual(['a', 'B', 'c']);
    expect(after.items).not.toBe(before.items);
  });
  it('creates intermediate containers when missing', () => {
    const after = setByPointer({}, '/a/b/0/c', 'leaf');
    expect(after).toEqual({ a: { b: [{ c: 'leaf' }] } });
  });
  it('round-trips with getByPointer', () => {
    const before = { a: { b: [{ c: 1 }, { c: 2 }] } };
    const after = setByPointer(before, '/a/b/1/c', 42);
    expect(getByPointer(after, '/a/b/1/c')).toBe(42);
    expect(getByPointer(after, '/a/b/0/c')).toBe(1);
  });
  it('writes the empty-string member for "/"', () => {
    expect(setByPointer({}, '/', 'value')).toEqual({ '': 'value' });
  });
  it('rejects non-canonical array indices instead of creating NaN properties', () => {
    expect(() => setByPointer({ items: [] }, '/items/nope', 'x')).toThrow(/array index/i);
    expect(() => setByPointer({ items: [] }, '/items/01', 'x')).toThrow(/array index/i);
  });
  it('writes prototype-shaped keys as safe own data properties', () => {
    const before = {};
    const after = setByPointer(before, '/__proto__/polluted', true) as Record<string, unknown>;
    expect(Object.getPrototypeOf(after)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.prototype.hasOwnProperty.call(after, '__proto__')).toBe(true);
    expect(getByPointer(after, '/__proto__/polluted')).toBe(true);

    const constructorPath = setByPointer({}, '/constructor/prototype/polluted', true);
    expect(getByPointer(constructorPath, '/constructor/prototype/polluted')).toBe(true);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

describe('resolveRef', () => {
  const root = {
    type: 'object',
    properties: {
      pet: { $ref: '#/$defs/Pet' },
    },
    $defs: {
      Pet: { type: 'object', properties: { name: { type: 'string' } } },
    },
  };
  it('returns referenced subschema for a local $ref', () => {
    const ref = { $ref: '#/$defs/Pet' };
    const resolved = resolveRef(ref, root);
    expect(resolved?.type).toBe('object');
    expect(resolved?.properties?.name?.type).toBe('string');
  });
  it('returns the schema unchanged when no $ref present', () => {
    const node = { type: 'string' };
    expect(resolveRef(node, root)).toBe(node);
  });
  it('returns undefined for unknown refs', () => {
    expect(resolveRef({ $ref: '#/$defs/Nope' }, root)).toBeUndefined();
  });
});

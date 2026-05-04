import { describe, it, expect } from 'vitest';
import {
  toPointer,
  pointerSegments,
  getByPointer,
  setByPointer,
  resolveRef,
} from '../jsonForm/index.js';

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
    expect(toPointer('/')).toBe('');
  });
  it('escapes ~ and / per RFC 6901', () => {
    // dotted form does not allow / inside a segment; we test pointer-form decoding instead.
    expect(pointerSegments('/a~1b')).toEqual(['a/b']);
    expect(pointerSegments('/a~0b')).toEqual(['a~b']);
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

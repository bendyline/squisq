import { describe, it, expect } from 'vitest';
import { evaluateWhen, resolveFlag } from '../jsonForm/index.js';

const data = {
  user: { role: 'admin', name: 'Alex' },
  count: 3,
  active: true,
  tags: ['a', 'b'],
};

describe('evaluateWhen', () => {
  it('equals — primitives', () => {
    expect(evaluateWhen({ field: 'user.role', equals: 'admin' }, data)).toBe(true);
    expect(evaluateWhen({ field: 'user.role', equals: 'guest' }, data)).toBe(false);
  });

  it('equals — arrays via deep equality', () => {
    expect(evaluateWhen({ field: 'tags', equals: ['a', 'b'] }, data)).toBe(true);
    expect(evaluateWhen({ field: 'tags', equals: ['a'] }, data)).toBe(false);
  });

  it('oneOf', () => {
    expect(evaluateWhen({ field: 'count', oneOf: [1, 2, 3] }, data)).toBe(true);
    expect(evaluateWhen({ field: 'count', oneOf: [10, 20] }, data)).toBe(false);
  });

  it('matches regex', () => {
    expect(evaluateWhen({ field: 'user.name', matches: '^Al' }, data)).toBe(true);
    expect(evaluateWhen({ field: 'user.name', matches: '^Bo' }, data)).toBe(false);
  });

  it('matches: returns false for non-string targets', () => {
    expect(evaluateWhen({ field: 'count', matches: '\\d' }, data)).toBe(false);
  });

  it('truthy', () => {
    expect(evaluateWhen({ field: 'active', truthy: true }, data)).toBe(true);
    expect(evaluateWhen({ field: 'active', truthy: false }, data)).toBe(false);
    expect(evaluateWhen({ field: 'missing', truthy: false }, data)).toBe(true);
  });

  it('default behavior with no operator: field is defined', () => {
    expect(evaluateWhen({ field: 'count' }, data)).toBe(true);
    expect(evaluateWhen({ field: 'missing' }, data)).toBe(false);
  });
});

describe('resolveFlag', () => {
  it('passes through literal booleans', () => {
    expect(resolveFlag(true, data)).toBe(true);
    expect(resolveFlag(false, data)).toBe(false);
  });
  it('returns false for undefined', () => {
    expect(resolveFlag(undefined, data)).toBe(false);
  });
  it('evaluates SquisqWhen', () => {
    expect(resolveFlag({ field: 'user.role', equals: 'admin' }, data)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { chooseControl, primaryType, arrayItemKind } from '../jsonForm/index.js';

describe('chooseControl', () => {
  it('honors explicit squisq.control', () => {
    expect(chooseControl({ type: 'string', squisq: { control: 'radio' } })).toBe('radio');
  });

  it('maps format=color', () => {
    expect(chooseControl({ type: 'string', format: 'color' })).toBe('color');
  });
  it('maps format=date / time / date-time / markdown / textarea', () => {
    expect(chooseControl({ type: 'string', format: 'date' })).toBe('date');
    expect(chooseControl({ type: 'string', format: 'time' })).toBe('time');
    expect(chooseControl({ type: 'string', format: 'date-time' })).toBe('datetime');
    expect(chooseControl({ type: 'string', format: 'markdown' })).toBe('richtext');
    expect(chooseControl({ type: 'string', format: 'textarea' })).toBe('multiline');
  });

  it('uses segmented for short enums (≤4)', () => {
    expect(
      chooseControl({ type: 'string', enum: ['a', 'b', 'c'] }),
    ).toBe('segmented');
    expect(
      chooseControl({ type: 'string', enum: ['a', 'b', 'c', 'd'] }),
    ).toBe('segmented');
  });
  it('uses combobox for long enums (>4)', () => {
    expect(
      chooseControl({ type: 'string', enum: ['a', 'b', 'c', 'd', 'e'] }),
    ).toBe('combobox');
  });

  it('arrays of objects → card-stack', () => {
    expect(
      chooseControl({ type: 'array', items: { type: 'object', properties: {} } }),
    ).toBe('card-stack');
  });
  it('arrays of primitives → chip-bin', () => {
    expect(chooseControl({ type: 'array', items: { type: 'string' } })).toBe('chip-bin');
  });

  it('booleans → toggle', () => {
    expect(chooseControl({ type: 'boolean' })).toBe('toggle');
  });

  it('numbers with both min and max → slider', () => {
    expect(chooseControl({ type: 'number', minimum: 0, maximum: 100 })).toBe('slider');
  });
  it('numbers without bounded range → stepper', () => {
    expect(chooseControl({ type: 'number' })).toBe('stepper');
    expect(chooseControl({ type: 'integer', minimum: 0 })).toBe('stepper');
  });

  it('strings with maxLength > 200 → multiline', () => {
    expect(chooseControl({ type: 'string', maxLength: 500 })).toBe('multiline');
  });
  it('plain strings → text', () => {
    expect(chooseControl({ type: 'string' })).toBe('text');
  });

  it('objects → group', () => {
    expect(chooseControl({ type: 'object', properties: {} })).toBe('group');
  });

  it('oneOf / anyOf → tabs', () => {
    expect(chooseControl({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toBe('tabs');
    expect(chooseControl({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('tabs');
  });
});

describe('primaryType', () => {
  it('returns the lone type', () => {
    expect(primaryType({ type: 'string' })).toBe('string');
  });
  it('skips null in nullable shorthand', () => {
    expect(primaryType({ type: ['string', 'null'] })).toBe('string');
    expect(primaryType({ type: ['null', 'integer'] })).toBe('integer');
  });
});

describe('arrayItemKind', () => {
  it('detects object items', () => {
    expect(arrayItemKind({ type: 'array', items: { type: 'object' } })).toBe('object');
  });
  it('detects primitive items', () => {
    expect(arrayItemKind({ type: 'array', items: { type: 'string' } })).toBe('primitive');
  });
  it('treats missing items as primitive', () => {
    expect(arrayItemKind({ type: 'array' })).toBe('primitive');
  });
});

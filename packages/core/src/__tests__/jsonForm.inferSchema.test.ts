import { describe, it, expect } from 'vitest';
import { inferSchema } from '../jsonForm/index.js';

describe('inferSchema', () => {
  it('infers an object schema from a sample', () => {
    const schema = inferSchema({ name: 'Alex', age: 30, active: true });
    expect(schema.type).toBe('object');
    expect(schema.properties?.name?.type).toBe('string');
    expect(schema.properties?.age?.type).toBe('integer');
    expect(schema.properties?.active?.type).toBe('boolean');
  });

  it('infers array item types', () => {
    const schema = inferSchema({ tags: ['a', 'b', 'c'] });
    const items = schema.properties?.tags?.items;
    const first = Array.isArray(items) ? items[0] : items;
    expect(first?.type).toBe('string');
  });

  it('merges multiple samples', () => {
    const schema = inferSchema(
      { name: 'Alex' },
      { additionalSamples: [{ name: 'Bo', age: 5 }] },
    );
    expect(schema.properties?.name?.type).toBe('string');
    expect(schema.properties?.age?.type).toBe('integer');
  });
});

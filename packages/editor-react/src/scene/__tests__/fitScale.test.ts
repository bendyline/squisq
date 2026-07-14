import { describe, expect, it } from 'vitest';
import { calculateFitScale } from '../fitScale';

describe('calculateFitScale', () => {
  it('does not enlarge content that already fits', () => {
    expect(calculateFitScale({ width: 200, height: 100 }, { width: 800, height: 600 })).toBe(1);
  });

  it('uses the smaller axis scale so every shape remains visible', () => {
    expect(calculateFitScale({ width: 1_000, height: 200 }, { width: 500, height: 300 })).toBe(0.5);
    expect(calculateFitScale({ width: 200, height: 1_000 }, { width: 500, height: 250 })).toBe(
      0.25,
    );
  });

  it('falls back to 100% until dimensions are measurable', () => {
    expect(calculateFitScale({ width: 0, height: 100 }, { width: 500, height: 300 })).toBe(1);
  });
});

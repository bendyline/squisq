import { describe, expect, it } from 'vitest';
import { advanceTime } from '../useTimelineClock';

describe('advanceTime', () => {
  it('advances by dt within range', () => {
    expect(advanceTime(2, 1.5, 30)).toBe(3.5);
  });

  it('clamps to total at the end', () => {
    expect(advanceTime(29.5, 1, 30)).toBe(30);
    expect(advanceTime(30, 5, 30)).toBe(30);
  });

  it('never goes below 0', () => {
    expect(advanceTime(0.2, -1, 30)).toBe(0);
  });

  it('returns 0 for an empty timeline', () => {
    expect(advanceTime(5, 1, 0)).toBe(0);
  });
});

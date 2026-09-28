import { describe, it, expect } from 'vitest';
import { frameCountFor, frameTimeSeconds } from '../frameClock.js';

describe('frameClock', () => {
  it('is fps-independent: a 30 fps frame lands on the same instant as the matching 3 fps frame', () => {
    expect(frameTimeSeconds(370, 30)).toBe(frameTimeSeconds(37, 3));
    expect(frameTimeSeconds(90, 30)).toBe(3);
  });

  it('is monotonic and exact at block boundaries', () => {
    let previous = -1;
    for (let i = 0; i < 3000; i++) {
      const t = frameTimeSeconds(i, 30);
      expect(t).toBeGreaterThan(previous);
      previous = t;
    }
    expect(frameTimeSeconds(150, 30)).toBe(5);
    expect(frameTimeSeconds(24, 24)).toBe(1);
  });

  it('counts frames with partial frames rounded up', () => {
    expect(frameCountFor(6, 10)).toBe(60);
    expect(frameCountFor(6.05, 10)).toBe(61);
    expect(frameCountFor(0, 30)).toBe(0);
  });

  it('rejects invalid input', () => {
    expect(() => frameTimeSeconds(-1, 30)).toThrow(RangeError);
    expect(() => frameTimeSeconds(1.5, 30)).toThrow(RangeError);
    expect(() => frameTimeSeconds(0, 0)).toThrow(RangeError);
    expect(() => frameCountFor(-1, 30)).toThrow(RangeError);
  });
});

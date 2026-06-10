import { describe, it, expect } from 'vitest';
import { bitrateForQuality } from '../workers/encodeParams.js';

const W = 1920;
const H = 1080;
const base = W * H * 4;

describe('bitrateForQuality', () => {
  it('returns the ~4 bits-per-pixel baseline for normal quality', () => {
    expect(bitrateForQuality('normal', W, H)).toBe(base);
  });

  it('falls back to the normal baseline for unknown quality values', () => {
    expect(bitrateForQuality('whatever', W, H)).toBe(base);
  });

  it('halves the baseline for draft and doubles it for high', () => {
    expect(bitrateForQuality('draft', W, H)).toBe(Math.round(base * 0.5));
    expect(bitrateForQuality('high', W, H)).toBe(Math.round(base * 2));
  });

  it('orders bitrate draft < normal < high', () => {
    const draft = bitrateForQuality('draft', W, H);
    const normal = bitrateForQuality('normal', W, H);
    const high = bitrateForQuality('high', W, H);
    expect(draft).toBeLessThan(normal);
    expect(normal).toBeLessThan(high);
  });

  it('scales with resolution', () => {
    expect(bitrateForQuality('normal', 640, 480)).toBeLessThan(bitrateForQuality('normal', W, H));
  });
});

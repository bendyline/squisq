import { describe, it, expect } from 'vitest';
import {
  isHex,
  oklchLighten,
  oklchDarken,
  oklchSetChroma,
  contrastRatio,
  pickContrastingText,
  deriveScale,
  relativeLuminance,
} from '../schemas/colorUtils.js';

describe('isHex', () => {
  it('accepts #rgb and #rrggbb', () => {
    expect(isHex('#fff')).toBe(true);
    expect(isHex('#123abc')).toBe(true);
    expect(isHex('#FF0080')).toBe(true);
  });
  it('rejects malformed strings', () => {
    expect(isHex('fff')).toBe(false);
    expect(isHex('#1234')).toBe(false);
    expect(isHex('#xyz')).toBe(false);
    expect(isHex('rgb(0,0,0)')).toBe(false);
  });
});

describe('oklchLighten / oklchDarken', () => {
  it('lighten produces a lighter color (higher luminance)', () => {
    const dark = '#101010';
    const lighter = oklchLighten(dark, 0.2);
    expect(relativeLuminance(lighter)).toBeGreaterThan(relativeLuminance(dark));
  });

  it('darken produces a darker color (lower luminance)', () => {
    const light = '#e0e0e0';
    const darker = oklchDarken(light, 0.2);
    expect(relativeLuminance(darker)).toBeLessThan(relativeLuminance(light));
  });

  it('round-trips approximately stable for moderate adjustments', () => {
    const seed = '#3182ce';
    const round = oklchDarken(oklchLighten(seed, 0.1), 0.1);
    // sRGB gamut clamping prevents perfect round-trip; expect within a small epsilon.
    expect(round).toMatch(/^#[0-9a-f]{6}$/);
    const lumDiff = Math.abs(relativeLuminance(seed) - relativeLuminance(round));
    expect(lumDiff).toBeLessThan(0.05);
  });

  it('returns a hex string', () => {
    expect(oklchLighten('#3182ce', 0.1)).toMatch(/^#[0-9a-f]{6}$/);
    expect(oklchDarken('#3182ce', 0.1)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('falls back to input on parse failure', () => {
    expect(oklchLighten('not-a-color', 0.1)).toBe('not-a-color');
  });
});

describe('oklchSetChroma', () => {
  it('reducing chroma toward 0 desaturates a color', () => {
    const vivid = '#ff3366';
    const muted = oklchSetChroma(vivid, 0.1);
    // Muted version's R/G/B channels should be much closer to each other than vivid.
    const parse = (h: string) =>
      [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const [vr, vg, vb] = parse(vivid);
    const [mr, mg, mb] = parse(muted);
    const vSpread = Math.max(vr, vg, vb) - Math.min(vr, vg, vb);
    const mSpread = Math.max(mr, mg, mb) - Math.min(mr, mg, mb);
    expect(mSpread).toBeLessThan(vSpread);
  });
});

describe('contrastRatio', () => {
  it('white-on-black is the maximum (≈21)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });
  it('same-color is 1', () => {
    expect(contrastRatio('#aabbcc', '#aabbcc')).toBeCloseTo(1, 5);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#222', '#ddd')).toBeCloseTo(contrastRatio('#ddd', '#222'), 5);
  });
});

describe('pickContrastingText', () => {
  it('returns dark text for light backgrounds', () => {
    expect(pickContrastingText('#ffffff')).toBe('#1a202c');
    expect(pickContrastingText('#f7fafc')).toBe('#1a202c');
  });
  it('returns light text for dark backgrounds', () => {
    expect(pickContrastingText('#000000')).toBe('#f7fafc');
    expect(pickContrastingText('#1a202c')).toBe('#f7fafc');
  });
  it('respects custom light/dark options', () => {
    expect(pickContrastingText('#000000', '#fefefe', '#020202')).toBe('#fefefe');
  });
});

describe('deriveScale', () => {
  it('produces 5 stops with base in the middle', () => {
    const scale = deriveScale('#3182ce', 0.15);
    expect(scale.base).toBe('#3182ce');
    expect(relativeLuminance(scale.lighter2)).toBeGreaterThan(relativeLuminance(scale.lighter1));
    expect(relativeLuminance(scale.lighter1)).toBeGreaterThan(relativeLuminance(scale.base));
    expect(relativeLuminance(scale.base)).toBeGreaterThan(relativeLuminance(scale.darker1));
    expect(relativeLuminance(scale.darker1)).toBeGreaterThan(relativeLuminance(scale.darker2));
  });
});

import { describe, it, expect } from 'vitest';
import {
  QUALITY_PRESETS,
  ORIENTATION_DIMENSIONS,
  resolveDimensions,
  bitrateForQuality,
  type VideoQuality,
  type VideoOrientation,
} from '../types.js';

describe('QUALITY_PRESETS', () => {
  it('defines every preset field for every quality level', () => {
    const levels: VideoQuality[] = ['draft', 'normal', 'high'];
    for (const level of levels) {
      const preset = QUALITY_PRESETS[level];
      expect(preset.preset).toBeTruthy();
      expect(preset.crf).toBeGreaterThanOrEqual(0);
      expect(preset.crf).toBeLessThanOrEqual(51);
      expect(preset.bitsPerPixel).toBeGreaterThan(0);
      expect(preset.audioBitrate).toBeGreaterThan(0);
    }
  });

  it('orders quality by descending crf (lower crf = higher quality)', () => {
    expect(QUALITY_PRESETS.draft.crf).toBeGreaterThan(QUALITY_PRESETS.normal.crf);
    expect(QUALITY_PRESETS.normal.crf).toBeGreaterThan(QUALITY_PRESETS.high.crf);
  });

  it('pins the historical bitsPerPixel and audioBitrate values', () => {
    expect(QUALITY_PRESETS.draft.bitsPerPixel).toBe(2);
    expect(QUALITY_PRESETS.normal.bitsPerPixel).toBe(4);
    expect(QUALITY_PRESETS.high.bitsPerPixel).toBe(8);
    expect(QUALITY_PRESETS.draft.audioBitrate).toBe(96_000);
    expect(QUALITY_PRESETS.normal.audioBitrate).toBe(128_000);
    expect(QUALITY_PRESETS.high.audioBitrate).toBe(192_000);
  });
});

describe('bitrateForQuality', () => {
  const W = 1920;
  const H = 1080;
  // Legacy formula reference: baseline = width * height * 4 bits/pixel,
  // halved for draft and doubled for high.
  const base = W * H * 4;

  it('returns the ~4 bits-per-pixel baseline for normal quality', () => {
    expect(bitrateForQuality('normal', W, H)).toBe(base);
  });

  it('halves the baseline for draft and doubles it for high', () => {
    expect(bitrateForQuality('draft', W, H)).toBe(Math.round(base * 0.5));
    expect(bitrateForQuality('high', W, H)).toBe(Math.round(base * 2));
  });

  it('matches the exact pre-unification values at 1080p', () => {
    expect(bitrateForQuality('draft', W, H)).toBe(4_147_200);
    expect(bitrateForQuality('normal', W, H)).toBe(8_294_400);
    expect(bitrateForQuality('high', W, H)).toBe(16_588_800);
  });

  it('orders bitrate draft < normal < high', () => {
    expect(bitrateForQuality('draft', W, H)).toBeLessThan(bitrateForQuality('normal', W, H));
    expect(bitrateForQuality('normal', W, H)).toBeLessThan(bitrateForQuality('high', W, H));
  });

  it('scales with resolution', () => {
    expect(bitrateForQuality('normal', 640, 480)).toBeLessThan(bitrateForQuality('normal', W, H));
  });
});

describe('ORIENTATION_DIMENSIONS', () => {
  it('landscape is wider than tall, portrait is taller than wide', () => {
    const orientations: VideoOrientation[] = ['landscape', 'portrait'];
    for (const o of orientations) {
      const dims = ORIENTATION_DIMENSIONS[o];
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);
    }
    expect(ORIENTATION_DIMENSIONS.landscape.width).toBeGreaterThan(
      ORIENTATION_DIMENSIONS.landscape.height,
    );
    expect(ORIENTATION_DIMENSIONS.portrait.height).toBeGreaterThan(
      ORIENTATION_DIMENSIONS.portrait.width,
    );
  });
});

describe('resolveDimensions', () => {
  it('defaults to landscape dimensions when nothing is specified', () => {
    expect(resolveDimensions({})).toEqual(ORIENTATION_DIMENSIONS.landscape);
  });

  it('applies portrait defaults when orientation is portrait', () => {
    expect(resolveDimensions({ orientation: 'portrait' })).toEqual(ORIENTATION_DIMENSIONS.portrait);
  });

  it('explicit width/height override orientation defaults', () => {
    expect(resolveDimensions({ orientation: 'portrait', width: 640, height: 480 })).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('allows overriding only one dimension', () => {
    expect(resolveDimensions({ width: 1280 })).toEqual({
      width: 1280,
      height: ORIENTATION_DIMENSIONS.landscape.height,
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  QUALITY_PRESETS,
  ORIENTATION_DIMENSIONS,
  resolveDimensions,
  type VideoQuality,
  type VideoOrientation,
} from '../types.js';

describe('QUALITY_PRESETS', () => {
  it('defines a preset + crf for every quality level', () => {
    const levels: VideoQuality[] = ['draft', 'normal', 'high'];
    for (const level of levels) {
      const preset = QUALITY_PRESETS[level];
      expect(preset.preset).toBeTruthy();
      expect(preset.crf).toBeGreaterThanOrEqual(0);
      expect(preset.crf).toBeLessThanOrEqual(51);
    }
  });

  it('orders quality by descending crf (lower crf = higher quality)', () => {
    expect(QUALITY_PRESETS.draft.crf).toBeGreaterThan(QUALITY_PRESETS.normal.crf);
    expect(QUALITY_PRESETS.normal.crf).toBeGreaterThan(QUALITY_PRESETS.high.crf);
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

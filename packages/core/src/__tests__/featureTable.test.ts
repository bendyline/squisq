import { describe, expect, it } from 'vitest';
import { featureTableAspect, fitFeatureTable } from '../doc/featureTable.js';

const speeds = {
  headers: ['Device and engine', 'Hardware', 'Qwen output tok/s', 'Gemma output tok/s'],
  rows: [
    [
      'Windows x64 desktop\n64 GB, AMD\nllama.cpp + Vulkan',
      'Ryzen 9 7950X3D, Radeon AI PRO R9700',
      '57.1',
      '129.4',
    ],
    ['Apple MacBook Pro\nMLX', 'M5 Max, 128 GB RAM', '28.0 (MTP)', '36.0 (no MTP drafter)'],
    [
      'RTX Spark laptop\nWindows arm64\nllama.cpp + CUDA',
      '64 GB (40 GB GPU, 24 GB CPU)',
      '26.4',
      '66.2',
    ],
  ],
};

describe('fitFeatureTable', () => {
  it('sets the type as large as the box allows, wrapping long cells', () => {
    const wide = fitFeatureTable(speeds, { width: 1650, height: 560 }, 32, 9);
    const narrow = fitFeatureTable(speeds, { width: 820, height: 560 }, 32, 9);
    expect(wide.fontSize).toBeGreaterThan(narrow.fontSize);
    expect(wide.height).toBeLessThanOrEqual(560);
  });

  it('keeps each cell’s own line breaks', () => {
    const box = { width: 1600, height: 600 };
    const stacked = fitFeatureTable({ headers: ['X'], rows: [['one\ntwo\nthree']] }, box, 30, 9);
    const inline = fitFeatureTable({ headers: ['X'], rows: [['one two three']] }, box, 30, 9);
    expect(stacked.height).toBeGreaterThan(inline.height);
    expect(featureTableAspect({ headers: ['X'], rows: [['one\ntwo\nthree']] })).toBeLessThan(
      featureTableAspect({ headers: ['X'], rows: [['one two three']] }),
    );
  });

  it('never exceeds the largest size and keeps a short table only as tall as its rows', () => {
    const small = { headers: ['A', 'B'], rows: [['1', '2']] };
    const fit = fitFeatureTable(small, { width: 1600, height: 600 }, 30, 9);
    expect(fit.fontSize).toBe(30);
    expect(fit.height).toBeLessThan(300);
  });

  it('falls back to the smallest size and the whole box when nothing fits', () => {
    const tall = { headers: ['Row'], rows: Array.from({ length: 200 }, (_, i) => [`Row ${i}`]) };
    expect(fitFeatureTable(tall, { width: 800, height: 300 }, 30, 9)).toEqual({
      fontSize: 9,
      height: 300,
    });
  });
});

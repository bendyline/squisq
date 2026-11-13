import { describe, expect, it } from 'vitest';
import { createPeakAccumulator } from '../mediaEdit/waveformPeaks.js';

describe('createPeakAccumulator', () => {
  it('keeps the loudest sample of each slice, across block boundaries', () => {
    // 100 Hz, 10 peaks a second: ten samples per slice.
    const peaks = createPeakAccumulator(100, 10);
    const first = new Float32Array(15);
    first[3] = 0.5;
    first[12] = -0.8;
    const second = new Float32Array(15);
    second[2] = 0.25; // sample 17: still the second slice
    second[14] = 0.6; // sample 29: the third
    peaks.push([first]);
    peaks.push([second]);
    const result = peaks.finish();
    expect(Array.from(result).map((p) => Number(p.toFixed(2)))).toEqual([0.5, 0.8, 0.6]);
  });

  it('takes the louder channel', () => {
    const peaks = createPeakAccumulator(100, 10);
    const left = new Float32Array(10).fill(0.1);
    const right = new Float32Array(10).fill(-0.7);
    peaks.push([left, right]);
    expect(peaks.finish()[0]).toBeCloseTo(0.7);
  });

  it('grows past its expected length and ignores empty blocks', () => {
    const peaks = createPeakAccumulator(100, 10, 20);
    peaks.push([new Float32Array(0)]);
    for (let i = 0; i < 50; i++) peaks.push([new Float32Array(100).fill(i / 100)]);
    const result = peaks.finish();
    expect(result).toHaveLength(500);
    expect(result[499]).toBeCloseTo(0.49);
  });

  it('counts a partial last slice', () => {
    const peaks = createPeakAccumulator(100, 10);
    peaks.push([new Float32Array(25).fill(0.3)]);
    expect(peaks.finish()).toHaveLength(3);
  });
});

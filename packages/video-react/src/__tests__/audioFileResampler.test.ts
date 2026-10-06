/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { createResampler, resampledLength } from '../audioFile/resampler.js';

function sine(frames: number, rate: number, hz: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function resampleWhole(input: Float32Array, from: number, to: number): Float32Array {
  const resampler = createResampler(from, to);
  return concat([resampler.process(input), resampler.flush()]);
}

describe('streaming resampler', () => {
  it.each([
    [24_000, 48_000],
    [24_000, 44_100],
    [48_000, 24_000],
    [22_050, 48_000],
    [44_100, 48_000],
  ])('%i Hz → %i Hz yields ceil(n · out / in) frames', (from, to) => {
    const frames = 12_345;
    const output = resampleWhole(new Float32Array(frames), from, to);
    expect(output.length).toBe(resampledLength(frames, from, to));
    expect(output.length).toBe(Math.ceil((frames * to) / from));
  });

  it('doubles a 24 kHz stream exactly (one second → 48 000 frames)', () => {
    expect(resampleWhole(new Float32Array(24_000), 24_000, 48_000).length).toBe(48_000);
  });

  it('is invisible at chunk boundaries: pieces resample exactly like the whole', () => {
    const input = sine(10_000, 24_000, 440);
    const whole = resampleWhole(input, 24_000, 44_100);

    const resampler = createResampler(24_000, 44_100);
    const parts: Float32Array[] = [];
    const sizes = [1, 7, 333, 1024, 2, 4000, 99];
    let offset = 0;
    let index = 0;
    while (offset < input.length) {
      const size = sizes[index++ % sizes.length];
      parts.push(resampler.process(input.subarray(offset, offset + size)));
      offset += size;
    }
    parts.push(resampler.flush());
    const pieced = concat(parts);

    expect(pieced.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(pieced[i]).toBeCloseTo(whole[i], 6);
  });

  it('keeps a constant signal constant away from the stream edges (unity DC gain)', () => {
    const output = resampleWhole(new Float32Array(4_800).fill(0.25), 24_000, 48_000);
    for (let i = 100; i < output.length - 100; i++) expect(output[i]).toBeCloseTo(0.25, 4);
  });

  it('reconstructs an in-band tone accurately when upsampling', () => {
    const from = 24_000;
    const to = 48_000;
    const hz = 1_000;
    const output = resampleWhole(sine(from, from, hz), from, to);
    const expected = sine(output.length, to, hz);
    let worst = 0;
    for (let i = 200; i < output.length - 200; i++) {
      worst = Math.max(worst, Math.abs(output[i] - expected[i]));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('suppresses content above the new Nyquist when downsampling', () => {
    // 15 kHz is representable at 48 kHz but not at 24 kHz (Nyquist 12 kHz).
    const output = resampleWhole(sine(48_000, 48_000, 15_000), 48_000, 24_000);
    let peak = 0;
    for (let i = 200; i < output.length - 200; i++) peak = Math.max(peak, Math.abs(output[i]));
    expect(peak).toBeLessThan(0.01);
  });

  it('returns nothing for empty input and is spent after flush', () => {
    const resampler = createResampler(24_000, 48_000);
    expect(resampler.process(new Float32Array(0)).length).toBe(0);
    expect(resampler.flush().length).toBe(0);
    expect(resampler.flush().length).toBe(0);
    expect(() => resampler.process(new Float32Array(4))).toThrow('already flushed');
  });

  it('rejects non-integer or non-positive rates', () => {
    expect(() => createResampler(0, 48_000)).toThrow(RangeError);
    expect(() => createResampler(24_000.5, 48_000)).toThrow(RangeError);
  });

  it('quantizes phases for rate pairs with very many distinct phases', () => {
    // gcd(48_001, 44_100) = 1 → 44 100 phases, quantized to a bounded table.
    const frames = 4_801;
    const output = resampleWhole(new Float32Array(frames).fill(0.5), 48_001, 44_100);
    expect(output.length).toBe(resampledLength(frames, 48_001, 44_100));
    for (let i = 100; i < output.length - 100; i++) expect(output[i]).toBeCloseTo(0.5, 3);
  });
});

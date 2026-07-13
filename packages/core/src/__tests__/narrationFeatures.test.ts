import { describe, it, expect } from 'vitest';
import { createFeatureState, extractFrameFeatures, featureStep } from '../narration/features';
import { tone, noise } from './narrationTestSignals';

const RATES = [48000, 44100];

describe('extractFrameFeatures', () => {
  it.each(RATES)('band energy passes speech band and rejects hum/hiss @ %d Hz', (sr) => {
    const inBand = extractFrameFeatures(tone(1000, 0.5, sr), sr);
    const hum = extractFrameFeatures(tone(60, 0.5, sr), sr);
    const hiss = extractFrameFeatures(tone(8000, 0.5, sr), sr);

    // Skip filter warm-up frames; compare steady-state medians.
    const median = (frames: { bandEnergy: number }[]) => {
      const vals = frames
        .slice(5)
        .map((f) => f.bandEnergy)
        .sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)];
    };
    expect(median(inBand)).toBeGreaterThan(median(hum) * 10);
    expect(median(inBand)).toBeGreaterThan(median(hiss) * 10);
  });

  it.each(RATES)('zcr orders noise above tone @ %d Hz', (sr) => {
    const noisy = extractFrameFeatures(noise(0.3, sr, 0.2, 7), sr);
    const tonal = extractFrameFeatures(tone(300, 0.3, sr), sr);
    expect(noisy[5].zcr).toBeGreaterThan(tonal[5].zcr);
  });

  it('rms measures a known-amplitude tone (~amp/√2)', () => {
    const sr = 48000;
    const frames = extractFrameFeatures(tone(440, 0.3, sr, 0.5), sr);
    expect(frames[5].rms).toBeGreaterThan(0.3);
    expect(frames[5].rms).toBeLessThan(0.4);
  });

  it.each(RATES)('streaming chunks produce the same frames as one batch @ %d Hz', (sr) => {
    const pcm = noise(0.5, sr, 0.1, 42);
    const batch = extractFrameFeatures(pcm, sr);

    let state = createFeatureState(sr);
    const streamed: ReturnType<typeof extractFrameFeatures> = [];
    // Uneven chunk sizes exercise the carry logic.
    const chunks = [100, 1024, 333, 4096, 57];
    let offset = 0;
    let pick = 0;
    while (offset < pcm.length) {
      const size = Math.min(chunks[pick++ % chunks.length], pcm.length - offset);
      const step = featureStep(state, pcm.subarray(offset, offset + size));
      state = step.state;
      streamed.push(...step.frames);
      offset += size;
    }

    expect(streamed.length).toBe(batch.length);
    for (let i = 0; i < batch.length; i++) {
      expect(streamed[i].tSec).toBeCloseTo(batch[i].tSec, 9);
      expect(streamed[i].rms).toBeCloseTo(batch[i].rms, 9);
      expect(streamed[i].bandEnergy).toBeCloseTo(batch[i].bandEnergy, 9);
      expect(streamed[i].zcr).toBeCloseTo(batch[i].zcr, 9);
    }
  });

  it('frame centers advance by the hop', () => {
    const sr = 48000;
    const frames = extractFrameFeatures(noise(0.3, sr, 0.1, 3), sr, { hopSec: 0.02 });
    expect(frames.length).toBeGreaterThan(5);
    expect(frames[1].tSec - frames[0].tSec).toBeCloseTo(0.02, 3);
  });
});

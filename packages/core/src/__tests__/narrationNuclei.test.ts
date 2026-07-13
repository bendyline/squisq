import { describe, it, expect } from 'vitest';
import { extractFrameFeatures } from '../narration/features';
import { createVadState, vadStep } from '../narration/vad';
import { detectSyllableOnsets } from '../narration/nuclei';
import { syllableTrain } from './narrationTestSignals';

const SR = 48000;

function detect(pcm: Float32Array): number[] {
  const frames = extractFrameFeatures(pcm, SR, { hopSec: 0.01 });
  let vad = createVadState();
  const flags = frames.map((f) => {
    vad = vadStep(vad, f);
    return vad.speaking;
  });
  return detectSyllableOnsets(frames, flags);
}

describe('detectSyllableOnsets', () => {
  it('finds each burst in a syllable train (±1 count, ±60 ms timing)', () => {
    const truth = [0.6, 0.9, 1.2, 1.5, 2.2, 2.5, 2.8, 3.6, 3.9, 4.2, 4.5, 4.8];
    const onsets = detect(syllableTrain(truth, SR, { seed: 11 }));
    expect(Math.abs(onsets.length - truth.length)).toBeLessThanOrEqual(1);

    // Each detected onset lies near some true burst (peak ≈ burst center,
    // so allow the 80 ms half-burst plus 60 ms tolerance).
    for (const t of onsets) {
      const nearest = Math.min(...truth.map((x) => Math.abs(t - (x + 0.08))));
      expect(nearest).toBeLessThanOrEqual(0.06 + 0.04);
    }
  });

  it('suppresses double-bursts closer than the minimum spacing', () => {
    // Two bursts 60 ms apart → their envelopes merge / spacing gate fires:
    // at most one onset in that neighborhood.
    const onsets = detect(syllableTrain([1.0, 1.06, 2.0], SR, { seed: 12 }));
    const nearOne = onsets.filter((t) => t > 0.8 && t < 1.5);
    expect(nearOne.length).toBeLessThanOrEqual(1);
  });

  it('reports nothing on silence/noise', () => {
    const onsets = detect(syllableTrain([], SR, { totalSec: 2, seed: 13 }));
    expect(onsets.length).toBe(0);
  });
});

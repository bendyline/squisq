import { describe, it, expect } from 'vitest';
import { extractFrameFeatures } from '../narration/features';
import { createVadState, vadStep } from '../narration/vad';
import { concat, noise, speechBurst } from './narrationTestSignals';

const SR = 48000;

function runVad(pcm: Float32Array) {
  const frames = extractFrameFeatures(pcm, SR);
  let state = createVadState();
  const flags: boolean[] = [];
  for (const frame of frames) {
    state = vadStep(state, frame);
    flags.push(state.speaking);
  }
  return { frames, flags };
}

describe('vadStep', () => {
  it('enters within 100 ms of speech onset and exits within hangover + 100 ms', () => {
    const quiet = 0.004;
    const pcm = concat(noise(1.0, SR, quiet, 1), speechBurst(0.8, SR, 2), noise(1.2, SR, quiet, 3));
    const { frames, flags } = runVad(pcm);

    const burstStart = 1.0;
    const burstEnd = 1.8;
    const enterIdx = flags.findIndex((f) => f);
    expect(enterIdx).toBeGreaterThan(-1);
    // Hann envelope reaches useful energy ~15% in, so allow 100 ms + ramp.
    expect(frames[enterIdx].tSec).toBeGreaterThan(burstStart);
    expect(frames[enterIdx].tSec).toBeLessThan(burstStart + 0.25);

    let lastSpeaking = -1;
    for (let i = 0; i < flags.length; i++) if (flags[i]) lastSpeaking = i;
    expect(lastSpeaking).toBeGreaterThan(-1);
    // Envelope tails off before burstEnd; exit must happen within
    // (ramp-down ~0.15) + hangover 0.3 + margin 0.1 of the burst end.
    expect(frames[lastSpeaking].tSec).toBeLessThan(burstEnd + 0.45);
    expect(frames[lastSpeaking].tSec).toBeGreaterThan(burstEnd - 0.45);
  });

  it('detects no speech on steady noise', () => {
    const { flags } = runVad(noise(3, SR, 0.01, 9));
    expect(flags.some(Boolean)).toBe(false);
  });

  it('adapts the floor to a noise step without flapping', () => {
    // −40 dB → −30 dB noise step: the step transient may read as speech,
    // but the dip-starved rebaseline (1.5 s of zero dips) must adopt the
    // new floor and settle back to silence — permanently.
    const pcm = concat(noise(2, SR, 0.01, 4), noise(4, SR, 0.0316, 5));
    const { frames, flags } = runVad(pcm);
    const tail = flags.filter((_, i) => frames[i].tSec > 3.8);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.some(Boolean)).toBe(false);
  });

  it('still detects speech over the louder floor after adapting', () => {
    const pcm = concat(noise(2, SR, 0.0316, 6), speechBurst(0.6, SR, 7), noise(0.8, SR, 0.0316, 8));
    const { frames, flags } = runVad(pcm);
    const speakingTimes = frames.filter((_, i) => flags[i]).map((f) => f.tSec);
    expect(speakingTimes.length).toBeGreaterThan(0);
    expect(Math.min(...speakingTimes)).toBeGreaterThan(1.9);
    expect(Math.min(...speakingTimes)).toBeLessThan(2.3);
  });
});

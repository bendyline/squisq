import { describe, it, expect } from 'vitest';
import {
  createPacingState,
  pacingStep,
  reanchorPacing,
  type PacingState,
  type PacingTick,
} from '../narration/pacing';
import { expectedSyllablesAt } from '../narration/script';
import { DEFAULT_PACING_CONFIG } from '../narration/types';
import { scriptFromMarkdown } from './narrationTestSignals';

const MD = `# Cadence

The quick brown fox jumps over the lazy dog while we keep a steady pace for this test.
It continues with more plain words that carry roughly one or two syllables each one.

Another paragraph starts after a pause and keeps going with the same easy words for a while.

## Second Section

More text lives here so the script is long enough that the prompter never runs off the end.
The prompter should track the reader through all of it without drifting away from the voice.
`;

const script = scriptFromMarkdown(MD);
const BASE_WPS = DEFAULT_PACING_CONFIG.baseWpm / 60;
const DT = 0.02;

/** Drive the controller with speaking ticks emitting onsets at `sylRate` (syl/s). */
function drive(
  state: PacingState,
  fromSec: number,
  durSec: number,
  opts: { speaking: boolean; sylRate?: number },
): PacingState {
  let acc = 0;
  let next = state;
  for (let t = fromSec; t < fromSec + durSec; t += DT) {
    let onsets = 0;
    if (opts.speaking && opts.sylRate) {
      acc += opts.sylRate * DT;
      while (acc >= 1) {
        onsets += 1;
        acc -= 1;
      }
    }
    const tick: PacingTick = { tSec: t, speaking: opts.speaking, onsets };
    next = pacingStep(next, tick, script);
  }
  return next;
}

const meanSylPerWord = script.totalSyllables / script.tokens.length;

describe('pacingStep', () => {
  it('halts within 250 ms of silence', () => {
    let state = drive(createPacingState(), 0, 3, {
      speaking: true,
      sylRate: BASE_WPS * meanSylPerWord,
    });
    expect(state.velocityWps).toBeGreaterThan(BASE_WPS * 0.5);
    const velocityAtSilence = state.velocityWps;
    state = drive(state, 3, 0.25, { speaking: false });
    expect(state.velocityWps).toBeLessThan(velocityAtSilence * 0.05);
    state = drive(state, 3.25, 0.3, { speaking: false });
    expect(state.velocityWps).toBe(0);
    expect(state.halted).toBe(true);
  });

  it('converges to the reader rate (steady 1.0× and 0.5×)', () => {
    for (const mult of [1.0, 0.5]) {
      const sylRate = mult * BASE_WPS * meanSylPerWord;
      const state = drive(createPacingState(), 0, 8, { speaking: true, sylRate });
      // The real invariant is voice lock: the prompter position stays
      // syllable-consistent with what was actually spoken (word-slope
      // varies legitimately with local word length).
      const drift =
        expectedSyllablesAt(script, state.wordPos) -
        (state.anchorExpectedSyl + state.cumDetectedSyl);
      expect(Math.abs(drift)).toBeLessThan(5);
      // Average slope lands in a generous band around the reader rate.
      const slope = state.wordPos / 8;
      expect(slope).toBeGreaterThan(mult * BASE_WPS * 0.7);
      expect(slope).toBeLessThan(mult * BASE_WPS * 1.3);
    }
  });

  it('clamps velocity at the rate-multiplier bounds', () => {
    // Absurdly fast reader: velocity must respect the 2.0× clamp even
    // though hard resyncs may jump the position.
    let state = createPacingState();
    let acc = 0;
    const sylRate = 5 * BASE_WPS * meanSylPerWord;
    for (let t = 0; t < 5; t += DT) {
      acc += sylRate * DT;
      let onsets = 0;
      while (acc >= 1) {
        onsets += 1;
        acc -= 1;
      }
      state = pacingStep(state, { tSec: t, speaking: true, onsets }, script);
      expect(state.velocityWps).toBeLessThanOrEqual(
        BASE_WPS * DEFAULT_PACING_CONFIG.maxRateMult * (1 + DEFAULT_PACING_CONFIG.maxCorrection) +
          1e-9,
      );
    }
  });

  it('silence at a paragraph break accrues no PI error', () => {
    // Park the prompter right on a paragraph-break token.
    const breakToken = script.tokens.findIndex((t) => t.pauseAfter >= 2);
    expect(breakToken).toBeGreaterThan(-1);
    let state = reanchorPacing(createPacingState(), breakToken + 0.9, script);
    state = drive(state, 0, 2.5, { speaking: false });
    expect(Math.abs(state.errIntegral)).toBeLessThan(1e-9);
    expect(state.velocityWps).toBe(0);
  });

  it('silence mid-sentence does accrue PI error', () => {
    // Park mid-sentence (pauseAfter 0 run) and let it drift ahead first.
    const midIdx = script.tokens.findIndex(
      (t, i) =>
        t.pauseAfter === 0 &&
        script.tokens.slice(Math.max(0, i - 1), i + 3).every((x) => x.pauseAfter < 2),
    );
    expect(midIdx).toBeGreaterThan(-1);
    const anchored0 = reanchorPacing(createPacingState(), midIdx, script);
    // Advance the prompter ahead of zero detected syllables, then go silent.
    let state = { ...anchored0, wordPos: Math.min(script.tokens.length, midIdx + 3) };
    state = drive(state, 0, 2.0, { speaking: false });
    expect(Math.abs(state.errIntegral)).toBeGreaterThan(0.1);
  });

  it('reanchorPacing resets error tracking but keeps the learned rate', () => {
    const state = drive(createPacingState(), 0, 4, {
      speaking: true,
      sylRate: BASE_WPS * meanSylPerWord,
    });
    const ema = state.emaSylPerSec;
    expect(ema).toBeGreaterThan(0);
    const anchored = reanchorPacing(state, 5, script);
    expect(anchored.wordPos).toBe(5);
    expect(anchored.cumDetectedSyl).toBe(0);
    expect(anchored.errIntegral).toBe(0);
    expect(anchored.emaSylPerSec).toBe(ema);
  });

  it('is pure: identical tick sequences yield identical states', () => {
    const run = () => {
      let state = createPacingState();
      state = drive(state, 0, 2, { speaking: true, sylRate: 4 });
      state = drive(state, 2, 1, { speaking: false });
      state = drive(state, 3, 2, { speaking: true, sylRate: 6 });
      return state;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('never leaves the script bounds', () => {
    let state = createPacingState();
    state = drive(state, 0, 60, { speaking: true, sylRate: 40 });
    expect(state.wordPos).toBeLessThanOrEqual(script.tokens.length);
    expect(state.wordPos).toBeGreaterThanOrEqual(0);
  });
});

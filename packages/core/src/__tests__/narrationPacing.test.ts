import { describe, it, expect } from 'vitest';
import {
  createPacingState,
  pacingStep,
  reanchorPacing,
  type PacingState,
  type PacingTick,
} from '../narration/pacing';
import { expectedSyllablesAt } from '../narration/script';
import { DEFAULT_PACING_CONFIG, type PacingConfig } from '../narration/types';
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
  config?: Partial<PacingConfig>,
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
    next = pacingStep(next, tick, script, config);
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

  it('tracks the reader rate monotonically', () => {
    // Faster reading → faster prompter is the whole point of voice pacing.
    let prevSlope = 0;
    for (const mult of [0.6, 1.0, 1.8]) {
      const sylRate = mult * BASE_WPS * meanSylPerWord;
      const state = drive(createPacingState(), 0, 8, { speaking: true, sylRate });
      const slope = state.wordPos / 8;
      expect(slope).toBeGreaterThan(prevSlope);
      prevSlope = slope;
    }
  });

  it('stays word-aligned when the reader matches the set pace', () => {
    const sylRate = BASE_WPS * meanSylPerWord;
    const state = drive(createPacingState(), 0, 8, { speaking: true, sylRate });
    const drift =
      expectedSyllablesAt(script, state.wordPos) - (state.anchorExpectedSyl + state.cumDetectedSyl);
    expect(Math.abs(drift)).toBeLessThan(6);
  });

  it('the WPM setting is a live lever: higher baseWpm → faster cruise', () => {
    // Same modest voice rate, different set pace. Because the set pace is a
    // real feedforward term (not cancelled), doubling baseWpm must visibly
    // speed the prompter up — the bug the user reported.
    const sylRate = 0.8 * BASE_WPS * meanSylPerWord;
    const slow = drive(createPacingState(), 0, 8, { speaking: true, sylRate });
    const fast = drive(createPacingState(), 0, 8, { speaking: true, sylRate }, { baseWpm: 260 });
    expect(fast.wordPos).toBeGreaterThan(slow.wordPos * 1.3);
  });

  it('never crawls below the set pace floor while speaking', () => {
    // A detector that reports almost nothing must still cruise near the set
    // pace (blend keeps baseWps in play) — so the prompter can't stall out
    // when syllable detection under-counts.
    const state = drive(createPacingState(), 0, 6, { speaking: true, sylRate: 0.05 });
    const slope = state.wordPos / 6;
    expect(slope).toBeGreaterThan(BASE_WPS * DEFAULT_PACING_CONFIG.minRateMult * 0.8);
  });

  it('clamps velocity at the cruise-band bounds', () => {
    // Absurdly fast reader: velocity respects the maxRateMult × set-pace
    // clamp (plus the bounded PI correction).
    let state = createPacingState();
    let acc = 0;
    const sylRate = 6 * BASE_WPS * meanSylPerWord;
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

  it('silence halts the prompter and never drags it backward', () => {
    // Park mid-script ahead of the detected syllables, then go silent. An
    // under-counting detector makes err > 0 ("prompter ahead"); the
    // forward-only correction must NOT slow or rewind — the prompter simply
    // holds position (velocity halts) rather than snapping back.
    const startPos = Math.min(20, script.tokens.length - 1);
    const anchored = reanchorPacing(createPacingState(), startPos, script);
    const state = drive({ ...anchored, wordPos: startPos + 3 }, 0, 2.5, { speaking: false });
    expect(state.velocityWps).toBe(0);
    expect(state.wordPos).toBeGreaterThanOrEqual(startPos + 3 - 1e-9);
  });

  it('catches up forward when the reader is ahead of the prompter', () => {
    // Feed a strong syllable stream while the prompter starts behind: the
    // forward-only boost (and, past the threshold, a forward resync) must
    // pull the highlight forward to meet the voice.
    const state = drive(createPacingState(), 0, 6, {
      speaking: true,
      sylRate: 2 * BASE_WPS * meanSylPerWord,
    });
    const detected = state.cumDetectedSyl;
    // The prompter should have advanced to roughly where those syllables land.
    const expectedPos = expectedSyllablesAt(script, state.wordPos);
    expect(expectedPos).toBeGreaterThan(detected * 0.6);
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

/**
 * The teleprompter pacing controller.
 *
 * A pure, deterministic step function: given the current state, one
 * analysis tick (VAD flag + syllable onsets), and the script, produce
 * the next state. The prompter position (`wordPos`) advances at a
 * velocity that (a) halts within ~250 ms of silence, (b) tracks the
 * reader's detected syllable rate while speaking, and (c) is corrected
 * by a PI loop on cumulative detected-vs-expected syllables so the
 * highlight can't drift arbitrarily far from the voice. Silence near an
 * expected paragraph/block break is legitimate and accrues no error.
 */

import { expectedSyllablesAt, wordPosAtExpectedSyllables } from './script.js';
import type { NarrationScript, PacingConfig } from './types.js';
import { DEFAULT_PACING_CONFIG } from './types.js';

export interface PacingTick {
  tSec: number;
  speaking: boolean;
  /** Syllable onsets detected in this tick (0 or 1 for frame-sized ticks). */
  onsets: number;
}

export interface PacingState {
  /** Fractional word position — the active token is `floor(wordPos)`. */
  wordPos: number;
  /** Current scroll velocity in words per second. */
  velocityWps: number;
  /** EMA of the detected syllable rate (syl/s); 0 until two onsets arrive. */
  emaSylPerSec: number;
  lastOnsetTSec: number | null;
  /** Syllables detected since the last anchor. */
  cumDetectedSyl: number;
  /** Expected cumulative syllables at the last anchor position. */
  anchorExpectedSyl: number;
  /** PI integral of the cumulative-syllable error (syl·s). */
  errIntegral: number;
  /** Continuous silence observed so far (s). */
  silenceSec: number;
  lastTSec: number | null;
  /** True when silent and fully stopped. */
  halted: boolean;
}

export function createPacingState(startWordPos = 0): PacingState {
  return {
    wordPos: startWordPos,
    velocityWps: 0,
    emaSylPerSec: 0,
    lastOnsetTSec: null,
    cumDetectedSyl: 0,
    anchorExpectedSyl: 0,
    errIntegral: 0,
    silenceSec: 0,
    lastTSec: null,
    halted: true,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Is `wordPos` within `lookahead` words of a paragraph/block break (or just past one)? */
function nearExpectedBreak(script: NarrationScript, wordPos: number, lookahead: number): boolean {
  const n = script.tokens.length;
  if (n === 0) return true;
  const from = Math.max(0, Math.floor(wordPos) - 1);
  const to = Math.min(n - 1, Math.floor(wordPos + lookahead));
  for (let i = from; i <= to; i++) {
    if (script.tokens[i].pauseAfter >= 2) return true;
  }
  return false;
}

/** Mean syllables-per-word over a short window ahead of the prompter position. */
function localSyllablesPerWord(
  script: NarrationScript,
  wordPos: number,
  windowWords: number,
): number {
  const n = script.tokens.length;
  if (n === 0) return 1;
  const start = clamp(Math.floor(wordPos), 0, n - 1);
  const end = Math.min(n, start + Math.max(1, windowWords));
  let sum = 0;
  for (let i = start; i < end; i++) sum += script.tokens[i].syllables;
  return Math.max(1, sum / (end - start));
}

/** Pure controller step — same inputs always yield the same output state. */
export function pacingStep(
  state: PacingState,
  tick: PacingTick,
  script: NarrationScript,
  config?: Partial<PacingConfig>,
): PacingState {
  const c = { ...DEFAULT_PACING_CONFIG, ...config };
  const baseWps = c.baseWpm / 60;
  const dt = clamp(tick.tSec - (state.lastTSec ?? tick.tSec), 0, 0.25);

  // 1. Onset bookkeeping: cumulative count + inter-onset-interval rate EMA.
  let emaSylPerSec = state.emaSylPerSec;
  let lastOnsetTSec = state.lastOnsetTSec;
  let cumDetectedSyl = state.cumDetectedSyl;
  for (let k = 0; k < tick.onsets; k++) {
    if (lastOnsetTSec !== null) {
      const ioi = tick.tSec - lastOnsetTSec;
      if (ioi > 0) {
        const instRate = clamp(1 / ioi, 0.5, 12);
        const alpha = 1 - Math.exp(-ioi / c.rateEmaTauSec);
        emaSylPerSec =
          emaSylPerSec === 0 ? instRate : emaSylPerSec + (instRate - emaSylPerSec) * alpha;
      }
    }
    lastOnsetTSec = tick.tSec;
    cumDetectedSyl += 1;
  }

  // 2–3. Voice-derived rate multiplier around the user's base rate.
  const sylPerWordLocal = localSyllablesPerWord(script, state.wordPos, c.sylWindowWords);
  const rateMult =
    emaSylPerSec > 0
      ? clamp(emaSylPerSec / sylPerWordLocal / baseWps, c.minRateMult, c.maxRateMult)
      : 1;

  // 4–5. PI correction on cumulative syllables; paragraph pauses are free.
  const err =
    expectedSyllablesAt(script, state.wordPos) - (state.anchorExpectedSyl + cumDetectedSyl);
  const pausedAtBreak =
    !tick.speaking && nearExpectedBreak(script, state.wordPos, c.breakLookaheadWords);
  let errIntegral = state.errIntegral;
  let effErr = err;
  if (pausedAtBreak) {
    effErr = 0;
  } else {
    errIntegral = clamp(errIntegral + err * dt, -c.intClamp, c.intClamp);
  }
  const corr = clamp(c.kP * effErr + c.kI * errIntegral, -c.maxCorrection, c.maxCorrection);

  // 6. Velocity: track while speaking, decay to a halt in silence.
  let velocityWps = state.velocityWps;
  let silenceSec = state.silenceSec;
  if (tick.speaking) {
    silenceSec = 0;
    const target = Math.max(0, baseWps * rateMult * (1 - corr));
    velocityWps += (target - velocityWps) * (1 - Math.exp(-dt / c.velSlewTauSec));
  } else {
    silenceSec += dt;
    velocityWps *= Math.exp(-dt / c.haltTauSec);
    if (velocityWps < 0.02) velocityWps = 0;
  }

  // 7. Hard resync when the highlight has drifted a paragraph away.
  let wordPos = state.wordPos;
  if (Math.abs(err) > c.resyncSyllables) {
    wordPos = wordPosAtExpectedSyllables(script, state.anchorExpectedSyl + cumDetectedSyl);
    errIntegral = 0;
  }

  // 8. Integrate.
  wordPos = clamp(wordPos + velocityWps * dt, 0, script.tokens.length);

  return {
    wordPos,
    velocityWps,
    emaSylPerSec,
    lastOnsetTSec,
    cumDetectedSyl,
    anchorExpectedSyl: state.anchorExpectedSyl,
    errIntegral,
    silenceSec,
    lastTSec: tick.tSec,
    halted: !tick.speaking && velocityWps === 0,
  };
}

/**
 * Re-anchor after a manual nudge/scroll: the new position becomes the
 * zero-error reference. The learned rate EMA survives.
 */
export function reanchorPacing(
  state: PacingState,
  wordPos: number,
  script: NarrationScript,
): PacingState {
  const pos = clamp(wordPos, 0, script.tokens.length);
  return {
    ...state,
    wordPos: pos,
    anchorExpectedSyl: expectedSyllablesAt(script, pos),
    cumDetectedSyl: 0,
    errIntegral: 0,
  };
}

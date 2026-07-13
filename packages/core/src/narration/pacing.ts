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

/**
 * Mean syllables-per-SPOKEN-word over a short window ahead of the prompter
 * position. Standalone punctuation (0 syllables, `spoken: false`) is
 * excluded so it doesn't deflate the average.
 */
function localSyllablesPerWord(
  script: NarrationScript,
  wordPos: number,
  windowWords: number,
): number {
  const n = script.tokens.length;
  if (n === 0) return 1.4;
  const start = clamp(Math.floor(wordPos), 0, n - 1);
  let sum = 0;
  let count = 0;
  for (let i = start; i < n && count < windowWords; i++) {
    if (!script.tokens[i].spoken) continue;
    sum += script.tokens[i].syllables;
    count += 1;
  }
  // Default to the English average (~1.4) when the window has no words yet.
  return count > 0 ? Math.max(1, sum / count) : 1.4;
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

  // 2–3. Cruise velocity: BLEND the user's set pace with the voice-derived
  // rate. The old design used `baseWps · clamp(voiceWps / baseWps)`, in
  // which baseWps algebraically cancels in the unclamped range — so the WPM
  // slider did nothing and a chronically under-counting detector dragged
  // the prompter slow with no way to compensate. Blending keeps the set
  // pace as a real feedforward term (WPM always felt), while the voice
  // steers within a band. Then clamp to a band around the set pace so
  // neither term alone can stall or run away.
  const sylPerWordLocal = localSyllablesPerWord(script, state.wordPos, c.sylWindowWords);
  const voiceWps = emaSylPerSec > 0 ? emaSylPerSec / sylPerWordLocal : baseWps;
  const cruise = clamp(
    c.voiceBlend * voiceWps + (1 - c.voiceBlend) * baseWps,
    baseWps * c.minRateMult,
    baseWps * c.maxRateMult,
  );

  // 4–5. FORWARD-ONLY position correction. `err` compares where the
  // prompter is (expected syllables at wordPos) against how many syllables
  // the voice has actually delivered. err < 0 → the reader is AHEAD of the
  // prompter → speed up to catch them. err > 0 → the prompter looks ahead
  // of the reader, but this is exactly the signal a chronically
  // under-counting syllable detector produces even when the prompter is
  // really BEHIND — so we deliberately do NOT slow or snap backward on it.
  // (The old symmetric PI pinned the prompter to the DETECTED count, so a
  // detector catching half the syllables parked the prompter at half the
  // reader's true position — the lag the user saw.) Slowing down is instead
  // handled honestly by the cruise blend (a slow voice lowers voiceWps) and
  // by halt-on-silence.
  const err =
    expectedSyllablesAt(script, state.wordPos) - (state.anchorExpectedSyl + cumDetectedSyl);
  let errIntegral = clamp(Math.min(0, state.errIntegral + err * dt), -c.intClamp, 0);
  const boost = err < 0 ? clamp(c.kP * -err + c.kI * -errIntegral, 0, c.maxCorrection) : 0;

  // 6. Velocity: track while speaking, decay to a halt in silence.
  let velocityWps = state.velocityWps;
  let silenceSec = state.silenceSec;
  if (tick.speaking) {
    silenceSec = 0;
    const target = Math.max(0, cruise * (1 + boost));
    velocityWps += (target - velocityWps) * (1 - Math.exp(-dt / c.velSlewTauSec));
  } else {
    silenceSec += dt;
    velocityWps *= Math.exp(-dt / c.haltTauSec);
    if (velocityWps < 0.02) velocityWps = 0;
  }

  // 7. Hard resync forward only: when the reader has clearly outrun the
  // prompter by more than a paragraph, jump ahead to catch up. Never jump
  // backward (a false "prompter ahead" from under-counting must not yank
  // the highlight back).
  let wordPos = state.wordPos;
  if (err < -c.resyncSyllables) {
    wordPos = Math.max(
      wordPos,
      wordPosAtExpectedSyllables(script, state.anchorExpectedSyl + cumDetectedSyl),
    );
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

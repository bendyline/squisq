/**
 * Syllable-nuclei detection: vowel nuclei show up as peaks in a
 * low-passed amplitude envelope of the speech-band signal.
 *
 * Envelope = one-pole low-pass (≈10 Hz) over √bandEnergy (amplitude
 * domain, so peaks are nuclei rather than energy spikes). A peak is
 * emitted one frame late (local-max needs one frame of lookahead —
 * ~20 ms live latency) and accepted only when: VAD says speaking, it
 * clears the minimum inter-onset spacing, it is prominent relative to
 * the valley since the last accepted peak, and it clears a decaying
 * loudness reference (guards against ripples inside quiet speech).
 */

import type { FrameFeatures, NucleiConfig } from './types.js';
import { DEFAULT_NUCLEI_CONFIG } from './types.js';

export interface NucleiState {
  /** One-pole envelope of √bandEnergy. */
  env: number;
  prevEnv: number;
  prevPrevEnv: number;
  /** tSec of the previous frame (the peak-candidate time). */
  prevTSec: number;
  /** Envelope minimum since the last accepted peak. */
  valley: number;
  lastOnsetTSec: number;
  /** Decaying loudness reference. */
  peakRef: number;
  lastTSec: number;
  framesSeen: number;
}

export function createNucleiState(_config?: Partial<NucleiConfig>): NucleiState {
  return {
    env: 0,
    prevEnv: 0,
    prevPrevEnv: 0,
    prevTSec: 0,
    valley: Number.POSITIVE_INFINITY,
    lastOnsetTSec: Number.NEGATIVE_INFINITY,
    peakRef: 0,
    lastTSec: 0,
    framesSeen: 0,
  };
}

/**
 * Pure per-frame step. `onset` is the tSec of a newly accepted syllable
 * nucleus (emitted once, at its peak frame), or null.
 */
export function nucleiStep(
  state: NucleiState,
  frame: FrameFeatures,
  speaking: boolean,
  config?: Partial<NucleiConfig>,
): { state: NucleiState; onset: number | null } {
  const c = { ...DEFAULT_NUCLEI_CONFIG, ...config };
  const amp = Math.sqrt(Math.max(0, frame.bandEnergy));
  const dt = state.framesSeen > 0 ? Math.max(0, frame.tSec - state.lastTSec) : 0;

  const env =
    state.framesSeen > 0
      ? state.env + (amp - state.env) * (1 - Math.exp(-2 * Math.PI * c.envelopeHz * dt))
      : amp;
  const peakRef = Math.max(env, state.peakRef * Math.exp(-(dt || 0) / c.peakRefTauSec));

  let onset: number | null = null;
  let valley = state.framesSeen > 0 ? state.valley : env;
  let lastOnsetTSec = state.lastOnsetTSec;

  // Candidate peak at the PREVIOUS frame: env[t-1] ≥ env[t-2] && env[t-1] > env[t].
  if (
    state.framesSeen >= 2 &&
    state.prevEnv >= state.prevPrevEnv &&
    state.prevEnv > env &&
    speaking &&
    state.prevTSec - lastOnsetTSec >= c.minInterOnsetMs / 1000 &&
    state.prevEnv >= valley * c.prominenceRatio &&
    state.prevEnv >= peakRef * c.minRelPeak
  ) {
    onset = state.prevTSec;
    lastOnsetTSec = state.prevTSec;
    // Re-seed the valley at the accepted peak; it decays via min() below.
    valley = state.prevEnv;
  }
  valley = Math.min(valley, env);

  return {
    state: {
      env,
      prevEnv: env,
      prevPrevEnv: state.framesSeen > 0 ? state.prevEnv : env,
      prevTSec: frame.tSec,
      valley,
      lastOnsetTSec,
      peakRef,
      lastTSec: frame.tSec,
      framesSeen: state.framesSeen + 1,
    },
    onset,
  };
}

/** Batch wrapper for the offline aligner. `vadFlags[i]` pairs with `frames[i]`. */
export function detectSyllableOnsets(
  frames: FrameFeatures[],
  vadFlags: boolean[],
  config?: Partial<NucleiConfig>,
): number[] {
  let state = createNucleiState(config);
  const onsets: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const step = nucleiStep(state, frames[i], vadFlags[i] ?? false, config);
    state = step.state;
    if (step.onset !== null) onsets.push(step.onset);
  }
  return onsets;
}

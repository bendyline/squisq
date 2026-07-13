/**
 * Adaptive voice-activity detection over frame features.
 *
 * The noise floor is an asymmetric EMA of band energy that hugs minima
 * (≈ a 5th-percentile tracker): fast attack toward quieter frames, slow
 * release upward, and FROZEN upward while speaking so long speech can't
 * inflate it. Speech enters via a ratio threshold with a
 * consecutive-frame debounce and exits after a continuous sub-exit
 * dwell (hangover) — the hangover also bridges trailing fricatives and
 * inter-word dips. A dip-starved rebaseline escape keeps a step change
 * in room noise from wedging the detector open: real speech dips below
 * the enter threshold between syllables, steady noise never does.
 */

import type { FrameFeatures, VadConfig } from './types.js';
import { DEFAULT_VAD_CONFIG } from './types.js';

export interface VadState {
  /** Adaptive noise-floor estimate (band-energy units). */
  noiseFloor: number;
  /** The VAD decision — the stage's output. */
  speaking: boolean;
  /** Consecutive supra-enter frames observed while silent. */
  enterStreak: number;
  /** tSec when the current sub-exit dwell began (while speaking), else null. */
  subExitSince: number | null;
  /** tSec when the current zero-dip run began (while speaking), else null. */
  noDipSince: number | null;
  /** No speech decisions before this time (floor seeding). */
  warmupUntilSec: number;
  /** False until the first frame seeds the floor. */
  seeded: boolean;
  lastTSec: number;
}

export function createVadState(config?: Partial<VadConfig>): VadState {
  const merged = { ...DEFAULT_VAD_CONFIG, ...config };
  return {
    noiseFloor: merged.floorMin,
    speaking: false,
    enterStreak: 0,
    subExitSince: null,
    noDipSince: null,
    warmupUntilSec: merged.warmupMs / 1000,
    seeded: false,
    lastTSec: 0,
  };
}

/** Pure per-frame step. `state.speaking` on the returned state is the decision for this frame. */
export function vadStep(
  state: VadState,
  frame: FrameFeatures,
  config?: Partial<VadConfig>,
): VadState {
  const c = { ...DEFAULT_VAD_CONFIG, ...config };
  const energy = Math.max(0, frame.bandEnergy);

  let floor = state.seeded ? state.noiseFloor : Math.max(energy, c.floorMin);
  if (state.seeded) {
    if (!state.speaking) {
      const alpha = energy < floor ? c.alphaDown : c.alphaUp;
      floor += (energy - floor) * alpha;
    } else if (energy < floor) {
      // Downward adaptation stays safe while speaking; only upward is frozen.
      floor += (energy - floor) * c.alphaDown;
    }
  }
  if (floor < c.floorMin) floor = c.floorMin;

  let speaking = state.speaking;
  let enterStreak = state.enterStreak;
  let subExitSince = state.subExitSince;
  let noDipSince = state.noDipSince;

  if (frame.tSec < state.warmupUntilSec) {
    speaking = false;
    enterStreak = 0;
    subExitSince = null;
    noDipSince = null;
  } else if (!speaking) {
    noDipSince = null;
    if (energy > floor * c.enterRatio) {
      enterStreak += 1;
      if (enterStreak >= c.enterFrames) {
        speaking = true;
        subExitSince = null;
        noDipSince = frame.tSec;
      }
    } else {
      enterStreak = 0;
    }
  } else {
    // Hangover: leave speech only after a continuous sub-exit dwell.
    if (energy >= floor * c.exitRatio) {
      subExitSince = null;
    } else {
      if (subExitSince === null) subExitSince = frame.tSec;
      if (frame.tSec - subExitSince >= c.hangoverMs / 1000) {
        speaking = false;
        subExitSince = null;
        noDipSince = null;
        enterStreak = 0;
      }
    }
    // Dip-starved rebaseline: a signal that never dips near the floor
    // is a new noise floor, not speech.
    if (speaking) {
      if (energy <= floor * c.enterRatio) {
        noDipSince = frame.tSec;
      } else if (noDipSince !== null && frame.tSec - noDipSince >= c.noiseRebaselineSec) {
        floor = Math.max(energy, c.floorMin);
        speaking = false;
        subExitSince = null;
        noDipSince = null;
        enterStreak = 0;
      }
    }
  }

  return {
    noiseFloor: floor,
    speaking,
    enterStreak,
    subExitSince,
    noDipSince,
    warmupUntilSec: state.warmupUntilSec,
    seeded: true,
    lastTSec: frame.tSec,
  };
}

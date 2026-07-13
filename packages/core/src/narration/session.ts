/**
 * Live-session composition: one pure call per PCM hop runs feature
 * extraction → VAD → nuclei → pacing. This is the only surface the
 * editor's mic loop needs — feed it worklet batches, read
 * `state.pacing.wordPos` / `state.vad.speaking` / `state.lastFrame`.
 */

import { createFeatureState, featureStep, type FeatureState } from './features.js';
import { createNucleiState, nucleiStep, type NucleiState } from './nuclei.js';
import { createPacingState, pacingStep, reanchorPacing, type PacingState } from './pacing.js';
import { createVadState, vadStep, type VadState } from './vad.js';
import type {
  FeatureConfig,
  FrameFeatures,
  NarrationScript,
  NucleiConfig,
  PacingConfig,
  VadConfig,
} from './types.js';

export interface NarrationSessionConfig {
  feature?: Partial<FeatureConfig>;
  vad?: Partial<VadConfig>;
  nuclei?: Partial<NucleiConfig>;
  pacing?: Partial<PacingConfig>;
}

export interface NarrationSessionState {
  script: NarrationScript;
  config: NarrationSessionConfig;
  features: FeatureState;
  vad: VadState;
  nuclei: NucleiState;
  pacing: PacingState;
  /** Most recent analysis frame — drives the UI level meter. */
  lastFrame: FrameFeatures | null;
  /** Seconds of PCM consumed so far. */
  tSec: number;
}

export function createNarrationSession(
  sampleRate: number,
  script: NarrationScript,
  config?: NarrationSessionConfig,
): NarrationSessionState {
  const merged = config ?? {};
  return {
    script,
    config: merged,
    features: createFeatureState(sampleRate, merged.feature),
    vad: createVadState(merged.vad),
    nuclei: createNucleiState(merged.nuclei),
    pacing: createPacingState(0),
    lastFrame: null,
    tSec: 0,
  };
}

/** Feed one hop of mono PCM; every completed frame advances VAD/nuclei/pacing. */
export function narrationSessionStep(
  state: NarrationSessionState,
  hop: Float32Array,
): NarrationSessionState {
  const { state: features, frames } = featureStep(state.features, hop);
  let vad = state.vad;
  let nuclei = state.nuclei;
  let pacing = state.pacing;
  let lastFrame = state.lastFrame;

  for (const frame of frames) {
    vad = vadStep(vad, frame, state.config.vad);
    const nucleiResult = nucleiStep(nuclei, frame, vad.speaking, state.config.nuclei);
    nuclei = nucleiResult.state;
    pacing = pacingStep(
      pacing,
      { tSec: frame.tSec, speaking: vad.speaking, onsets: nucleiResult.onset !== null ? 1 : 0 },
      state.script,
      state.config.pacing,
    );
    lastFrame = frame;
  }

  return {
    ...state,
    features,
    vad,
    nuclei,
    pacing,
    lastFrame,
    tSec: state.tSec + hop.length / state.features.sampleRate,
  };
}

/** Manual nudge/scroll: re-anchor the pacing controller at a word position. */
export function reanchorSession(
  state: NarrationSessionState,
  wordPos: number,
): NarrationSessionState {
  return { ...state, pacing: reanchorPacing(state.pacing, wordPos, state.script) };
}

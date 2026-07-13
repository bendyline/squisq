/**
 * @bendyline/squisq/narration — the narration/teleprompter engine.
 *
 * Pure TypeScript, zero dependencies, no DOM/Node APIs: a script model
 * built from a Doc, streaming DSP (band features → adaptive VAD →
 * syllable nuclei), a deterministic voice-adaptive pacing controller,
 * and an offline DTW aligner that turns a recorded take into word/block
 * timestamps. Determinism is a hard rule here — no Date.now, no
 * Math.random, no timers — so every stage is unit-testable in Node
 * with synthetic PCM.
 */

export type {
  ScriptToken,
  ScriptBlockRange,
  NarrationScript,
  FrameFeatures,
  FeatureConfig,
  VadConfig,
  NucleiConfig,
  PacingConfig,
  AlignConfig,
  WordTiming,
  NarrationBlockRange,
  NarrationAlignment,
} from './types.js';
export {
  DEFAULT_FEATURE_CONFIG,
  DEFAULT_VAD_CONFIG,
  DEFAULT_NUCLEI_CONFIG,
  DEFAULT_PACING_CONFIG,
  DEFAULT_ALIGN_CONFIG,
} from './types.js';

export { estimateSyllables } from './syllables.js';

export {
  buildNarrationScript,
  expectedSyllablesAt,
  wordPosAtExpectedSyllables,
  wordIndexAtChar,
  wordIndexAtTime,
  type BuildScriptOptions,
} from './script.js';

export {
  createBandpass,
  bandpassRun,
  createFeatureState,
  featureStep,
  extractFrameFeatures,
  type BandpassState,
  type FeatureState,
} from './features.js';

export { createVadState, vadStep, type VadState } from './vad.js';

export { createNucleiState, nucleiStep, detectSyllableOnsets, type NucleiState } from './nuclei.js';

export {
  createPacingState,
  pacingStep,
  reanchorPacing,
  type PacingState,
  type PacingTick,
} from './pacing.js';

export {
  createNarrationSession,
  narrationSessionStep,
  reanchorSession,
  type NarrationSessionConfig,
  type NarrationSessionState,
} from './session.js';

export { traceWordPosAt, downsampleTrace, type NarrationTrace, type TraceSample } from './trace.js';

export { alignNarration, type AlignInput } from './align.js';

export {
  buildNarrationTimingJson,
  parseNarrationTimingJson,
  type NarrationTimingJsonV3,
  type NarrationTimingBlock,
  type BuildNarrationTimingOptions,
} from './sidecar.js';

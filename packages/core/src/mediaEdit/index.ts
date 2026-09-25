/**
 * Media edits: non-destructive recipes on audio/video references, the
 * trim + cuts time map, and the derived-render store layout.
 *
 * See `@bendyline/squisq/mediaEdit` for the public subpath entry and
 * `docs/media-edits.md` for the host contract.
 */

export {
  MEDIA_FX_ORDER,
  MEDIA_FX_SPECS,
  MEDIA_EDIT_PARAMS,
  mediaEditHtmlAttribute,
  formatMediaNumber,
  parseMediaFx,
  serializeMediaFx,
  hasRenderableFx,
  normalizeMediaCuts,
  parseMediaCuts,
  serializeMediaCuts,
  parseMediaCrop,
  normalizeMediaCrop,
  serializeMediaCrop,
  parseMediaEdits,
  serializeMediaEdits,
  mediaEditValuesFromParams,
  mediaEditValuesFromAttributes,
  mediaRenderKey,
} from './recipe.js';
export type {
  MediaFxOpId,
  MediaFxOp,
  MediaFxChain,
  MediaCut,
  MediaCrop,
  MediaEdits,
  MediaEditParamKey,
  MediaEditParamValues,
} from './recipe.js';

export { createMediaTimeMap } from './timeMap.js';
export type { MediaTimeMap, MediaTimeMapInput } from './timeMap.js';

export {
  MEDIA_RENDER_DIR,
  MEDIA_RENDER_MANIFEST_VERSION,
  MEDIA_RENDER_GC_AGE_DAYS,
  mediaRenderStem,
  mediaRenderFilePath,
  mediaRenderManifestPath,
  parseMediaRenderPath,
  isMediaRenderPath,
  buildMediaRenderIndex,
  parseMediaRenderManifest,
  serializeMediaRenderManifest,
  mediaRenderStaleness,
  collectDocMediaClips,
  mediaClipRenderKey,
  referencedMediaRenderKeys,
  mediaRenderKeyFor,
  selectMediaRendersForGc,
} from './renderStore.js';
export type {
  MediaRenderAnalysis,
  MediaRenderManifest,
  MediaRenderEntry,
  ParsedMediaRenderPath,
} from './renderStore.js';

// Signal chain (pure DSP; the denoiser model is injected by the renderer).
export {
  MEDIA_FX_SAMPLE_RATE,
  MEDIA_FX_ENGINE,
  MEDIA_FX_TRUE_PEAK_CEILING_DB,
  MEDIA_FX_LOUDNESS_TOLERANCE,
  analyzeMediaFx,
  renderMediaFx,
  correctedLoudnessAnalysis,
} from './dsp/chain.js';
export type {
  MediaFxSource,
  MediaFxAnalysis,
  MediaFxOptions,
  MediaFxRenderOptions,
  MediaFxRenderResult,
} from './dsp/chain.js';
export { createDenoiseStage } from './dsp/denoiser.js';
export type { Denoiser, DenoiserFactory, DenoiseStage } from './dsp/denoiser.js';
export { createResampler } from './dsp/resample.js';
export type { Resampler } from './dsp/resample.js';
export { createLoudnessMeter, integratedLoudnessFromSteps } from './dsp/loudness.js';
export type { LoudnessMeter } from './dsp/loudness.js';
export { createLimiter } from './dsp/limiter.js';
export type { Limiter, LimiterOptions } from './dsp/limiter.js';
export {
  createBreathAnalyzer,
  detectBreaths,
  breathGainAt,
  applyBreathEnvelope,
} from './dsp/breath.js';
export type {
  BreathFrame,
  BreathRegion,
  BreathAnalyzer,
  BreathDetectOptions,
} from './dsp/breath.js';
export { PAUSE_TIGHTEN_DEFAULTS, detectPauseCuts } from './dsp/pauses.js';
export type { PauseTightenOptions } from './dsp/pauses.js';

/**
 * @bendyline/squisq-video — Video Export from Squisq Documents
 *
 * Browser-pure foundation for rendering Squisq docs to MP4 video.
 * Provides:
 * - Render HTML generation for headless frame capture
 * - WASM-based frame-to-MP4 encoding via ffmpeg.wasm
 * - Shared types, quality presets, and dimension helpers
 *
 * Pure helpers and HTML generation work in browsers and Node.js. The
 * ffmpeg.wasm encoder itself requires a browser runtime; Node callers should
 * use the native encoder supplied by @bendyline/squisq-cli.
 */

// ── Types & Presets ────────────────────────────────────────────────
export type {
  VideoExportOptions,
  VideoQuality,
  VideoOrientation,
  FfmpegWasmLoadConfig,
  QualityPreset,
  EncoderResult,
} from './types.js';

export {
  QUALITY_PRESETS,
  ORIENTATION_DIMENSIONS,
  resolveDimensions,
  validateVideoExportOptions,
  bitrateForQuality,
} from './types.js';

// ── ffmpeg.wasm runtime assets ─────────────────────────────────────
export { resolveFfmpegWasmLoad, FFMPEG_WASM_SETUP_HINT } from './ffmpegCore.js';

// ── Audio Timeline ─────────────────────────────────────────────────
export type { AudioTimelineClip, ComputeAudioTimelineOptions } from './audioTimeline.js';
export { computeAudioTimeline } from './audioTimeline.js';

// ── Render HTML ────────────────────────────────────────────────────
export type { RenderHtmlOptions } from './renderHtml.js';
export { generateRenderHtml } from './renderHtml.js';

// ── Dashboard Image Export ─────────────────────────────────────────
export type {
  DashboardResolutionId,
  DashboardResolutionPreset,
  ResolveDashboardDimensionsInput,
  ResolvedDashboardDimensions,
} from './dashboardImage.js';
export {
  DASHBOARD_RESOLUTIONS,
  DEFAULT_DASHBOARD_RESOLUTION,
  MAX_DASHBOARD_IMAGE_DIMENSION,
  MAX_DASHBOARD_IMAGE_PIXELS,
  MIN_DASHBOARD_IMAGE_DIMENSION,
  dashboardFamilyForDimensions,
  resolveDashboardDimensions,
  validateDashboardImageDimensions,
} from './dashboardImage.js';

// ── FFmpeg Argument Builders ───────────────────────────────────────
export type { GifDither, GifFilterOptions, GifOutputOptions } from './ffmpegArgs.js';
export {
  ffmpegVideoQualityArgs,
  audioBitrateArg,
  ffmpegAudioMuxArgs,
  ffmpegGifFilterGraph,
  ffmpegGifPaletteGenerationFilter,
  ffmpegGifPaletteApplicationGraph,
  ffmpegGifPaletteApplicationArgs,
  ffmpegGifOutputArgs,
} from './ffmpegArgs.js';

// ── WASM Encoder ───────────────────────────────────────────────────
export { framesToMp4Wasm, fetchFile } from './wasmEncoder.js';

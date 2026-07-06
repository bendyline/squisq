/**
 * @bendyline/squisq-video — Video Export from Squisq Documents
 *
 * Browser-pure foundation for rendering Squisq docs to MP4 video.
 * Provides:
 * - Render HTML generation for headless frame capture
 * - WASM-based frame-to-MP4 encoding via ffmpeg.wasm
 * - Shared types, quality presets, and dimension helpers
 *
 * This package has no Node.js dependencies and works in both browser and Node.
 */

// ── Types & Presets ────────────────────────────────────────────────
export type {
  VideoExportOptions,
  VideoQuality,
  VideoOrientation,
  QualityPreset,
  EncoderResult,
} from './types.js';

export {
  QUALITY_PRESETS,
  ORIENTATION_DIMENSIONS,
  resolveDimensions,
  bitrateForQuality,
} from './types.js';

// ── Audio Timeline ─────────────────────────────────────────────────
export type { AudioTimelineClip } from './audioTimeline.js';
export { computeAudioTimeline } from './audioTimeline.js';

// ── Render HTML ────────────────────────────────────────────────────
export type { RenderHtmlOptions } from './renderHtml.js';
export { generateRenderHtml } from './renderHtml.js';

// ── FFmpeg Argument Builders ───────────────────────────────────────
export { ffmpegVideoQualityArgs, audioBitrateArg } from './ffmpegArgs.js';

// ── WASM Encoder ───────────────────────────────────────────────────
export { framesToMp4Wasm, fetchFile } from './wasmEncoder.js';

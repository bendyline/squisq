/**
 * Video Export Types
 *
 * Shared type definitions for video encoding and render HTML generation.
 * Used by both the browser-based encoder and the CLI native encoder.
 */

/**
 * Video quality preset.
 * Controls the H.264 encoding speed/quality trade-off and constant rate factor.
 *
 * - draft:  ultrafast preset, CRF 28 — fast encode, lower quality (~1-2 Mbps)
 * - normal: medium preset, CRF 23 — balanced (~3-5 Mbps)
 * - high:   slow preset, CRF 18 — best quality, slowest (~8-12 Mbps)
 */
export type VideoQuality = 'draft' | 'normal' | 'high';

/** Viewport orientation for video output. */
export type VideoOrientation = 'landscape' | 'portrait';

/** Encoding preset parameters mapped from VideoQuality. */
export interface QualityPreset {
  /** FFmpeg -preset value (ultrafast, medium, slow) */
  preset: string;
  /** FFmpeg -crf value (lower = higher quality, 0-51 range) */
  crf: number;
  /**
   * Bits per pixel for WebCodecs bitrate targeting.
   * Target bitrate = width * height * bitsPerPixel (see {@link bitrateForQuality}).
   * These values reproduce the historical per-quality formula exactly:
   * the old code used a `width * height * 4` baseline, halved for draft and
   * doubled for high — i.e. 2 / 4 / 8 bits per pixel.
   */
  bitsPerPixel: number;
  /** Target AAC audio bitrate in bits/sec for muxed audio tracks. */
  audioBitrate: number;
}

/** Quality preset lookup — shared between wasm and native encoders. */
export const QUALITY_PRESETS: Record<VideoQuality, QualityPreset> = {
  draft: { preset: 'ultrafast', crf: 28, bitsPerPixel: 2, audioBitrate: 96_000 },
  normal: { preset: 'medium', crf: 23, bitsPerPixel: 4, audioBitrate: 128_000 },
  high: { preset: 'slow', crf: 18, bitsPerPixel: 8, audioBitrate: 192_000 },
};

/**
 * Target H.264 bitrate (bits/sec) for a given quality at a given resolution.
 *
 * Computes `width * height * preset.bitsPerPixel`. With bitsPerPixel of
 * 2 / 4 / 8 (draft / normal / high) this is numerically identical to the
 * legacy formula (`width * height * 4` baseline, ×0.5 for draft, ×2 for high)
 * that previously lived in both the main-thread and worker WebCodecs encoders.
 * The single source of truth now lives here so every encode path agrees.
 */
export function bitrateForQuality(q: VideoQuality, width: number, height: number): number {
  const preset = QUALITY_PRESETS[q] ?? QUALITY_PRESETS.normal;
  return Math.round(width * height * preset.bitsPerPixel);
}

/** Viewport dimensions for each orientation. */
export const ORIENTATION_DIMENSIONS: Record<VideoOrientation, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

/** Options for video export encoding. */
export interface VideoExportOptions {
  /** Frames per second (default: 30) */
  fps?: number;
  /** Video width in pixels (default: based on orientation) */
  width?: number;
  /** Video height in pixels (default: based on orientation) */
  height?: number;
  /** Encoding quality preset (default: 'normal') */
  quality?: VideoQuality;
  /** Viewport orientation (default: 'landscape') */
  orientation?: VideoOrientation;
  /**
   * Progress callback. Called during encoding with completion percentage and phase description.
   * @param percent - 0-100 completion percentage
   * @param phase - Human-readable description of current phase (e.g., 'encoding', 'muxing')
   */
  onProgress?: (percent: number, phase: string) => void;
}

/** Result from the wasm encoder. */
export interface EncoderResult {
  /** MP4 file bytes */
  data: Uint8Array;
  /** Video duration in seconds */
  duration: number;
}

/**
 * Resolve dimensions from options, applying orientation defaults.
 */
export function resolveDimensions(options: VideoExportOptions): {
  width: number;
  height: number;
} {
  const orientation = options.orientation ?? 'landscape';
  const defaults = ORIENTATION_DIMENSIONS[orientation];
  return {
    width: options.width ?? defaults.width,
    height: options.height ?? defaults.height,
  };
}

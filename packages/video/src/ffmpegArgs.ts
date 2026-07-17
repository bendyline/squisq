/**
 * FFmpeg argument builders — the single source of truth for translating a
 * {@link VideoQuality} into ffmpeg CLI flags. Shared verbatim by every
 * ffmpeg-based encode path: the wasm encoder ({@link ./wasmEncoder}), the
 * video-react fallback worker, and the CLI native encoder. Deriving these
 * from {@link QUALITY_PRESETS} keeps the browser and CLI byte-for-byte aligned.
 *
 * Pure, dependency-free, and unit-testable in isolation (the actual ffmpeg
 * invocations live behind wasm/child-process boundaries that are awkward to
 * exercise directly).
 */

import { QUALITY_PRESETS, type VideoQuality } from './types.js';

/** Dithering algorithms intentionally exposed by Squisq's GIF encoder. */
export type GifDither = 'bayer' | 'sierra2_4a' | 'none';

/** Options for the shared palette-based animated GIF filter graph. */
export interface GifFilterOptions {
  width: number;
  height: number;
  /** Palette size, from 2 through GIF's maximum of 256. */
  maxColors?: number;
  /** Palette dithering algorithm (default: `sierra2_4a`). */
  dither?: GifDither;
  /** Ordered Bayer strength, used only when `dither` is `bayer` (0-5). */
  bayerScale?: number;
}

/** Options for GIF muxing in addition to the palette filter graph. */
export interface GifOutputOptions extends GifFilterOptions {
  /** Number of repeats; 0 loops forever and -1 disables looping. */
  loop?: number;
}

/**
 * H.264 speed/quality flags (`-preset`, `-crf`) for a quality level.
 * @example ffmpegVideoQualityArgs('high') // ['-preset', 'slow', '-crf', '18']
 */
export function ffmpegVideoQualityArgs(quality: VideoQuality): string[] {
  const preset = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.normal;
  return ['-preset', preset.preset, '-crf', String(preset.crf)];
}

/**
 * AAC audio-bitrate flag value in ffmpeg's `k` shorthand for a quality level.
 * @example audioBitrateArg('high') // '192k'
 */
export function audioBitrateArg(quality: VideoQuality): string {
  const preset = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.normal;
  return `${preset.audioBitrate / 1000}k`;
}

/**
 * AAC muxing flags that preserve the complete video timeline.
 *
 * `-shortest` by itself truncates video whenever narration ends early. Padding
 * the audio stream first makes the video stream the shortest input instead, so
 * audio longer than the video is trimmed while shorter audio becomes silence.
 */
export function ffmpegAudioMuxArgs(bitrate: string | number): string[] {
  return ['-c:a', 'aac', '-b:a', String(bitrate), '-af', 'apad', '-shortest'];
}

interface ResolvedGifFilterOptions {
  width: number;
  height: number;
  maxColors: number;
  ditherArgs: string;
}

function resolveGifFilterOptions(options: GifFilterOptions): ResolvedGifFilterOptions {
  const { width, height } = options;
  const maxColors = options.maxColors ?? 256;
  const dither = options.dither ?? 'sierra2_4a';
  const bayerScale = options.bayerScale ?? 3;

  for (const [label, value] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`GIF ${label} must be a positive integer.`);
    }
  }
  if (!Number.isSafeInteger(maxColors) || maxColors < 2 || maxColors > 256) {
    throw new RangeError('GIF maxColors must be an integer between 2 and 256.');
  }
  if (!['bayer', 'sierra2_4a', 'none'].includes(dither)) {
    throw new RangeError(`Unknown GIF dither: ${String(dither)}.`);
  }
  if (!Number.isSafeInteger(bayerScale) || bayerScale < 0 || bayerScale > 5) {
    throw new RangeError('GIF bayerScale must be an integer between 0 and 5.');
  }

  return {
    width,
    height,
    maxColors,
    ditherArgs: dither === 'bayer' ? `dither=bayer:bayer_scale=${bayerScale}` : `dither=${dither}`,
  };
}

function gifScaleFilter({ width, height }: ResolvedGifFilterOptions): string {
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
  );
}

/** First pass of the bounded-memory GIF workflow: video -> one palette image. */
export function ffmpegGifPaletteGenerationFilter(options: GifFilterOptions): string {
  const resolved = resolveGifFilterOptions(options);
  return (
    `${gifScaleFilter(resolved)},` +
    `palettegen=stats_mode=diff:max_colors=${resolved.maxColors}:reserve_transparent=0`
  );
}

/** Second pass of the bounded-memory GIF workflow: video + palette -> GIF frames. */
export function ffmpegGifPaletteApplicationGraph(options: GifFilterOptions): string {
  const resolved = resolveGifFilterOptions(options);
  return (
    `[0:v]${gifScaleFilter(resolved)}[gif_frames];` +
    `[gif_frames][1:v]paletteuse=${resolved.ditherArgs}:diff_mode=rectangle[gif_out]`
  );
}

/** Output arguments for the second, two-input pass of GIF encoding. */
export function ffmpegGifPaletteApplicationArgs(options: GifOutputOptions): string[] {
  const loop = resolveGifLoop(options);
  return [
    '-filter_complex',
    ffmpegGifPaletteApplicationGraph(options),
    '-map',
    '[gif_out]',
    '-an',
    '-loop',
    String(loop),
  ];
}

/**
 * Build a high-quality, compression-friendly GIF palette filter graph.
 *
 * A single palette is derived from the parts of the frame that change, while
 * `diff_mode=rectangle` keeps error diffusion inside the changed rectangle so
 * static slide backgrounds remain byte-stable and compress efficiently.
 */
export function ffmpegGifFilterGraph(options: GifFilterOptions): string {
  const resolved = resolveGifFilterOptions(options);
  return (
    `[0:v]${gifScaleFilter(resolved)},split[gif_frames][gif_palette_source];` +
    `[gif_palette_source]palettegen=stats_mode=diff:max_colors=${resolved.maxColors}:reserve_transparent=0[gif_palette];` +
    `[gif_frames][gif_palette]paletteuse=${resolved.ditherArgs}:diff_mode=rectangle[gif_out]`
  );
}

function resolveGifLoop(options: GifOutputOptions): number {
  const loop = options.loop ?? 0;
  if (!Number.isSafeInteger(loop) || loop < -1 || loop > 65_535) {
    throw new RangeError('GIF loop must be an integer between -1 and 65535.');
  }
  return loop;
}

/** Build the output-side FFmpeg arguments for an animated GIF. */
export function ffmpegGifOutputArgs(options: GifOutputOptions): string[] {
  const loop = resolveGifLoop(options);
  return [
    '-filter_complex',
    ffmpegGifFilterGraph(options),
    '-map',
    '[gif_out]',
    '-an',
    '-loop',
    String(loop),
  ];
}

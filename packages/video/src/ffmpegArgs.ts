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

/**
 * Native FFmpeg Encoder
 *
 * Encodes PNG frames to MP4 or animated GIF using a locally installed ffmpeg
 * binary. Writes frames to a temporary directory, invokes ffmpeg as a child
 * process, and reads the resulting media file.
 *
 * This is the Node fast path used after the CLI detects native FFmpeg. Browser
 * callers use the WebCodecs/ffmpeg.wasm paths in the video packages instead.
 */

import { execFile } from 'node:child_process';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import type { GifDither, VideoExportOptions, VideoOrientation } from '@bendyline/squisq-video';
import {
  resolveDimensions,
  ffmpegVideoQualityArgs,
  audioBitrateArg,
  ffmpegAudioMuxArgs,
  ffmpegGifOutputArgs,
} from '@bendyline/squisq-video';

/** Options for native animated-GIF encoding. */
export interface GifExportOptions {
  /** Frames per second (default: 10; GIF timing is centisecond-based). */
  fps?: number;
  /** Output width in pixels (default: 960 landscape / 540 portrait). */
  width?: number;
  /** Output height in pixels (default: 540 landscape / 960 portrait). */
  height?: number;
  /** Viewport orientation used for default dimensions. */
  orientation?: VideoOrientation;
  /** Number of repeats; 0 loops forever and -1 disables looping. */
  loop?: number;
  /** Palette size, between 2 and 256 (default: 256). */
  maxColors?: number;
  /** Palette dithering algorithm (default: sierra2_4a). */
  dither?: GifDither;
  /** Bayer strength when dither is bayer (0-5, default: 3). */
  bayerScale?: number;
  /** Encoding progress callback. */
  onProgress?: (percent: number, phase: string) => void;
}

/** Compression-friendly defaults for animated GIF output. */
export const GIF_EXPORT_DEFAULTS = {
  fps: 10,
  width: 960,
  height: 540,
  loop: 0,
  maxColors: 256,
  dither: 'sierra2_4a' as GifDither,
} as const;

function resolveGifDimensions(options: GifExportOptions): { width: number; height: number } {
  const portrait = options.orientation === 'portrait';
  const defaults = portrait
    ? { width: GIF_EXPORT_DEFAULTS.height, height: GIF_EXPORT_DEFAULTS.width }
    : { width: GIF_EXPORT_DEFAULTS.width, height: GIF_EXPORT_DEFAULTS.height };
  const width = options.width ?? defaults.width;
  const height = options.height ?? defaults.height;
  for (const [label, value] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`GIF ${label} must be a positive integer.`);
    }
  }
  return { width, height };
}

function resolveGifFps(options: GifExportOptions): number {
  const fps = options.fps ?? GIF_EXPORT_DEFAULTS.fps;
  // GIF delays are stored in centiseconds, so rates above 100 cannot be
  // represented without timestamp rounding.
  if (!Number.isFinite(fps) || fps <= 0 || fps > 100) {
    throw new RangeError('GIF FPS must be a finite number between 1 and 100.');
  }
  return fps;
}

/**
 * Encode frame PNGs to MP4 using native ffmpeg.
 *
 * @param ffmpegPath - Absolute path to the ffmpeg binary
 * @param frames - Array of PNG image bytes (one per frame)
 * @param audio - Optional audio file bytes to mux
 * @param outputPath - Where to write the final MP4
 * @param options - Encoding options (fps, quality, dimensions, progress)
 */
export async function framesToMp4Native(
  ffmpegPath: string,
  frames: Uint8Array[],
  audio: Uint8Array | null,
  outputPath: string,
  options: VideoExportOptions = {},
): Promise<void> {
  const fps = options.fps ?? 30;
  const quality = options.quality ?? 'normal';
  const { width, height } = resolveDimensions(options);
  const onProgress = options.onProgress;

  if (frames.length === 0) {
    throw new Error('No frames provided for encoding');
  }
  // Create a temp working directory
  const tmpId = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `squisq-video-${tmpId}`);
  await mkdir(workDir, { recursive: true });

  try {
    onProgress?.(0, 'writing frames');

    // Write frame PNGs to temp directory
    const padLen = String(frames.length).length;
    for (let i = 0; i < frames.length; i++) {
      const name = `frame-${String(i + 1).padStart(padLen, '0')}.png`;
      await writeFile(join(workDir, name), frames[i]);

      if (onProgress && i % 10 === 0) {
        onProgress(Math.round((i / frames.length) * 30), 'writing frames');
      }
    }

    // Write audio if provided
    let audioPath: string | null = null;
    if (audio) {
      audioPath = join(workDir, 'audio-input');
      await writeFile(audioPath, audio);
    }

    onProgress?.(30, 'encoding');

    // Build ffmpeg arguments
    const padPattern = join(workDir, `frame-%0${padLen}d.png`);
    const args = ['-y', '-framerate', String(fps), '-i', padPattern];

    if (audioPath) {
      args.push('-i', audioPath);
    }

    args.push(
      '-c:v',
      'libx264',
      ...ffmpegVideoQualityArgs(quality),
      '-pix_fmt',
      'yuv420p',
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    );

    if (audioPath) {
      args.push(...ffmpegAudioMuxArgs(audioBitrateArg(quality)));
    }

    args.push(outputPath);

    // Run ffmpeg. execFile buffers stdout/stderr internally for the callback,
    // so the child's pipes are already drained — no manual stderr listener needed.
    await new Promise<void>((resolve, reject) => {
      execFile(ffmpegPath, args, { timeout: 600_000 }, (err) => {
        if (err) {
          reject(new Error(`ffmpeg failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });

    onProgress?.(100, 'done');
  } finally {
    // Clean up temp directory
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Encode frames using native ffmpeg and return the MP4 bytes (instead of writing to disk).
 * Useful when the caller needs the bytes in memory.
 */
export async function framesToMp4NativeBytes(
  ffmpegPath: string,
  frames: Uint8Array[],
  audio: Uint8Array | null,
  options: VideoExportOptions = {},
): Promise<Uint8Array> {
  const tmpId = randomBytes(8).toString('hex');
  const tmpOutput = join(tmpdir(), `squisq-video-out-${tmpId}.mp4`);

  try {
    await framesToMp4Native(ffmpegPath, frames, audio, tmpOutput, options);
    const data = await readFile(tmpOutput);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } finally {
    await rm(tmpOutput, { force: true });
  }
}

/**
 * Encode PNG frames to an animated GIF using native FFmpeg.
 *
 * The shared palette graph uses changed-frame statistics and rectangle-scoped
 * palette application so static slide regions remain stable and compress well.
 * GIF has no audio track; callers should surface that limitation before calling.
 */
export async function framesToGifNative(
  ffmpegPath: string,
  frames: Uint8Array[],
  outputPath: string,
  options: GifExportOptions = {},
): Promise<void> {
  const fps = resolveGifFps(options);
  const { width, height } = resolveGifDimensions(options);
  const onProgress = options.onProgress;

  if (frames.length === 0) {
    throw new Error('No frames provided for encoding');
  }
  const gifOutputArgs = ffmpegGifOutputArgs({
    width,
    height,
    loop: options.loop ?? GIF_EXPORT_DEFAULTS.loop,
    maxColors: options.maxColors ?? GIF_EXPORT_DEFAULTS.maxColors,
    dither: options.dither ?? GIF_EXPORT_DEFAULTS.dither,
    bayerScale: options.bayerScale,
  });

  const tmpId = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `squisq-gif-${tmpId}`);
  await mkdir(workDir, { recursive: true });

  try {
    onProgress?.(0, 'writing frames');
    const padLen = String(frames.length).length;
    for (let i = 0; i < frames.length; i++) {
      const name = `frame-${String(i + 1).padStart(padLen, '0')}.png`;
      await writeFile(join(workDir, name), frames[i]);
      if (onProgress && i % 10 === 0) {
        onProgress(Math.round((i / frames.length) * 30), 'writing frames');
      }
    }

    onProgress?.(30, 'encoding');
    const padPattern = join(workDir, `frame-%0${padLen}d.png`);
    const args = ['-y', '-framerate', String(fps), '-i', padPattern, ...gifOutputArgs, outputPath];

    await new Promise<void>((resolve, reject) => {
      execFile(ffmpegPath, args, { timeout: 600_000 }, (err) => {
        if (err) reject(new Error(`ffmpeg GIF encoding failed: ${err.message}`));
        else resolve();
      });
    });
    onProgress?.(100, 'done');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Encode frames with native FFmpeg and return animated-GIF bytes. */
export async function framesToGifNativeBytes(
  ffmpegPath: string,
  frames: Uint8Array[],
  options: GifExportOptions = {},
): Promise<Uint8Array> {
  const tmpId = randomBytes(8).toString('hex');
  const tmpOutput = join(tmpdir(), `squisq-gif-out-${tmpId}.gif`);
  try {
    await framesToGifNative(ffmpegPath, frames, tmpOutput, options);
    const data = await readFile(tmpOutput);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } finally {
    await rm(tmpOutput, { force: true });
  }
}

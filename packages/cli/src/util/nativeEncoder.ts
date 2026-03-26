/**
 * Native FFmpeg Encoder
 *
 * Encodes PNG frames to MP4 using a locally installed ffmpeg binary.
 * Writes frames to a temporary directory, invokes ffmpeg as a child process,
 * and reads the resulting MP4.
 *
 * This is the fast path — used when native ffmpeg is detected on the system.
 * Falls back to the WASM encoder (in @bendyline/squisq-video) when unavailable.
 */

import { execFile } from 'node:child_process';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import type { VideoExportOptions } from '@bendyline/squisq-video';
import { QUALITY_PRESETS, resolveDimensions } from '@bendyline/squisq-video';

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
  const preset = QUALITY_PRESETS[quality];
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
      '-preset',
      preset.preset,
      '-crf',
      String(preset.crf),
      '-pix_fmt',
      'yuv420p',
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    );

    if (audioPath) {
      args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
    }

    args.push(outputPath);

    // Run ffmpeg
    await new Promise<void>((resolve, reject) => {
      const proc = execFile(ffmpegPath, args, { timeout: 600_000 }, (err) => {
        if (err) {
          reject(new Error(`ffmpeg failed: ${err.message}`));
        } else {
          resolve();
        }
      });

      // ffmpeg writes progress to stderr
      proc.stderr?.on('data', () => {
        // Could parse ffmpeg progress output here in the future
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

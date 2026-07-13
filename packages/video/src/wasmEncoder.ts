/**
 * WASM Video Encoder
 *
 * Encodes PNG frame screenshots into an MP4 video using ffmpeg.wasm.
 * Browser-pure — no Node.js APIs. The encoder requires a browser runtime with
 * SharedArrayBuffer support (normally supplied via COOP/COEP headers).
 *
 * Uses @ffmpeg/ffmpeg for H.264 encoding and optional AAC audio muxing.
 */

import { fetchFile } from '@ffmpeg/util';

import type { VideoExportOptions, EncoderResult } from './types.js';
import { resolveDimensions } from './types.js';
import { ffmpegVideoQualityArgs, audioBitrateArg, ffmpegAudioMuxArgs } from './ffmpegArgs.js';

/**
 * Encode an array of PNG frame screenshots into an MP4 video.
 *
 * @param frames - Array of PNG image bytes (one per frame, in order)
 * @param audio - Optional WAV/MP3/AAC audio bytes to mux into the video
 * @param options - Encoding options (fps, quality, dimensions, progress)
 * @returns Encoded MP4 data and duration metadata
 */
export async function framesToMp4Wasm(
  frames: Uint8Array[],
  audio: Uint8Array | null,
  options: VideoExportOptions = {},
): Promise<EncoderResult> {
  const fps = options.fps ?? 30;
  const quality = options.quality ?? 'normal';
  const { width, height } = resolveDimensions(options);
  const onProgress = options.onProgress;

  if (frames.length === 0) {
    throw new Error('No frames provided for encoding');
  }

  const runtime = globalThis as typeof globalThis & {
    process?: { versions?: { node?: string } };
  };
  if (runtime.process?.versions?.node && typeof window === 'undefined') {
    throw new Error(
      'framesToMp4Wasm is browser-only. In Node.js, use framesToMp4Native or framesToMp4NativeBytes from @bendyline/squisq-cli/api.',
    );
  }

  const duration = frames.length / fps;

  // Initialize ffmpeg.wasm
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  try {
    ffmpeg.on('progress', ({ progress }) => {
      if (onProgress) {
        const percent = Math.round(progress * 100);
        onProgress(Math.min(percent, 99), 'encoding');
      }
    });

    await ffmpeg.load(options.ffmpegWasm);

    onProgress?.(0, 'writing frames');

    // Write frame PNGs to virtual filesystem
    const padLen = String(frames.length).length;
    for (let i = 0; i < frames.length; i++) {
      const name = `frame-${String(i + 1).padStart(padLen, '0')}.png`;
      await ffmpeg.writeFile(name, frames[i]);

      // Report frame-write progress (0-40% of total)
      if (onProgress && i % 10 === 0) {
        onProgress(Math.round((i / frames.length) * 40), 'writing frames');
      }
    }

    // Write audio if provided
    if (audio) {
      await ffmpeg.writeFile('audio-input', audio);
    }

    onProgress?.(40, 'encoding');

    // Build ffmpeg command
    const padPattern = `frame-%0${padLen}d.png`;
    const args = ['-y', '-framerate', String(fps), '-i', padPattern];

    // Add audio input
    if (audio) {
      args.push('-i', 'audio-input');
    }

    // Video encoding settings
    args.push(
      '-c:v',
      'libx264',
      ...ffmpegVideoQualityArgs(quality),
      '-pix_fmt',
      'yuv420p',
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    );

    // Audio encoding
    if (audio) {
      args.push(...ffmpegAudioMuxArgs(audioBitrateArg(quality)));
    }

    args.push('output.mp4');

    // Run encoding
    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(`ffmpeg.wasm failed with exit code ${exitCode}`);
    }

    onProgress?.(95, 'reading output');

    // Read the output file
    const data = await ffmpeg.readFile('output.mp4');

    // Cleanup virtual filesystem
    for (let i = 0; i < frames.length; i++) {
      const name = `frame-${String(i + 1).padStart(padLen, '0')}.png`;
      await ffmpeg.deleteFile(name);
    }
    if (audio) {
      await ffmpeg.deleteFile('audio-input');
    }
    await ffmpeg.deleteFile('output.mp4');

    onProgress?.(100, 'done');

    // ffmpeg.readFile returns Uint8Array for binary files
    const outputData = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);

    return { data: outputData, duration };
  } finally {
    ffmpeg.terminate();
  }
}

// Re-export fetchFile for convenience — consumers may need it to prepare audio bytes
export { fetchFile };

/**
 * Animated GIF finalization for the browser export path.
 *
 * The frame-capture pipeline already produces a compact, video-only MP4. For
 * the GIF MVP we use that MP4 as a bounded-memory intermediate, then run a
 * palette generation/application pass through ffmpeg.wasm.
 */

import {
  ffmpegGifOutputArgs,
  type FfmpegWasmLoadConfig,
  type GifOutputOptions,
} from '@bendyline/squisq-video';

/** Build the deterministic ffmpeg arguments used for MP4 -> animated GIF. */
export function buildGifFfmpegArgs(options: GifOutputOptions): string[] {
  return ['-y', '-i', 'video.mp4', ...ffmpegGifOutputArgs(options), 'out.gif'];
}

/**
 * Convert a video-only MP4 into a looping animated GIF with a generated
 * palette. The ffmpeg runtime is always terminated, including on failure.
 */
export async function transcodeMp4ToGifWithFfmpegWasm(
  videoMp4: Uint8Array,
  options: GifOutputOptions,
  loadConfig?: FfmpegWasmLoadConfig,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (videoMp4.byteLength === 0) {
    throw new Error('Cannot create an animated GIF from an empty MP4.');
  }
  if (signal?.aborted) {
    throw new DOMException('Animated GIF export was cancelled.', 'AbortError');
  }

  const args = buildGifFfmpegArgs(options);
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  let terminated = false;
  const terminate = () => {
    if (terminated) return;
    terminated = true;
    ffmpeg.terminate();
  };
  const handleAbort = () => terminate();
  signal?.addEventListener('abort', handleAbort, { once: true });
  try {
    await ffmpeg.load({
      ...loadConfig,
      classWorkerURL:
        loadConfig?.classWorkerURL ??
        new URL('./workers/ffmpeg.class-worker.js', import.meta.url).href,
    });
    if (signal?.aborted) {
      throw new DOMException('Animated GIF export was cancelled.', 'AbortError');
    }
    await ffmpeg.writeFile('video.mp4', videoMp4);
    if (signal?.aborted) {
      throw new DOMException('Animated GIF export was cancelled.', 'AbortError');
    }
    const exitCode = await ffmpeg.exec(args);
    if (signal?.aborted) {
      throw new DOMException('Animated GIF export was cancelled.', 'AbortError');
    }
    if (exitCode !== 0) {
      throw new Error(`ffmpeg.wasm GIF transcode failed with exit code ${exitCode}`);
    }
    const data = await ffmpeg.readFile('out.gif');
    return data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
  } finally {
    signal?.removeEventListener('abort', handleAbort);
    terminate();
  }
}

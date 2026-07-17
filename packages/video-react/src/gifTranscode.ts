/**
 * Animated GIF finalization for the browser export path.
 *
 * The frame-capture pipeline already produces a compact, video-only MP4. For
 * the GIF MVP we use that MP4 as a bounded-memory intermediate, then run a
 * bounded palette generation and application passes through ffmpeg.wasm.
 */

import {
  ffmpegGifPaletteApplicationArgs,
  ffmpegGifPaletteGenerationFilter,
  resolveFfmpegWasmLoad,
  type FfmpegWasmLoadConfig,
  type GifOutputOptions,
} from '@bendyline/squisq-video';

/** Build the bounded first pass: MP4 -> one global palette image. */
export function buildGifPaletteFfmpegArgs(options: GifOutputOptions): string[] {
  return [
    '-y',
    '-i',
    'video.mp4',
    '-vf',
    ffmpegGifPaletteGenerationFilter(options),
    '-frames:v',
    '1',
    'palette.png',
  ];
}

/** Build the bounded second pass: MP4 + palette image -> animated GIF. */
export function buildGifFfmpegArgs(options: GifOutputOptions): string[] {
  return [
    '-y',
    '-i',
    'video.mp4',
    '-i',
    'palette.png',
    ...ffmpegGifPaletteApplicationArgs(options),
    'out.gif',
  ];
}

const FFMPEG_ERRORISH = /error|invalid|failed|out of memory|memory access|abort|unable to/i;

function ffmpegFailureDetail(logs: string[]): string | null {
  const lines = logs.map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => FFMPEG_ERRORISH.test(line)) ?? lines.at(-1) ?? null;
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

  // Validate runtime assets before allocating the runtime, so an unconfigured
  // core fails cleanly instead of reaching for @ffmpeg/ffmpeg's CDN default.
  const load = resolveFfmpegWasmLoad(loadConfig, 'Animated GIF export', {
    classWorkerURL: new URL('./workers/ffmpeg.class-worker.js', import.meta.url).href,
  });

  const paletteArgs = buildGifPaletteFfmpegArgs(options);
  const gifArgs = buildGifFfmpegArgs(options);
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  const recentLogs: string[] = [];
  const handleLog = ({ message }: { message: string }) => {
    recentLogs.push(message);
    if (recentLogs.length > 40) recentLogs.shift();
  };
  ffmpeg.on('log', handleLog);
  let terminated = false;
  const terminate = () => {
    if (terminated) return;
    terminated = true;
    ffmpeg.terminate();
  };
  const handleAbort = () => terminate();
  signal?.addEventListener('abort', handleAbort, { once: true });
  try {
    await ffmpeg.load(load);
    if (signal?.aborted) {
      throw new DOMException('Animated GIF export was cancelled.', 'AbortError');
    }
    await ffmpeg.writeFile('video.mp4', videoMp4);
    if (signal?.aborted) {
      throw new DOMException('Animated GIF export was cancelled.', 'AbortError');
    }
    const execPhase = async (args: string[], phase: string): Promise<void> => {
      recentLogs.length = 0;
      let exitCode: number;
      try {
        exitCode = await ffmpeg.exec(args);
      } catch (caught: unknown) {
        if (signal?.aborted) {
          throw new DOMException('Animated GIF export was cancelled.', 'AbortError');
        }
        const detail = ffmpegFailureDetail(recentLogs);
        const fallback = caught instanceof Error ? caught.message : String(caught);
        throw new Error(`ffmpeg.wasm GIF transcode failed during ${phase}: ${detail ?? fallback}`);
      }
      if (signal?.aborted) {
        throw new DOMException('Animated GIF export was cancelled.', 'AbortError');
      }
      if (exitCode !== 0) {
        const detail = ffmpegFailureDetail(recentLogs);
        throw new Error(
          `ffmpeg.wasm GIF transcode failed during ${phase} with exit code ${exitCode}` +
            (detail ? `: ${detail}` : ''),
        );
      }
    };

    // Do not use a split palette graph here. paletteuse cannot consume its
    // branch until palettegen reaches EOF, so long exports retain every raw
    // decoded frame in the wasm heap. Reopening the compact MP4 for a second
    // pass keeps memory bounded to decoder/filter working sets.
    await execPhase(paletteArgs, 'palette generation');
    await execPhase(gifArgs, 'palette application');

    // Release intermediates before copying a potentially large GIF back from
    // the wasm filesystem into JavaScript memory.
    await ffmpeg.deleteFile('video.mp4').catch(() => false);
    await ffmpeg.deleteFile('palette.png').catch(() => false);
    const data = await ffmpeg.readFile('out.gif');
    return data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
  } finally {
    signal?.removeEventListener('abort', handleAbort);
    ffmpeg.off('log', handleLog);
    terminate();
  }
}

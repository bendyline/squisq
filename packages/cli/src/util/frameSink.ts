/**
 * Frame sinks for offline MP4 rendering.
 *
 * The capture loop produces one encoded still (PNG or JPEG) per output frame
 * and hands it to a sink. Two kinds exist:
 *
 * - {@link createFfmpegPipeSink} streams stills into one long-running ffmpeg
 *   process over stdin (`image2pipe`) so x264 encodes as frames arrive and
 *   memory stays flat however long the document is. This replaced the
 *   retain-every-PNG-then-encode design, whose 256 MB budget held only a few
 *   seconds of 1080p photo slides.
 * - {@link openDirectoryFrameStore} spools stills to a directory next to a
 *   manifest, so a render can be inspected frame by frame and resumed after
 *   an interruption without re-capturing frames already on disk.
 *
 * Related: api.ts (`renderDocToMp4`), runFfmpeg.ts (stderr digest),
 * @bendyline/squisq-video ffmpegArgs.ts (quality and mux flags).
 *
 * Gotchas: the pipe sink honours stdin backpressure, so a slow encoder slows
 * capture rather than buffering frames. A wall-clock timeout would fire on
 * every long render, so the sink watches for silence instead: a frame write
 * or an ffmpeg stderr line counts as activity.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Doc } from '@bendyline/squisq/schemas';
import type { VideoQuality } from '@bendyline/squisq-video';
import {
  audioBitrateArg,
  ffmpegAudioMuxArgs,
  ffmpegVideoQualityArgs,
} from '@bendyline/squisq-video';
import { lastMeaningfulFfmpegLine } from './runFfmpeg.js';

/** Still-image format captured from the browser for each frame. */
export type CaptureFormat = 'png' | 'jpeg';

/** Destination for captured stills, in output order. */
export interface FrameSink {
  /** Append one still `repeat` times (cover pre-roll repeats a single capture). */
  write(frame: Uint8Array, repeat?: number): Promise<void>;
  /** Close the input and wait for the encoder to finish; rejects on encoder failure. */
  finish(): Promise<void>;
  /** Terminate the encoder and discard partial output. Never rejects. */
  abort(): Promise<void>;
  /** Frames accepted so far, repeats included. */
  readonly frameCount: number;
}

/** Everything the pipe encoder needs; mirrors the memory path's ffmpeg flags. */
export interface FfmpegPipeSinkOptions {
  ffmpegPath: string;
  outputPath: string;
  fps: number;
  width: number;
  height: number;
  quality: VideoQuality;
  captureFormat: CaptureFormat;
  /** Pre-mixed audio file to mux, or null for a silent video. */
  audioPath: string | null;
  signal?: AbortSignal;
  /** Fail when neither a frame nor encoder output arrives for this long (default 120 s). */
  idleTimeoutMs?: number;
}

/** ffmpeg arguments for the streaming (`image2pipe`) H.264 encode. Pure; unit-tested. */
export function ffmpegPipeArgs(
  options: Omit<FfmpegPipeSinkOptions, 'ffmpegPath' | 'signal' | 'idleTimeoutMs'>,
): string[] {
  const { outputPath, fps, width, height, quality, captureFormat, audioPath } = options;
  const args = [
    '-y',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-c:v',
    captureFormat === 'jpeg' ? 'mjpeg' : 'png',
    '-i',
    'pipe:0',
  ];
  if (audioPath) args.push('-i', audioPath);
  // JPEG stills decode as full-range (yuvj420p). Convert to limited range while
  // scaling and tag the stream, otherwise x264 emits full-range video that some
  // players render washed out; PNG stills already arrive as limited-range RGB.
  const range = captureFormat === 'jpeg' ? ':in_range=pc:out_range=tv' : '';
  args.push(
    '-c:v',
    'libx264',
    ...ffmpegVideoQualityArgs(quality),
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease${range},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
  );
  if (audioPath) args.push(...ffmpegAudioMuxArgs(audioBitrateArg(quality)));
  // faststart moves the index to the front so the file streams before it fully downloads.
  args.push('-movflags', '+faststart', outputPath);
  return args;
}

const STDERR_TAIL_LINES = 200;
const IDLE_POLL_MS = 5_000;

/** Stream stills into a long-running ffmpeg process. */
export function createFfmpegPipeSink(options: FfmpegPipeSinkOptions): FrameSink {
  const { ffmpegPath, signal, idleTimeoutMs = 120_000 } = options;
  const child = spawn(ffmpegPath, ffmpegPipeArgs(options), {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  const stderrTail: string[] = [];
  let lastActivity = Date.now();
  let failure: Error | null = null;
  let frames = 0;
  let exitCode: number | null | undefined;

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    lastActivity = Date.now();
    for (const line of chunk.split(/\r?\n|\r/)) {
      if (!line.trim()) continue;
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    }
  });
  child.on('error', (err) => {
    failure ??= err;
  });
  // EPIPE arrives here when ffmpeg dies mid-stream; the exit handler explains why.
  child.stdin.on('error', (err) => {
    failure ??= err;
  });
  const exited = new Promise<void>((resolve) => {
    child.on('exit', (code) => {
      exitCode = code;
      resolve();
    });
    child.on('error', () => resolve());
  });

  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > idleTimeoutMs) {
      failure ??= new Error(
        `ffmpeg produced no output for ${Math.round(idleTimeoutMs / 1000)}s`,
      );
      child.kill('SIGKILL');
    }
  }, IDLE_POLL_MS);
  idleTimer.unref();
  const onAbort = (): void => {
    child.kill('SIGKILL');
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const cleanup = (): void => {
    clearInterval(idleTimer);
    signal?.removeEventListener('abort', onAbort);
  };
  const describeFailure = (): string => {
    const detail = lastMeaningfulFfmpegLine(stderrTail.join('\n'));
    if (failure && (failure as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'the ffmpeg binary could not be started (ENOENT). Run `squisq doctor` to check your FFmpeg installation.';
    }
    const head = failure
      ? failure.message
      : exitCode === undefined
        ? 'ffmpeg exited unexpectedly'
        : `ffmpeg exited unsuccessfully (exit code ${exitCode})`;
    return detail ? `${head} (last output: ${detail})` : head;
  };
  const throwIfDead = (): void => {
    signal?.throwIfAborted();
    if (failure || exitCode !== undefined) {
      throw new Error(`ffmpeg failed: ${describeFailure()}`);
    }
  };

  return {
    get frameCount() {
      return frames;
    },
    async write(frame, repeat = 1) {
      if (!Number.isSafeInteger(repeat) || repeat < 1) {
        throw new Error('Frame repetition count must be a positive integer');
      }
      throwIfDead();
      for (let i = 0; i < repeat; i += 1) {
        lastActivity = Date.now();
        if (!child.stdin.write(frame)) {
          // Backpressure: wait for the encoder to drain, but never past its death.
          await Promise.race([once(child.stdin, 'drain').catch(() => undefined), exited]);
        }
        throwIfDead();
        frames += 1;
      }
    },
    async finish() {
      throwIfDead();
      child.stdin.end();
      await exited;
      cleanup();
      signal?.throwIfAborted();
      if (failure || exitCode !== 0) throw new Error(`ffmpeg failed: ${describeFailure()}`);
    },
    async abort() {
      cleanup();
      if (exitCode === undefined) child.kill('SIGKILL');
      await exited;
    },
  };
}

/**
 * Identity of a spooled render. A spool is reusable only when every value
 * matches: a different doc, size, rate, caption or animation setting changes
 * the pixels, and a different capture format changes the bytes on disk.
 */
export interface FrameManifest {
  generatedBy: 'squisq-cli';
  docHash: string;
  fps: number;
  width: number;
  height: number;
  captionStyle: string | null;
  animationsEnabled: boolean;
  coverPreRoll: number;
  captureFormat: CaptureFormat;
}

/** Stable digest of a Doc's render-relevant content for spool manifests. */
export function docRenderHash(doc: Doc): string {
  return createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}

/** Spool directory holding one still per output frame plus its manifest. */
export interface DirectoryFrameStore {
  readonly dir: string;
  /** True when an existing spool matched the manifest and may supply frames. */
  readonly reusable: boolean;
  path(index: number): string;
  has(index: number): Promise<boolean>;
  read(index: number): Promise<Uint8Array>;
  write(index: number, frame: Uint8Array): Promise<void>;
}

const MANIFEST_NAME = 'manifest.json';

/**
 * Open (creating if needed) a spool directory. With `resume`, frames from a
 * spool whose manifest equals `manifest` are offered for reuse; otherwise the
 * manifest is replaced and every frame is captured afresh (existing files with
 * the same names are overwritten as the render proceeds).
 */
export async function openDirectoryFrameStore(
  dir: string,
  manifest: FrameManifest,
  resume: boolean,
): Promise<DirectoryFrameStore> {
  await mkdir(dir, { recursive: true });
  const manifestPath = join(dir, MANIFEST_NAME);
  let existing: FrameManifest | null = null;
  try {
    existing = JSON.parse(await readFile(manifestPath, 'utf8')) as FrameManifest;
  } catch {
    existing = null;
  }
  const reusable = resume && existing !== null && isDeepStrictEqual(existing, manifest);
  if (!reusable) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const extension = manifest.captureFormat === 'jpeg' ? 'jpg' : 'png';
  const path = (index: number): string =>
    join(dir, `frame-${String(index).padStart(6, '0')}.${extension}`);
  return {
    dir,
    reusable,
    path,
    async has(index) {
      try {
        await access(path(index));
        return true;
      } catch {
        return false;
      }
    },
    async read(index) {
      const bytes = await readFile(path(index));
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },
    async write(index, frame) {
      await writeFile(path(index), frame);
    },
  };
}

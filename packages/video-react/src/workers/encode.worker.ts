/**
 * Video Encoding Web Worker
 *
 * Encodes video frames to MP4 using one of two backends:
 * - **WebCodecs** (preferred): Streaming H.264 encoding via VideoEncoder + mp4-muxer.
 *   Each frame is encoded as it arrives — minimal memory footprint.
 * - **ffmpeg.wasm** (fallback): Batch encoding in ~10-second segments.
 *   Used when WebCodecs is unavailable (older browsers).
 *
 * Frames arrive as ImageBitmap (zero-copy transfer from main thread).
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  InitMessage,
  FrameMessage,
} from './workerTypes.js';
import {
  bitrateForQuality,
  ffmpegVideoQualityArgs,
  resolveFfmpegWasmLoad,
} from '@bendyline/squisq-video';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

import { createMp4Muxer, type Mp4MuxerHandle } from '../mp4Mux.js';

// ── State ──────────────────────────────────────────────────────────

let backend: 'webcodecs' | 'ffmpeg-wasm' | null = null;
let cancelled = false;

// WebCodecs state
let videoEncoder: VideoEncoder | null = null;
let muxer: Mp4MuxerHandle | null = null;

// ffmpeg.wasm state
let ffmpegInstance: FFmpeg | null = null;
let ffmpegFrames: Array<{ data: Uint8Array; index: number }> = [];
let ffmpegConfig: InitMessage | null = null;

// Frame tracking
let totalFramesReceived = 0;
/** Frames the caller said it would send; 0 means "unknown" (indeterminate). */
let totalFramesExpected = 0;

// ── Helpers ────────────────────────────────────────────────────────

function post(msg: WorkerToMainMessage, transfer?: Transferable[]) {
  self.postMessage(msg, { transfer: transfer ?? [] });
}

function postProgress(percent: number, phase: string) {
  post({ type: 'progress', percent, phase });
}

/**
 * Report frame-ingest progress as a real fraction of the expected frame count,
 * scaled into the `0..scale` share of the export this phase represents.
 *
 * When the caller did not supply `totalFrames` we report `indeterminate` rather
 * than inventing a number. (The previous `n / (n + 1) * scale` formula was pure
 * fiction: it reached ~90% of `scale` after ten frames and then crept
 * asymptotically toward `scale` forever, regardless of the real total.)
 */
function postFrameProgress(scale: number, phase: string) {
  if (totalFramesExpected <= 0) {
    post({ type: 'progress', percent: 0, phase, indeterminate: true });
    return;
  }
  const ratio = Math.min(totalFramesReceived / totalFramesExpected, 1);
  post({ type: 'progress', percent: Math.round(ratio * scale), phase });
}

function postError(message: string) {
  post({ type: 'error', message });
}

function disposeFfmpeg(): void {
  try {
    ffmpegInstance?.terminate();
  } finally {
    ffmpegInstance = null;
  }
}

// ── Feature Detection ──────────────────────────────────────────────

function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

function hasSharedArrayBuffer(): boolean {
  return typeof SharedArrayBuffer !== 'undefined';
}

/**
 * Check whether the browser's WebCodecs implementation actually supports
 * the H.264 Baseline profile we use. Linux Chromium ships without the
 * proprietary H.264 encoder, so `VideoEncoder` exists but `configure()`
 * for `avc1.*` fails asynchronously.
 */
async function supportsWebCodecsH264(config: InitMessage): Promise<boolean> {
  if (!hasWebCodecs()) return false;
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: 'avc1.42001f',
      width: config.width,
      height: config.height,
      bitrate: bitrateForQuality(config.quality, config.width, config.height),
      framerate: config.fps,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

// ── WebCodecs Backend ──────────────────────────────────────────────

function initWebCodecs(config: InitMessage) {
  muxer = createMp4Muxer({
    width: config.width,
    height: config.height,
    fps: config.fps,
  });

  videoEncoder = new VideoEncoder({
    output(chunk, meta) {
      if (cancelled) return;
      muxer!.addVideoChunk(chunk, meta ?? undefined);
    },
    error(err) {
      postError(`WebCodecs encoder error: ${err.message}`);
    },
  });

  // Deliberate profile split from mainThreadEncoder (avc1.640028, High@4.0):
  // this worker is the max-compatibility fallback path, so it uses H.264
  // Baseline (avc1.42001f) — widest decoder support at a small quality cost.
  videoEncoder.configure({
    codec: 'avc1.42001f',
    width: config.width,
    height: config.height,
    bitrate: bitrateForQuality(config.quality, config.width, config.height),
    framerate: config.fps,
  });
}

async function encodeFrameWebCodecs(msg: FrameMessage) {
  if (!videoEncoder || cancelled) {
    msg.bitmap.close();
    return;
  }

  const frame = new VideoFrame(msg.bitmap, { timestamp: msg.timestamp });
  const keyFrame = msg.frameIndex % 30 === 0; // Key frame every 30 frames
  videoEncoder.encode(frame, { keyFrame });
  frame.close();
  msg.bitmap.close();
  totalFramesReceived++;

  postFrameProgress(50, frameLabel('Encoding'));
}

/** "Encoding frame 12/300" when the total is known, "Encoding frame 12" when not. */
function frameLabel(verb: string): string {
  return totalFramesExpected > 0
    ? `${verb} frame ${totalFramesReceived}/${totalFramesExpected}`
    : `${verb} frame ${totalFramesReceived}`;
}

async function finalizeWebCodecs() {
  if (!videoEncoder || !muxer || cancelled) return;

  postProgress(50, 'Flushing encoder…');
  await videoEncoder.flush();
  videoEncoder.close();
  videoEncoder = null;

  postProgress(90, 'Finalizing MP4…');
  const buffer = muxer.finalize();
  muxer = null;

  post({ type: 'complete', data: buffer, size: buffer.byteLength }, [buffer]);
}

// ── ffmpeg.wasm Backend ────────────────────────────────────────────

async function initFfmpegWasm(config: InitMessage) {
  ffmpegConfig = config;
  ffmpegFrames = [];
  ffmpegSegments.length = 0;
  totalFramesReceived = 0;

  // Lazy-load ffmpeg.wasm
  // Resolve runtime assets before touching the runtime. An unconfigured core
  // throws here with setup instructions instead of inheriting @ffmpeg/ffmpeg's
  // unpkg CDN default — this error is intentionally NOT wrapped by the generic
  // "Failed to load ffmpeg.wasm" handler below, which would bury the hint.
  const load = resolveFfmpegWasmLoad(config.ffmpegWasm, 'The ffmpeg.wasm encoder fallback', {
    classWorkerURL: new URL('./ffmpeg.class-worker.js', import.meta.url).href,
  });

  let ffmpeg: FFmpeg | null = null;
  try {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    ffmpeg = new FFmpeg();
    await ffmpeg.load(load);
    ffmpegInstance = ffmpeg;
  } catch (err: unknown) {
    ffmpeg?.terminate();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load ffmpeg.wasm: ${message}. ` +
        'Ensure @ffmpeg/ffmpeg and @ffmpeg/util are installed and ' +
        'Cross-Origin-Isolation headers (COOP/COEP) are set.',
    );
  }
}

async function encodeFrameFfmpeg(msg: FrameMessage) {
  if (cancelled) {
    msg.bitmap.close();
    return;
  }

  // Convert ImageBitmap to PNG bytes via OffscreenCanvas
  const canvas = new OffscreenCanvas(msg.bitmap.width, msg.bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    msg.bitmap.close();
    postError('Failed to create OffscreenCanvas 2D context');
    return;
  }
  ctx.drawImage(msg.bitmap, 0, 0);
  msg.bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await blob.arrayBuffer();
  ffmpegFrames.push({ data: new Uint8Array(arrayBuffer), index: msg.frameIndex });
  totalFramesReceived++;

  postFrameProgress(80, frameLabel('Collecting'));

  // Batch encode every ~10 seconds worth of frames
  const batchSize = (ffmpegConfig?.fps ?? 30) * 10;
  if (ffmpegFrames.length >= batchSize) {
    await encodeFfmpegBatch();
  }
}

/** Segments already encoded as MP4 data. */
const ffmpegSegments: Uint8Array[] = [];

async function execOrThrow(ffmpeg: FFmpeg, args: string[], operation: string): Promise<void> {
  const exitCode = await ffmpeg.exec(args);
  if (exitCode !== 0) {
    throw new Error(`${operation} failed with ffmpeg exit code ${exitCode}`);
  }
}

async function readBinaryFile(ffmpeg: FFmpeg, path: string): Promise<Uint8Array> {
  const data = await ffmpeg.readFile(path);
  if (typeof data === 'string') {
    throw new Error(`Expected binary data from ffmpeg for ${path}`);
  }
  return data;
}

async function encodeFfmpegBatch() {
  if (!ffmpegInstance || ffmpegFrames.length === 0 || cancelled) return;

  const ffmpeg = ffmpegInstance;
  const config = ffmpegConfig!;
  const batchIndex = ffmpegSegments.length;

  // Frames are collected and encoded incrementally, so ingest fraction is the
  // only honest signal here. Batching is an internal memory detail — reporting
  // `40 + batchIndex * 5` made the bar climb with segment count and run past
  // 100% on any export longer than ~2 minutes.
  postFrameProgress(80, `Encoding batch ${batchIndex + 1}…`);

  // Write frames to virtual filesystem
  for (const frame of ffmpegFrames) {
    const paddedIndex = String(frame.index).padStart(6, '0');
    await ffmpeg.writeFile(`frame_${paddedIndex}.png`, frame.data);
  }

  const firstIndex = ffmpegFrames[0].index;
  const segmentName = `segment_${batchIndex}.mp4`;

  // Encode batch to MP4 segment
  await execOrThrow(
    ffmpeg,
    [
      '-framerate',
      String(config.fps),
      '-start_number',
      String(firstIndex),
      '-i',
      `frame_%06d.png`,
      '-frames:v',
      String(ffmpegFrames.length),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      ...ffmpegVideoQualityArgs(config.quality),
      segmentName,
    ],
    `Encoding video segment ${batchIndex + 1}`,
  );

  // Read segment and clean up frames
  const segmentData = await readBinaryFile(ffmpeg, segmentName);
  ffmpegSegments.push(segmentData);

  // Clean up frame files
  for (const frame of ffmpegFrames) {
    const paddedIndex = String(frame.index).padStart(6, '0');
    await ffmpeg.deleteFile(`frame_${paddedIndex}.png`);
  }
  await ffmpeg.deleteFile(segmentName);

  // Free batch memory
  ffmpegFrames = [];
}

async function finalizeFfmpeg() {
  if (!ffmpegInstance || cancelled) return;

  // Encode any remaining frames
  await encodeFfmpegBatch();

  const ffmpeg = ffmpegInstance;

  postProgress(85, 'Concatenating segments…');

  let finalData: Uint8Array;

  if (ffmpegSegments.length === 1) {
    // Single segment — no concat needed
    finalData = ffmpegSegments[0];
  } else if (ffmpegSegments.length > 1) {
    // Write segments and concat list
    const concatList: string[] = [];
    for (let i = 0; i < ffmpegSegments.length; i++) {
      const name = `seg_${i}.mp4`;
      await ffmpeg.writeFile(name, ffmpegSegments[i]);
      concatList.push(`file '${name}'`);
    }
    await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList.join('\n')));

    await execOrThrow(
      ffmpeg,
      ['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'output.mp4'],
      'Concatenating video segments',
    );

    finalData = await readBinaryFile(ffmpeg, 'output.mp4');

    // Clean up
    for (let i = 0; i < ffmpegSegments.length; i++) {
      await ffmpeg.deleteFile(`seg_${i}.mp4`);
    }
    await ffmpeg.deleteFile('concat.txt');
    await ffmpeg.deleteFile('output.mp4');
  } else {
    postError('No frames were encoded');
    return;
  }

  postProgress(95, 'Preparing download…');

  // Convert Uint8Array to a transferable ArrayBuffer
  const sliced = new Uint8Array(finalData).buffer as ArrayBuffer;
  post({ type: 'complete', data: sliced, size: sliced.byteLength }, [sliced]);

  // Clean up
  disposeFfmpeg();
  ffmpegSegments.length = 0;
}

// ── Message Handler ────────────────────────────────────────────────

async function handleMessage(msg: MainToWorkerMessage): Promise<void> {
  switch (msg.type) {
    case 'init': {
      cancelled = false;
      totalFramesReceived = 0;
      totalFramesExpected =
        typeof msg.totalFrames === 'number' && Number.isFinite(msg.totalFrames)
          ? Math.max(0, Math.floor(msg.totalFrames))
          : 0;

      if (await supportsWebCodecsH264(msg)) {
        backend = 'webcodecs';
        initWebCodecs(msg);
      } else if (hasSharedArrayBuffer()) {
        backend = 'ffmpeg-wasm';
        await initFfmpegWasm(msg);
      } else {
        throw new Error(
          'No video encoding support available. ' +
            'WebCodecs H.264 is unavailable (typical on Linux Chromium without proprietary codecs) ' +
            'and ffmpeg.wasm requires SharedArrayBuffer (Cross-Origin-Isolation headers).',
        );
      }

      post({ type: 'capabilities', backend });
      postProgress(0, 'Encoder ready');
      break;
    }

    case 'frame': {
      if (cancelled) {
        msg.bitmap.close();
        return;
      }
      if (backend === 'webcodecs') {
        await encodeFrameWebCodecs(msg);
      } else if (backend === 'ffmpeg-wasm') {
        await encodeFrameFfmpeg(msg);
      } else {
        msg.bitmap.close();
        throw new Error('Encoder received a frame before it was initialized');
      }
      post({ type: 'frame-complete', frameIndex: msg.frameIndex });
      break;
    }

    case 'finalize': {
      if (backend === 'webcodecs') {
        await finalizeWebCodecs();
      } else if (backend === 'ffmpeg-wasm') {
        await finalizeFfmpeg();
      } else {
        throw new Error('Encoder cannot finalize before it is initialized');
      }
      break;
    }

    case 'cancel': {
      if (videoEncoder && videoEncoder.state !== 'closed') {
        videoEncoder.close();
        videoEncoder = null;
      }
      muxer = null;
      disposeFfmpeg();
      ffmpegFrames = [];
      ffmpegSegments.length = 0;
      totalFramesExpected = 0;
      backend = null;
      break;
    }
  }
}

// MessageEvent callbacks are not implicitly serialized: an async frame handler
// can still be running when finalize arrives. Keep one queue so frame ownership,
// ffmpeg's virtual filesystem, and finalization have a single ordering boundary.
let messageQueue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  // Cancellation must become visible to the currently-running operation without
  // waiting behind all queued frames. Cleanup itself remains ordered.
  if (msg.type === 'cancel') cancelled = true;

  messageQueue = messageQueue
    .then(() => handleMessage(msg))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      postError(message);
    });
};

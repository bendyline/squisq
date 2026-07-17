/**
 * Worker-backed video encoder.
 *
 * Spawns `workers/encode.worker.ts` and exposes the same shape as
 * `MainThreadEncoder` so `useVideoExport` can treat both backends
 * uniformly. Used as a fallback when WebCodecs H.264 isn't supported
 * (typical on Linux Chromium): the worker auto-selects its ffmpeg.wasm
 * path in that case.
 */

import type { MainThreadEncoder, EncoderConfig } from './mainThreadEncoder.js';
import type { MainToWorkerMessage, WorkerToMainMessage } from './workers/workerTypes.js';
import type { FfmpegWasmLoadConfig } from '@bendyline/squisq-video';
import { validateVideoExportOptions } from '@bendyline/squisq-video';

/** Resolves once the worker has reported which backend it picked. */
export interface WorkerEncoder extends MainThreadEncoder {
  /** Backend the worker selected ('webcodecs' or 'ffmpeg-wasm'). */
  readonly ready: Promise<'webcodecs' | 'ffmpeg-wasm'>;
}

export function createWorkerEncoder(
  config: EncoderConfig & { ffmpegWasm?: FfmpegWasmLoadConfig },
): WorkerEncoder {
  validateVideoExportOptions(config);

  const worker = new Worker(new URL('./workers/encode.worker.js', import.meta.url), {
    type: 'module',
  });

  let state: 'open' | 'finalizing' | 'closed' = 'open';
  let fatalError: Error | null = null;
  let finalizeResolve: ((buffer: ArrayBuffer) => void) | null = null;
  let finalizeReject: ((err: Error) => void) | null = null;
  let readyResolve: ((backend: 'webcodecs' | 'ffmpeg-wasm') => void) | null = null;
  let readyReject: ((err: Error) => void) | null = null;
  let readySettled = false;
  const frameWaiters = new Map<
    number,
    { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void }
  >();

  const ready = new Promise<'webcodecs' | 'ffmpeg-wasm'>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const frameDuration = 1_000_000 / config.fps; // microseconds per frame

  function post(msg: MainToWorkerMessage, transfer?: Transferable[]) {
    worker.postMessage(msg, transfer ?? []);
  }

  // Keep async lifecycle checks observable to TypeScript: event handlers can
  // change state while finalize() is awaiting pending frame acknowledgements.
  const currentState = () => state;

  worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'capabilities':
        readySettled = true;
        readyResolve?.(msg.backend);
        readyResolve = readyReject = null;
        break;
      case 'frame-complete': {
        const waiter = frameWaiters.get(msg.frameIndex);
        waiter?.resolve();
        frameWaiters.delete(msg.frameIndex);
        break;
      }
      case 'complete':
        state = 'closed';
        finalizeResolve?.(msg.data);
        finalizeResolve = finalizeReject = null;
        worker.terminate();
        break;
      case 'error': {
        const err = new Error(msg.message);
        fatalError = err;
        state = 'closed';
        readySettled = true;
        readyReject?.(err);
        finalizeReject?.(err);
        for (const waiter of frameWaiters.values()) waiter.reject(err);
        frameWaiters.clear();
        readyResolve = readyReject = null;
        finalizeResolve = finalizeReject = null;
        worker.terminate();
        break;
      }
      // 'progress' is informational; ignored at this layer
    }
  };

  worker.onerror = (event) => {
    const err = new Error(event.message || 'Worker error');
    fatalError = err;
    state = 'closed';
    readySettled = true;
    readyReject?.(err);
    finalizeReject?.(err);
    for (const waiter of frameWaiters.values()) waiter.reject(err);
    frameWaiters.clear();
    readyResolve = readyReject = null;
    finalizeResolve = finalizeReject = null;
    worker.terminate();
  };

  post({
    type: 'init',
    width: config.width,
    height: config.height,
    fps: config.fps,
    quality: config.quality,
    ...(config.totalFrames !== undefined ? { totalFrames: config.totalFrames } : {}),
    ...(config.ffmpegWasm ? { ffmpegWasm: config.ffmpegWasm } : {}),
  });

  return {
    ready,

    encodeFrame(frame, frameIndex: number): Promise<void> {
      if (typeof HTMLCanvasElement !== 'undefined' && frame instanceof HTMLCanvasElement) {
        return Promise.reject(new Error('Worker encoding requires a transferable ImageBitmap'));
      }
      const bitmap = frame as ImageBitmap;
      if (state !== 'open' || fatalError) {
        bitmap.close();
        return Promise.reject(fatalError ?? new Error('Encoder is not accepting frames'));
      }
      if (frameWaiters.has(frameIndex)) {
        bitmap.close();
        return Promise.reject(new Error(`Frame ${frameIndex} was submitted more than once`));
      }
      let resolveFrame!: () => void;
      let rejectFrame!: (err: Error) => void;
      const promise = new Promise<void>((resolve, reject) => {
        resolveFrame = resolve;
        rejectFrame = reject;
      });
      frameWaiters.set(frameIndex, { promise, resolve: resolveFrame, reject: rejectFrame });
      const timestamp = Math.round(frameIndex * frameDuration);
      post({ type: 'frame', bitmap, frameIndex, timestamp }, [bitmap]);
      return promise;
    },

    async finalize(): Promise<ArrayBuffer> {
      if (state !== 'open') throw new Error('Encoder already closed or finalizing');
      if (fatalError) throw fatalError;
      state = 'finalizing';
      await Promise.all(Array.from(frameWaiters.values(), (waiter) => waiter.promise));
      if (currentState() === 'closed') {
        throw fatalError ?? new Error('Encoder closed during finalization');
      }
      return new Promise<ArrayBuffer>((resolve, reject) => {
        finalizeResolve = resolve;
        finalizeReject = reject;
        post({ type: 'finalize' });
      });
    },

    close() {
      if (state === 'closed') return;
      state = 'closed';
      const err = new Error('Encoder closed');
      if (!readySettled) {
        readySettled = true;
        readyReject?.(err);
      }
      finalizeReject?.(err);
      for (const waiter of frameWaiters.values()) waiter.reject(err);
      frameWaiters.clear();
      readyResolve = readyReject = null;
      finalizeResolve = finalizeReject = null;
      post({ type: 'cancel' });
      worker.terminate();
    },
  };
}

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

/** Resolves once the worker has reported which backend it picked. */
export interface WorkerEncoder extends MainThreadEncoder {
  /** Backend the worker selected ('webcodecs' or 'ffmpeg-wasm'). */
  readonly ready: Promise<'webcodecs' | 'ffmpeg-wasm'>;
}

export function createWorkerEncoder(config: EncoderConfig): WorkerEncoder {
  if (!config.fps || config.fps <= 0 || !config.width || !config.height) {
    throw new Error(
      `Invalid encoder config: fps=${config.fps}, width=${config.width}, height=${config.height}`,
    );
  }

  const worker = new Worker(new URL('./workers/encode.worker.js', import.meta.url), {
    type: 'module',
  });

  let closed = false;
  let fatalError: Error | null = null;
  let finalizeResolve: ((buffer: ArrayBuffer) => void) | null = null;
  let finalizeReject: ((err: Error) => void) | null = null;
  let readyResolve: ((backend: 'webcodecs' | 'ffmpeg-wasm') => void) | null = null;
  let readyReject: ((err: Error) => void) | null = null;

  const ready = new Promise<'webcodecs' | 'ffmpeg-wasm'>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const frameDuration = 1_000_000 / config.fps; // microseconds per frame

  function post(msg: MainToWorkerMessage, transfer?: Transferable[]) {
    worker.postMessage(msg, transfer ?? []);
  }

  worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'capabilities':
        readyResolve?.(msg.backend);
        readyResolve = readyReject = null;
        break;
      case 'complete':
        finalizeResolve?.(msg.data);
        finalizeResolve = finalizeReject = null;
        worker.terminate();
        break;
      case 'error': {
        const err = new Error(msg.message);
        fatalError = err;
        readyReject?.(err);
        finalizeReject?.(err);
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
    readyReject?.(err);
    finalizeReject?.(err);
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
  });

  return {
    ready,

    encodeFrame(bitmap: ImageBitmap, frameIndex: number) {
      if (closed || fatalError) {
        bitmap.close();
        return;
      }
      const timestamp = Math.round(frameIndex * frameDuration);
      post({ type: 'frame', bitmap, frameIndex, timestamp }, [bitmap]);
    },

    async finalize(): Promise<ArrayBuffer> {
      if (closed) throw new Error('Encoder already closed');
      if (fatalError) throw fatalError;
      closed = true;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        finalizeResolve = resolve;
        finalizeReject = reject;
        post({ type: 'finalize' });
      });
    },

    close() {
      if (closed) return;
      closed = true;
      post({ type: 'cancel' });
      worker.terminate();
    },
  };
}

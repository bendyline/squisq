/**
 * Main-thread client for the media-edit engine.
 *
 * Jobs run in `workers/mediaEdit.worker.js` so a render never blocks the
 * editor. If the worker cannot start (a CSP without `worker-src`, a bundler
 * that dropped the asset), jobs fall back to the main thread with the same
 * results — slower to the UI, never broken.
 */

import type { MediaFxAnalysis } from '@bendyline/squisq/mediaEdit';
import type {
  MediaEditJobOptions,
  MediaEditPausesRequest,
  MediaEditPausesResult,
  MediaEditPreviewRequest,
  MediaEditPreviewResult,
  MediaEditRenderRequest,
  MediaEditRenderResult,
} from './mediaEditEngine.js';
import { createRnnoiseDenoiserFactory } from './rnnoiseDenoiser.js';

/**
 * The main-thread fallback. Loaded on demand — as is RNNoise — so page
 * bundles carry neither unless a worker cannot start.
 */
const inlineDenoiser = createRnnoiseDenoiserFactory(() =>
  import('@shiguredo/rnnoise-wasm').then(({ Rnnoise }) => Rnnoise.load()),
);
async function inlineEngine() {
  return import('./mediaEditEngine.js');
}
function inlineOptions(options: MediaEditJobOptions): MediaEditJobOptions {
  return { ...options, denoiser: options.denoiser ?? inlineDenoiser };
}
import type { MediaEditWorkerRequest, MediaEditWorkerResponse } from './mediaEditWorkerProtocol.js';

export interface MediaEditRenderer {
  render(
    request: MediaEditRenderRequest,
    options?: MediaEditJobOptions,
  ): Promise<MediaEditRenderResult>;
  analyze(
    request: MediaEditRenderRequest,
    options?: MediaEditJobOptions,
  ): Promise<MediaFxAnalysis | null>;
  preview(
    request: MediaEditPreviewRequest,
    options?: MediaEditJobOptions,
  ): Promise<MediaEditPreviewResult>;
  /** Propose cuts that shorten long pauses. */
  pauses(
    request: MediaEditPausesRequest,
    options?: MediaEditJobOptions,
  ): Promise<MediaEditPausesResult>;
  dispose(): void;
}

export interface MediaEditRendererOptions {
  /**
   * Create the worker. Defaults to the packaged `workers/mediaEdit.worker.js`
   * resolved beside this module; hosts whose bundler needs an explicit worker
   * import pass their own. Return null to run on the main thread.
   */
  createWorker?: () => Worker | null;
}

function defaultWorker(): Worker {
  return new Worker(new URL('./workers/mediaEdit.worker.js', import.meta.url), { type: 'module' });
}

function abortError(): DOMException {
  return new DOMException('The media-edit job was cancelled.', 'AbortError');
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  onProgress?: (fraction: number) => void;
  /** The same job on the main thread, for when the worker dies mid-flight. */
  inline: () => Promise<unknown>;
};

export function createMediaEditRenderer(options: MediaEditRendererOptions = {}): MediaEditRenderer {
  let worker: Worker | null | undefined;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (reason: unknown) => {
    for (const job of pending.values()) job.reject(reason);
    pending.clear();
  };

  const ensureWorker = (): Worker | null => {
    if (worker !== undefined) return worker;
    try {
      worker = (options.createWorker ?? defaultWorker)();
    } catch {
      worker = null;
    }
    if (worker) {
      worker.onmessage = (event: MessageEvent<MediaEditWorkerResponse>) => {
        const msg = event.data;
        const job = pending.get(msg.id);
        if (!job) return;
        if (msg.type === 'progress') {
          job.onProgress?.(msg.fraction);
          return;
        }
        pending.delete(msg.id);
        if (msg.type === 'error') job.reject(msg.aborted ? abortError() : new Error(msg.message));
        else job.resolve(msg.result);
      };
      worker.onerror = (event) => {
        // A worker that fails to load (CSP, missing asset) errors before any
        // reply: retire it and finish its jobs — and all later ones — inline.
        event.preventDefault();
        worker?.terminate();
        worker = null;
        const orphans = [...pending.values()];
        pending.clear();
        for (const job of orphans) job.inline().then(job.resolve, job.reject);
      };
    }
    return worker;
  };

  function dispatch<T>(
    request: MediaEditWorkerRequest & { type: 'render' | 'analyze' | 'preview' | 'pauses' },
    jobOptions: MediaEditJobOptions,
    inline: () => Promise<T>,
  ): Promise<T> {
    const target = ensureWorker();
    if (!target) return inline();
    return new Promise<T>((resolve, reject) => {
      if (jobOptions.signal?.aborted) {
        reject(abortError());
        return;
      }
      pending.set(request.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: jobOptions.onProgress,
        inline,
      });
      jobOptions.signal?.addEventListener(
        'abort',
        () =>
          target.postMessage({ type: 'cancel', id: request.id } satisfies MediaEditWorkerRequest),
        { once: true },
      );
      target.postMessage(request);
    });
  }

  return {
    render(request, jobOptions = {}) {
      return dispatch({ ...request, type: 'render', id: nextId++ }, jobOptions, async () =>
        (await inlineEngine()).renderMediaEditAudio(request, inlineOptions(jobOptions)),
      );
    },
    analyze(request, jobOptions = {}) {
      return dispatch({ ...request, type: 'analyze', id: nextId++ }, jobOptions, async () =>
        (await inlineEngine()).analyzeMediaEditAudio(request, inlineOptions(jobOptions)),
      );
    },
    preview(request, jobOptions = {}) {
      return dispatch({ ...request, type: 'preview', id: nextId++ }, jobOptions, async () =>
        (await inlineEngine()).previewMediaEditAudio(request, inlineOptions(jobOptions)),
      );
    },
    pauses(request, jobOptions = {}) {
      return dispatch({ ...request, type: 'pauses', id: nextId++ }, jobOptions, async () =>
        (await inlineEngine()).analyzeMediaEditPauses(request, jobOptions),
      );
    },
    dispose() {
      failAll(abortError());
      worker?.terminate();
      worker = null;
    },
  };
}

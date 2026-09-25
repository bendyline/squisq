/**
 * Media-edit worker: runs renders, analyses and previews off the main thread.
 * One job per request id; `cancel` aborts the matching job.
 */

import { Rnnoise } from '@shiguredo/rnnoise-wasm';
import { createRnnoiseDenoiserFactory } from '../mediaEdit/rnnoiseDenoiser.js';
import {
  analyzeMediaEditAudio,
  analyzeMediaEditPauses,
  previewMediaEditAudio,
  renderMediaEditAudio,
} from '../mediaEdit/mediaEditEngine.js';
import type {
  MediaEditWorkerRequest,
  MediaEditWorkerResponse,
} from '../mediaEdit/mediaEditWorkerProtocol.js';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MediaEditWorkerRequest>) => void) | null;
  postMessage(message: MediaEditWorkerResponse, transfer?: Transferable[]): void;
};

const jobs = new Map<number, AbortController>();
const denoiser = createRnnoiseDenoiserFactory(() => Rnnoise.load());

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function run(request: Exclude<MediaEditWorkerRequest, { type: 'cancel' }>): Promise<void> {
  const controller = new AbortController();
  jobs.set(request.id, controller);
  const options = {
    denoiser,
    signal: controller.signal,
    onProgress: (fraction: number) =>
      scope.postMessage({ type: 'progress', id: request.id, fraction }),
  };
  try {
    if (request.type === 'render') {
      const result = await renderMediaEditAudio(request, options);
      scope.postMessage({ type: 'rendered', id: request.id, result }, [result.bytes]);
    } else if (request.type === 'pauses') {
      const result = await analyzeMediaEditPauses(request, options);
      scope.postMessage({ type: 'paused', id: request.id, result });
    } else if (request.type === 'analyze') {
      const result = await analyzeMediaEditAudio(request, options);
      scope.postMessage({ type: 'analyzed', id: request.id, result });
    } else {
      const result = await previewMediaEditAudio(request, options);
      const buffers = [...result.original, ...result.processed].map(
        (ch) => ch.buffer as ArrayBuffer,
      );
      scope.postMessage({ type: 'previewed', id: request.id, result }, buffers);
    }
  } catch (err: unknown) {
    scope.postMessage({
      type: 'error',
      id: request.id,
      message: err instanceof Error ? err.message : String(err),
      aborted: isAbort(err),
    });
  } finally {
    jobs.delete(request.id);
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'cancel') {
    jobs.get(request.id)?.abort();
    return;
  }
  void run(request);
};

/**
 * Layout engines: the same `layoutGraph` behind a promise, either on the
 * calling thread or in a Web Worker so a large graph never blocks the UI.
 *
 * The worker engine spawns lazily on the first request with
 * `new Worker(new URL('./worker/index.js', import.meta.url), { type: 'module' })`
 * — the pattern bundlers (Vite, webpack 5) understand and emit as an asset.
 * Hosts whose bundler pre-bundles this package must exclude it (Vite:
 * `optimizeDeps.exclude`) or pass a `workerFactory`. Requests run one at a
 * time in order. Aborting the running request, or its timing out, ends the
 * worker; the next request starts a fresh one. Where no worker can start at
 * all (Node, SSR, a missing asset), requests run on the calling thread.
 */

import { layoutGraph } from './layout.js';
import { createGraphWorkerHost } from './worker/host.js';
import type { GraphWorkerResponse, GraphWorkerTransport } from './worker/protocol.js';
import type { LayoutGraph, LayoutOptions, LayoutResult } from './types.js';

export interface LayoutRequestOptions {
  signal?: AbortSignal;
}

export interface GraphLayoutEngine {
  /** Where layouts currently run; a worker engine reports `inline` after falling back. */
  readonly mode: 'inline' | 'worker';
  layout(
    graph: LayoutGraph,
    options?: LayoutOptions,
    request?: LayoutRequestOptions,
  ): Promise<LayoutResult>;
  dispose(): void;
}

function abortError(): Error {
  const err = new Error('Layout aborted');
  err.name = 'AbortError';
  return err;
}

export function createInlineLayoutEngine(): GraphLayoutEngine {
  let disposed = false;
  return {
    mode: 'inline',
    async layout(graph, options, request) {
      if (disposed) throw new Error('GraphLayoutEngine used after dispose()');
      await Promise.resolve();
      if (request?.signal?.aborted) throw abortError();
      return layoutGraph(graph, options);
    },
    dispose() {
      disposed = true;
    },
  };
}

/** In-process transport: the worker host driven on a microtask, for tests and Node. */
export function createLocalLayoutTransport(): GraphWorkerTransport {
  let handler: ((message: GraphWorkerResponse) => void) | null = null;
  const host = createGraphWorkerHost((message) => {
    queueMicrotask(() => handler?.(message));
  });
  return {
    post: (message) => queueMicrotask(() => host(message)),
    onMessage: (fn) => {
      handler = fn;
    },
    terminate: () => {
      handler = null;
    },
  };
}

function spawnWorkerTransport(workerFactory?: () => Worker): GraphWorkerTransport {
  if (typeof Worker === 'undefined')
    throw new Error('Web Workers are unavailable in this environment');
  const worker = workerFactory
    ? workerFactory()
    : new Worker(new URL('./worker/index.js', import.meta.url), { type: 'module' });
  return {
    post: (message) => worker.postMessage(message),
    onMessage: (fn) => {
      worker.onmessage = (event: MessageEvent<GraphWorkerResponse>) => fn(event.data);
    },
    onError: (fn) => {
      worker.onerror = (event) => {
        event.preventDefault();
        fn(new Error(event.message || 'Graph layout worker failed'));
      };
      worker.onmessageerror = () => fn(new Error('Graph layout response could not be decoded'));
    },
    terminate: () => worker.terminate(),
  };
}

export interface WorkerLayoutEngineOptions {
  /** Transport override, called once per worker started; tests use `createLocalLayoutTransport`. */
  transport?: () => GraphWorkerTransport;
  /**
   * Worker construction for bundler-managed hosts. Vite:
   * `import LayoutWorker from '@bendyline/squisq-graph/worker?worker'`, then
   * `workerFactory: () => new LayoutWorker()`.
   */
  workerFactory?: () => Worker;
  /** Per-request deadline; default 20 seconds. */
  requestTimeoutMs?: number;
}

interface Job {
  graph: LayoutGraph;
  options?: LayoutOptions;
  signal?: AbortSignal;
  resolve: (result: LayoutResult) => void;
  reject: (err: unknown) => void;
  onAbort?: () => void;
}

export function createWorkerLayoutEngine(
  options: WorkerLayoutEngineOptions = {},
): GraphLayoutEngine {
  const timeoutMs = options.requestTimeoutMs ?? 20_000;
  const queue: Job[] = [];
  let transport: GraphWorkerTransport | null = null;
  let inline = false;
  let answered = false;
  let disposed = false;
  let running: { job: Job; id: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let seq = 0;

  const settle = (job: Job): void => {
    if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort);
  };

  const stopWorker = (): void => {
    transport?.terminate();
    transport = null;
  };

  const endRunning = (): Job | null => {
    if (!running) return null;
    const { job, timer } = running;
    clearTimeout(timer);
    running = null;
    settle(job);
    return job;
  };

  const ensureTransport = (): GraphWorkerTransport | null => {
    if (inline) return null;
    if (transport) return transport;
    try {
      const t = options.transport
        ? options.transport()
        : spawnWorkerTransport(options.workerFactory);
      t.onMessage((message) => {
        if (!running || message.id !== running.id) return;
        answered = true;
        const job = endRunning()!;
        if (message.type === 'error') job.reject(new Error(message.message));
        else job.resolve(message.result);
        pump();
      });
      t.onError?.((error) => {
        stopWorker();
        const job = endRunning();
        if (!answered) {
          // The worker never ran (a missing asset, a blocked script): stay on this thread.
          inline = true;
          if (job) queue.unshift(job);
        } else {
          job?.reject(error);
        }
        pump();
      });
      transport = t;
      return t;
    } catch {
      inline = true;
      return null;
    }
  };

  const pump = (): void => {
    if (running || disposed) return;
    const job = queue.shift();
    if (!job) return;
    const t = ensureTransport();
    if (!t) {
      settle(job);
      try {
        job.resolve(layoutGraph(job.graph, job.options));
      } catch (err: unknown) {
        job.reject(err);
      }
      pump();
      return;
    }
    const id = ++seq;
    running = {
      job,
      id,
      timer: setTimeout(() => {
        stopWorker();
        endRunning()?.reject(new Error('Graph layout timed out'));
        pump();
      }, timeoutMs),
    };
    try {
      t.post({ type: 'layout', id, graph: job.graph, options: job.options });
    } catch (err: unknown) {
      stopWorker();
      endRunning()?.reject(err);
      pump();
    }
  };

  return {
    get mode() {
      return inline ? 'inline' : 'worker';
    },
    layout(graph, layoutOptions, request) {
      if (disposed) return Promise.reject(new Error('GraphLayoutEngine used after dispose()'));
      const signal = request?.signal;
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise<LayoutResult>((resolve, reject) => {
        const job: Job = { graph, options: layoutOptions, signal, resolve, reject };
        if (signal) {
          job.onAbort = () => {
            if (running?.job === job) {
              stopWorker();
              endRunning();
              job.reject(abortError());
              pump();
              return;
            }
            const at = queue.indexOf(job);
            if (at >= 0) queue.splice(at, 1);
            settle(job);
            job.reject(abortError());
          };
          signal.addEventListener('abort', job.onAbort, { once: true });
        }
        queue.push(job);
        queueMicrotask(pump);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopWorker();
      const pending = [endRunning(), ...queue.splice(0)].filter((j): j is Job => j !== null);
      for (const job of pending) {
        settle(job);
        job.reject(new Error('GraphLayoutEngine disposed'));
      }
    },
  };
}

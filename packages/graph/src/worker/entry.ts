/**
 * The Web Worker entry — its own tsup entry (`dist/worker/index.js`), fully
 * self-contained after bundling (this package has no runtime dependencies),
 * spawned by `createWorkerLayoutEngine` via
 * `new URL('./worker/index.js', import.meta.url)`.
 */

import { createGraphWorkerHost } from './host.js';
import type { GraphWorkerRequest, GraphWorkerResponse } from './protocol.js';

interface WorkerScope {
  onmessage: ((event: { data: GraphWorkerRequest }) => void) | null;
  postMessage(message: GraphWorkerResponse): void;
}

const scope = globalThis as unknown as WorkerScope;
const handle = createGraphWorkerHost((message) => scope.postMessage(message));
scope.onmessage = (event) => handle(event.data);

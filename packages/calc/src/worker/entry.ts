/**
 * The Web Worker entry — its own tsup entry (`dist/worker/index.js`),
 * fully self-contained after bundling (the calc package has zero runtime
 * dependencies), spawned by `createWorkerCalcEngine` via
 * `new URL('./worker/index.js', import.meta.url)`.
 */

import { createCalcWorkerHost } from './host.js';
import type { CalcWorkerRequest, CalcWorkerResponse } from './protocol.js';

interface WorkerScope {
  onmessage: ((event: { data: CalcWorkerRequest }) => void) | null;
  postMessage(message: CalcWorkerResponse): void;
}

const scope = globalThis as unknown as WorkerScope;
const handle = createCalcWorkerHost((message) => scope.postMessage(message));
scope.onmessage = (event) => handle(event.data);

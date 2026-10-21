/**
 * Messages between the worker-engine client and the worker host. Every
 * payload is structured-clone-safe plain data.
 */

import type { LayoutGraph, LayoutOptions, LayoutResult } from '../types.js';

export type GraphWorkerRequest = {
  type: 'layout';
  id: number;
  graph: LayoutGraph;
  options?: LayoutOptions;
};

export type GraphWorkerResponse =
  | { type: 'result'; id: number; result: LayoutResult; elapsedMs: number }
  | { type: 'error'; id: number; message: string };

/** The transport seam: a real Worker, or an in-process bridge for tests and Node. */
export interface GraphWorkerTransport {
  post(message: GraphWorkerRequest): void;
  onMessage(handler: (message: GraphWorkerResponse) => void): void;
  onError?(handler: (error: Error) => void): void;
  terminate(): void;
}

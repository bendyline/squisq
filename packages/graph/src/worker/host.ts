/**
 * The worker-side dispatcher. Pure (takes a `post` function, returns a
 * message handler) so tests can drive it without a real Worker; `entry.ts`
 * wires it to the worker global scope.
 */

import { layoutGraph } from '../layout.js';
import type { GraphWorkerRequest, GraphWorkerResponse } from './protocol.js';

export function createGraphWorkerHost(
  post: (message: GraphWorkerResponse) => void,
): (message: GraphWorkerRequest) => void {
  return (message) => {
    if (message.type !== 'layout') return;
    const started = Date.now();
    try {
      const result = layoutGraph(message.graph, message.options);
      post({ type: 'result', id: message.id, result, elapsedMs: Date.now() - started });
    } catch (err: unknown) {
      post({
        type: 'error',
        id: message.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

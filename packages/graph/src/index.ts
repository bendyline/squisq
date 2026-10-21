/**
 * @bendyline/squisq-graph — graph layout for squisq: a compound layered
 * layout with orthogonal edge routing. Nodes may nest inside container
 * nodes; edges flow one way, cross as little as the layout can manage, and
 * leave containers through shared border ports. Pure TypeScript, no runtime
 * dependencies, deterministic, and runnable in a Web Worker.
 */

export type {
  LaidOutEdge,
  LaidOutNode,
  LayoutEdgeInput,
  LayoutGraph,
  LayoutNodeInput,
  LayoutOptions,
  LayoutResult,
  LayoutStats,
  Padding,
  Point,
} from './types.js';
export { DEFAULT_LAYOUT_OPTIONS, layoutGraph, resolveLayoutOptions } from './layout.js';
export { LAYOUT_ALGORITHM_VERSION, graphSignature } from './signature.js';
export {
  pointAlongPolyline,
  polylineLength,
  polylinePath,
  type PolylinePathOptions,
  type PolylinePoint,
} from './path.js';
export {
  createInlineLayoutEngine,
  createLocalLayoutTransport,
  createWorkerLayoutEngine,
  type GraphLayoutEngine,
  type LayoutRequestOptions,
  type WorkerLayoutEngineOptions,
} from './engine.js';
export type {
  GraphWorkerRequest,
  GraphWorkerResponse,
  GraphWorkerTransport,
} from './worker/protocol.js';

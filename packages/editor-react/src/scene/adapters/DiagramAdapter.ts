/**
 * DiagramAdapter — translate between Scene's generic command vocabulary
 * and the diagram-specific Tiptap commands in `diagramCommands.ts`.
 *
 * Read direction:  heading list + connectsTo → SceneLayer[] + SceneEdge[]
 * Write direction: SceneCommand → moveNode / addConnection / addNode / etc.
 *
 * The diagram surface uses `node-card-<id>` / `node-label-<id>` ids for
 * its synthetic card layers. The adapter maps those back to the
 * underlying heading id when dispatching writes.
 */

import type { Layer } from '@bendyline/squisq/schemas';
import type { SceneEdge } from '../commands/SceneCommand';
import {
  nodesToCardLayers,
  NODE_WIDTH,
  NODE_HEIGHT,
  type DiagramNodeDescriptor,
} from '../layers/nodeCard';
import type { DiagramNode, DiagramEdge } from '../../diagram/types';

export interface DiagramSceneData {
  layers: Layer[];
  edges: SceneEdge[];
  /** Diagram node descriptors (id, label, x, y). Useful for the ConnectTool overlay. */
  nodes: DiagramNodeDescriptor[];
}

/**
 * Convert the (nodes, edges) shape currently produced by `useDiagramData`
 * into Scene's layer/edge vocabulary. We accept the React-Flow-flavored
 * shape so the existing data hook can stay unchanged during the swap.
 */
export function buildDiagramScene(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
): DiagramSceneData {
  const descriptors: DiagramNodeDescriptor[] = nodes.map((n) => ({
    id: n.id,
    label: n.data.label,
    x: n.position.x,
    y: n.position.y,
    ...(n.width != null ? { width: n.width } : {}),
    ...(n.height != null ? { height: n.height } : {}),
    ...(n.kind === 'container' ? { kind: 'container' as const } : {}),
  }));
  const layers = nodesToCardLayers(descriptors);
  const sceneEdges: SceneEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.label ? { label: e.label } : {}),
    ...(e.directed === false ? { endMarker: 'none' as const } : {}),
    ...(e.sourceAnchor ? { sourceAnchor: e.sourceAnchor } : {}),
    ...(e.targetAnchor ? { targetAnchor: e.targetAnchor } : {}),
    ...(e.routing ? { routing: e.routing } : {}),
  }));
  return { layers, edges: sceneEdges, nodes: descriptors };
}

/**
 * Re-export of the diagram-specific `layerFollows` helper for hosts
 * that want to pass it straight to `<Scene layerFollows={...} />`.
 */
export { diagramLayerFollows } from '../layers/nodeCard';

/**
 * Compute a node's center point in viewport units. Used by the
 * ConnectTool to draw the in-flight connection preview and to find a
 * drop target.
 */
export function nodeCenter(node: DiagramNodeDescriptor): { x: number; y: number } {
  return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT / 2 };
}

// (The heading-based `makeDiagramDispatch` was removed with the ASCII-fence
// cutover — canvas commands for diagrams now flow through
// `asciiDiagram/asciiDiagramCommands.ts` instead of heading mutations.)

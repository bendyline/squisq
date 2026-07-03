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

import type { Editor } from '@tiptap/react';
import type { Layer } from '@bendyline/squisq/schemas';
import type { SceneCommand, SceneEdge } from '../commands/SceneCommand';
import {
  nodesToCardLayers,
  nodeIdFromCardLayerId,
  NODE_WIDTH,
  NODE_HEIGHT,
  type DiagramNodeDescriptor,
} from '../layers/nodeCard';
import {
  moveNode,
  addConnection,
  removeConnection,
  renameNode,
  addNode,
  removeNode,
  listDiagramChildren,
} from '../../diagram/diagramCommands';
import type { DiagramRFNode, DiagramRFEdge } from '../../diagram/useDiagramData';

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
  nodes: readonly DiagramRFNode[],
  edges: readonly DiagramRFEdge[],
): DiagramSceneData {
  const descriptors: DiagramNodeDescriptor[] = nodes.map((n) => ({
    id: n.id,
    label: n.data.label,
    x: n.position.x,
    y: n.position.y,
    ...(n.width != null ? { width: n.width } : {}),
    ...(n.height != null ? { height: n.height } : {}),
  }));
  const layers = nodesToCardLayers(descriptors);
  const sceneEdges: SceneEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.label ? { label: e.label } : {}),
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

/**
 * Build a SceneCommand dispatcher that writes back to Tiptap using the
 * existing diagram commands. The returned function is stable for a
 * given (editor, parentPos) tuple.
 */
export function makeDiagramDispatch(
  editor: Editor,
  parentPos: number,
): (cmd: SceneCommand) => void {
  return (cmd: SceneCommand) => {
    switch (cmd.kind) {
      case 'moveLayer': {
        const nodeId = nodeIdFromCardLayerId(cmd.id);
        if (!nodeId) return;
        // Only the card layer carries the node's position; ignore label
        // moves (they'd duplicate the same write).
        if (!cmd.id.startsWith('node-card-')) return;
        moveNode(editor, parentPos, nodeId, cmd.x, cmd.y);
        return;
      }
      case 'addEdge':
        addConnection(editor, parentPos, cmd.source, cmd.target, cmd.type);
        return;
      case 'removeEdge':
        removeConnection(editor, parentPos, cmd.source, cmd.target, cmd.type);
        return;
      case 'removeLayer': {
        const nodeId = nodeIdFromCardLayerId(cmd.id);
        if (nodeId) removeNode(editor, parentPos, nodeId);
        return;
      }
      case 'renameLayer': {
        const nodeId = nodeIdFromCardLayerId(cmd.id);
        if (nodeId) renameNode(editor, parentPos, nodeId, cmd.label);
        return;
      }
      case 'addLayer': {
        // Diagram mode interprets addLayer as "add a new diagram node at
        // the layer's position". Pull (x, y) from the layer's position
        // and synthesize a fresh id.
        const pos = cmd.layer.position;
        const x = typeof pos.x === 'number' ? pos.x : 0;
        const y = typeof pos.y === 'number' ? pos.y : 0;
        const id = nextNodeId(editor, parentPos);
        const label = inferAddedLabel(cmd.layer) ?? `Node`;
        addNode(editor, parentPos, id, label, x, y);
        return;
      }
      case 'setLayerAttr': {
        const nodeId = nodeIdFromCardLayerId(cmd.id);
        if (!nodeId) return;
        if (cmd.path === 'content.text' && typeof cmd.value === 'string') {
          renameNode(editor, parentPos, nodeId, cmd.value);
        }
        return;
      }
      case 'resizeLayer':
        // v1: diagram nodes are fixed-size. Ignore resize.
        return;
      case 'setLayerText': {
        const nodeId = nodeIdFromCardLayerId(cmd.id);
        if (nodeId) renameNode(editor, parentPos, nodeId, cmd.text);
        return;
      }
    }
    // Exhaustiveness check — TS will flag unhandled command kinds.
    const _exhaustive: never = cmd;
    void _exhaustive;
  };

  function inferAddedLabel(layer: Layer): string | null {
    if (layer.type === 'text') return layer.content.text;
    return null;
  }
}

function nextNodeId(editor: Editor, parentPos: number): string {
  const used = new Set(listDiagramChildren(editor, parentPos).map((c) => c.id));
  let i = used.size + 1;
  let id = `node-${i}`;
  while (used.has(id)) {
    i++;
    id = `node-${i}`;
  }
  return id;
}

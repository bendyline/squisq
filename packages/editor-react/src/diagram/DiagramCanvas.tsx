/**
 * DiagramCanvas — thin wrapper around the Squisq Scene engine.
 *
 * Translates between the diagram's command vocabulary (which the host
 * `DiagramWidget` translates into Tiptap mutations) and the Scene's
 * generic SceneCommand vocabulary. The Scene itself owns viewport
 * pan/zoom, selection, hit-testing, and tool dispatch.
 *
 * Diagram nodes are rendered as synthetic card+label Layer pairs
 * (`nodeCard.tsx`) so what you see in the editor is the same Layer
 * schema the SSR `diagramBlock.ts` template emits. Edges are drawn by
 * `<DiagramEdges>` as a separate background layer.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Scene,
  buildDiagramScene,
  nodeIdFromCardLayerId,
  diagramLayerFollows,
  DiagramEdges,
  SelectTool,
  ConnectTool,
  type SceneCommand,
} from '../scene';
import type { DiagramRFNode, DiagramRFEdge } from './useDiagramData';

export type DiagramCommand =
  | { kind: 'moveNode'; nodeId: string; x: number; y: number }
  | { kind: 'resizeNode'; nodeId: string; width: number; height: number }
  | { kind: 'addConnection'; source: string; target: string; type?: string }
  | { kind: 'removeConnection'; source: string; target: string; type?: string }
  | { kind: 'renameNode'; nodeId: string; newLabel: string }
  | { kind: 'addNode'; x: number; y: number }
  | { kind: 'removeNode'; nodeId: string };

interface DiagramCanvasProps {
  nodes: DiagramRFNode[];
  edges: DiagramRFEdge[];
  onCommand: (cmd: DiagramCommand) => void;
  /** When true, render the maximize button. Click toggles `onToggleMaximize`. */
  showMaximize?: boolean;
  /** Whether the canvas is currently maximized (affects button icon). */
  maximized?: boolean;
  /** Callback when the maximize button is clicked. */
  onToggleMaximize?: () => void;
}

// Viewport size for the diagram canvas — a wide-ish surface in author
// units. The Scene's fit-on-mount centers the diagram inside whatever
// container the canvas is rendered into.
const DIAGRAM_VIEWPORT = { width: 1600, height: 900 };

const TOOLS = [SelectTool, ConnectTool];

export function DiagramCanvas({
  nodes: incomingNodes,
  edges: incomingEdges,
  onCommand,
  showMaximize = true,
  maximized = false,
  onToggleMaximize,
}: DiagramCanvasProps) {
  const scene = useMemo(
    () => buildDiagramScene(incomingNodes, incomingEdges),
    [incomingNodes, incomingEdges],
  );
  // Track the active tool so we can keep selection when the user toggles
  // back to Select after using Connect.
  const [activeToolId, setActiveToolId] = useState<string>('select');

  // Translate generic SceneCommand → diagram-specific DiagramCommand,
  // then hand off to the host (DiagramWidget) which writes to Tiptap.
  const handleSceneCommand = useCallback(
    (cmd: SceneCommand) => {
      switch (cmd.kind) {
        case 'moveLayer': {
          // Only the node-card layer carries the position; ignore drag
          // commits on the label layer (it'd duplicate the write).
          if (!cmd.id.startsWith('node-card-')) return;
          const nodeId = nodeIdFromCardLayerId(cmd.id);
          if (!nodeId) return;
          onCommand({ kind: 'moveNode', nodeId, x: cmd.x, y: cmd.y });
          return;
        }
        case 'addEdge':
          onCommand({
            kind: 'addConnection',
            source: cmd.source,
            target: cmd.target,
            type: cmd.type,
          });
          return;
        case 'removeEdge':
          onCommand({
            kind: 'removeConnection',
            source: cmd.source,
            target: cmd.target,
            type: cmd.type,
          });
          return;
        case 'removeLayer': {
          const nodeId = nodeIdFromCardLayerId(cmd.id);
          if (nodeId) onCommand({ kind: 'removeNode', nodeId });
          return;
        }
        case 'renameLayer': {
          const nodeId = nodeIdFromCardLayerId(cmd.id);
          if (nodeId) onCommand({ kind: 'renameNode', nodeId, newLabel: cmd.label });
          return;
        }
        case 'addLayer': {
          // Diagram mode interprets addLayer as "add a node at the layer's
          // position". The Scene's empty-state "add" button and any future
          // double-click handler dispatch this.
          const pos = cmd.layer.position;
          const x = typeof pos.x === 'number' ? pos.x : 0;
          const y = typeof pos.y === 'number' ? pos.y : 0;
          onCommand({ kind: 'addNode', x, y });
          return;
        }
        case 'resizeLayer': {
          if (!cmd.id.startsWith('node-card-')) return;
          const nodeId = nodeIdFromCardLayerId(cmd.id);
          if (!nodeId) return;
          onCommand({ kind: 'resizeNode', nodeId, width: cmd.width, height: cmd.height });
          return;
        }
        case 'setLayerAttr':
          // Diagram nodes don't expose generic attr writes; renames go
          // through `renameLayer` and positions through move/resize.
          return;
      }
      const _exhaustive: never = cmd;
      void _exhaustive;
    },
    [onCommand],
  );

  // Edges render in the renderExtras callback so they sit behind the
  // node cards (which the Scene renders itself).
  const nodesForExtras = scene.nodes;
  const edgesForExtras = scene.edges;
  const renderExtras = useCallback(
    () => <DiagramEdges nodes={nodesForExtras} edges={edgesForExtras} />,
    [nodesForExtras, edgesForExtras],
  );

  return (
    <div className="squisq-diagram-canvas">
      <Scene
        viewport={DIAGRAM_VIEWPORT}
        layers={scene.layers}
        edges={scene.edges}
        tools={TOOLS}
        activeToolId={activeToolId}
        onActiveToolIdChange={setActiveToolId}
        onCommand={handleSceneCommand}
        renderExtras={renderExtras}
        layerFollows={diagramLayerFollows}
        showMaximize={showMaximize}
        maximized={maximized}
        onToggleMaximize={onToggleMaximize}
      />
      {scene.nodes.length === 0 && (
        <DiagramEmptyState
          onAdd={() => {
            // Place the first node at the center of the viewport's
            // logical surface; the Scene's fit-on-mount keeps it visible.
            onCommand({
              kind: 'addNode',
              x: DIAGRAM_VIEWPORT.width / 2 - 90,
              y: DIAGRAM_VIEWPORT.height / 2 - 32,
            });
          }}
        />
      )}
    </div>
  );
}

function DiagramEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="squisq-diagram-empty">
      <div className="squisq-diagram-empty-title">No diagram nodes yet</div>
      <div className="squisq-diagram-empty-hint">
        Click "+ Add first node" below, or add sub-headings under this block.
      </div>
      <button type="button" className="squisq-diagram-empty-btn" onClick={onAdd}>
        + Add first node
      </button>
    </div>
  );
}

export default DiagramCanvas;

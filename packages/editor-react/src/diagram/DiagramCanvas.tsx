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

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Scene,
  buildDiagramScene,
  nodeIdFromCardLayerId,
  diagramLayerFollows,
  DiagramEdges,
  type SceneCommand,
} from '../scene';
import type { SceneTextEditConfig } from '../scene/text/sceneTextConfig';
import type { SceneTextChannel } from '../scene/text/sceneTextChannel';
import { markdownToTiptap } from '../tiptapBridge';
import type { DiagramRFNode, DiagramRFEdge } from './types';
import { DIAGRAM_VIEWPORT, DIAGRAM_TOOLS } from './diagramConstants';

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
  /**
   * Active tool id, controlled by the host (DiagramWidget) so the tool
   * buttons can live in the shared toolbar above the canvas. Falls back
   * to internal state when omitted.
   */
  activeToolId?: string;
  onActiveToolIdChange?: (id: string) => void;
  /** Forwarded to the Scene so the host can drive a Delete action. */
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  /** Per-editor toolbar bridge for detached scene roots. */
  textChannel?: SceneTextChannel;
}

const TOOLS = DIAGRAM_TOOLS;

export function DiagramCanvas({
  nodes: incomingNodes,
  edges: incomingEdges,
  onCommand,
  showMaximize = true,
  maximized = false,
  onToggleMaximize,
  activeToolId: controlledToolId,
  onActiveToolIdChange,
  onSelectionChange,
  textChannel,
}: DiagramCanvasProps) {
  const scene = useMemo(
    () => buildDiagramScene(incomingNodes, incomingEdges),
    [incomingNodes, incomingEdges],
  );
  // Track the active tool so we can keep selection when the user toggles
  // back to Select after using Connect. Controlled by the host when it
  // owns the shared toolbar; falls back to internal state otherwise.
  const [internalToolId, setInternalToolId] = useState<string>('select');
  const activeToolId = controlledToolId ?? internalToolId;
  const setActiveToolId = onActiveToolIdChange ?? setInternalToolId;

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
        case 'setLayerText': {
          // Diagram node labels persist as heading text (markdown inline
          // marks); the rich `html` is not stored separately.
          const nodeId = nodeIdFromCardLayerId(cmd.id);
          if (nodeId) onCommand({ kind: 'renameNode', nodeId, newLabel: cmd.text });
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

  // Inline label editing: double-click a node card to edit its label.
  // Labels persist as the node's heading text (inline markdown marks), so
  // the editor is `inline` level. Refs keep the config stable.
  const incomingNodesRef = useRef(incomingNodes);
  incomingNodesRef.current = incomingNodes;
  const textConfig = useMemo<SceneTextEditConfig>(
    () => ({
      channel: textChannel,
      resolveEditableId: (id) => (nodeIdFromCardLayerId(id) ? id : null),
      getHtml: (id) => {
        const nodeId = nodeIdFromCardLayerId(id);
        const node = incomingNodesRef.current.find((n) => n.id === nodeId);
        return markdownToTiptap(node?.data.label ?? '');
      },
      commit: (id, { text }) => {
        // Node labels persist as plain heading text for now (rich marks on
        // labels are a follow-up — the rendering foundation is in place).
        handleSceneCommand({ kind: 'renameLayer', id, label: text });
      },
      level: 'inline',
    }),
    [handleSceneCommand, textChannel],
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
        onSelectionChange={onSelectionChange}
        onCommand={handleSceneCommand}
        renderExtras={renderExtras}
        layerFollows={diagramLayerFollows}
        showMaximize={showMaximize}
        maximized={maximized}
        onToggleMaximize={onToggleMaximize}
        showToolbar={false}
        textEditing={textConfig}
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

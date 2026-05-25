/**
 * DiagramCanvas — React Flow surface for editing a diagram section.
 *
 * Owns the local React Flow node/edge state (initialised from the
 * markdown-derived data passed in by the NodeView). Surfaces user
 * interactions back to the parent via the `onCommand` callback, which
 * the NodeView turns into Tiptap commands.
 *
 * Local state lets React Flow handle drag interactions smoothly without
 * committing each frame back to the document. We only call `onCommand`
 * on commit-points (drag stop, connect, edge/node delete, double-click).
 */

import { useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type OnNodesDelete,
  type OnEdgesDelete,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export type DiagramCommand =
  | { kind: 'moveNode'; nodeId: string; x: number; y: number }
  | { kind: 'addConnection'; source: string; target: string; type?: string }
  | { kind: 'removeConnection'; source: string; target: string; type?: string }
  | { kind: 'renameNode'; nodeId: string; newLabel: string }
  | { kind: 'addNode'; x: number; y: number }
  | { kind: 'removeNode'; nodeId: string };

interface DiagramCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onCommand: (cmd: DiagramCommand) => void;
  /** When true, render the maximize button. Click toggles `onToggleMaximize`. */
  showMaximize?: boolean;
  /** Whether the canvas is currently maximized (affects button icon). */
  maximized?: boolean;
  /** Callback when the maximize button is clicked. */
  onToggleMaximize?: () => void;
}

export function DiagramCanvas({
  nodes: incomingNodes,
  edges: incomingEdges,
  onCommand,
  showMaximize = true,
  maximized = false,
  onToggleMaximize,
}: DiagramCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(incomingNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(incomingEdges);

  // Sync incoming props → local state when the markdown changes externally
  // (e.g. raw-editor edits while the canvas is open). Skip when the only
  // diff is something React Flow is mid-handling (drag in progress is
  // local-only anyway, so this is safe for our commit-on-stop model).
  useEffect(() => {
    setNodes(incomingNodes);
  }, [incomingNodes, setNodes]);
  useEffect(() => {
    setEdges(incomingEdges);
  }, [incomingEdges, setEdges]);

  const handleNodesChange = (changes: NodeChange[]) => {
    onNodesChange(changes);
    for (const c of changes) {
      if (c.type === 'position' && c.dragging === false && c.position) {
        onCommand({ kind: 'moveNode', nodeId: c.id, x: c.position.x, y: c.position.y });
      }
    }
  };

  const handleEdgesChange = (changes: EdgeChange[]) => {
    onEdgesChange(changes);
  };

  const handleConnect = (params: Connection) => {
    if (!params.source || !params.target) return;
    onCommand({ kind: 'addConnection', source: params.source, target: params.target });
  };

  const handleEdgesDelete: OnEdgesDelete = (removed) => {
    for (const e of removed) {
      onCommand({
        kind: 'removeConnection',
        source: e.source,
        target: e.target,
        type: typeof e.label === 'string' ? e.label : undefined,
      });
    }
  };

  const handleNodesDelete: OnNodesDelete = (removed) => {
    for (const n of removed) {
      onCommand({ kind: 'removeNode', nodeId: n.id });
    }
  };

  const handleNodeDoubleClick = (_e: React.MouseEvent, node: Node) => {
    const current = typeof node.data.label === 'string' ? node.data.label : '';
    const next = window.prompt('Rename node', current);
    if (next != null && next !== current) {
      onCommand({ kind: 'renameNode', nodeId: node.id, newLabel: next });
    }
  };

  const handlePaneDoubleClick = (e: React.MouseEvent) => {
    // Translate click coordinates into canvas-space. React Flow's
    // `screenToFlowPosition` requires the instance — we rely on the
    // wrapper's coordinate system being close enough for v1 by using
    // the event's offset relative to the pane element.
    const target = e.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    onCommand({
      kind: 'addNode',
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div className="squisq-diagram-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        onNodesDelete={handleNodesDelete}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={undefined}
        onDoubleClickCapture={handlePaneDoubleClick}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      {showMaximize && onToggleMaximize && (
        <button
          type="button"
          className="squisq-diagram-maximize-btn"
          onClick={onToggleMaximize}
          title={maximized ? 'Exit fullscreen (Esc)' : 'Maximize diagram'}
        >
          {maximized ? '✕' : '⛶'}
        </button>
      )}
    </div>
  );
}

export default DiagramCanvas;

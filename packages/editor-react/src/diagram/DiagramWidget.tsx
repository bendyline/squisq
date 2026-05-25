/**
 * DiagramWidget — the React-Flow-backed canvas that sits below a
 * `### Title {[diagram]}` heading in the WYSIWYG view.
 *
 * Owns the maximize toggle: in normal mode the canvas sits inline at a
 * fixed height; in maximized mode it portals into a full-editor overlay
 * and renders edge-to-edge. Pushes user actions back through the
 * `diagramCommands` helpers.
 */

import { useCallback, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { DiagramCanvas, type DiagramCommand } from './DiagramCanvas';
import { DiagramMaximizedOverlay } from './DiagramMaximizedOverlay';
import { useDiagramData } from './useDiagramData';
import {
  moveNode,
  addConnection,
  removeConnection,
  renameNode,
  addNode,
  removeNode,
} from './diagramCommands';

interface DiagramWidgetProps {
  editor: Editor;
  /** Position of the parent `{[diagram]}` heading in the doc. */
  parentPos: number;
  /** The host element (used for portal targeting). */
  host?: HTMLElement | null;
}

export function DiagramWidget({ editor, parentPos, host }: DiagramWidgetProps) {
  const { nodes, edges } = useDiagramData(editor, parentPos);
  const [maximized, setMaximized] = useState(false);

  const dispatch = useCallback(
    (cmd: DiagramCommand) => {
      switch (cmd.kind) {
        case 'moveNode':
          moveNode(editor, parentPos, cmd.nodeId, cmd.x, cmd.y);
          break;
        case 'addConnection':
          addConnection(editor, parentPos, cmd.source, cmd.target, cmd.type);
          break;
        case 'removeConnection':
          removeConnection(editor, parentPos, cmd.source, cmd.target, cmd.type);
          break;
        case 'renameNode':
          renameNode(editor, parentPos, cmd.nodeId, cmd.newLabel);
          break;
        case 'addNode': {
          // Synthesize a stable id from the next available "node-N" slot.
          const used = new Set(nodes.map((n) => n.id));
          let i = nodes.length + 1;
          let id = `node-${i}`;
          while (used.has(id)) {
            i++;
            id = `node-${i}`;
          }
          addNode(editor, parentPos, id, `Node ${i}`, cmd.x, cmd.y);
          break;
        }
        case 'removeNode':
          removeNode(editor, parentPos, cmd.nodeId);
          break;
      }
    },
    [editor, parentPos, nodes],
  );

  const canvas = (
    <DiagramCanvas
      nodes={nodes}
      edges={edges}
      onCommand={dispatch}
      showMaximize
      maximized={maximized}
      onToggleMaximize={() => setMaximized((m) => !m)}
    />
  );

  if (maximized) {
    return (
      <div className="squisq-diagram-inline-placeholder">
        <DiagramMaximizedOverlay host={host ?? null} onClose={() => setMaximized(false)}>
          {canvas}
        </DiagramMaximizedOverlay>
      </div>
    );
  }

  return <div className="squisq-diagram-inline">{canvas}</div>;
}

export default DiagramWidget;

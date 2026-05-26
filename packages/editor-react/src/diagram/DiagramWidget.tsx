/**
 * DiagramWidget — the Squisq-Scene-backed canvas that sits below a
 * `### Title {[diagram]}` heading in the WYSIWYG view.
 *
 * Owns the maximize toggle. Resolves the parent heading's position
 * dynamically each render via `headingKey`, so the widget can survive
 * attribute-only doc changes (drag commits) without going stale when
 * content above the diagram shifts.
 *
 * Pushes user actions back through the `diagramCommands` helpers.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { DiagramCanvas, type DiagramCommand } from './DiagramCanvas';
import { DiagramMaximizedOverlay } from './DiagramMaximizedOverlay';
import { useDiagramData } from './useDiagramData';
import { findDiagramHeadingPos } from './DiagramExtension';
import {
  moveNode,
  resizeNode,
  addConnection,
  removeConnection,
  renameNode,
  addNode,
  removeNode,
} from './diagramCommands';

interface DiagramWidgetProps {
  editor: Editor;
  /** Stable id derived from the parent heading (slug / `#id`). */
  headingKey: string;
  /** Position of the parent heading at widget-creation time. Used as a
   * fallback when the dynamic lookup fails (e.g. before the first
   * transaction). */
  fallbackParentPos: number;
  /** Host element used for portal targeting by the maximize overlay. */
  host?: HTMLElement | null;
}

export function DiagramWidget({
  editor,
  headingKey,
  fallbackParentPos,
  host,
}: DiagramWidgetProps) {
  // Re-resolve parentPos on every editor transaction so writes target
  // the current heading position even after content above shifts.
  const [parentPos, setParentPos] = useState<number>(
    () => findDiagramHeadingPos(editor, headingKey) ?? fallbackParentPos,
  );
  useEffect(() => {
    const onUpdate = () => {
      const next = findDiagramHeadingPos(editor, headingKey);
      if (next != null && next !== parentPos) setParentPos(next);
    };
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor, headingKey, parentPos]);

  const { nodes, edges } = useDiagramData(editor, parentPos);
  const [maximized, setMaximized] = useState(false);

  const dispatch = useCallback(
    (cmd: DiagramCommand) => {
      // Re-resolve at dispatch time too — the React state may not have
      // caught up yet when the user issues rapid-fire commands.
      const livePos = findDiagramHeadingPos(editor, headingKey) ?? parentPos;
      switch (cmd.kind) {
        case 'moveNode':
          moveNode(editor, livePos, cmd.nodeId, cmd.x, cmd.y);
          break;
        case 'resizeNode':
          resizeNode(editor, livePos, cmd.nodeId, cmd.width, cmd.height);
          break;
        case 'addConnection':
          addConnection(editor, livePos, cmd.source, cmd.target, cmd.type);
          break;
        case 'removeConnection':
          removeConnection(editor, livePos, cmd.source, cmd.target, cmd.type);
          break;
        case 'renameNode':
          renameNode(editor, livePos, cmd.nodeId, cmd.newLabel);
          break;
        case 'addNode': {
          const used = new Set(nodes.map((n) => n.id));
          let i = nodes.length + 1;
          let id = `node-${i}`;
          while (used.has(id)) {
            i++;
            id = `node-${i}`;
          }
          addNode(editor, livePos, id, `Node ${i}`, cmd.x, cmd.y);
          break;
        }
        case 'removeNode':
          removeNode(editor, livePos, cmd.nodeId);
          break;
      }
    },
    [editor, headingKey, parentPos, nodes],
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

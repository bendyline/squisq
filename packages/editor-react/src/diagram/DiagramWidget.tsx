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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { DiagramCanvas, type DiagramCommand } from './DiagramCanvas';
import { DIAGRAM_TOOLS, DIAGRAM_VIEWPORT } from './diagramConstants';
import { DiagramMaximizedOverlay } from './DiagramMaximizedOverlay';
import { useDiagramData } from './useDiagramData';
import { findDiagramHeadingPos } from './DiagramExtension';
import { SceneBlockToolbar, type SceneBlockAction } from '../scene/SceneBlockToolbar';
import { SceneSideToolbar } from '../scene/SceneSideToolbar';
import { nodeIdFromCardLayerId, NODE_WIDTH, NODE_HEIGHT } from '../scene';
import { Icon } from '../Icon';
import {
  moveNode,
  resizeNode,
  addConnection,
  removeConnection,
  renameNode,
  addNode,
  removeNode,
  getDiagramHeight,
  setDiagramHeight,
} from './diagramCommands';

/** Smallest height the canvas can be dragged to (px). */
const MIN_DIAGRAM_HEIGHT = 160;
/** Default canvas height when none is pinned — must match `.squisq-diagram-inline` in diagram.css. */
const DEFAULT_DIAGRAM_HEIGHT = 420;

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

export function DiagramWidget({ editor, headingKey, fallbackParentPos, host }: DiagramWidgetProps) {
  // Re-resolve parentPos on every editor transaction so writes target
  // the current heading position even after content above shifts. The same
  // pass refreshes the pinned canvas height from the heading annotation so
  // an external edit (or markdown reload) is reflected.
  const [parentPos, setParentPos] = useState<number>(
    () => findDiagramHeadingPos(editor, headingKey) ?? fallbackParentPos,
  );
  const [pinnedHeight, setPinnedHeight] = useState<number | null>(() =>
    getDiagramHeight(editor, findDiagramHeadingPos(editor, headingKey) ?? fallbackParentPos),
  );
  useEffect(() => {
    const onUpdate = () => {
      const next = findDiagramHeadingPos(editor, headingKey);
      if (next != null && next !== parentPos) setParentPos(next);
      setPinnedHeight(getDiagramHeight(editor, next ?? parentPos));
    };
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor, headingKey, parentPos]);

  const { nodes, edges } = useDiagramData(editor, parentPos);
  const [maximized, setMaximized] = useState(false);

  // Live height while the bottom handle is being dragged (null = not
  // dragging). Takes precedence over the persisted height so the canvas
  // tracks the pointer before the markdown write lands on release.
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const effectiveHeight = dragHeight ?? pinnedHeight;

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      // The handle owns this gesture — keep ProseMirror and the Scene from
      // treating it as a selection / canvas drag.
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      // Measure the live rendered height so a drag starting from the CSS
      // default (no pinned height yet) grows from the right baseline.
      const startHeight =
        inlineRef.current?.getBoundingClientRect().height ??
        effectiveHeight ??
        DEFAULT_DIAGRAM_HEIGHT;
      const heightAt = (clientY: number) =>
        Math.max(MIN_DIAGRAM_HEIGHT, Math.round(startHeight + (clientY - startY)));
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      const onMove = (ev: PointerEvent) => setDragHeight(heightAt(ev.clientY));
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        const finalH = heightAt(ev.clientY);
        setDragHeight(null);
        const livePos = findDiagramHeadingPos(editor, headingKey) ?? parentPos;
        setDiagramHeight(editor, livePos, finalH);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [editor, headingKey, parentPos, effectiveHeight],
  );

  // Double-click the handle to clear the pinned height (revert to default).
  const onResizeReset = useCallback(() => {
    const livePos = findDiagramHeadingPos(editor, headingKey) ?? parentPos;
    setDragHeight(null);
    setDiagramHeight(editor, livePos, null);
  }, [editor, headingKey, parentPos]);

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

  // ── Shared toolbar (above the canvas) ────────────────────
  // Tool selection + node CRUD live here rather than inside the canvas,
  // so diagram/drawing/layout share one consistent bar above each canvas.
  const [activeToolId, setActiveToolId] = useState<string>('select');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Map the Scene's selected layer ids (node cards) back to node ids.
  const selectedNodeIds = useMemo(
    () =>
      [...selectedIds]
        .map((id) => nodeIdFromCardLayerId(id))
        .filter((id): id is string => id != null),
    [selectedIds],
  );

  const actions: SceneBlockAction[] = [
    {
      id: 'add-node',
      label: 'Node',
      icon: <Icon icon="fa-solid fa-plus" />,
      title: 'Add node',
      onClick: () =>
        dispatch({
          kind: 'addNode',
          x: DIAGRAM_VIEWPORT.width / 2 - NODE_WIDTH / 2,
          y: DIAGRAM_VIEWPORT.height / 2 - NODE_HEIGHT / 2,
        }),
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Icon icon="fa-solid fa-trash" />,
      title: 'Delete selected node',
      danger: true,
      disabled: selectedNodeIds.length === 0,
      onClick: () => selectedNodeIds.forEach((id) => dispatch({ kind: 'removeNode', nodeId: id })),
    },
  ];

  const toolbar = (
    <SceneBlockToolbar
      tools={DIAGRAM_TOOLS}
      activeToolId={activeToolId}
      onSelectTool={setActiveToolId}
      actions={actions}
    />
  );

  const canvas = (
    <DiagramCanvas
      nodes={nodes}
      edges={edges}
      onCommand={dispatch}
      showMaximize
      maximized={maximized}
      onToggleMaximize={() => setMaximized((m) => !m)}
      activeToolId={activeToolId}
      onActiveToolIdChange={setActiveToolId}
      onSelectionChange={setSelectedIds}
    />
  );

  if (maximized) {
    return (
      <div
        className="squisq-diagram-inline-placeholder"
        style={effectiveHeight != null ? { height: effectiveHeight } : undefined}
      >
        <DiagramMaximizedOverlay host={host ?? null} onClose={() => setMaximized(false)}>
          {/* Maximized has a full screen for a static right column — no collapse. */}
          <div className="squisq-scene-block-max">
            {canvas}
            <div className="squisq-scene-side-toolbar">{toolbar}</div>
          </div>
        </DiagramMaximizedOverlay>
      </div>
    );
  }

  return (
    <div className="squisq-scene-shell">
      {/* Before the canvas so the narrow-width fallback bar sits above it; the
        wide-width gutter column is absolute and unaffected by DOM order. */}
      <SceneSideToolbar>{toolbar}</SceneSideToolbar>
      <div
        className="squisq-diagram-inline"
        ref={inlineRef}
        style={effectiveHeight != null ? { height: effectiveHeight } : undefined}
      >
        {canvas}
        <div
          className="squisq-diagram-resize-handle"
          onPointerDown={onResizeStart}
          onDoubleClick={onResizeReset}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize diagram height"
          title="Drag to resize · double-click to reset"
        />
      </div>
    </div>
  );
}

export default DiagramWidget;

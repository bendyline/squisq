/**
 * AsciiDiagramWidget — the interactive canvas mounted below a hidden
 * ASCII-diagram code fence in the WYSIWYG view.
 *
 * Mirrors the legacy heading-based DiagramWidget's chrome (shared toolbar,
 * maximize overlay, height handle) but reads/writes the FENCE: data comes
 * from `useAsciiDiagramData` (live re-parse), edits go through
 * `applyAsciiDiagramCommand` (op → render → verify → single-transaction
 * text replace).
 *
 * The height handle is session-local by design: a fence has no annotation
 * surface to persist a `height=` on, and writing chrome state into the art
 * would violate "the fence is the diagram".
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { DiagramCanvas, type DiagramCommand } from '../diagram/DiagramCanvas';
import { DIAGRAM_TOOLS, DIAGRAM_VIEWPORT } from '../diagram/diagramConstants';
import { DiagramMaximizedOverlay } from '../diagram/DiagramMaximizedOverlay';
import { SceneBlockToolbar, type SceneBlockAction } from '../scene/SceneBlockToolbar';
import { SceneSideToolbar } from '../scene/SceneSideToolbar';
import { nodeIdFromCardLayerId, NODE_WIDTH, NODE_HEIGHT } from '../scene';
import { Icon } from '../Icon';
import {
  asciiDiagramToCanvas,
  initialAsciiDiagramCanvasOffset,
  offsetAsciiDiagram,
  useAsciiDiagramData,
  type AsciiDiagramCanvasOffset,
} from './asciiDiagramData';
import { applyAsciiDiagramCommand } from './asciiDiagramCommands';
import { isAsciiSourceVisible, toggleAsciiSource } from './AsciiDiagramExtension';
import type { SceneTextChannel } from '../scene/text/sceneTextChannel';

/** Smallest height the canvas can be dragged to (px). */
const MIN_DIAGRAM_HEIGHT = 160;
const DEFAULT_DIAGRAM_HEIGHT = 420;

interface AsciiDiagramWidgetProps {
  editor: Editor;
  /** Session id from the extension's position registry. */
  blockId: string;
  /** Position at widget-creation time — display-only fallback. */
  fallbackPos: number;
  /** Host element used for portal targeting by the maximize overlay. */
  host?: HTMLElement | null;
  textChannel?: SceneTextChannel;
}

export function AsciiDiagramWidget({
  editor,
  blockId,
  host,
  textChannel,
}: AsciiDiagramWidgetProps) {
  const view = useAsciiDiagramData(editor, blockId);
  const [maximized, setMaximized] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const canvasOffsetRef = useRef<AsciiDiagramCanvasOffset | null>(null);
  const [canvasOffsetVersion, setCanvasOffsetVersion] = useState(0);
  const inlineRef = useRef<HTMLDivElement>(null);
  const effectiveHeight = dragHeight ?? height;

  if (view && canvasOffsetRef.current === null) {
    canvasOffsetRef.current = initialAsciiDiagramCanvasOffset(view.diagram);
  }

  const canvasView = useMemo(() => {
    if (!view) return null;
    const offset = canvasOffsetRef.current ?? { col: 0, row: 0 };
    return asciiDiagramToCanvas(offsetAsciiDiagram(view.diagram, offset));
    // The ref is intentionally versioned only when its value is consumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, canvasOffsetVersion]);

  const dispatch = useCallback(
    (cmd: DiagramCommand) => {
      const offset = canvasOffsetRef.current ?? { col: 0, row: 0 };
      const applied = applyAsciiDiagramCommand(editor, blockId, cmd, {
        diagramOffset: offset,
      });
      if (applied && (offset.col !== 0 || offset.row !== 0)) {
        // The same rewrite that applied the edit has now persisted the virtual
        // gutter. Drop the projection offset so the on-screen coordinates do
        // not change while the fence-backed view refreshes.
        canvasOffsetRef.current = { col: 0, row: 0 };
        setCanvasOffsetVersion((version) => version + 1);
      }
    },
    [editor, blockId],
  );

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
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
        setDragHeight(null);
        setHeight(heightAt(ev.clientY));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [effectiveHeight],
  );

  const onResizeReset = useCallback(() => {
    setDragHeight(null);
    setHeight(null);
  }, []);

  // ── Shared toolbar (above the canvas) ────────────────────
  const [activeToolId, setActiveToolId] = useState<string>('select');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedNodeIds = useMemo(
    () =>
      [...selectedIds]
        .map((id) => nodeIdFromCardLayerId(id))
        .filter((id): id is string => id != null),
    [selectedIds],
  );

  const sourceVisible = isAsciiSourceVisible(editor, blockId);

  if (!view) return null;

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
    {
      id: 'ascii-source',
      label: 'Source',
      icon: <Icon icon="fa-solid fa-code" />,
      title: sourceVisible ? 'Hide ASCII source' : 'Show ASCII source',
      onClick: () => toggleAsciiSource(editor, blockId),
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

  const warnings =
    view.warnings.length > 0 ? (
      <details className="squisq-ascii-diagram-warnings">
        <summary>
          {view.warnings.length} parser note{view.warnings.length === 1 ? '' : 's'}
        </summary>
        <ul>
          {view.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </details>
    ) : null;

  const canvas = (
    <DiagramCanvas
      textChannel={textChannel}
      nodes={canvasView?.nodes ?? view.nodes}
      edges={canvasView?.edges ?? view.edges}
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
      {warnings}
    </div>
  );
}

export default AsciiDiagramWidget;

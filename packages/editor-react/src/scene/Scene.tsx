/**
 * Scene — the editing surface used by diagrams, layouts, and drawings.
 *
 * Owns the viewport (pan/zoom), the selection state, and the active
 * tool. Tools are plain `SceneTool` objects that respond to pointer/
 * keyboard events via the `SceneToolContext` the Scene constructs each
 * render. Adapters (DiagramAdapter, LayoutAdapter, DrawingAdapter) sit
 * outside the Scene and translate `SceneCommand`s into domain edits
 * (markdown attrs, Tiptap mutations, etc).
 *
 * The Scene is deliberately small — most of the logic lives in the hooks
 * (pan/zoom, hit-test, selection) and the tools (interaction rules).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Layer } from '@bendyline/squisq/schemas';
import type { SceneCommand, SceneEdge } from './commands/SceneCommand';
import type { SceneTool, SceneToolContext } from './tools/SceneTool';
import { useScenePanZoom } from './hooks/useScenePanZoom';
import { useSceneSelection } from './hooks/useSceneSelection';
import { useSceneHitTest, layerBounds, type HitTestable } from './hooks/useSceneHitTest';
import { SceneViewport } from './SceneViewport';
import { SceneSelection, type ResizeCorner } from './SceneSelection';
import { getActiveMoveOffset, getActiveResize, beginHandleDrag } from './tools/SelectTool';
import { RenderLayer } from './layers/renderLayer';

export interface SceneProps {
  /** Viewport size in viewport units. Layers render in this coordinate space. */
  viewport: { width: number; height: number };
  /** Layers, back-to-front. Identity changes trigger re-render. */
  layers: readonly Layer[];
  /** Optional edges (diagram mode). Rendered as PathLayer-style curves. */
  edges?: readonly SceneEdge[];
  /** Ordered list of available tools. The first is active by default. */
  tools: readonly SceneTool[];
  /** Override the active tool id. Falls back to `tools[0].id`. */
  activeToolId?: string;
  /** Called when the user picks a different tool from the built-in toolbar. */
  onActiveToolIdChange?: (id: string) => void;
  /** Called when a tool issues a command. */
  onCommand: (cmd: SceneCommand) => void;
  /**
   * Optional renderer for non-Layer content (e.g. diagram edges, in-flight
   * connection preview). Receives the same SceneToolContext the tools do.
   * Rendered behind the layer pass so edges sit below cards.
   */
  renderExtras?: (ctx: SceneToolContext) => ReactNode;
  /**
   * Optional override for how individual layers render. Defaults to the
   * SSR-identical `RenderLayer` from `packages/react/src/layers/`. Hosts
   * that want bespoke per-layer decoration (custom diagram card shells,
   * inline editing affordances) can replace this.
   */
  renderLayer?: (layer: Layer, viewport: { width: number; height: number }) => ReactNode;
  /**
   * Optional follower relationship — given a layer id, return the id of
   * the layer it "follows" (or null when independent). A follower
   * receives the same live drag/resize transform as its owner, so a
   * decorative pair (e.g. a diagram node's card + label) moves together
   * even though only one is selectable. Pure visual sugar — selection
   * state itself is unaffected.
   */
  layerFollows?: (layerId: string) => string | null;
  /** When true, render the corner maximize toggle. */
  showMaximize?: boolean;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  /** Render the built-in toolbar (Select / Connect / etc.). Default true. */
  showToolbar?: boolean;
}

export function Scene(props: SceneProps) {
  const {
    viewport,
    layers,
    edges = [],
    tools,
    activeToolId: controlledActiveId,
    onActiveToolIdChange,
    onCommand,
    renderExtras,
    renderLayer,
    layerFollows,
    showMaximize,
    maximized,
    onToggleMaximize,
    showToolbar = true,
  } = props;

  const layerRenderer = renderLayer ?? defaultRenderLayer;

  // ── Tool state ──────────────────────────────────────────────
  const [internalActiveId, setInternalActiveId] = useState<string>(tools[0]?.id ?? 'select');
  const activeId = controlledActiveId ?? internalActiveId;
  const setActiveTool = useCallback(
    (id: string) => {
      if (onActiveToolIdChange) onActiveToolIdChange(id);
      else setInternalActiveId(id);
    },
    [onActiveToolIdChange],
  );
  const activeTool = useMemo(
    () => tools.find((t) => t.id === activeId) ?? tools[0],
    [tools, activeId],
  );

  // ── Pan/zoom + selection ────────────────────────────────────
  const panZoom = useScenePanZoom();
  const selection = useSceneSelection();
  const { hit } = useSceneHitTest();

  // ── Hit-test cache ──────────────────────────────────────────
  const hitItems: HitTestable[] = useMemo(() => {
    const out: HitTestable[] = [];
    for (const layer of layers) {
      const bounds = layerBounds(layer, viewport);
      if (!bounds) continue;
      out.push({ id: layer.id, layer, bounds });
    }
    return out;
  }, [layers, viewport]);

  // ── Tool context (rebuilt every render — cheap, no allocations in hot path) ──
  const ctx: SceneToolContext = useMemo(
    () => ({
      viewport,
      transform: panZoom.transform,
      layers,
      edges,
      selection: selection.selection,
      hitItems,
      screenToViewport: panZoom.screenToViewport,
      viewportToScreen: panZoom.viewportToScreen,
      hit: (p) => hit(p, hitItems),
      setSelection: selection.setSelection,
      dispatch: onCommand,
      setActiveTool,
    }),
    [
      viewport,
      panZoom.transform,
      panZoom.screenToViewport,
      panZoom.viewportToScreen,
      layers,
      edges,
      selection.selection,
      selection.setSelection,
      hitItems,
      hit,
      onCommand,
      setActiveTool,
    ],
  );
  // Mirror ctx in a ref so keyboard handlers attached to window read the
  // latest selection without re-binding on every selection change.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // ── Pointer dispatch ────────────────────────────────────────
  const containerRef = useRef<SVGSVGElement>(null);
  const isPanning = useRef(false);
  const panLast = useRef<{ x: number; y: number } | null>(null);

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Negative deltaY = wheel up = zoom in.
      const factor = Math.exp(-e.deltaY * 0.0015);
      panZoom.zoomAt(factor, sx, sy);
    },
    [panZoom],
  );

  // Tools keep their drag state in module-level closures (so it survives
  // outside React's render cycle). To make the live drag/resize preview
  // *visible*, the Scene needs to re-render on every pointer-move while
  // a gesture is in progress. We bump `dragTick` on pointer-down and on
  // every move thereafter — cheap (one setState per move) and only fires
  // while the user is actively interacting.
  const [, setDragTick] = useState(0);
  const pointerActive = useRef(false);
  const bumpTick = useCallback(() => setDragTick((t) => t + 1), []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Focus the SVG so it can receive keyboard events (Delete, Escape,
      // tool shortcuts). preventDefault on focus loss is what makes the
      // ProseMirror parent NOT steal focus back mid-gesture.
      (e.currentTarget as SVGSVGElement).focus({ preventScroll: true });
      // Middle-button or space-modified drag → pan, regardless of tool.
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanning.current = true;
        panLast.current = { x: e.clientX, y: e.clientY };
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return;
      }
      pointerActive.current = true;
      activeTool?.onPointerDown?.(e, ctxRef.current);
      bumpTick();
    },
    [activeTool, bumpTick],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (isPanning.current && panLast.current) {
        const dx = e.clientX - panLast.current.x;
        const dy = e.clientY - panLast.current.y;
        panLast.current = { x: e.clientX, y: e.clientY };
        panZoom.panBy(dx, dy);
        return;
      }
      activeTool?.onPointerMove?.(e, ctxRef.current);
      if (pointerActive.current) bumpTick();
    },
    [activeTool, panZoom, bumpTick],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      pointerActive.current = false;
      if (isPanning.current) {
        isPanning.current = false;
        panLast.current = null;
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
        return;
      }
      activeTool?.onPointerUp?.(e, ctxRef.current);
    },
    [activeTool],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      activeTool?.onDoubleClick?.(e, ctxRef.current);
    },
    [activeTool],
  );

  // ── Keyboard handling ──────────────────────────────────────
  // We make the SVG focusable (tabIndex=-1, set in SceneViewport) and
  // focus it on pointer-down. Keydown listeners on the SVG only fire
  // when it has focus — that keeps us from hijacking Delete in
  // surrounding form fields or the parent ProseMirror editor.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      // Tool shortcuts (single-letter, no modifier).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        const shortcut = e.key.toLowerCase();
        const match = tools.find((t) => t.shortcut === shortcut);
        if (match) {
          setActiveTool(match.id);
          e.preventDefault();
          return;
        }
      }
      // Tool keydown (Delete, Escape, etc.).
      activeTool?.onKeyDown?.(e, ctxRef.current);
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [tools, activeTool, setActiveTool]);

  // ── Initial fit ─────────────────────────────────────────────
  const didFitRef = useRef(false);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (didFitRef.current) return;
    if (!containerSize) return;
    if (hitItems.length === 0) return;
    didFitRef.current = true;
    // Fit to the bounding box of all hit items (the visible content).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const it of hitItems) {
      if (it.bounds.x < minX) minX = it.bounds.x;
      if (it.bounds.y < minY) minY = it.bounds.y;
      if (it.bounds.x + it.bounds.width > maxX) maxX = it.bounds.x + it.bounds.width;
      if (it.bounds.y + it.bounds.height > maxY) maxY = it.bounds.y + it.bounds.height;
    }
    if (!Number.isFinite(minX)) return;
    panZoom.fitBox(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      containerSize,
      40,
    );
  }, [containerSize, hitItems, panZoom]);

  // ── Render ──────────────────────────────────────────────────
  const liveOffset = activeId === 'select' ? getActiveMoveOffset() : null;
  const liveResize = activeId === 'select' ? getActiveResize() : null;

  // Per-layer transform applied during an in-flight drag or resize so
  // the user sees the layer move/stretch in real time, not just on commit.
  // A layer is "active" for transform purposes if it's directly selected,
  // OR if it follows a directly-selected layer via `layerFollows`.
  const wrapperFor = (layer: Layer): { transform?: string } => {
    const followsId = layerFollows?.(layer.id) ?? null;
    const ownerId =
      selection.selection.has(layer.id)
        ? layer.id
        : followsId && selection.selection.has(followsId)
          ? followsId
          : null;
    if (!ownerId) return {};
    if (liveResize && liveResize.layerId === ownerId) {
      const bounds = hitItems.find((it) => it.id === ownerId)?.bounds;
      if (!bounds) return {};
      const sx = bounds.width > 0 ? liveResize.bounds.width / bounds.width : 1;
      const sy = bounds.height > 0 ? liveResize.bounds.height / bounds.height : 1;
      const tx = liveResize.bounds.x - bounds.x * sx;
      const ty = liveResize.bounds.y - bounds.y * sy;
      return { transform: `matrix(${sx} 0 0 ${sy} ${tx} ${ty})` };
    }
    if (liveOffset) return { transform: `translate(${liveOffset.dx} ${liveOffset.dy})` };
    return {};
  };

  const handleHandlePointerDown = (
    e: React.PointerEvent<SVGElement>,
    corner: ResizeCorner,
  ) => {
    const id = selection.selection.values().next().value as string | undefined;
    if (!id) return;
    const bounds = hitItems.find((it) => it.id === id)?.bounds;
    if (!bounds) return;
    const root = containerRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const startV = panZoom.screenToViewport(sx, sy);
    beginHandleDrag({ layerId: id, corner, startV, startBounds: bounds });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    // Mark a gesture as active so the Scene's pointer-move handler
    // triggers re-renders for the live resize preview.
    pointerActive.current = true;
    bumpTick();
    e.stopPropagation();
  };

  return (
    <div className="squisq-scene-root">
      {showToolbar && (
        <SceneToolbar tools={tools} activeId={activeId} onSelect={setActiveTool} />
      )}
      <SceneViewport
        ref={containerRef}
        width={containerSize?.width ?? viewport.width}
        height={containerSize?.height ?? viewport.height}
        transform={panZoom.transform}
        cursor={activeTool?.cursor}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* Extras (e.g. diagram edges) render behind the layers so the
            cards visually clip edge endpoints. */}
        {renderExtras?.(ctx)}
        {/* Layers — the Scene wraps each in a transformable <g> so a
            selected layer can show a live drag/resize preview without
            requiring the host to know about drag state. */}
        {layers.map((layer) => (
          <g key={layer.id} data-layer-id={layer.id} {...wrapperFor(layer)}>
            {layerRenderer(layer, viewport)}
          </g>
        ))}
        <SceneSelection
          selection={selection.selection}
          hitItems={hitItems}
          liveOffset={liveOffset}
          liveResize={liveResize}
          onHandlePointerDown={handleHandlePointerDown}
        />
        {activeTool?.renderOverlay?.(ctx)}
      </SceneViewport>
      {showMaximize && onToggleMaximize && (
        <button
          type="button"
          className="squisq-scene-maximize-btn"
          onClick={onToggleMaximize}
          title={maximized ? 'Exit fullscreen (Esc)' : 'Maximize'}
        >
          {maximized ? '✕' : '⛶'}
        </button>
      )}
    </div>
  );
}

function defaultRenderLayer(
  layer: Layer,
  viewport: { width: number; height: number },
): ReactNode {
  return <RenderLayer layer={layer} viewport={viewport} />;
}

// ── Toolbar ────────────────────────────────────────────────────

function SceneToolbar({
  tools,
  activeId,
  onSelect,
}: {
  tools: readonly SceneTool[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (tools.length <= 1) return null;
  return (
    <div className="squisq-scene-toolbar" role="toolbar" aria-label="Scene tools">
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`squisq-scene-tool${activeId === t.id ? ' squisq-scene-tool--active' : ''}`}
          onClick={() => onSelect(t.id)}
          title={t.shortcut ? `${t.label} (${t.shortcut.toUpperCase()})` : t.label}
          aria-pressed={activeId === t.id}
        >
          {t.icon ?? <span className="squisq-scene-tool-label">{t.label}</span>}
        </button>
      ))}
    </div>
  );
}

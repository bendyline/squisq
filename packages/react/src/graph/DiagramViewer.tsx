/**
 * DiagramViewer — draws a laid-out graph (`@bendyline/squisq-graph`) as
 * boxes and routed arrows, with pan, zoom, selection, hover emphasis and
 * keyboard navigation.
 *
 * Rendering is built to stay smooth on large graphs:
 * - The drawing is three memoized layers (containers, edges, nodes) under
 *   one transformed group, so panning and zooming re-render nothing inside.
 * - Hover, selection and highlighting are a generated stylesheet keyed by
 *   item index, so they never re-render the layers either.
 * - Above a few hundred nodes only what is near the screen is drawn; the set
 *   changes when the view crosses a tile, not on every frame.
 * - Labels, details and badges drop out as the drawing shrinks (CSS, not
 *   re-rendering).
 */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { polylinePath, type LayoutResult } from '@bendyline/squisq-graph';
import { GridIndex, type Box } from './spatialIndex.js';
import { GRAPH_VIEW_CSS } from './styles.js';
import { GRAPH_NODE_METRICS, estimateTextWidth, truncateToWidth } from './textMetrics.js';
import type {
  DiagramViewerHandle,
  DiagramViewerProps,
  GraphTone,
  GraphViewEdge,
  GraphViewNode,
} from './types.js';
import {
  fitTransform,
  revealTransform,
  visibleRect,
  zoomAt,
  type Size,
  type ViewTransform,
} from './viewTransform.js';
import { GRAPH_VIEW_CULL_AT, graphViewRenderCounts } from './constants.js';

const LOD_LABELS = 0.4;
const LOD_DETAILS = 0.75;
const DRAG_SLOP = 3;
/** A held node expires if no new layout arrives, so a late relayout never jumps the camera. */
const ANCHOR_TTL_MS = 10_000;
const DEFAULT_SIZE: Size = { width: 800, height: 600 };

interface NodeText {
  label: string;
  detail?: string;
  badge?: string;
  badgeWidth: number;
}

interface Model {
  layout: LayoutResult;
  nodeView: (GraphViewNode | undefined)[];
  edgeView: (GraphViewEdge | undefined)[];
  nodeText: NodeText[];
  edgePath: string[];
  edgeWidth: number[];
  edgeTone: GraphTone[];
  indexOf: Map<string, number>;
  edgeIndexOf: Map<string, number>;
  incident: number[][];
  successors: number[][];
  predecessors: number[][];
  /** Containers outermost first, so inner frames draw on top. */
  containers: number[];
  leaves: number[];
  nodeIndex: GridIndex;
  edgeIndex: GridIndex;
  tones: GraphTone[];
}

function buildModel(
  layout: LayoutResult,
  nodes: readonly GraphViewNode[] | undefined,
  edges: readonly GraphViewEdge[] | undefined,
  cornerRadius: number,
): Model {
  const nodeById = new Map(nodes?.map((n) => [n.id, n]));
  const edgeById = new Map(edges?.map((e) => [e.id, e]));
  const indexOf = new Map<string, number>();
  layout.nodes.forEach((n, i) => {
    if (!indexOf.has(n.id)) indexOf.set(n.id, i);
  });
  const edgeIndexOf = new Map<string, number>();
  layout.edges.forEach((e, i) => {
    if (!edgeIndexOf.has(e.id)) edgeIndexOf.set(e.id, i);
  });

  const m = GRAPH_NODE_METRICS;
  const nodeView = layout.nodes.map((n) => nodeById.get(n.id));
  const nodeText = layout.nodes.map((n, i): NodeText => {
    const view = nodeView[i];
    const label = view?.label ?? n.id;
    const badgeWidth = view?.badge
      ? estimateTextWidth(view.badge, m.badgeSize) + m.badgePadding
      : 0;
    const toggle = view?.expandable ? m.toggleWidth : 0;
    if (n.container) {
      return {
        label: truncateToWidth(label, n.width - m.paddingX * 2 - toggle - badgeWidth, m.labelSize),
        badge: view?.badge,
        badgeWidth,
      };
    }
    const room = n.width - m.paddingX * 2 - toggle - (badgeWidth ? badgeWidth + 6 : 0);
    return {
      label: truncateToWidth(label, room, m.labelSize),
      detail: view?.detail ? truncateToWidth(view.detail, room, m.detailSize) : undefined,
      badge: view?.badge,
      badgeWidth,
    };
  });

  const edgeView = layout.edges.map((e) => edgeById.get(e.id));
  const edgePath = layout.edges.map((e) => polylinePath(e.points, { radius: cornerRadius }));
  const edgeWidth = edgeView.map((v) => {
    const w = v?.weight ?? 1;
    return Math.min(6, Math.max(1, 1 + 1.25 * Math.log2(Math.max(1, w))));
  });
  const edgeTone = edgeView.map((v) => v?.tone ?? 'neutral');

  const incident: number[][] = layout.nodes.map(() => []);
  const successors: number[][] = layout.nodes.map(() => []);
  const predecessors: number[][] = layout.nodes.map(() => []);
  layout.edges.forEach((e, k) => {
    const s = indexOf.get(e.source);
    const t = indexOf.get(e.target);
    if (s === undefined || t === undefined) return;
    incident[s]!.push(k);
    incident[t]!.push(k);
    if (!successors[s]!.includes(t)) successors[s]!.push(t);
    if (!predecessors[t]!.includes(s)) predecessors[t]!.push(s);
  });

  const containers: number[] = [];
  const leaves: number[] = [];
  layout.nodes.forEach((n, i) => (n.container ? containers : leaves).push(i));
  containers.sort(
    (a, b) =>
      layout.nodes[b]!.width * layout.nodes[b]!.height -
        layout.nodes[a]!.width * layout.nodes[a]!.height || a - b,
  );

  const edgeBoxes: Box[] = layout.edges.map((e) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of e.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return Number.isFinite(x0)
      ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
      : { x: 0, y: 0, width: 0, height: 0 };
  });
  const cell = Math.max(
    128,
    Math.sqrt((layout.width * layout.height) / Math.max(1, layout.nodes.length)) * 4,
  );
  const tones = [...new Set<GraphTone>(['neutral', ...edgeTone])];

  return {
    layout,
    nodeView,
    edgeView,
    nodeText,
    edgePath,
    edgeWidth,
    edgeTone,
    indexOf,
    edgeIndexOf,
    incident,
    successors,
    predecessors,
    containers,
    leaves,
    nodeIndex: new GridIndex(layout.nodes, cell),
    edgeIndex: new GridIndex(edgeBoxes, cell),
    tones,
  };
}

function drawingBox(layout: LayoutResult): Box {
  return { x: 0, y: 0, width: layout.width, height: layout.height };
}

function joinClass(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

// ── Layers ─────────────────────────────────────────────────────────────

interface LayerProps {
  model: Model;
  visible: Set<number> | null;
}

const ContainersLayer = memo(function ContainersLayer({ model, visible }: LayerProps) {
  graphViewRenderCounts.containers++;
  const m = GRAPH_NODE_METRICS;
  return (
    <g className="gv-containers">
      {model.containers.map((i) => {
        if (visible && !visible.has(i)) return null;
        const n = model.layout.nodes[i]!;
        const view = model.nodeView[i];
        const text = model.nodeText[i]!;
        const toggle = view?.expandable ? m.toggleWidth : 0;
        return (
          <g
            key={i}
            className={joinClass('gv-container', view?.className)}
            data-i={i}
            transform={`translate(${n.x} ${n.y})`}
          >
            <title>{view?.title ?? view?.label ?? n.id}</title>
            <rect
              className="gv-frame"
              width={n.width}
              height={n.height}
              rx={6}
              style={view?.fill ? { fill: view.fill } : undefined}
            />
            {toggle > 0 && <Toggle x={m.paddingX - 2} y={14} open={view?.expanded !== false} />}
            <text className="gv-container-label" x={m.paddingX + toggle} y={18}>
              {text.label}
            </text>
            {text.badge && (
              <Badge
                x={n.width - m.paddingX - text.badgeWidth}
                y={7}
                width={text.badgeWidth}
                text={text.badge}
              />
            )}
          </g>
        );
      })}
    </g>
  );
});

const NodesLayer = memo(function NodesLayer({ model, visible }: LayerProps) {
  graphViewRenderCounts.nodes++;
  const m = GRAPH_NODE_METRICS;
  return (
    <g className="gv-nodes">
      {model.leaves.map((i) => {
        if (visible && !visible.has(i)) return null;
        const n = model.layout.nodes[i]!;
        const view = model.nodeView[i];
        const text = model.nodeText[i]!;
        const toggle = view?.expandable ? m.toggleWidth : 0;
        const collapsed = !!view?.expandable && !view.expanded;
        const tone = view?.tone && view.tone !== 'neutral' ? view.tone : undefined;
        const labelY = text.detail ? n.height / 2 - 2 : n.height / 2 + 4;
        return (
          <g
            key={i}
            className={joinClass('gv-node', view?.className)}
            data-i={i}
            data-tone={tone}
            data-collapsed={collapsed ? '' : undefined}
            transform={`translate(${n.x} ${n.y})`}
          >
            <title>{view?.title ?? view?.label ?? n.id}</title>
            {collapsed && (
              <rect className="gv-stack" x={3} y={-3} width={n.width} height={n.height} rx={4} />
            )}
            <rect
              className="gv-box"
              width={n.width}
              height={n.height}
              rx={4}
              style={view?.fill ? { fill: view.fill } : undefined}
            />
            {toggle > 0 && <Toggle x={m.paddingX - 4} y={n.height / 2} open={!collapsed} />}
            <text className="gv-label" x={m.paddingX + toggle} y={labelY}>
              {text.label}
            </text>
            {text.detail && (
              <text className="gv-detail" x={m.paddingX + toggle} y={n.height / 2 + 11}>
                {text.detail}
              </text>
            )}
            {text.badge && (
              <Badge
                x={n.width - m.paddingX - text.badgeWidth}
                y={n.height / 2 - 8}
                width={text.badgeWidth}
                text={text.badge}
              />
            )}
          </g>
        );
      })}
    </g>
  );
});

interface EdgesLayerProps extends LayerProps {
  scope: string;
  clickable: boolean;
}

const EdgesLayer = memo(function EdgesLayer({ model, visible, scope, clickable }: EdgesLayerProps) {
  graphViewRenderCounts.edges++;
  return (
    <g className="gv-edges">
      {model.layout.edges.map((e, k) => {
        if (visible && !visible.has(k)) return null;
        const view = model.edgeView[k];
        const tone = model.edgeTone[k]!;
        const marker = `url(#${scope}-arrow-${tone})`;
        return (
          <g
            key={k}
            className={joinClass('gv-edge', view?.className)}
            data-e={k}
            data-tone={tone !== 'neutral' ? tone : undefined}
            data-dashed={view?.dashed ? '' : undefined}
          >
            {view?.title && <title>{view.title}</title>}
            <path
              className="gv-line"
              d={model.edgePath[k]}
              style={{ strokeWidth: model.edgeWidth[k] }}
              markerEnd={marker}
              markerStart={view?.bidirectional ? marker : undefined}
            />
            {clickable && <path className="gv-hit" d={model.edgePath[k]} />}
          </g>
        );
      })}
    </g>
  );
});

function Toggle({ x, y, open }: { x: number; y: number; open: boolean }) {
  return (
    <g className="gv-toggle" data-toggle="" transform={`translate(${x} ${y})`}>
      <rect x={-4} y={-8} width={16} height={16} />
      <path d={open ? 'M0 -2 L4 2 L8 -2' : 'M2 -4 L6 0 L2 4'} />
    </g>
  );
}

function Badge({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  return (
    <g className="gv-badge" transform={`translate(${x} ${y})`}>
      <rect width={width} height={16} rx={3} />
      <text x={width / 2} y={11.5} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

// ── The viewer ─────────────────────────────────────────────────────────

type Hit =
  { kind: 'node'; i: number; toggle: boolean } | { kind: 'edge'; k: number } | { kind: 'none' };

function hitTest(target: EventTarget | null): Hit {
  const el = target instanceof Element ? target : null;
  const toggle = !!el?.closest('[data-toggle]');
  const node = el?.closest('[data-i]');
  if (node) return { kind: 'node', i: Number(node.getAttribute('data-i')), toggle };
  const edge = el?.closest('[data-e]');
  if (edge) return { kind: 'edge', k: Number(edge.getAttribute('data-e')) };
  return { kind: 'none' };
}

function cullKeyFor(t: ViewTransform, size: Size): string {
  const v = visibleRect(t, size);
  const w = v.x1 - v.x0;
  const h = v.y1 - v.y0;
  const tile = 2 ** Math.ceil(Math.log2(Math.max(w, h, 1) / 2));
  return [
    tile,
    Math.floor((v.x0 - w / 2) / tile),
    Math.floor((v.y0 - h / 2) / tile),
    Math.ceil((v.x1 + w / 2) / tile),
    Math.ceil((v.y1 + h / 2) / tile),
  ].join(':');
}

export const DiagramViewer = forwardRef<DiagramViewerHandle, DiagramViewerProps>(
  function DiagramViewer(props, ref) {
    const {
      layout,
      nodes,
      edges,
      selectedIds,
      onSelectionChange,
      onNodeActivate,
      onContainerToggle,
      onEdgeClick,
      onHoverChange,
      highlightIds,
      hoverNeighbors = true,
      wheel = 'zoom',
      cornerRadius = 6,
      fitPadding = 24,
      maxFitScale = 1.5,
      controls = true,
      ariaLabel,
      describeNode,
      initialSize,
      className,
      style,
    } = props;

    const scope = `gv${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const model = useMemo(
      () => buildModel(layout, nodes, edges, cornerRadius),
      [layout, nodes, edges, cornerRadius],
    );
    const rootRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<Size>(initialSize ?? DEFAULT_SIZE);
    const sizeRef = useRef(size);
    sizeRef.current = size;
    const [transform, setTransformState] = useState<ViewTransform>(() =>
      fitTransform(drawingBox(layout), initialSize ?? DEFAULT_SIZE, fitPadding, maxFitScale),
    );
    const transformRef = useRef(transform);
    const setTransform = useCallback((t: ViewTransform) => {
      transformRef.current = t;
      setTransformState(t);
    }, []);
    const userMoved = useRef(false);
    /** A node to hold at its screen position through the next layout, e.g. a folder just toggled. */
    const anchor = useRef<{ id: string; x: number; y: number; at: number } | null>(null);
    const [hover, setHover] = useState<number | null>(null);
    const [panning, setPanning] = useState(false);
    const [announcement, setAnnouncement] = useState('');
    const [ownSelection, setOwnSelection] = useState<string[]>([]);
    const selection = selectedIds ?? ownSelection;
    const followIndex = useRef(0);

    useLayoutEffect(() => {
      const el = rootRef.current;
      if (!el) return;
      const measure = () => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        setSize((prev) =>
          prev.width === r.width && prev.height === r.height
            ? prev
            : { width: r.width, height: r.height },
        );
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    // A node held in place keeps its screen position through a new layout, so
    // opening a folder does not throw the person somewhere else. Otherwise the
    // view follows the layout and the element's size until the person moves it.
    useLayoutEffect(() => {
      const held = anchor.current;
      anchor.current = null;
      if (held && Date.now() - held.at < ANCHOR_TTL_MS) {
        const i = model.indexOf.get(held.id);
        if (i !== undefined) {
          const n = model.layout.nodes[i]!;
          const t = transformRef.current;
          userMoved.current = true;
          setTransform({ tx: held.x - n.x * t.scale, ty: held.y - n.y * t.scale, scale: t.scale });
          return;
        }
      }
      if (userMoved.current) return;
      setTransform(fitTransform(drawingBox(model.layout), size, fitPadding, maxFitScale));
    }, [model, size, fitPadding, maxFitScale, setTransform]);

    useEffect(() => {
      setHover((h) => (h !== null && h >= model.layout.nodes.length ? null : h));
    }, [model]);

    const moveView = useCallback(
      (t: ViewTransform) => {
        userMoved.current = true;
        setTransform(t);
      },
      [setTransform],
    );

    const fit = useCallback(() => {
      userMoved.current = false;
      setTransform(
        fitTransform(drawingBox(model.layout), sizeRef.current, fitPadding, maxFitScale),
      );
    }, [model, fitPadding, maxFitScale, setTransform]);

    const boxOf = useCallback(
      (ids: readonly string[]): Box | null => {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const id of ids) {
          const i = model.indexOf.get(id);
          if (i === undefined) continue;
          const n = model.layout.nodes[i]!;
          x0 = Math.min(x0, n.x);
          y0 = Math.min(y0, n.y);
          x1 = Math.max(x1, n.x + n.width);
          y1 = Math.max(y1, n.y + n.height);
        }
        return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
      },
      [model],
    );

    const reveal = useCallback(
      (id: string) => {
        const box = boxOf([id]);
        if (!box) return;
        const t = transformRef.current;
        const next = revealTransform(t, box, sizeRef.current, fitPadding);
        // Already in view: leave the camera, and the right to refit, alone.
        if (next.tx !== t.tx || next.ty !== t.ty) moveView(next);
      },
      [boxOf, moveView, fitPadding],
    );

    const keepInPlace = useCallback(
      (id: string) => {
        const i = model.indexOf.get(id);
        if (i === undefined) return;
        const n = model.layout.nodes[i]!;
        const t = transformRef.current;
        anchor.current = { id, x: n.x * t.scale + t.tx, y: n.y * t.scale + t.ty, at: Date.now() };
      },
      [model],
    );

    const zoomBy = useCallback(
      (factor: number) => {
        const s = sizeRef.current;
        moveView(zoomAt(transformRef.current, factor, s.width / 2, s.height / 2));
      },
      [moveView],
    );

    useImperativeHandle(
      ref,
      () => ({
        fit,
        focus: (ids) => {
          const box = boxOf(ids);
          if (box)
            moveView(fitTransform(box, sizeRef.current, fitPadding * 2, Math.max(1, maxFitScale)));
        },
        reveal,
        keepInPlace,
        zoomBy,
      }),
      [fit, boxOf, moveView, fitPadding, maxFitScale, reveal, keepInPlace, zoomBy],
    );

    const select = useCallback(
      (ids: string[]) => {
        if (!selectedIds) setOwnSelection(ids);
        onSelectionChange?.(ids);
      },
      [selectedIds, onSelectionChange],
    );

    const announce = useCallback(
      (i: number) => {
        const id = model.layout.nodes[i]!.id;
        setAnnouncement(describeNode?.(id) ?? model.nodeView[i]?.label ?? id);
      },
      [model, describeNode],
    );

    // Wheel zoom needs a non-passive listener to keep the page from scrolling.
    useEffect(() => {
      const el = rootRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        if (wheel === 'scroll-unless-modifier' && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const step = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
        moveView(
          zoomAt(
            transformRef.current,
            Math.exp(-e.deltaY * step),
            e.clientX - r.left,
            e.clientY - r.top,
          ),
        );
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, [wheel, moveView]);

    const drag = useRef<{
      pointer: number;
      x: number;
      y: number;
      tx: number;
      ty: number;
      moved: boolean;
      hit: Hit;
      additive: boolean;
    } | null>(null);

    const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button > 0) return;
      rootRef.current?.focus({ preventScroll: true });
      const t = transformRef.current;
      drag.current = {
        pointer: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        tx: t.tx,
        ty: t.ty,
        moved: false,
        hit: hitTest(e.target),
        additive: e.shiftKey || e.metaKey || e.ctrlKey,
      };
    };

    const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!d.moved) {
        d.moved = true;
        setPanning(true);
        setHover(null);
        // Captured only now: capturing on press would retarget the click and
        // double-click that follow a press without a drag to the canvas.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic events in tests carry no capturable pointer.
        }
      }
      moveView({ tx: d.tx + dx, ty: d.ty + dy, scale: transformRef.current.scale });
    };

    const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      drag.current = null;
      setPanning(false);
      if (d.moved) return;
      const hit = d.hit;
      if (hit.kind === 'node') {
        const id = model.layout.nodes[hit.i]?.id;
        if (id === undefined) return;
        const view = model.nodeView[hit.i];
        if (hit.toggle && view?.expandable) {
          keepInPlace(id);
          onContainerToggle?.(id, !view.expanded);
          return;
        }
        if (d.additive) {
          select(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
        } else {
          select([id]);
        }
        announce(hit.i);
      } else if (hit.kind === 'edge') {
        const id = model.layout.edges[hit.k]?.id;
        if (id !== undefined) onEdgeClick?.(id);
      } else if (selection.length > 0) {
        select([]);
      }
    };

    const onDoubleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
      const hit = hitTest(e.target);
      if (hit.kind !== 'node' || hit.toggle) return;
      const n = model.layout.nodes[hit.i];
      if (n && !n.container) onNodeActivate?.(n.id);
    };

    const onPointerOver = (e: ReactPointerEvent<SVGSVGElement>) => {
      if (drag.current?.moved) return;
      const hit = hitTest(e.target);
      const next = hit.kind === 'node' && !model.layout.nodes[hit.i]?.container ? hit.i : null;
      if (next === hover) return;
      setHover(next);
      onHoverChange?.(next === null ? null : model.layout.nodes[next]!.id);
    };

    const onPointerLeave = () => {
      if (hover === null) return;
      setHover(null);
      onHoverChange?.(null);
    };

    const selectedIndex = (): number | null => {
      const id = selection[selection.length - 1];
      const i = id === undefined ? undefined : model.indexOf.get(id);
      return i === undefined ? null : i;
    };

    const center = (i: number): { x: number; y: number } => {
      const n = model.layout.nodes[i]!;
      return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
    };

    const pickInDirection = (dx: number, dy: number): number | null => {
      const from = selectedIndex();
      const origin =
        from !== null
          ? center(from)
          : (() => {
              const v = visibleRect(transformRef.current, sizeRef.current);
              return { x: (v.x0 + v.x1) / 2, y: (v.y0 + v.y1) / 2 };
            })();
      let best: number | null = null;
      let bestScore = Infinity;
      for (const i of model.leaves) {
        if (i === from) continue;
        const c = center(i);
        const along = (c.x - origin.x) * dx + (c.y - origin.y) * dy;
        const across = Math.abs((c.x - origin.x) * dy - (c.y - origin.y) * dx);
        if (from !== null && along <= 0) continue;
        const score =
          from === null ? Math.hypot(c.x - origin.x, c.y - origin.y) : along + across * 2;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      return best;
    };

    const choose = (i: number) => {
      const id = model.layout.nodes[i]!.id;
      select([id]);
      announce(i);
      reveal(id);
    };

    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const arrow = arrows[e.key];
      if (arrow) {
        e.preventDefault();
        const next = pickInDirection(arrow[0], arrow[1]);
        if (next !== null) choose(next);
        return;
      }
      const current = selectedIndex();
      switch (e.key) {
        case ']':
        case '[': {
          if (current === null) return;
          const list = e.key === ']' ? model.successors[current]! : model.predecessors[current]!;
          if (list.length === 0) return;
          e.preventDefault();
          choose(list[followIndex.current++ % list.length]!);
          return;
        }
        case 'Enter':
          if (current !== null && !model.layout.nodes[current]!.container) {
            e.preventDefault();
            onNodeActivate?.(model.layout.nodes[current]!.id);
          }
          return;
        case ' ': {
          const view = current === null ? undefined : model.nodeView[current];
          if (current !== null && view?.expandable) {
            e.preventDefault();
            keepInPlace(model.layout.nodes[current]!.id);
            onContainerToggle?.(model.layout.nodes[current]!.id, !view.expanded);
          }
          return;
        }
        case 'Escape':
          if (selection.length > 0) {
            e.preventDefault();
            select([]);
          }
          return;
        case 'f':
        case '0':
          e.preventDefault();
          fit();
          return;
        case '+':
        case '=':
          e.preventDefault();
          zoomBy(1.25);
          return;
        case '-':
          e.preventDefault();
          zoomBy(0.8);
          return;
        default:
          followIndex.current = 0;
      }
    };

    // Which nodes and edges stay bright: the hovered node's neighborhood, else the highlights.
    const emphasis = useMemo(() => {
      if (hover !== null && hoverNeighbors) {
        const nodesOn = new Set<number>([hover]);
        const edgesOn = new Set<number>();
        for (const k of model.incident[hover] ?? []) {
          edgesOn.add(k);
          const e = model.layout.edges[k]!;
          nodesOn.add(model.indexOf.get(e.source)!);
          nodesOn.add(model.indexOf.get(e.target)!);
        }
        return { nodes: nodesOn, edges: edgesOn };
      }
      if (highlightIds && highlightIds.length > 0) {
        const nodesOn = new Set<number>();
        for (const id of highlightIds) {
          const i = model.indexOf.get(id);
          if (i !== undefined) nodesOn.add(i);
        }
        const edgesOn = new Set<number>();
        model.layout.edges.forEach((e, k) => {
          if (
            nodesOn.has(model.indexOf.get(e.source)!) &&
            nodesOn.has(model.indexOf.get(e.target)!)
          )
            edgesOn.add(k);
        });
        return { nodes: nodesOn, edges: edgesOn };
      }
      return null;
    }, [hover, hoverNeighbors, highlightIds, model]);

    const dynamicCss = useMemo(() => {
      let css = '';
      const chosen = selection
        .map((id) => model.indexOf.get(id))
        .filter((i): i is number => i !== undefined);
      if (chosen.length > 0) {
        const list = chosen.map((i) => `[data-i="${i}"]`).join(',');
        css +=
          `.${scope} :is(${list})>:is(.gv-box,.gv-frame){stroke:var(--squisq-graph-selected,` +
          `var(--squisq-graph-tone-accent,#2563eb));stroke-width:2.5px}`;
      }
      if (emphasis && (emphasis.nodes.size > 0 || emphasis.edges.size > 0)) {
        const list = [
          ...[...emphasis.nodes].map((i) => `[data-i="${i}"]`),
          ...[...emphasis.edges].map((k) => `[data-e="${k}"]`),
        ].join(',');
        css += `.${scope}[data-dim] :is(${list}){opacity:1}`;
      }
      return css;
    }, [selection, emphasis, model, scope]);

    const culling = model.layout.nodes.length > GRAPH_VIEW_CULL_AT;
    const cullKey = culling ? cullKeyFor(transform, size) : '';
    const visible = useMemo(() => {
      if (!culling) return null;
      const [tile, qx0, qy0, qx1, qy1] = cullKey.split(':').map(Number) as [
        number,
        number,
        number,
        number,
        number,
      ];
      const x0 = qx0 * tile;
      const y0 = qy0 * tile;
      const x1 = qx1 * tile;
      const y1 = qy1 * tile;
      return {
        nodes: new Set(model.nodeIndex.query(x0, y0, x1, y1)),
        edges: new Set(model.edgeIndex.query(x0, y0, x1, y1)),
      };
    }, [culling, cullKey, model]);

    const lod = transform.scale < LOD_LABELS ? 0 : transform.scale < LOD_DETAILS ? 1 : 2;
    const t = transform;

    return (
      <div
        ref={rootRef}
        className={joinClass('squisq-graph-view', scope, `gv-lod-${lod}`, className)}
        style={style}
        tabIndex={0}
        role="group"
        aria-roledescription="diagram"
        aria-label={ariaLabel}
        data-dim={emphasis ? '' : undefined}
        data-panning={panning ? '' : undefined}
        onKeyDown={onKeyDown}
      >
        <style>{GRAPH_VIEW_CSS}</style>
        <style>{dynamicCss}</style>
        <svg
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerOver={onPointerOver}
          onPointerLeave={onPointerLeave}
          onDoubleClick={onDoubleClick}
        >
          <defs>
            {model.tones.map((tone) => (
              <marker
                key={tone}
                id={`${scope}-arrow-${tone}`}
                viewBox="0 0 10 10"
                refX={9}
                refY={5}
                markerWidth={7}
                markerHeight={7}
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path className={`gv-arrow-${tone}`} d="M0,0 L10,5 L0,10 z" />
              </marker>
            ))}
          </defs>
          <g className="gv-world" transform={`translate(${t.tx} ${t.ty}) scale(${t.scale})`}>
            <ContainersLayer model={model} visible={visible?.nodes ?? null} />
            <EdgesLayer
              model={model}
              visible={visible?.edges ?? null}
              scope={scope}
              clickable={!!onEdgeClick}
            />
            <NodesLayer model={model} visible={visible?.nodes ?? null} />
          </g>
        </svg>
        {controls && (
          <div
            className="gv-controls"
            role="toolbar"
            aria-label="Zoom"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => zoomBy(0.8)}
            >
              −
            </button>
            <output aria-label="Zoom level">{Math.round(t.scale * 100)}%</output>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.25)}>
              +
            </button>
            <button
              type="button"
              aria-label="Fit diagram"
              title="Fit the whole diagram"
              onClick={fit}
            >
              Fit
            </button>
          </div>
        )}
        <div className="gv-live" aria-live="polite">
          {announcement}
        </div>
      </div>
    );
  },
);

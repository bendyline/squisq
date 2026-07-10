/**
 * Diagram block template.
 *
 * Renders a node-and-edge diagram from one of two data sources:
 * 1. Child headings (`context.children`) — the legacy authored form; each
 *    child becomes a node positioned by `x`/`y` and connected by
 *    `connectsTo` (see `diagramLayout.ts` for auto-placement rules).
 * 2. `input.nodes`/`input.edges` (usually via `templateData`) — the
 *    data-driven form derived from an ASCII-art diagram fence. Nodes may
 *    carry per-node sizes and a `container` reference; containers draw
 *    behind their children as translucent grouping cards.
 *
 * Layout coordinates are author-defined units. The template computes a
 * bounding box of all nodes and scales it to fit the block's viewport
 * with padding, so users don't have to think about absolute pixel ranges.
 */

import type { Layer, ShapeLayer, TextLayer, PathLayer, MarkerStyle } from '../../schemas/Doc.js';
import type {
  DiagramBlockInput,
  DiagramTemplateEdge,
  DiagramTemplateNode,
  TemplateContext,
} from '../../schemas/BlockTemplates.js';
import { resolveColorScheme, getThemeFont, themedFontSize } from '../utils/themeUtils.js';
import { connectorPath, lineStyleDasharray, snapEndpoints } from '../utils/shapeGeometry.js';
import { computeDiagramLayout } from './diagramLayout.js';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;
const PADDING = 80;

interface ResolvedDiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Containment depth (0 = top level); containers draw depth-ascending. */
  depth: number;
  isContainer: boolean;
}

interface ResolvedDiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  directed: boolean;
}

interface ResolvedDiagram {
  nodes: ResolvedDiagramNode[];
  edges: ResolvedDiagramEdge[];
}

function nodesFromChildren(context: TemplateContext): ResolvedDiagram {
  const layout = computeDiagramLayout(context.children ?? []);
  return {
    nodes: layout.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      x: n.x,
      y: n.y,
      w: NODE_WIDTH,
      h: NODE_HEIGHT,
      depth: 0,
      isContainer: false,
    })),
    edges: layout.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.type ? { label: e.type } : {}),
      directed: true,
    })),
  };
}

/**
 * Defensive resolution of `templateData`-supplied nodes/edges: the data is
 * untyped at runtime (it can come from a hand-written `json data` fence),
 * so malformed entries are dropped rather than crashing the template.
 */
function nodesFromTemplateData(input: DiagramBlockInput): ResolvedDiagram {
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const valid = rawNodes.filter(
    (n): n is DiagramTemplateNode =>
      typeof n === 'object' &&
      n !== null &&
      typeof n.id === 'string' &&
      n.id.length > 0 &&
      typeof n.label === 'string' &&
      typeof n.x === 'number' &&
      Number.isFinite(n.x) &&
      typeof n.y === 'number' &&
      Number.isFinite(n.y),
  );
  const ids = new Set(valid.map((n) => n.id));
  const containerIds = new Set(
    valid.map((n) => n.container).filter((c): c is string => typeof c === 'string' && ids.has(c)),
  );
  const depthOf = (node: DiagramTemplateNode): number => {
    let depth = 0;
    let current: DiagramTemplateNode | undefined = node;
    const seen = new Set<string>();
    while (current?.container && ids.has(current.container) && !seen.has(current.id)) {
      seen.add(current.id);
      depth++;
      current = valid.find((n) => n.id === current?.container);
    }
    return depth;
  };
  const nodes: ResolvedDiagramNode[] = valid.map((n) => ({
    id: n.id,
    label: n.label,
    x: n.x,
    y: n.y,
    w: typeof n.w === 'number' && Number.isFinite(n.w) && n.w > 0 ? n.w : NODE_WIDTH,
    h: typeof n.h === 'number' && Number.isFinite(n.h) && n.h > 0 ? n.h : NODE_HEIGHT,
    depth: depthOf(n),
    isContainer: containerIds.has(n.id),
  }));

  const rawEdges = Array.isArray(input.edges) ? input.edges : [];
  const edges: ResolvedDiagramEdge[] = rawEdges
    .filter(
      (e): e is DiagramTemplateEdge =>
        typeof e === 'object' &&
        e !== null &&
        typeof e.source === 'string' &&
        typeof e.target === 'string' &&
        ids.has(e.source) &&
        ids.has(e.target),
    )
    .map((e, i) => ({
      id: e.label ? `${e.source}->${e.target}:${e.label}` : `${e.source}->${e.target}-${i}`,
      source: e.source,
      target: e.target,
      ...(e.label ? { label: e.label } : {}),
      directed: e.directed !== false,
    }));
  return { nodes, edges };
}

export function diagramBlock(input: DiagramBlockInput, context: TemplateContext): Layer[] {
  const { theme, viewport, children = [] } = context;
  const colors = resolveColorScheme(context, input.colorScheme ?? 'blue');

  const resolved =
    children.length > 0
      ? nodesFromChildren(context)
      : input.nodes && input.nodes.length > 0
        ? nodesFromTemplateData(input)
        : { nodes: [], edges: [] };

  if (resolved.nodes.length === 0) {
    // Empty diagram — render a single hint label so the block has visible content.
    return [
      {
        type: 'text',
        id: 'diagram-empty',
        content: {
          text: input.title ?? 'Empty diagram',
          style: {
            fontSize: themedFontSize(36, context, true),
            fontFamily: getThemeFont(context, 'title'),
            color: theme.colors.textMuted,
            textAlign: 'center',
          },
        },
        position: { x: '50%', y: '50%', anchor: 'center' },
      },
    ];
  }

  // Compute the bounding box of all nodes in author coordinates.
  const minX = Math.min(...resolved.nodes.map((n) => n.x));
  const maxX = Math.max(...resolved.nodes.map((n) => n.x + n.w));
  const minY = Math.min(...resolved.nodes.map((n) => n.y));
  const maxY = Math.max(...resolved.nodes.map((n) => n.y + n.h));

  // Available area in viewport pixels (after reserving space for the title, if any).
  const titleHeight = input.title ? 120 : 0;
  const availW = Math.max(1, viewport.width - PADDING * 2);
  const availH = Math.max(1, viewport.height - PADDING * 2 - titleHeight);
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);

  // Uniform scale so the diagram fits both dimensions. Small diagrams are
  // allowed to grow (everything here is vector) up to 1.8× so a three-node
  // flow doesn't render as a tiny cluster in an empty canvas; label fonts
  // and strokes scale with the nodes, clamped so text never balloons.
  const scale = Math.min(availW / contentW, availH / contentH, 1.8);
  const fontAdj = Math.min(Math.max(scale, 1), 1.5);
  const strokeW = Math.round(2 * fontAdj);

  // Compute viewport-pixel coordinates of each node's top-left corner.
  // The title and the scaled diagram are centered together as one group —
  // a top-pinned title over a center-floated diagram split the block into
  // two stranded pieces.
  const scaledW = contentW * scale;
  const scaledH = contentH * scale;
  const groupTop = Math.max(PADDING / 2, (viewport.height - titleHeight - scaledH) / 2);
  const offsetX = PADDING + (availW - scaledW) / 2;
  const offsetY = groupTop + titleHeight;
  const transform = (n: ResolvedDiagramNode): { x: number; y: number; w: number; h: number } => ({
    x: offsetX + (n.x - minX) * scale,
    y: offsetY + (n.y - minY) * scale,
    w: n.w * scale,
    h: n.h * scale,
  });

  const layers: Layer[] = [];

  // Optional title above the diagram.
  if (input.title) {
    layers.push({
      type: 'text',
      id: 'diagram-title',
      content: {
        text: input.title,
        style: {
          fontSize: themedFontSize(40, context, true),
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
        },
      },
      position: { x: '50%', y: groupTop + titleHeight / 2 - 16, anchor: 'center' },
    });
  }

  const containers = resolved.nodes
    .filter((n) => n.isContainer)
    .sort((a, b) => a.depth - b.depth || a.y - b.y || a.x - b.x);
  const leaves = resolved.nodes.filter((n) => !n.isContainer);

  // Container cards first — translucent grouping surfaces behind everything.
  for (const node of containers) {
    const t = transform(node);
    const card: ShapeLayer = {
      type: 'shape',
      id: `node-card-${node.id}`,
      content: {
        shape: 'rect',
        fill: colors.bg ?? theme.colors.backgroundLight,
        fillOpacity: 0.25,
        stroke: colors.text ?? theme.colors.primary,
        strokeWidth: Math.max(1, strokeW - 1),
        borderRadius: 10,
      },
      position: { x: t.x, y: t.y, width: t.w, height: t.h },
    };
    layers.push(card);
  }

  // Position lookup by id for edge routing (containers included — edges may
  // attach to them, e.g. a through-border split from a parsed fence).
  const positions = new Map<string, { cx: number; cy: number; rx: number; ry: number }>();
  for (const node of resolved.nodes) {
    const t = transform(node);
    positions.set(node.id, { cx: t.x + t.w / 2, cy: t.y + t.h / 2, rx: t.w / 2, ry: t.h / 2 });
  }

  // Edge styling (applies to all edges; direction comes per-edge).
  const startMarker: MarkerStyle = input.startStyle ?? 'none';
  const configuredEnd: MarkerStyle = input.endStyle ?? 'arrow';
  const edgeDash = lineStyleDasharray(input.lineStyle);

  // Edges above containers, behind leaf nodes.
  for (const edge of resolved.edges) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) continue;
    const endMarker: MarkerStyle = edge.directed ? configuredEnd : 'none';
    const { start, end } = snapEndpoints(a, b);
    const pathLayer: PathLayer = {
      type: 'path',
      id: `edge-${edge.id}`,
      content: {
        d: connectorPath(input.edgeStyle ?? 'curved', start, end),
        stroke: colors.text ?? theme.colors.primary,
        strokeWidth: strokeW,
        fill: 'none',
        ...(edgeDash ? { dasharray: edgeDash } : {}),
        ...(startMarker !== 'none' ? { startMarker } : {}),
        ...(endMarker !== 'none' ? { endMarker } : {}),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
    layers.push(pathLayer);

    if (edge.label) {
      // Edge label, floated just above the edge midpoint so the line never
      // strikes through the text.
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      const labelFontSize = themedFontSize(Math.round(18 * fontAdj), context, false);
      const labelLayer: TextLayer = {
        type: 'text',
        id: `edge-label-${edge.id}`,
        content: {
          text: edge.label,
          style: {
            fontSize: labelFontSize,
            fontFamily: getThemeFont(context, 'body'),
            color: theme.colors.textMuted,
            textAlign: 'center',
          },
        },
        position: { x: mx, y: my - labelFontSize * 0.9, anchor: 'center' },
      };
      layers.push(labelLayer);
    }
  }

  // Leaf nodes (card + label) on top of edges.
  for (const node of leaves) {
    const t = transform(node);
    const card: ShapeLayer = {
      type: 'shape',
      id: `node-card-${node.id}`,
      content: {
        shape: 'rect',
        fill: colors.bg ?? theme.colors.backgroundLight,
        stroke: colors.text ?? theme.colors.primary,
        strokeWidth: strokeW,
        borderRadius: input.nodeShape === 'pill' ? t.h / 2 : 10,
      },
      position: { x: t.x, y: t.y, width: t.w, height: t.h },
    };
    layers.push(card);

    const label: TextLayer = {
      type: 'text',
      id: `node-label-${node.id}`,
      content: {
        text: node.label,
        style: {
          fontSize: themedFontSize(Math.round(22 * fontAdj), context, false),
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: 'bold',
          color: colors.text ?? theme.colors.text,
          textAlign: 'center',
        },
      },
      position: { x: t.x + t.w / 2, y: t.y + t.h / 2, anchor: 'center', width: t.w },
    };
    layers.push(label);
  }

  // Container titles last — anchored near the container's top edge, above
  // any child content that could otherwise overprint them.
  for (const node of containers) {
    const t = transform(node);
    const fontSize = themedFontSize(Math.round(20 * fontAdj), context, false);
    const label: TextLayer = {
      type: 'text',
      id: `node-label-${node.id}`,
      content: {
        text: node.label.split('\n')[0] ?? '',
        style: {
          fontSize,
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: 'bold',
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
      },
      position: { x: t.x + t.w / 2, y: t.y + fontSize, anchor: 'center', width: t.w },
    };
    layers.push(label);
  }

  return layers;
}

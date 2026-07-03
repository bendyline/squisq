/**
 * Diagram block template.
 *
 * Renders the parent block's children as a node-and-edge diagram:
 * - Each child becomes a rounded-rect node card with its title as label.
 * - Each `child.connectsTo` entry becomes a path edge (cubic-bezier curve
 *   with an arrowhead at the target end).
 * - Children with `x`/`y` set are placed at those coordinates; the rest
 *   are auto-laid out below in a square-ish grid (see `diagramLayout.ts`).
 *
 * Layout coordinates from `x=`/`y=` are author-defined units. The
 * template computes a bounding box of all nodes and scales it to fit
 * the block's viewport with padding, so users don't have to think about
 * absolute pixel ranges.
 */

import type { Layer, ShapeLayer, TextLayer, PathLayer, MarkerStyle } from '../../schemas/Doc.js';
import type { DiagramBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { resolveColorScheme, getThemeFont, themedFontSize } from '../utils/themeUtils.js';
import { clipEndpoints, connectorPath, lineStyleDasharray } from '../utils/shapeGeometry.js';
import { computeDiagramLayout, type DiagramNodePosition } from './diagramLayout.js';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;
const PADDING = 80;

export function diagramBlock(input: DiagramBlockInput, context: TemplateContext): Layer[] {
  const { theme, viewport, children = [] } = context;
  const colors = resolveColorScheme(context, input.colorScheme ?? 'blue');

  const layout = computeDiagramLayout(children);
  if (layout.nodes.length === 0) {
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
  const minX = Math.min(...layout.nodes.map((n) => n.x));
  const maxX = Math.max(...layout.nodes.map((n) => n.x + NODE_WIDTH));
  const minY = Math.min(...layout.nodes.map((n) => n.y));
  const maxY = Math.max(...layout.nodes.map((n) => n.y + NODE_HEIGHT));

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
  const transform = (n: DiagramNodePosition): { x: number; y: number; w: number; h: number } => ({
    x: offsetX + (n.x - minX) * scale,
    y: offsetY + (n.y - minY) * scale,
    w: NODE_WIDTH * scale,
    h: NODE_HEIGHT * scale,
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

  // Position lookup by id for edge routing.
  const positions = new Map<string, { cx: number; cy: number; rx: number; ry: number }>();
  for (const node of layout.nodes) {
    const t = transform(node);
    positions.set(node.id, { cx: t.x + t.w / 2, cy: t.y + t.h / 2, rx: t.w / 2, ry: t.h / 2 });
  }

  // Edge styling (applies to all edges; per-edge styling lives on the nodes).
  const startMarker: MarkerStyle = input.startStyle ?? 'none';
  const endMarker: MarkerStyle = input.endStyle ?? 'arrow';
  const edgeDash = lineStyleDasharray(input.lineStyle);

  // Edges first so they sit behind nodes.
  for (const edge of layout.edges) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) continue;
    const { start, end } = clipEndpoints(a, b);
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

    if (edge.type) {
      // Connection-type label, floated just above the edge midpoint so the
      // line never strikes through the text.
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      const labelFontSize = themedFontSize(Math.round(18 * fontAdj), context, false);
      const labelLayer: TextLayer = {
        type: 'text',
        id: `edge-label-${edge.id}`,
        content: {
          text: edge.type,
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

  // Nodes (card + label) on top of edges.
  for (const node of layout.nodes) {
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

  return layers;
}

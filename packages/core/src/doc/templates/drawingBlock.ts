/**
 * Drawing block template.
 *
 * Renders the parent block's children as free-form shapes on a canvas:
 * - Each child becomes a shape (`rect`/`circle` → ShapeLayer, `line`/
 *   `arrow`/`path` → PathLayer, `text` → TextLayer) with its title as a
 *   centered label and its body text as an optional sublabel.
 * - `line`/`arrow` children with `from`/`to` (and any child's
 *   `connectsTo`) become connectors clipped to the shapes they join.
 *
 * Coordinates from `x`/`y`/`width`/`height` are author-defined units; the
 * template fits the bounding box of all shapes to the viewport with
 * padding (same approach as `diagramBlock`), so authors don't think in
 * absolute pixels.
 */

import type { Layer, ShapeLayer, TextLayer, PathLayer } from '../../schemas/Doc.js';
import type { DrawingBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { resolveColorScheme, getThemeFont, themedFontSize } from '../utils/themeUtils.js';
import { computeDrawingLayout, type DrawingShape, type DrawingConnector } from './drawingLayout.js';
import { shapePath, connectorPath, clipEndpoints } from '../utils/shapeGeometry.js';

const PADDING = 80;

export function drawingBlock(input: DrawingBlockInput, context: TemplateContext): Layer[] {
  const { theme, viewport, children = [] } = context;
  const colors = resolveColorScheme(context, input.colorScheme);
  const defaultStroke = input.stroke ?? colors.text ?? theme.colors.text;
  const defaultFill = input.fill ?? 'none';

  const layout = computeDrawingLayout(children);

  // No shapes authored as children → empty drawing hint.
  if (layout.shapes.length === 0 && layout.connectors.length === 0) {
    return [emptyHint(input, context)];
  }

  // Bounding box of all shapes in author coordinates.
  const minX = Math.min(...layout.shapes.map((s) => s.x));
  const maxX = Math.max(...layout.shapes.map((s) => s.x + s.width));
  const minY = Math.min(...layout.shapes.map((s) => s.y));
  const maxY = Math.max(...layout.shapes.map((s) => s.y + s.height));

  const titleHeight = input.title ? 120 : 0;
  const availW = Math.max(1, viewport.width - PADDING * 2);
  const availH = Math.max(1, viewport.height - PADDING * 2 - titleHeight);
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);

  // Uniform scale that fits both dimensions. Small drawings may grow
  // (shapes are vector) up to 1.8× so a three-shape sketch doesn't render
  // as a tiny off-center cluster; the title and the scaled drawing are
  // centered together as one group.
  const scale = Math.min(availW / contentW, availH / contentH, 1.8);
  const scaledW = contentW * scale;
  const scaledH = contentH * scale;
  const groupTop = Math.max(PADDING / 2, (viewport.height - titleHeight - scaledH) / 2);
  const offsetX = PADDING + (availW - scaledW) / 2;
  const offsetY = groupTop + titleHeight;

  const tx = (x: number) => offsetX + (x - minX) * scale;
  const ty = (y: number) => offsetY + (y - minY) * scale;
  const fontAdj = Math.min(Math.max(scale, 1), 1.5);

  const layers: Layer[] = [];

  if (input.title) {
    layers.push({
      type: 'text',
      id: 'drawing-title',
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

  // Center lookup so connectors can clip to the shapes they join.
  const boxes = new Map<string, { cx: number; cy: number; rx: number; ry: number }>();
  for (const s of layout.shapes) {
    const x = tx(s.x);
    const y = ty(s.y);
    const w = s.width * scale;
    const h = s.height * scale;
    boxes.set(s.id, {
      cx: x + w / 2,
      cy: y + h / 2,
      rx: Math.max(1, w / 2),
      ry: Math.max(1, h / 2),
    });
  }

  // Connectors first so they sit behind shapes.
  for (const conn of layout.connectors) {
    const a = boxes.get(conn.from);
    const b = boxes.get(conn.to);
    if (!a || !b) continue;
    const { start, end } = clipEndpoints(a, b);
    const path: PathLayer = {
      type: 'path',
      id: `connector-${conn.id}`,
      content: {
        d: connectorPath(conn.routing, start, end),
        stroke: conn.stroke ?? defaultStroke,
        strokeWidth: conn.strokeWidth ?? Math.round(2 * fontAdj),
        fill: 'none',
        ...(conn.dasharray ? { dasharray: conn.dasharray } : {}),
        ...(conn.startMarker !== 'none' ? { startMarker: conn.startMarker } : {}),
        ...(conn.endMarker !== 'none' ? { endMarker: conn.endMarker } : {}),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
    layers.push(path);
    if (conn.label) layers.push(connectorLabel(conn, a, b, context, fontAdj));
  }

  // Shapes (and their labels) on top.
  for (const s of layout.shapes) {
    const x = tx(s.x);
    const y = ty(s.y);
    const w = s.width * scale;
    const h = s.height * scale;
    layers.push(...shapeLayers(s, x, y, w, h, context, defaultStroke, defaultFill, fontAdj));
  }

  return layers;
}

// ============================================
// Per-shape layer emission
// ============================================

function shapeLayers(
  s: DrawingShape,
  x: number,
  y: number,
  w: number,
  h: number,
  context: TemplateContext,
  defaultStroke: string,
  defaultFill: string,
  fontAdj: number,
): Layer[] {
  const out: Layer[] = [];
  const stroke = s.stroke ?? defaultStroke;
  const fill = s.fill ?? defaultFill;

  if (s.kind === 'text') {
    out.push(
      textLayer(
        `shape-${s.id}`,
        s.text ?? s.label ?? '',
        x + w / 2,
        y + h / 2,
        w,
        context,
        s.stroke ?? context.theme.colors.text,
        true,
        fontAdj,
      ),
    );
    return out;
  }

  if (s.kind === 'rect' || s.kind === 'circle') {
    const shape: ShapeLayer = {
      type: 'shape',
      id: `shape-${s.id}`,
      content: {
        shape: s.kind,
        fill,
        stroke,
        strokeWidth: s.strokeWidth ?? Math.round(2 * fontAdj),
        ...(s.kind === 'rect' && s.borderRadius != null ? { borderRadius: s.borderRadius } : {}),
      },
      position: { x, y, width: w, height: h },
    };
    out.push(shape);
  } else {
    // line / arrow / path / polygon shapes → PathLayer.
    const diagonal = `M ${round(x)} ${round(y)} L ${round(x + w)} ${round(y + h)}`;
    let d = diagonal;
    let pathFill = 'none';
    let endMarker: 'none' | 'arrow' = 'none';
    if (s.kind === 'path') {
      d = s.d ?? diagonal;
      pathFill = fill;
    } else if (s.kind === 'arrow') {
      endMarker = 'arrow';
    } else if (s.kind !== 'line') {
      // Named polygon / curved shape → computed filled path.
      d = shapePath(s.kind, x, y, w, h) ?? diagonal;
      pathFill = fill;
    }
    const path: PathLayer = {
      type: 'path',
      id: `shape-${s.id}`,
      content: {
        d,
        stroke,
        strokeWidth: s.strokeWidth ?? Math.round(2 * fontAdj),
        fill: pathFill,
        ...(s.dasharray ? { dasharray: s.dasharray } : {}),
        ...(endMarker !== 'none' ? { endMarker } : {}),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
    out.push(path);
  }

  // Label (heading text) centered on the shape; sublabel (body) below it.
  if (s.label) {
    out.push(
      textLayer(
        `shape-label-${s.id}`,
        s.label,
        x + w / 2,
        y + h / 2,
        w,
        context,
        s.stroke ?? context.theme.colors.text,
        true,
        fontAdj,
      ),
    );
  }
  if (s.sublabel) {
    out.push(
      textLayer(
        `shape-sublabel-${s.id}`,
        s.sublabel,
        x + w / 2,
        y + h + 14 * fontAdj,
        w,
        context,
        context.theme.colors.textMuted,
        false,
        fontAdj,
      ),
    );
  }
  return out;
}

function textLayer(
  id: string,
  text: string,
  cx: number,
  cy: number,
  width: number,
  context: TemplateContext,
  color: string,
  bold: boolean,
  fontAdj: number,
): TextLayer {
  return {
    type: 'text',
    id,
    content: {
      text,
      style: {
        fontSize: themedFontSize(Math.round((bold ? 22 : 18) * fontAdj), context, false),
        fontFamily: getThemeFont(context, 'body'),
        ...(bold ? { fontWeight: 'bold' as const } : {}),
        color,
        textAlign: 'center',
      },
    },
    position: { x: cx, y: cy, anchor: 'center', width },
  };
}

function connectorLabel(
  conn: DrawingConnector,
  a: { cx: number; cy: number },
  b: { cx: number; cy: number },
  context: TemplateContext,
  fontAdj: number,
): TextLayer {
  const fontSize = themedFontSize(Math.round(18 * fontAdj), context, false);
  return {
    type: 'text',
    id: `connector-label-${conn.id}`,
    content: {
      text: conn.label ?? '',
      style: {
        fontSize,
        fontFamily: getThemeFont(context, 'body'),
        color: context.theme.colors.textMuted,
        textAlign: 'center',
      },
    },
    // Floated just above the connector midpoint so the line never
    // strikes through the label text.
    position: { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 - fontSize * 0.9, anchor: 'center' },
  };
}

function emptyHint(input: DrawingBlockInput, context: TemplateContext): TextLayer {
  return {
    type: 'text',
    id: 'drawing-empty',
    content: {
      text: input.title ?? 'Empty drawing',
      style: {
        fontSize: themedFontSize(36, context, true),
        fontFamily: getThemeFont(context, 'title'),
        color: context.theme.colors.textMuted,
        textAlign: 'center',
      },
    },
    position: { x: '50%', y: '50%', anchor: 'center' },
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

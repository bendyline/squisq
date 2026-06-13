/**
 * shapeLayers — synthesize Scene Layer(s) for a drawing shape.
 *
 * The drawing editor's counterpart to `nodeCard.tsx`: a core `DrawingShape`
 * (from `computeDrawingLayout`) becomes a primary Layer (`dshape-<id>`) plus,
 * for non-text shapes with a label, a follower TextLayer (`dlabel-<id>`).
 * The Scene's `RenderLayer` draws them with the normal SSR components, so the
 * canvas and the `drawingBlock` preview render the same primitives.
 *
 * Coordinates are author units used 1:1 as the Scene's viewport units (the
 * same convention diagrams use) — the SSR template fit-scales independently.
 */

import type { Layer, ShapeLayer, TextLayer, PathLayer } from '@bendyline/squisq/schemas';
import { shapePath, type DrawingShape } from '@bendyline/squisq/doc';

/** Prefix for a shape's primary (geometry) layer id. */
const SHAPE_PREFIX = 'dshape-';
/** Prefix for a shape's follower label layer id. */
const LABEL_PREFIX = 'dlabel-';

const DEFAULT_STROKE = '#1e293b';
const DEFAULT_FILL = 'none';

/** A `{id,x,y,width,height}` box per shape — feeds the connector renderer. */
export interface ShapeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Build the Scene layer(s) for one shape. rect/circle → ShapeLayer;
 * line/arrow → ShapeLayer `line` (a bounding-box line, editable via the
 * Select tool's resize handles); path → PathLayer; text → TextLayer. A
 * non-text shape with a label also gets a centered, hit-test-transparent
 * label layer that follows the primary (see {@link drawingLayerFollows}).
 */
export function shapeToLayers(shape: DrawingShape): Layer[] {
  const { id, x, y, width, height } = shape;
  const stroke = shape.stroke ?? DEFAULT_STROKE;
  const fill = shape.fill ?? DEFAULT_FILL;
  const strokeWidth = shape.strokeWidth ?? 2;

  if (shape.kind === 'text') {
    const text: TextLayer = {
      id: `${SHAPE_PREFIX}${id}`,
      type: 'text',
      position: { x, y, width, height },
      content: {
        text: shape.text ?? shape.label ?? '',
        style: {
          fontSize: labelFontSize(height),
          color: stroke,
          textAlign: 'center',
        },
      },
    };
    return [text];
  }

  let primary: Layer;
  if (shape.kind === 'rect' || shape.kind === 'circle') {
    const layer: ShapeLayer = {
      id: `${SHAPE_PREFIX}${id}`,
      type: 'shape',
      position: { x, y, width, height },
      content: {
        shape: shape.kind,
        fill,
        stroke,
        strokeWidth,
        ...(shape.kind === 'rect' && shape.borderRadius != null
          ? { borderRadius: shape.borderRadius }
          : {}),
      },
    };
    primary = layer;
  } else if (shape.kind === 'path') {
    const layer: PathLayer = {
      id: `${SHAPE_PREFIX}${id}`,
      type: 'path',
      position: { x, y, width, height },
      content: {
        d: shape.d ?? `M ${x} ${y} L ${x + width} ${y + height}`,
        stroke,
        strokeWidth,
        fill,
        ...(shape.dasharray ? { dasharray: shape.dasharray } : {}),
      },
    };
    primary = layer;
  } else if (shape.kind === 'line') {
    // Plain line → a bounding-box line (editable via resize handles).
    const layer: ShapeLayer = {
      id: `${SHAPE_PREFIX}${id}`,
      type: 'shape',
      position: { x, y, width, height },
      content: { shape: 'line', stroke, strokeWidth },
    };
    primary = layer;
  } else if (shape.kind === 'arrow') {
    const layer: PathLayer = {
      id: `${SHAPE_PREFIX}${id}`,
      type: 'path',
      position: { x, y, width, height },
      content: {
        d: `M ${x} ${y} L ${x + width} ${y + height}`,
        stroke,
        strokeWidth,
        fill: 'none',
        endMarker: 'arrow',
      },
    };
    primary = layer;
  } else {
    // Named polygon / curved shape → computed filled path.
    const layer: PathLayer = {
      id: `${SHAPE_PREFIX}${id}`,
      type: 'path',
      position: { x, y, width, height },
      content: {
        d: shapePath(shape.kind, x, y, width, height) ?? `M ${x} ${y} L ${x + width} ${y + height}`,
        stroke,
        strokeWidth,
        fill,
        ...(shape.dasharray ? { dasharray: shape.dasharray } : {}),
      },
    };
    primary = layer;
  }

  const out: Layer[] = [primary];
  if (shape.label) {
    // No explicit height keeps the label out of the hit-test (the primary
    // wins pointer-down), exactly like nodeCard's label.
    out.push({
      id: `${LABEL_PREFIX}${id}`,
      type: 'text',
      position: { x: x + width / 2, y: y + height / 2, width, anchor: 'center' },
      content: {
        text: shape.label,
        style: { fontSize: labelFontSize(height), fontWeight: 'bold', color: stroke, textAlign: 'center' },
      },
    } satisfies TextLayer);
  }
  return out;
}

/** Convert shapes to a flat Layer[] — primaries first, then labels (paint order). */
export function shapesToSceneLayers(shapes: readonly DrawingShape[]): Layer[] {
  const primaries: Layer[] = [];
  const labels: Layer[] = [];
  for (const shape of shapes) {
    const [primary, label] = shapeToLayers(shape);
    primaries.push(primary);
    if (label) labels.push(label);
  }
  return [...primaries, ...labels];
}

/** `{id,x,y,width,height}` boxes for the connector renderer. */
export function shapeBoxes(shapes: readonly DrawingShape[]): ShapeBox[] {
  return shapes.map((s) => ({ id: s.id, x: s.x, y: s.y, width: s.width, height: s.height }));
}

/** A label layer follows its primary shape during drag/resize previews. */
export function drawingLayerFollows(layerId: string): string | null {
  if (layerId.startsWith(LABEL_PREFIX)) {
    return `${SHAPE_PREFIX}${layerId.slice(LABEL_PREFIX.length)}`;
  }
  return null;
}

/** Recover the shape (heading) id from a primary or label layer id. */
export function shapeIdFromLayerId(layerId: string): string | null {
  if (layerId.startsWith(SHAPE_PREFIX)) return layerId.slice(SHAPE_PREFIX.length);
  if (layerId.startsWith(LABEL_PREFIX)) return layerId.slice(LABEL_PREFIX.length);
  return null;
}

/** True for a primary shape layer id (not a label). */
export function isPrimaryShapeLayer(layerId: string): boolean {
  return layerId.startsWith(SHAPE_PREFIX);
}

/** The primary layer id for a shape (heading) id. */
export function primaryLayerId(shapeId: string): string {
  return `${SHAPE_PREFIX}${shapeId}`;
}

function labelFontSize(height: number): number {
  return Math.max(12, Math.min(48, Math.round(height * 0.34)));
}

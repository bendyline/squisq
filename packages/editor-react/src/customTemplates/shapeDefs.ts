/**
 * Standard shape definitions for the template designer's "Add" bin.
 *
 * Each entry maps to one of Squisq's shape kinds. The three primitives
 * the renderer draws natively (`rect`, `circle`, `line`) become a
 * `ShapeLayer`; every other kind is compiled to an SVG path via
 * {@link shapePath} and stored as a `PathLayer` — the same split the
 * `drawing` template uses (see `shapeGeometry.ts`). Both render through
 * the shared layer components, so the bin preview, the editor canvas,
 * and the final block render stay identical.
 *
 * Like {@link TOKEN_DEFS}, a shape can be placed two ways: drag it onto
 * the canvas (the drag carries the id on {@link SHAPE_DRAG_MIME}) or
 * click it to arm the matching place tool, then click the canvas.
 */

import type { Layer, PathLayer, ShapeLayer } from '@bendyline/squisq/schemas';
import { shapePath } from '@bendyline/squisq/doc';

/** MIME type carried on the drag's `dataTransfer` for a shape. */
export const SHAPE_DRAG_MIME = 'application/x-squisq-shape';

export interface ShapeDef {
  /** Stable id, used both as the place-tool id and the drag payload. */
  id: string;
  /** Short button label. */
  label: string;
  /**
   * Shape kind. `rect`/`circle`/`line` render as a native `ShapeLayer`;
   * any other kind is compiled to a `PathLayer` path via `shapePath`.
   */
  kind: string;
  /** For `rect`: render with rounded corners. */
  rounded?: boolean;
}

export const SHAPE_DEFS: ShapeDef[] = [
  { id: 'shape-rect', label: 'Rectangle', kind: 'rect' },
  { id: 'shape-rect-rounded', label: 'Rounded', kind: 'rect', rounded: true },
  { id: 'shape-circle', label: 'Ellipse', kind: 'circle' },
  { id: 'shape-line', label: 'Line', kind: 'line' },
  { id: 'shape-triangle', label: 'Triangle', kind: 'triangle' },
  { id: 'shape-right-triangle', label: 'Right triangle', kind: 'right-triangle' },
  { id: 'shape-diamond', label: 'Diamond', kind: 'diamond' },
  { id: 'shape-pentagon', label: 'Pentagon', kind: 'pentagon' },
  { id: 'shape-hexagon', label: 'Hexagon', kind: 'hexagon' },
  { id: 'shape-octagon', label: 'Octagon', kind: 'octagon' },
  { id: 'shape-star', label: 'Star', kind: 'star' },
  { id: 'shape-star4', label: '4-point star', kind: 'star4' },
  { id: 'shape-star6', label: '6-point star', kind: 'star6' },
  { id: 'shape-parallelogram', label: 'Parallelogram', kind: 'parallelogram' },
  { id: 'shape-trapezoid', label: 'Trapezoid', kind: 'trapezoid' },
  { id: 'shape-plus', label: 'Plus', kind: 'plus' },
  { id: 'shape-chevron', label: 'Chevron', kind: 'chevron' },
  { id: 'shape-arrow-right', label: 'Arrow right', kind: 'arrow-right' },
  { id: 'shape-arrow-left', label: 'Arrow left', kind: 'arrow-left' },
  { id: 'shape-arrow-up', label: 'Arrow up', kind: 'arrow-up' },
  { id: 'shape-arrow-down', label: 'Arrow down', kind: 'arrow-down' },
  { id: 'shape-double-arrow', label: 'Double arrow', kind: 'double-arrow' },
  { id: 'shape-callout', label: 'Callout', kind: 'callout' },
  { id: 'shape-cylinder', label: 'Cylinder', kind: 'cylinder' },
  { id: 'shape-cloud', label: 'Cloud', kind: 'cloud' },
  { id: 'shape-heart', label: 'Heart', kind: 'heart' },
  { id: 'shape-lightning', label: 'Lightning', kind: 'lightning' },
];

/** Kinds the renderer draws natively as a `ShapeLayer`. */
const NATIVE_KINDS = new Set(['rect', 'circle', 'line']);

/** Default visual styling for a freshly placed shape. */
const FILL = '#e2e8f0'; // slate-200
const STROKE = '#475569'; // slate-600
const STROKE_WIDTH = 2;
const ROUNDED_RADIUS = 20;

/** Default placement box (top-left anchored at the drop/click point). */
function defaultSize(kind: string): { width: number; height: number } {
  if (kind === 'line') return { width: 280, height: 120 };
  return { width: 220, height: 180 };
}

let counter = 0;
function nextShapeId(): string {
  counter += 1;
  return `shape-${Date.now().toString(36)}-${counter}`;
}

/**
 * Build the layer a shape def adds, top-left at the given viewport point.
 * Native kinds produce a `ShapeLayer`; everything else a computed
 * `PathLayer`. Shared by the click-to-place tool and the drag-drop
 * handler so both paths produce identical layers.
 */
export function buildShapeLayer(def: ShapeDef, point: { x: number; y: number }): Layer {
  const { width, height } = defaultSize(def.kind);
  const position = { x: point.x, y: point.y, width, height };
  const id = nextShapeId();

  if (NATIVE_KINDS.has(def.kind)) {
    const layer: ShapeLayer = {
      id,
      type: 'shape',
      position,
      content: {
        shape: def.kind as 'rect' | 'circle' | 'line',
        fill: def.kind === 'line' ? 'none' : FILL,
        stroke: STROKE,
        strokeWidth: STROKE_WIDTH,
        ...(def.kind === 'rect' ? { borderRadius: def.rounded ? ROUNDED_RADIUS : 0 } : {}),
      },
    };
    return layer;
  }

  const layer: PathLayer = {
    id,
    type: 'path',
    position,
    content: {
      // `d` is the initial geometry; `shapeKind` lets the renderer
      // re-derive it from `position` so the shape moves, resizes, and
      // adapts to the viewport (see PathLayer).
      d: shapePath(def.kind, point.x, point.y, width, height) ?? '',
      shapeKind: def.kind,
      fill: FILL,
      stroke: STROKE,
      strokeWidth: STROKE_WIDTH,
    },
  };
  return layer;
}

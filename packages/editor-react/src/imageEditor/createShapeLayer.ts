/**
 * createShapeLayer — turn a drawing-palette shape `kind` and a canvas drop
 * point into a new {@link ImageEditLayerInput}.
 *
 * The mapping mirrors the drawing editor's `shapeToLayers`: the native
 * primitives (`rectangle`/`circle`/`line`) become a core `ShapeLayer`,
 * `text` becomes a `TextLayer`, the line `arrow` becomes a `PathLayer` with
 * an arrowhead marker, and every other kind (polygons, stars, block arrows,
 * curved shapes) becomes a `PathLayer` carrying `shapeKind` so the shared
 * `PathLayer` renderer re-derives the geometry from the position box on
 * move/resize — exactly like drawings.
 */

import { shapePath } from '@bendyline/squisq/doc';
import type { ImageEditLayerInput } from './state.js';

/** Default shape footprint, centered on the drop point. */
const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 80;
const DEFAULT_FILL = '#3399ff';
const DEFAULT_STROKE = '#1a4d80';
const DEFAULT_STROKE_WIDTH = 2;

/** Redline annotation color (engineering review red). */
const REDLINE_COLOR = '#cc0000';
const REDLINE_STROKE_WIDTH = 15;

/** Kinds that are drawn by dragging start→end (or corner A→corner B) rather than clicking to drop. */
const LINEAR_KINDS = new Set(['line', 'arrow', 'redline-arrow', 'redline-rect']);

export function isLinearShapeKind(kind: string): boolean {
  return LINEAR_KINDS.has(kind);
}

/** Native `ShapeLayer` primitive kinds (the rest compile to a `PathLayer`). */
const NATIVE: Record<string, 'rect' | 'circle' | 'line'> = {
  rectangle: 'rect',
  circle: 'circle',
  line: 'line',
};

export function createShapeLayer(kind: string, x: number, y: number): ImageEditLayerInput {
  const width = DEFAULT_WIDTH;
  const height = DEFAULT_HEIGHT;
  const px = Math.round(x - width / 2);
  const py = Math.round(y - height / 2);
  const position = { x: px, y: py, width, height };
  const name = prettifyKind(kind);

  if (kind === 'text') {
    return {
      type: 'text',
      name: 'Text',
      position: { x: Math.round(x), y: Math.round(y), width: 240, height: 48 },
      content: {
        text: 'New text',
        style: { fontSize: 32, color: '#111111', fontFamily: 'sans-serif' },
      },
    };
  }

  // ── Redline shortcuts ──────────────────────────────────────────────────────
  if (kind === 'redline-arrow') {
    return {
      type: 'path',
      name: 'Redline Arrow',
      position,
      content: {
        d: `M ${px} ${py} L ${px + width} ${py + height}`,
        stroke: REDLINE_COLOR,
        strokeWidth: REDLINE_STROKE_WIDTH,
        fill: 'none',
        endMarker: 'arrow',
      },
    };
  }
  if (kind === 'redline-rect') {
    return {
      type: 'shape',
      name: 'Redline Rectangle',
      position,
      content: {
        shape: 'rect',
        fill: 'none',
        stroke: REDLINE_COLOR,
        strokeWidth: REDLINE_STROKE_WIDTH,
        borderRadius: 0,
      },
    };
  }
  if (kind === 'redline-text') {
    return {
      type: 'text',
      name: 'Redline Text',
      position: { x: Math.round(x), y: Math.round(y), width: 240, height: 48 },
      content: {
        text: 'Annotation',
        style: {
          fontSize: 24,
          color: REDLINE_COLOR,
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
        },
      },
    };
  }

  const native = NATIVE[kind];
  if (native === 'rect') {
    return {
      type: 'shape',
      name,
      position,
      content: {
        shape: 'rect',
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        borderRadius: 8,
      },
    };
  }
  if (native === 'circle') {
    return {
      type: 'shape',
      name,
      position,
      content: {
        shape: 'circle',
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      },
    };
  }
  if (native === 'line') {
    return {
      type: 'shape',
      name,
      position,
      content: { shape: 'line', stroke: DEFAULT_STROKE, strokeWidth: DEFAULT_STROKE_WIDTH },
    };
  }

  if (kind === 'arrow') {
    // A bounding-box line with an arrowhead at the end (no fill).
    return {
      type: 'path',
      name: 'Arrow',
      position,
      content: {
        d: `M ${px} ${py} L ${px + width} ${py + height}`,
        stroke: DEFAULT_STROKE,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        fill: 'none',
        endMarker: 'arrow',
      },
    };
  }

  // Named polygon / curved shape. Store `shapeKind` so the renderer (and the
  // export pipeline) re-derive `d` from the position box; `d` is a seed value.
  const d =
    shapePath(kind, px, py, width, height) ?? `M ${px} ${py} L ${px + width} ${py + height}`;
  return {
    type: 'path',
    name,
    position,
    content: {
      d,
      shapeKind: kind,
      fill: DEFAULT_FILL,
      stroke: DEFAULT_STROKE,
      strokeWidth: DEFAULT_STROKE_WIDTH,
    },
  };
}

/**
 * Create a line-based shape layer from a drag gesture (start point → end point).
 * Used for `line`, `arrow`, and `redline-arrow` where the user drags to set both
 * endpoints rather than clicking to drop a fixed-size shape.
 */
export function createLinearShapeLayer(
  kind: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): ImageEditLayerInput {
  const rx1 = Math.round(x1);
  const ry1 = Math.round(y1);
  const rx2 = Math.round(x2);
  const ry2 = Math.round(y2);

  // Bounding box for selection handle placement — always positive dimensions.
  const bx = Math.min(rx1, rx2);
  const by = Math.min(ry1, ry2);
  const bw = Math.max(Math.abs(rx2 - rx1), 4);
  const bh = Math.max(Math.abs(ry2 - ry1), 4);
  const position = { x: bx, y: by, width: bw, height: bh };

  if (kind === 'line') {
    // ShapeLayer line: renderer draws from (x,y) to (x+width, y+height).
    // Store the actual start/end so the diagonal matches the drag direction.
    return {
      type: 'shape',
      name: 'Line',
      position: {
        x: rx1,
        y: ry1,
        width: rx2 - rx1,
        height: ry2 - ry1,
      },
      content: { shape: 'line', stroke: DEFAULT_STROKE, strokeWidth: DEFAULT_STROKE_WIDTH },
    };
  }

  if (kind === 'arrow') {
    return {
      type: 'path',
      name: 'Arrow',
      position,
      content: {
        d: `M ${rx1} ${ry1} L ${rx2} ${ry2}`,
        stroke: DEFAULT_STROKE,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        fill: 'none',
        endMarker: 'arrow',
      },
    };
  }

  if (kind === 'redline-arrow') {
    return {
      type: 'path',
      name: 'Redline Arrow',
      position,
      content: {
        d: `M ${rx1} ${ry1} L ${rx2} ${ry2}`,
        stroke: REDLINE_COLOR,
        strokeWidth: REDLINE_STROKE_WIDTH,
        fill: 'none',
        endMarker: 'arrow',
      },
    };
  }

  if (kind === 'redline-rect') {
    // Normalize so width/height are always positive regardless of drag direction.
    return {
      type: 'shape',
      name: 'Redline Rectangle',
      position: {
        x: Math.min(rx1, rx2),
        y: Math.min(ry1, ry2),
        width: Math.max(Math.abs(rx2 - rx1), 4),
        height: Math.max(Math.abs(ry2 - ry1), 4),
      },
      content: {
        shape: 'rect',
        fill: 'none',
        stroke: REDLINE_COLOR,
        strokeWidth: REDLINE_STROKE_WIDTH,
        borderRadius: 0,
      },
    };
  }

  // Fallback: shouldn't be called for non-linear kinds
  return createShapeLayer(kind, (x1 + x2) / 2, (y1 + y2) / 2);
}

/** Turn a palette kind into a layer-panel name, e.g. `arrow-right` → `Arrow Right`. */
function prettifyKind(kind: string): string {
  return kind
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

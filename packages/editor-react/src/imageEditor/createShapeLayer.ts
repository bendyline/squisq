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
  const d = shapePath(kind, px, py, width, height) ?? `M ${px} ${py} L ${px + width} ${py + height}`;
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

/** Turn a palette kind into a layer-panel name, e.g. `arrow-right` → `Arrow Right`. */
function prettifyKind(kind: string): string {
  return kind
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * shapeGeometry — pure SVG geometry for the drawing/diagram shape vocabulary.
 *
 * Three concerns, all deterministic and dependency-free:
 *  - `shapePath(kind, x, y, w, h)` → an SVG path `d` for a named shape inscribed
 *    in a bounding box. Returns null for the natively-rendered primitives
 *    (rect / circle / line / text / path) so the caller can keep using a
 *    `ShapeLayer` for those; everything else becomes a computed `PathLayer`.
 *  - `markerPath(style, dir)` → the `<marker>` path for a line end-style, in the
 *    standard 0–10 marker viewBox (shared by the SSR `PathLayer` renderer and the
 *    editor's edge renderer).
 *  - `connectorPath(routing, start, end)` + `snapEndpoints(a, b)` → the line/edge
 *    geometry between two shapes (straight / orthogonal / curved), lifted from the
 *    diagram template so drawings and diagrams draw identical connectors. The older
 *    `clipEndpoints(a, b)` helper remains for free-angle clipping, but rendered
 *    connectors use snapped ports so authored lines land on stable attachment points.
 */

import type { MarkerStyle } from '../../schemas/Doc.js';

// ============================================
// Shapes
// ============================================

/** Connector routing styles. */
export type ConnectorRouting = 'straight' | 'orthogonal' | 'curved';

/**
 * Shape kinds rendered as computed paths (everything except the primitives the
 * renderer draws natively). Used by templates to decide ShapeLayer vs PathLayer.
 */
export const PATH_SHAPE_KINDS = new Set([
  'triangle',
  'right-triangle',
  'diamond',
  'pentagon',
  'hexagon',
  'octagon',
  'star',
  'star4',
  'star6',
  'parallelogram',
  'trapezoid',
  'plus',
  'chevron',
  'arrow-right',
  'arrow-left',
  'arrow-up',
  'arrow-down',
  'double-arrow',
  'callout',
  'cylinder',
  'cloud',
  'heart',
  'lightning',
]);

/** Round to 1 decimal for compact, stable path output. */
function r(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Close a list of points into an `M … L … Z` polygon path. */
function poly(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  const head = `M ${r(first[0])} ${r(first[1])}`;
  const tail = rest.map(([x, y]) => `L ${r(x)} ${r(y)}`).join(' ');
  return `${head} ${tail} Z`;
}

/** Regular polygon points inscribed in the box ellipse, `rotation` in radians. */
function regular(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  rotation: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * 2 * Math.PI) / sides;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/** Star points alternating outer/inner radius. */
function star(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  spikes: number,
  innerRatio: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const rot = -Math.PI / 2; // first point up
  for (let i = 0; i < spikes * 2; i++) {
    const outer = i % 2 === 0;
    const a = rot + (i * Math.PI) / spikes;
    const fx = outer ? rx : rx * innerRatio;
    const fy = outer ? ry : ry * innerRatio;
    pts.push([cx + fx * Math.cos(a), cy + fy * Math.sin(a)]);
  }
  return pts;
}

/**
 * SVG path `d` for a named shape inscribed in `[x, y, w, h]`, or null when the
 * kind is rendered natively (rect / circle / line / text / path / arrow).
 */
export function shapePath(kind: string, x: number, y: number, w: number, h: number): string | null {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const right = x + w;
  const bottom = y + h;

  switch (kind) {
    case 'triangle':
      return poly([
        [cx, y],
        [right, bottom],
        [x, bottom],
      ]);
    case 'right-triangle':
      return poly([
        [x, y],
        [x, bottom],
        [right, bottom],
      ]);
    case 'diamond':
      return poly([
        [cx, y],
        [right, cy],
        [cx, bottom],
        [x, cy],
      ]);
    case 'pentagon':
      return poly(regular(cx, cy, rx, ry, 5, -Math.PI / 2));
    case 'hexagon': {
      // Flat top/bottom hexagon: inset the left/right vertices.
      const inset = w * 0.25;
      return poly([
        [x + inset, y],
        [right - inset, y],
        [right, cy],
        [right - inset, bottom],
        [x + inset, bottom],
        [x, cy],
      ]);
    }
    case 'octagon': {
      const cut = Math.min(w, h) * 0.29;
      return poly([
        [x + cut, y],
        [right - cut, y],
        [right, y + cut],
        [right, bottom - cut],
        [right - cut, bottom],
        [x + cut, bottom],
        [x, bottom - cut],
        [x, y + cut],
      ]);
    }
    case 'star':
      return poly(star(cx, cy, rx, ry, 5, 0.4));
    case 'star4':
      return poly(star(cx, cy, rx, ry, 4, 0.4));
    case 'star6':
      return poly(star(cx, cy, rx, ry, 6, 0.5));
    case 'parallelogram': {
      const off = w * 0.25;
      return poly([
        [x + off, y],
        [right, y],
        [right - off, bottom],
        [x, bottom],
      ]);
    }
    case 'trapezoid': {
      const off = w * 0.25;
      return poly([
        [x + off, y],
        [right - off, y],
        [right, bottom],
        [x, bottom],
      ]);
    }
    case 'plus': {
      const t = Math.min(w, h) / 3; // arm thickness
      const lx = x + (w - t) / 2;
      const rxp = lx + t;
      const ty = y + (h - t) / 2;
      const byp = ty + t;
      return poly([
        [lx, y],
        [rxp, y],
        [rxp, ty],
        [right, ty],
        [right, byp],
        [rxp, byp],
        [rxp, bottom],
        [lx, bottom],
        [lx, byp],
        [x, byp],
        [x, ty],
        [lx, ty],
      ]);
    }
    case 'chevron': {
      const notch = w * 0.25;
      return poly([
        [x, y],
        [right - notch, y],
        [right, cy],
        [right - notch, bottom],
        [x, bottom],
        [x + notch, cy],
      ]);
    }
    case 'arrow-right':
      return blockArrow(x, y, w, h, 'right');
    case 'arrow-left':
      return blockArrow(x, y, w, h, 'left');
    case 'arrow-up':
      return blockArrow(x, y, w, h, 'up');
    case 'arrow-down':
      return blockArrow(x, y, w, h, 'down');
    case 'double-arrow': {
      const head = w * 0.3;
      const bodyT = h * 0.4;
      const ty = cy - bodyT / 2;
      const by = cy + bodyT / 2;
      return poly([
        [x, cy],
        [x + head, y],
        [x + head, ty],
        [right - head, ty],
        [right - head, y],
        [right, cy],
        [right - head, bottom],
        [right - head, by],
        [x + head, by],
        [x + head, bottom],
      ]);
    }
    case 'callout': {
      // Speech bubble: rounded-ish body (square corners for path simplicity)
      // with a tail off the lower-left.
      const bodyH = h * 0.78;
      const bb = y + bodyH;
      const tailX = x + w * 0.25;
      return `M ${r(x)} ${r(y)} L ${r(right)} ${r(y)} L ${r(right)} ${r(bb)} L ${r(tailX + w * 0.12)} ${r(bb)} L ${r(tailX)} ${r(bottom)} L ${r(tailX - w * 0.02)} ${r(bb)} L ${r(x)} ${r(bb)} Z`;
    }
    case 'cylinder': {
      const ell = h * 0.16; // ellipse half-height
      return (
        `M ${r(x)} ${r(y + ell)} ` +
        `A ${r(rx)} ${r(ell)} 0 0 1 ${r(right)} ${r(y + ell)} ` +
        `L ${r(right)} ${r(bottom - ell)} ` +
        `A ${r(rx)} ${r(ell)} 0 0 1 ${r(x)} ${r(bottom - ell)} ` +
        `Z ` +
        // top ellipse outline
        `M ${r(x)} ${r(y + ell)} ` +
        `A ${r(rx)} ${r(ell)} 0 0 0 ${r(right)} ${r(y + ell)}`
      );
    }
    case 'cloud': {
      // Four bumps along the top + a flat-ish bottom, via arcs.
      const b = h * 0.5;
      return (
        `M ${r(x + w * 0.2)} ${r(bottom)} ` +
        `A ${r(w * 0.2)} ${r(b)} 0 0 1 ${r(x + w * 0.15)} ${r(cy)} ` +
        `A ${r(w * 0.2)} ${r(b)} 0 0 1 ${r(x + w * 0.45)} ${r(y + h * 0.2)} ` +
        `A ${r(w * 0.2)} ${r(b)} 0 0 1 ${r(x + w * 0.8)} ${r(y + h * 0.25)} ` +
        `A ${r(w * 0.18)} ${r(b)} 0 0 1 ${r(x + w * 0.85)} ${r(bottom)} ` +
        `Z`
      );
    }
    case 'heart': {
      const topY = y + h * 0.3;
      return (
        `M ${r(cx)} ${r(bottom)} ` +
        `C ${r(x - w * 0.1)} ${r(cy)} ${r(x)} ${r(y)} ${r(cx)} ${r(topY)} ` +
        `C ${r(right)} ${r(y)} ${r(right + w * 0.1)} ${r(cy)} ${r(cx)} ${r(bottom)} ` +
        `Z`
      );
    }
    case 'lightning':
      return poly([
        [x + w * 0.55, y],
        [x + w * 0.2, y + h * 0.55],
        [x + w * 0.45, y + h * 0.55],
        [x + w * 0.3, bottom],
        [right, y + h * 0.4],
        [x + w * 0.55, y + h * 0.4],
      ]);
    default:
      return null;
  }
}

/** Block arrow (body rectangle + triangular head) pointing in `dir`. */
function blockArrow(
  x: number,
  y: number,
  w: number,
  h: number,
  dir: 'right' | 'left' | 'up' | 'down',
): string {
  const right = x + w;
  const bottom = y + h;
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (dir === 'right' || dir === 'left') {
    const head = w * 0.4;
    const bodyT = h * 0.5;
    const ty = cy - bodyT / 2;
    const by = cy + bodyT / 2;
    if (dir === 'right') {
      return poly([
        [x, ty],
        [right - head, ty],
        [right - head, y],
        [right, cy],
        [right - head, bottom],
        [right - head, by],
        [x, by],
      ]);
    }
    return poly([
      [right, ty],
      [x + head, ty],
      [x + head, y],
      [x, cy],
      [x + head, bottom],
      [x + head, by],
      [right, by],
    ]);
  }
  const head = h * 0.4;
  const bodyT = w * 0.5;
  const lx = cx - bodyT / 2;
  const rxp = cx + bodyT / 2;
  if (dir === 'down') {
    return poly([
      [lx, y],
      [rxp, y],
      [rxp, bottom - head],
      [right, bottom - head],
      [cx, bottom],
      [x, bottom - head],
      [lx, bottom - head],
    ]);
  }
  return poly([
    [lx, bottom],
    [rxp, bottom],
    [rxp, y + head],
    [right, y + head],
    [cx, y],
    [x, y + head],
    [lx, y + head],
  ]);
}

// ============================================
// End markers
// ============================================

/**
 * The `<marker>` path for a line end-style, in the 0–10 marker viewBox.
 * `dir` selects orientation (`end` points along +x; `start` is mirrored).
 * Returns null for `'none'`. `filled` shapes paint with the stroke color;
 * non-filled (`open`) draw as a stroked outline.
 */
export function markerPath(
  style: MarkerStyle,
  dir: 'start' | 'end',
): { d: string; filled: boolean } | null {
  const mirror = dir === 'start';
  const mx = (n: number) => (mirror ? 10 - n : n);
  const tri = (closed: boolean) => `M ${mx(0)} 0 L ${mx(10)} 5 L ${mx(0)} 10${closed ? ' z' : ''}`;
  switch (style) {
    case 'arrow':
      return { d: tri(true), filled: true };
    case 'open':
      return { d: tri(false), filled: false };
    case 'diamond':
      return { d: 'M 0 5 L 5 0 L 10 5 L 5 10 z', filled: true };
    case 'square':
      return { d: 'M 1 1 L 9 1 L 9 9 L 1 9 z', filled: true };
    case 'circle':
      return { d: 'M 0 5 A 5 5 0 1 0 10 5 A 5 5 0 1 0 0 5 z', filled: true };
    case 'none':
    default:
      return null;
  }
}

// ============================================
// Connector routing
// ============================================

export interface ClipBox {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export type ConnectorPort =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left';

export interface ConnectorSnapPoint {
  port: ConnectorPort;
  x: number;
  y: number;
}

/** Intersection of the center-to-center line with `from`'s bounding box. */
export function clipPoint(from: ClipBox, to: ClipBox): { x: number; y: number } {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy };
  const sx = Math.abs(dx) > 0 ? from.rx / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 0 ? from.ry / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: from.cx + dx * s, y: from.cy + dy * s };
}

/** Clip both endpoints of an edge to the two shapes it joins. */
export function clipEndpoints(
  a: ClipBox,
  b: ClipBox,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  return { start: clipPoint(a, b), end: clipPoint(b, a) };
}

/** The stable connector ports exposed around a shape/card box. */
export function snapPoints(box: ClipBox): ConnectorSnapPoint[] {
  const left = box.cx - box.rx;
  const right = box.cx + box.rx;
  const top = box.cy - box.ry;
  const bottom = box.cy + box.ry;
  return [
    { port: 'top', x: box.cx, y: top },
    { port: 'right', x: right, y: box.cy },
    { port: 'bottom', x: box.cx, y: bottom },
    { port: 'left', x: left, y: box.cy },
    { port: 'top-left', x: left, y: top },
    { port: 'top-right', x: right, y: top },
    { port: 'bottom-right', x: right, y: bottom },
    { port: 'bottom-left', x: left, y: bottom },
  ];
}

/** Nearest stable connector port on `box` to an arbitrary point. */
export function nearestSnapPoint(box: ClipBox, point: { x: number; y: number }): ConnectorSnapPoint {
  let best = snapPoints(box)[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of snapPoints(box)) {
    const score = distanceSq(candidate, point) + portTieBreak(candidate.port);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Pick the pair of connector ports, one on each box, with the shortest
 * distance between them. This gives stable attachments to side/corner handles
 * instead of arbitrary center-ray intersections.
 */
export function snapEndpoints(
  a: ClipBox,
  b: ClipBox,
): { start: ConnectorSnapPoint; end: ConnectorSnapPoint } {
  let bestStart = snapPoints(a)[0];
  let bestEnd = snapPoints(b)[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const start of snapPoints(a)) {
    for (const end of snapPoints(b)) {
      const score = distanceSq(start, end) + portTieBreak(start.port) + portTieBreak(end.port);
      if (score < bestScore) {
        bestStart = start;
        bestEnd = end;
        bestScore = score;
      }
    }
  }
  return { start: bestStart, end: bestEnd };
}

function distanceSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function portTieBreak(port: ConnectorPort): number {
  return port.includes('-') ? 0.02 : 0;
}

/** Build the SVG `d` for a connector between two clipped endpoints. */
export function connectorPath(
  routing: ConnectorRouting,
  start: { x: number; y: number },
  end: { x: number; y: number },
): string {
  if (routing === 'straight') {
    return `M ${r(start.x)} ${r(start.y)} L ${r(end.x)} ${r(end.y)}`;
  }
  if (routing === 'orthogonal') {
    const midX = (start.x + end.x) / 2;
    return `M ${r(start.x)} ${r(start.y)} L ${r(midX)} ${r(start.y)} L ${r(midX)} ${r(end.y)} L ${r(end.x)} ${r(end.y)}`;
  }
  // curved
  const dx = Math.abs(end.x - start.x);
  const cp = Math.max(40, dx / 2);
  return `M ${r(start.x)} ${r(start.y)} C ${r(start.x + cp)} ${r(start.y)}, ${r(end.x - cp)} ${r(end.y)}, ${r(end.x)} ${r(end.y)}`;
}

/** Map a `lineStyle` (solid|dashed|dotted) to an SVG `stroke-dasharray`. */
export function lineStyleDasharray(style: string | undefined): string | undefined {
  switch (style?.toLowerCase()) {
    case 'dashed':
    case 'dash':
      return '8 6';
    case 'dotted':
    case 'dot':
      return '2 6';
    default:
      return undefined;
  }
}

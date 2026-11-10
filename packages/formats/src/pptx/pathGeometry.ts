/**
 * SVG path data → DrawingML custom geometry.
 *
 * A slide's `path` layers carry SVG path data in canvas pixels: a pie
 * chart's wedges, a line chart's series, a diagram's curved connectors, the
 * arcs of a cycle, the tiers of a pyramid. PowerPoint draws none of those
 * from a preset shape, so each becomes a `custGeom` whose path list repeats
 * the same moves, lines and curves — a real, editable, recolourable shape
 * rather than a picture of one.
 *
 * `parseSvgPath` reduces every SVG command (relative forms, the `H`/`V`
 * shorthands, smooth curves, elliptical arcs) to absolute moves, lines,
 * cubic and quadratic curves and closes; arcs are split into cubic segments
 * of at most a quarter turn, which is as close as any renderer draws them.
 *
 * Related: `export.ts` (`buildPathLayerShapes`), core `doc/utils/shapeGeometry.ts`.
 */

/** One absolute drawing command. */
export type PathSegment =
  | { op: 'M' | 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Q'; x1: number; y1: number; x: number; y: number }
  | { op: 'Z' };

/** How many numbers each SVG command consumes per repetition. */
const ARITY: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/**
 * An SVG elliptical arc from the current point as cubic curves (the endpoint
 * parameterization of SVG 1.1 §F.6, converted to centre form and split into
 * segments of at most 90°).
 */
function arcToCubics(
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  x: number,
  y: number,
): PathSegment[] {
  if ((x0 === x && y0 === y) || !Number.isFinite(rx + ry)) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  // A zero radius degenerates to a straight line (§F.6.2).
  if (rx === 0 || ry === 0) return [{ op: 'L', x, y }];
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  // Radii too small to span the endpoints are scaled up until they do (§F.6.6).
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / (denominator || 1)));
  const cxp = (factor * rx * y1) / ry;
  const cyp = (-factor * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return turn;
  };
  const start = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / pieces;
  const handle = (4 / 3) * Math.tan(step / 4);
  const point = (theta: number): [number, number] => [
    cx + rx * Math.cos(theta) * cos - ry * Math.sin(theta) * sin,
    cy + rx * Math.cos(theta) * sin + ry * Math.sin(theta) * cos,
  ];
  const tangent = (theta: number): [number, number] => [
    -rx * Math.sin(theta) * cos - ry * Math.cos(theta) * sin,
    -rx * Math.sin(theta) * sin + ry * Math.cos(theta) * cos,
  ];
  const segments: PathSegment[] = [];
  for (let i = 0; i < pieces; i++) {
    const from = start + step * i;
    const to = from + step;
    const [px, py] = point(from);
    const [qx, qy] = point(to);
    const [tx0, ty0] = tangent(from);
    const [tx1, ty1] = tangent(to);
    segments.push({
      op: 'C',
      x1: px + handle * tx0,
      y1: py + handle * ty0,
      x2: qx - handle * tx1,
      y2: qy - handle * ty1,
      // The last piece ends exactly on the authored endpoint.
      x: i === pieces - 1 ? x : qx,
      y: i === pieces - 1 ? y : qy,
    });
  }
  return segments;
}

/**
 * Parse SVG path data into absolute segments. Returns `null` for data that
 * is not a path at all (no leading move, a malformed number, an unknown
 * command), so the caller can fall back rather than draw a broken shape.
 */
export function parseSvgPath(d: string): PathSegment[] | null {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu);
  if (!tokens || !/^[Mm]$/u.test(tokens[0]!)) return null;
  const segments: PathSegment[] = [];
  let [cx, cy] = [0, 0];
  let [startX, startY] = [0, 0];
  /** The previous curve's far control point, for the smooth `S`/`T` forms. */
  let control: { kind: 'C' | 'Q'; x: number; y: number } | undefined;
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++]!;
    const upper = command.toUpperCase();
    const arity = ARITY[upper];
    if (arity === undefined || !/^[a-zA-Z]$/u.test(command)) return null;
    const relative = command !== upper;
    if (upper === 'Z') {
      segments.push({ op: 'Z' });
      [cx, cy] = [startX, startY];
      control = undefined;
      continue;
    }
    let first = true;
    // A command repeats for as long as numbers follow it.
    while (first || (index < tokens.length && !/^[a-zA-Z]$/u.test(tokens[index]!))) {
      const numbers = tokens.slice(index, index + arity).map(Number);
      if (numbers.length < arity || numbers.some((value) => !Number.isFinite(value))) return null;
      index += arity;
      const [ox, oy] = relative ? [cx, cy] : [0, 0];
      let next: typeof control;
      switch (upper) {
        case 'M': {
          [cx, cy] = [ox + numbers[0]!, oy + numbers[1]!];
          // Coordinates after the first pair of a move are implicit lines.
          if (first) {
            segments.push({ op: 'M', x: cx, y: cy });
            [startX, startY] = [cx, cy];
          } else segments.push({ op: 'L', x: cx, y: cy });
          break;
        }
        case 'L':
          [cx, cy] = [ox + numbers[0]!, oy + numbers[1]!];
          segments.push({ op: 'L', x: cx, y: cy });
          break;
        case 'H':
          cx = ox + numbers[0]!;
          segments.push({ op: 'L', x: cx, y: cy });
          break;
        case 'V':
          cy = oy + numbers[0]!;
          segments.push({ op: 'L', x: cx, y: cy });
          break;
        case 'C':
        case 'S': {
          const smooth = upper === 'S';
          const x1 = smooth ? (control?.kind === 'C' ? 2 * cx - control.x : cx) : ox + numbers[0]!;
          const y1 = smooth ? (control?.kind === 'C' ? 2 * cy - control.y : cy) : oy + numbers[1]!;
          const rest = numbers.slice(smooth ? 0 : 2);
          const [x2, y2, x, y] = [ox + rest[0]!, oy + rest[1]!, ox + rest[2]!, oy + rest[3]!];
          segments.push({ op: 'C', x1, y1, x2, y2, x, y });
          next = { kind: 'C', x: x2, y: y2 };
          [cx, cy] = [x, y];
          break;
        }
        case 'Q':
        case 'T': {
          const smooth = upper === 'T';
          const x1 = smooth ? (control?.kind === 'Q' ? 2 * cx - control.x : cx) : ox + numbers[0]!;
          const y1 = smooth ? (control?.kind === 'Q' ? 2 * cy - control.y : cy) : oy + numbers[1]!;
          const rest = numbers.slice(smooth ? 0 : 2);
          const [x, y] = [ox + rest[0]!, oy + rest[1]!];
          segments.push({ op: 'Q', x1, y1, x, y });
          next = { kind: 'Q', x: x1, y: y1 };
          [cx, cy] = [x, y];
          break;
        }
        case 'A': {
          const [x, y] = [ox + numbers[5]!, oy + numbers[6]!];
          segments.push(
            ...arcToCubics(
              cx,
              cy,
              numbers[0]!,
              numbers[1]!,
              numbers[2]!,
              numbers[3] !== 0,
              numbers[4] !== 0,
              x,
              y,
            ),
          );
          [cx, cy] = [x, y];
          break;
        }
      }
      control = next;
      first = false;
    }
  }
  return segments;
}

/** The box that holds every point (and curve handle) of a path. */
export function pathBounds(segments: readonly PathSegment[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const segment of segments) {
    if (segment.op === 'Z') continue;
    xs.push(segment.x);
    ys.push(segment.y);
    if (segment.op === 'C' || segment.op === 'Q') {
      xs.push(segment.x1);
      ys.push(segment.y1);
    }
    if (segment.op === 'C') {
      xs.push(segment.x2);
      ys.push(segment.y2);
    }
  }
  if (!xs.length) return null;
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Whether a path is one straight stroke: every point on the line from its
 * first to its last. PowerPoint draws that as a `line` preset, which keeps
 * arrowheads crisp and the shape a connector people can grab by its ends.
 */
export function isStraightLine(segments: readonly PathSegment[]): boolean {
  const points = segments.filter((segment) => segment.op !== 'Z');
  if (points.length < 2 || points.length !== segments.length) return false;
  if (points.some((segment) => segment.op === 'C' || segment.op === 'Q')) return false;
  const first = points[0] as { x: number; y: number };
  const last = points[points.length - 1] as { x: number; y: number };
  const [dx, dy] = [last.x - first.x, last.y - first.y];
  const length = Math.hypot(dx, dy);
  if (length === 0) return false;
  return points.every((segment) => {
    const point = segment as { x: number; y: number };
    return Math.abs((point.x - first.x) * dy - (point.y - first.y) * dx) / length < 0.5;
  });
}

/**
 * A path as `a:custGeom`, in a coordinate space of `scale` units to the
 * canvas pixel with its origin at the path's bounds. `filled` is false for an
 * open stroke, which must not be closed and flooded by the shape's fill.
 */
export function customGeometryXml(
  segments: readonly PathSegment[],
  bounds: { x: number; y: number; width: number; height: number },
  scale: number,
  filled: boolean,
): string {
  const unit = (value: number, origin: number) => Math.round((value - origin) * scale);
  const pt = (x: number, y: number) => `<a:pt x="${unit(x, bounds.x)}" y="${unit(y, bounds.y)}"/>`;
  const body = segments
    .map((segment) => {
      switch (segment.op) {
        case 'M':
          return `<a:moveTo>${pt(segment.x, segment.y)}</a:moveTo>`;
        case 'L':
          return `<a:lnTo>${pt(segment.x, segment.y)}</a:lnTo>`;
        case 'C':
          return `<a:cubicBezTo>${pt(segment.x1, segment.y1)}${pt(segment.x2, segment.y2)}${pt(segment.x, segment.y)}</a:cubicBezTo>`;
        case 'Q':
          return `<a:quadBezTo>${pt(segment.x1, segment.y1)}${pt(segment.x, segment.y)}</a:quadBezTo>`;
        case 'Z':
          return '<a:close/>';
      }
    })
    .join('');
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  return (
    `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>` +
    `<a:rect l="0" t="0" r="r" b="b"/>` +
    `<a:pathLst><a:path w="${width}" h="${height}"${filled ? '' : ' fill="none"'}>${body}</a:path></a:pathLst>` +
    `</a:custGeom>`
  );
}

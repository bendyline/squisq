/**
 * SVG path geometry for chart marks. All coordinates are absolute
 * viewport pixels, matching the PathLayer `d` contract.
 *
 * Angle convention for arcs: degrees clockwise from 12 o'clock (the
 * familiar pie-chart orientation).
 */

export interface ChartPoint {
  x: number;
  y: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Point on a circle at `deg` clockwise from 12 o'clock. */
export function pointOnCircle(cx: number, cy: number, r: number, deg: number): ChartPoint {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: round(cx + r * Math.cos(rad)), y: round(cy + r * Math.sin(rad)) };
}

/**
 * Pie wedge (rInner = 0) or donut sector path from startDeg to endDeg
 * (clockwise). A full-circle sweep is clamped just under 360° — a single
 * SVG arc with coincident endpoints renders as nothing.
 */
export function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number,
): string {
  let sweep = endDeg - startDeg;
  if (sweep <= 0) return '';
  // Clamp far enough under 360° that the endpoints stay distinct after
  // 2-decimal coordinate rounding, even at small radii.
  if (sweep >= 359.9) sweep = 359.9;
  const end = startDeg + sweep;
  const largeArc = sweep > 180 ? 1 : 0;

  const o1 = pointOnCircle(cx, cy, rOuter, startDeg);
  const o2 = pointOnCircle(cx, cy, rOuter, end);

  if (rInner <= 0) {
    return [
      `M ${round(cx)} ${round(cy)}`,
      `L ${o1.x} ${o1.y}`,
      `A ${round(rOuter)} ${round(rOuter)} 0 ${largeArc} 1 ${o2.x} ${o2.y}`,
      'Z',
    ].join(' ');
  }

  const i1 = pointOnCircle(cx, cy, rInner, startDeg);
  const i2 = pointOnCircle(cx, cy, rInner, end);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${round(rOuter)} ${round(rOuter)} 0 ${largeArc} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${round(rInner)} ${round(rInner)} 0 ${largeArc} 0 ${i1.x} ${i1.y}`,
    'Z',
  ].join(' ');
}

/** Open polyline through the given points. */
export function polylinePath(points: ChartPoint[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ');
}

/** Closed region under a polyline, dropped to `baselineY`. */
export function areaPath(points: ChartPoint[], baselineY: number): string {
  if (points.length === 0) return '';
  const open = polylinePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${open} L ${round(last.x)} ${round(baselineY)} L ${round(first.x)} ${round(baselineY)} Z`;
}

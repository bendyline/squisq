/**
 * Drawing helpers for routed edges: an SVG path with rounded corners, and
 * points along a polyline for labels and arrowheads.
 */

import type { Point } from './types.js';

export interface PolylinePathOptions {
  /** Corner radius; each corner is cut to at most half of its shorter leg. Default 0. */
  radius?: number;
  /** Decimal places in the output. Default 2. */
  precision?: number;
}

/** An SVG path `d` for the polyline, corners rounded when `radius` is set. */
export function polylinePath(points: readonly Point[], options: PolylinePathOptions = {}): string {
  if (points.length === 0) return '';
  const radius = Math.max(0, options.radius ?? 0);
  const scale = 10 ** (options.precision ?? 2);
  const f = (v: number): string => String(Math.round(v * scale) / scale);
  const parts = [`M${f(points[0]!.x)} ${f(points[0]!.y)}`];
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const next = points[i + 1];
    if (radius === 0 || !next) {
      parts.push(`L${f(p.x)} ${f(p.y)}`);
      continue;
    }
    const prev = points[i - 1]!;
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0) {
      parts.push(`L${f(p.x)} ${f(p.y)}`);
      continue;
    }
    const ax = p.x + ((prev.x - p.x) / inLen) * r;
    const ay = p.y + ((prev.y - p.y) / inLen) * r;
    const bx = p.x + ((next.x - p.x) / outLen) * r;
    const by = p.y + ((next.y - p.y) / outLen) * r;
    parts.push(`L${f(ax)} ${f(ay)}`, `Q${f(p.x)} ${f(p.y)} ${f(bx)} ${f(by)}`);
  }
  return parts.join(' ');
}

export function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return length;
}

export interface PolylinePoint extends Point {
  /** Direction of travel at this point, in degrees clockwise from +x. */
  angle: number;
}

/** The point a `fraction` (0–1) of the way along the polyline. */
export function pointAlongPolyline(points: readonly Point[], fraction: number): PolylinePoint {
  if (points.length === 0) return { x: 0, y: 0, angle: 0 };
  if (points.length === 1) return { ...points[0]!, angle: 0 };
  const target = polylineLength(points) * Math.min(1, Math.max(0, fraction));
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    if (walked + len >= target || i === points.length - 1) {
      const t = Math.min(1, (target - walked) / len);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    }
    walked += len;
  }
  const last = points[points.length - 1]!;
  return { ...last, angle: 0 };
}

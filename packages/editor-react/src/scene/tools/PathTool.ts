/**
 * PathTool — drag to draw a freehand path.
 *
 * Captures pointer samples on move; on release, simplifies the polyline
 * into a smooth cubic bezier sequence (a one-pass Catmull–Rom-style
 * pass) and dispatches an `addLayer` for a new PathLayer.
 *
 * v1 emits an open path (no Z). Closed paths can be added by a later
 * tool variant or via the SelectTool's properties panel.
 */

import { createElement, type JSX } from 'react';
import type { PathLayer } from '@bendyline/squisq/schemas';
import type { SceneTool } from './SceneTool';
import { serializePath, type ParsedPath, type PathPoint } from '../paths/bezierEdit';

interface PathToolOptions {
  /** Stroke color. Default '#1e293b'. */
  stroke?: string;
  /** Stroke width. Default 2. */
  strokeWidth?: number;
  /** Minimum distance (viewport units) between captured samples. */
  sampleDistance?: number;
  /** Override id / label / shortcut. */
  id?: string;
  label?: string;
  shortcut?: string;
}

export function createPathTool(options: PathToolOptions = {}): SceneTool {
  const stroke = options.stroke ?? '#1e293b';
  const strokeWidth = options.strokeWidth ?? 2;
  const sampleDistance = options.sampleDistance ?? 4;

  let samples: { x: number; y: number }[] | null = null;

  function pointer(e: React.PointerEvent): { sx: number; sy: number } {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  return {
    id: options.id ?? 'path',
    label: options.label ?? 'Pen',
    cursor: 'crosshair',
    shortcut: options.shortcut ?? 'p',

    onPointerDown(e, ctx) {
      if (e.button !== 0) return;
      const { sx, sy } = pointer(e);
      const v = ctx.screenToViewport(sx, sy);
      samples = [v];
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },

    onPointerMove(e, ctx) {
      if (!samples) return;
      const { sx, sy } = pointer(e);
      const v = ctx.screenToViewport(sx, sy);
      const last = samples[samples.length - 1];
      if (Math.hypot(v.x - last.x, v.y - last.y) >= sampleDistance) samples.push(v);
    },

    onPointerUp(e, ctx) {
      if (!samples) return;
      const captured = samples;
      samples = null;
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      if (captured.length < 2) return;
      const parsed = smoothPolyline(captured);
      const d = serializePath(parsed);
      const bounds = polylineBounds(captured);
      const layer: PathLayer = {
        id: `path-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        type: 'path',
        position: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
        content: {
          d,
          stroke,
          strokeWidth,
          fill: 'none',
        },
      };
      ctx.dispatch({ kind: 'addLayer', layer });
      ctx.setActiveTool?.('select');
    },

    renderOverlay(): JSX.Element | null {
      if (!samples || samples.length < 2) return null;
      // Live polyline — cheaper than re-smoothing on every move.
      const d = polylineToD(samples);
      return createElement('path', {
        key: 'path-preview',
        d,
        className: 'squisq-scene-connect-preview',
        fill: 'none',
      });
    },
  };
}

function polylineToD(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  const parts = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 1; i < pts.length; i++) parts.push(`L ${pts[i].x} ${pts[i].y}`);
  return parts.join(' ');
}

/**
 * Catmull–Rom → cubic bezier conversion. Each interior segment becomes a
 * C with control points derived from the surrounding samples, producing
 * a smooth curve that passes through every input point. Endpoints reuse
 * the adjacent sample as a virtual control.
 */
function smoothPolyline(pts: { x: number; y: number }[]): ParsedPath {
  if (pts.length === 0) return { points: [], closed: false };
  if (pts.length === 1) return { points: [{ kind: 'move', x: pts[0].x, y: pts[0].y }], closed: false };
  const points: PathPoint[] = [{ kind: 'move', x: pts[0].x, y: pts[0].y }];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const tension = 6;
    const cp1 = { x: p1.x + (p2.x - p0.x) / tension, y: p1.y + (p2.y - p0.y) / tension };
    const cp2 = { x: p2.x - (p3.x - p1.x) / tension, y: p2.y - (p3.y - p1.y) / tension };
    // Attach cpOut to the previous point and cpIn to the new point.
    const prev = points[points.length - 1];
    if (prev) prev.cpOut = cp1;
    points.push({ kind: 'curve', x: p2.x, y: p2.y, cpIn: cp2 });
  }
  return { points, closed: false };
}

function polylineBounds(pts: { x: number; y: number }[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

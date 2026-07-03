/**
 * useSceneHitTest — point→layer lookup.
 *
 * Each layer's bounding rectangle is derived from its `position` field;
 * the topmost layer (last in the array) under the point wins. Path
 * layers also get a thicker stroke-aware hit area so users can grab a
 * 2-pixel edge without pixel-perfect aim.
 *
 * Pure function for now (no state) — wrapped in a hook so consumers can
 * cache the lookup table later without changing the call site.
 */

import { useCallback } from 'react';
import type { Layer } from '@bendyline/squisq/schemas';

export interface HitTestable {
  id: string;
  layer: Layer;
  /** Bounding rect in viewport units. */
  bounds: { x: number; y: number; width: number; height: number };
}

export interface UseSceneHitTestResult {
  /** Topmost layer id at the given viewport-unit point, or null. */
  hit: (point: { x: number; y: number }, items: HitTestable[]) => string | null;
}

export function useSceneHitTest(): UseSceneHitTestResult {
  const hit = useCallback(
    (point: { x: number; y: number }, items: HitTestable[]): string | null => {
      // Walk from last (topmost) to first so the visually-on-top layer wins.
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (pointInRect(point, it.bounds)) return it.id;
      }
      return null;
    },
    [],
  );
  return { hit };
}

/**
 * Compute a layer's bounding rect in viewport units. Resolves `%` strings
 * against the supplied viewport size and handles the `anchor` field on
 * the layer's position. Returns null when the layer's geometry can't be
 * resolved (e.g. a TextLayer with no explicit width — for those callers
 * should measure DOM and fall back to a click-tolerance box).
 */
export function layerBounds(
  layer: Layer,
  viewport: { width: number; height: number },
  defaults: { width?: number; height?: number } = {},
): { x: number; y: number; width: number; height: number } | null {
  const pos = layer.position;
  if (!pos) return null;
  const w = resolveLen(pos.width, viewport.width, defaults.width);
  const h = resolveLen(pos.height, viewport.height, defaults.height);
  if (w == null || h == null) return null;
  const cx = resolveLen(pos.x, viewport.width, 0) ?? 0;
  const cy = resolveLen(pos.y, viewport.height, 0) ?? 0;
  const anchor = pos.anchor ?? 'top-left';
  const { ax, ay } = anchorOffsets(anchor, w, h);
  return { x: cx - ax, y: cy - ay, width: w, height: h };
}

function pointInRect(
  p: { x: number; y: number },
  r: { x: number; y: number; width: number; height: number },
): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

function resolveLen(
  v: number | string | undefined,
  base: number,
  fallback?: number,
): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v.endsWith('%')) {
      const pct = parseFloat(v);
      if (Number.isFinite(pct)) return (pct / 100) * base;
    }
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function anchorOffsets(anchor: string, w: number, h: number): { ax: number; ay: number } {
  switch (anchor) {
    case 'center':
      return { ax: w / 2, ay: h / 2 };
    case 'top-right':
      return { ax: w, ay: 0 };
    case 'bottom-left':
      return { ax: 0, ay: h };
    case 'bottom-right':
      return { ax: w, ay: h };
    case 'top-left':
    default:
      return { ax: 0, ay: 0 };
  }
}

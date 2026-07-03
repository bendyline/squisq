/**
 * createDrawShapeTool — drag to draw the currently-pending shape kind.
 *
 * Generalizes `ShapeTool` to any kind in the drawing vocabulary. The pending
 * kind is read on demand (set by the ShapePalette), and committing calls back
 * to the host with the kind + bounding box so the adapter can insert a
 * `{[kind …]}` heading. The live preview renders the actual shape geometry.
 */

import { createElement, type JSX } from 'react';
import { shapePath } from '@bendyline/squisq/doc';
import type { SceneTool } from './SceneTool';

export interface DrawShapeOptions {
  /** The kind to draw, or null when none is pending (tool is inert). */
  getKind: () => string | null;
  /** Commit a drawn shape. */
  onDraw: (kind: string, box: { x: number; y: number; width: number; height: number }) => void;
}

export function createDrawShapeTool(options: DrawShapeOptions): SceneTool {
  let drag: { start: { x: number; y: number }; current: { x: number; y: number } } | null = null;

  function pointer(e: React.PointerEvent): { sx: number; sy: number } {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  function box(): { x: number; y: number; width: number; height: number } {
    const a = drag!.start;
    const b = drag!.current;
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  }

  return {
    id: 'draw',
    label: 'Shape',
    cursor: 'crosshair',

    onPointerDown(e, ctx) {
      if (e.button !== 0 || !options.getKind()) return;
      const { sx, sy } = pointer(e);
      const v = ctx.screenToViewport(sx, sy);
      drag = { start: v, current: v };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },

    onPointerMove(e, ctx) {
      if (!drag) return;
      const { sx, sy } = pointer(e);
      drag.current = ctx.screenToViewport(sx, sy);
    },

    onPointerUp(e, ctx) {
      if (!drag) return;
      const b = box();
      const kind = options.getKind();
      drag = null;
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      if (kind && b.width >= 4 && b.height >= 4) options.onDraw(kind, b);
      ctx.setActiveTool?.('select');
    },

    renderOverlay(): JSX.Element | null {
      if (!drag) return null;
      const b = box();
      const kind = options.getKind();
      const d = kind ? shapePath(kind, b.x, b.y, b.width, b.height) : null;
      return createElement('path', {
        key: 'draw-preview',
        d: d ?? `M ${b.x} ${b.y} h ${b.width} v ${b.height} h ${-b.width} Z`,
        className: 'squisq-scene-connect-preview',
        fill: 'none',
      });
    },
  };
}

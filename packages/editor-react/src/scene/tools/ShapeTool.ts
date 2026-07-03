/**
 * ShapeTool — drag to draw a rectangle or circle as a new ShapeLayer.
 *
 * Exposed as a factory so a host can pre-bind the shape kind and
 * stroke/fill defaults. Returns a fresh SceneTool instance — the
 * factory pattern lets multiple Scene instances coexist without
 * sharing module-level drag state.
 */

import { createElement, type JSX } from 'react';
import type { ShapeLayer } from '@bendyline/squisq/schemas';
import type { SceneTool } from './SceneTool';

interface ShapeToolOptions {
  /** Shape kind. Default 'rect'. */
  shape?: 'rect' | 'circle' | 'line';
  /** Stroke color. Default '#1e293b'. */
  stroke?: string;
  /** Fill color (or 'none' for an outline-only shape). Default 'none'. */
  fill?: string;
  /** Stroke width in viewport units. Default 2. */
  strokeWidth?: number;
  /** Corner radius for rects. Default 6. */
  borderRadius?: number;
  /** Override the tool id (default 'shape'). */
  id?: string;
  /** Override the tool label. */
  label?: string;
  /** Keyboard shortcut (single char, lowercase). */
  shortcut?: string;
}

export function createShapeTool(options: ShapeToolOptions = {}): SceneTool {
  const shape = options.shape ?? 'rect';
  const stroke = options.stroke ?? '#1e293b';
  const fill = options.fill ?? 'none';
  const strokeWidth = options.strokeWidth ?? 2;
  const borderRadius = options.borderRadius ?? 6;

  interface DragState {
    startV: { x: number; y: number };
    currentV: { x: number; y: number };
  }
  let drag: DragState | null = null;

  function pointer(e: React.PointerEvent): { sx: number; sy: number } {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  return {
    id: options.id ?? `shape-${shape}`,
    label: options.label ?? `${shape[0].toUpperCase()}${shape.slice(1)}`,
    cursor: 'crosshair',
    shortcut: options.shortcut,

    onPointerDown(e, ctx) {
      if (e.button !== 0) return;
      const { sx, sy } = pointer(e);
      const v = ctx.screenToViewport(sx, sy);
      drag = { startV: v, currentV: v };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },

    onPointerMove(e, ctx) {
      if (!drag) return;
      const { sx, sy } = pointer(e);
      drag.currentV = ctx.screenToViewport(sx, sy);
    },

    onPointerUp(e, ctx) {
      if (!drag) return;
      const box = boxFromCorners(drag.startV, drag.currentV);
      drag = null;
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      // Ignore micro-drags that are probably an accidental click.
      if (box.width < 4 || box.height < 4) return;
      const layer: ShapeLayer = {
        id: `shape-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        type: 'shape',
        position: { x: box.x, y: box.y, width: box.width, height: box.height },
        content: {
          shape,
          fill,
          stroke,
          strokeWidth,
          ...(shape === 'rect' ? { borderRadius } : {}),
        },
      };
      ctx.dispatch({ kind: 'addLayer', layer });
      // Switch back to Select so the user can immediately move the new shape.
      ctx.setActiveTool?.('select');
    },

    renderOverlay(): JSX.Element | null {
      if (!drag) return null;
      const box = boxFromCorners(drag.startV, drag.currentV);
      if (shape === 'circle') {
        const r = Math.min(box.width, box.height) / 2;
        return createElement('circle', {
          key: 'shape-preview',
          cx: box.x + box.width / 2,
          cy: box.y + box.height / 2,
          r,
          className: 'squisq-scene-connect-preview',
          fill: 'none',
        });
      }
      if (shape === 'line') {
        return createElement('line', {
          key: 'shape-preview',
          x1: drag.startV.x,
          y1: drag.startV.y,
          x2: drag.currentV.x,
          y2: drag.currentV.y,
          className: 'squisq-scene-connect-preview',
        });
      }
      return createElement('rect', {
        key: 'shape-preview',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        rx: borderRadius,
        ry: borderRadius,
        className: 'squisq-scene-connect-preview',
        fill: 'none',
      });
    },
  };
}

function boxFromCorners(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

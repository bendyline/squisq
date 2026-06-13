/**
 * DrawingConnectTool — create and re-target connectors between shapes.
 *
 * Mirrors `ConnectTool` but works on drawing shape layers (`dshape-<id>`)
 * and supports two gestures:
 *  - Press empty-on a shape, drag to another shape, release → `addEdge`.
 *  - Press on a selected connector's endpoint handle, drag to a shape,
 *    release → re-target that endpoint (via the `onRetarget` callback,
 *    since the generic SceneCommand vocabulary has no retarget command).
 *
 * Current edges / selection / shape boxes change every render, so the
 * host passes `endpointAt` (reads the live selected-edge handles) rather
 * than baking them into the memoized tool.
 */

import { createElement, type JSX } from 'react';
import type { SceneTool, SceneToolContext } from './SceneTool';
import { shapeIdFromLayerId, isPrimaryShapeLayer } from '../layers/shapeLayers';

/** A grab on the selected connector's endpoint handle. */
export interface EndpointHit {
  connectorId: string;
  /** Which end the handle controls. */
  end: 'from' | 'to';
  /** The shape id of the *other* (fixed) endpoint — anchors the drag. */
  fixedShapeId: string;
}

export interface DrawingConnectOptions {
  /** Endpoint handle (of the selected connector) near `point`, if any. */
  endpointAt?: (point: { x: number; y: number }) => EndpointHit | null;
  /** Commit an endpoint re-target. */
  onRetarget?: (connectorId: string, end: 'from' | 'to', newTargetId: string) => void;
}

type DragState =
  | {
      mode: 'new';
      sourceId: string;
      anchor: { x: number; y: number };
      current: { x: number; y: number };
      hovered: string | null;
    }
  | {
      mode: 'retarget';
      connectorId: string;
      end: 'from' | 'to';
      fixedShapeId: string;
      anchor: { x: number; y: number };
      current: { x: number; y: number };
      hovered: string | null;
    };

export function createDrawingConnectTool(options: DrawingConnectOptions = {}): SceneTool {
  let drag: DragState | null = null;

  function pointer(e: React.PointerEvent): { sx: number; sy: number } {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  function shapeCenter(ctx: SceneToolContext, shapeId: string): { x: number; y: number } | null {
    const it = ctx.hitItems.find((h) => h.id === `dshape-${shapeId}`);
    if (!it) return null;
    return { x: it.bounds.x + it.bounds.width / 2, y: it.bounds.y + it.bounds.height / 2 };
  }

  function shapeAt(ctx: SceneToolContext, v: { x: number; y: number }): string | null {
    const hitId = ctx.hit(v);
    if (!hitId || !isPrimaryShapeLayer(hitId)) return null;
    return shapeIdFromLayerId(hitId);
  }

  return {
    id: 'connect',
    label: 'Connect',
    cursor: 'crosshair',
    shortcut: 'c',

    onPointerDown(e, ctx) {
      if (e.button !== 0) return;
      const { sx, sy } = pointer(e);
      const v = ctx.screenToViewport(sx, sy);

      // Endpoint handle of the selected connector → re-target gesture.
      const ep = options.endpointAt?.(v);
      if (ep) {
        const anchor = shapeCenter(ctx, ep.fixedShapeId) ?? v;
        drag = {
          mode: 'retarget',
          connectorId: ep.connectorId,
          end: ep.end,
          fixedShapeId: ep.fixedShapeId,
          anchor,
          current: v,
          hovered: null,
        };
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        e.stopPropagation();
        return;
      }

      // Otherwise start a new connection from the shape under the pointer.
      const src = shapeAt(ctx, v);
      if (!src) return;
      drag = { mode: 'new', sourceId: src, anchor: shapeCenter(ctx, src) ?? v, current: v, hovered: null };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      e.stopPropagation();
    },

    onPointerMove(e, ctx) {
      if (!drag) return;
      const { sx, sy } = pointer(e);
      const v = ctx.screenToViewport(sx, sy);
      drag.current = v;
      const tgt = shapeAt(ctx, v);
      const exclude = drag.mode === 'new' ? drag.sourceId : drag.fixedShapeId;
      drag.hovered = tgt && tgt !== exclude ? tgt : null;
    },

    onPointerUp(e, ctx) {
      if (!drag) return;
      const finished = drag;
      drag = null;
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      if (!finished.hovered) return;
      if (finished.mode === 'new') {
        ctx.dispatch({ kind: 'addEdge', source: finished.sourceId, target: finished.hovered });
      } else {
        options.onRetarget?.(finished.connectorId, finished.end, finished.hovered);
      }
    },

    renderOverlay(): JSX.Element | null {
      if (!drag) return null;
      const a = drag.anchor;
      const b = drag.current;
      return createElement(
        'g',
        { key: 'drawing-connect-preview' },
        createElement('path', {
          d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
          className: 'squisq-scene-connect-preview',
          fill: 'none',
        }),
        createElement('circle', {
          cx: b.x,
          cy: b.y,
          r: 4,
          className: 'squisq-scene-connect-preview',
        }),
      );
    },
  };
}

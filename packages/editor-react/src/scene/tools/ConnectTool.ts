/**
 * ConnectTool — drag from a diagram node to another to create an edge.
 *
 * Press on a node-card layer to anchor the connection start. While
 * dragging, render a dashed preview path from the source node's center
 * to the pointer. On release over a different node-card layer, dispatch
 * an `addEdge` command. Release elsewhere cancels.
 *
 * The tool reads the node descriptors from `ctx.edges`/`ctx.layers` —
 * not from a parallel data store — so it stays in sync with whatever
 * the DiagramAdapter just produced.
 */

import { createElement, type JSX } from 'react';
import type { SceneTool, SceneToolContext } from './SceneTool';
import { nodeIdFromCardLayerId } from '../layers/nodeCard';
import {
  curvedPath,
  edgeEndpoints,
  snapPointToward,
  type EdgeNodeBox,
} from '../layers/edgeGeometry';

interface ConnectState {
  sourceNodeId: string;
  /** Source node/card box in viewport units (cached at drag start). */
  sourceBox: EdgeNodeBox;
  /** Preview start/end in viewport units. */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Currently-hovered target node id, if any (for highlight + drop). */
  hoveredTargetId: string | null;
}

let state: ConnectState | null = null;

function pointerFromEvent(e: React.PointerEvent): { sx: number; sy: number } {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
}

function nodeBoxFromCard(ctx: SceneToolContext, nodeId: string): EdgeNodeBox | null {
  const card = ctx.hitItems.find((it) => it.id === `node-card-${nodeId}`);
  if (!card) return null;
  return {
    id: nodeId,
    x: card.bounds.x,
    y: card.bounds.y,
    width: card.bounds.width,
    height: card.bounds.height,
  };
}

function nodeBoxes(ctx: SceneToolContext): EdgeNodeBox[] {
  const boxes: EdgeNodeBox[] = [];
  for (const it of ctx.hitItems) {
    if (!it.id.startsWith('node-card-')) continue;
    const nodeId = nodeIdFromCardLayerId(it.id);
    if (!nodeId) continue;
    boxes.push({
      id: nodeId,
      x: it.bounds.x,
      y: it.bounds.y,
      width: it.bounds.width,
      height: it.bounds.height,
    });
  }
  return boxes;
}

function connectionPoints(box: EdgeNodeBox): Array<{ x: number; y: number }> {
  const width = box.width ?? 0;
  const height = box.height ?? 0;
  const left = box.x;
  const right = box.x + width;
  const top = box.y;
  const bottom = box.y + height;
  const centerX = box.x + width / 2;
  const centerY = box.y + height / 2;
  return [
    { x: centerX, y: top },
    { x: right, y: centerY },
    { x: centerX, y: bottom },
    { x: left, y: centerY },
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function updatePreview(
  sourceBox: EdgeNodeBox,
  current: { x: number; y: number },
  targetBox: EdgeNodeBox | null,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  if (targetBox) {
    return (
      edgeEndpoints([sourceBox, targetBox], sourceBox.id, targetBox.id) ?? {
        start: current,
        end: current,
      }
    );
  }
  return {
    start: snapPointToward([sourceBox], sourceBox.id, current) ?? current,
    end: current,
  };
}

export const ConnectTool: SceneTool = {
  id: 'connect',
  label: 'Connect',
  cursor: 'crosshair',
  shortcut: 'c',
  hideSelectionHandles: true,

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const { sx, sy } = pointerFromEvent(e);
    const v = ctx.screenToViewport(sx, sy);
    const hitId = ctx.hit(v);
    if (!hitId) return;
    const nodeId = nodeIdFromCardLayerId(hitId);
    if (!nodeId) return;
    const sourceBox = nodeBoxFromCard(ctx, nodeId);
    if (!sourceBox) return;
    const preview = updatePreview(sourceBox, v, null);
    state = {
      sourceNodeId: nodeId,
      sourceBox,
      start: preview.start,
      end: preview.end,
      hoveredTargetId: null,
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  },

  onPointerMove(e, ctx) {
    if (!state) return;
    const { sx, sy } = pointerFromEvent(e);
    const v = ctx.screenToViewport(sx, sy);
    const hitId = ctx.hit(v);
    const nodeId = hitId ? nodeIdFromCardLayerId(hitId) : null;
    const targetId = nodeId && nodeId !== state.sourceNodeId ? nodeId : null;
    const targetBox = targetId ? nodeBoxFromCard(ctx, targetId) : null;
    const preview = updatePreview(state.sourceBox, v, targetBox);
    state.start = preview.start;
    state.end = preview.end;
    state.hoveredTargetId = targetBox?.id ?? null;
  },

  onPointerUp(e, ctx) {
    if (!state) return;
    const target = state.hoveredTargetId;
    if (target) {
      ctx.dispatch({ kind: 'addEdge', source: state.sourceNodeId, target });
    }
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    state = null;
  },

  renderOverlay(ctx): JSX.Element | null {
    const points = nodeBoxes(ctx).flatMap((box) =>
      connectionPoints(box).map((point, index) =>
        createElement('circle', {
          key: `${box.id}-${index}`,
          cx: point.x,
          cy: point.y,
          r: 4,
          className:
            state?.hoveredTargetId === box.id
              ? 'squisq-scene-connection-point squisq-scene-connection-point--active'
              : 'squisq-scene-connection-point',
        }),
      ),
    );

    if (!state) {
      return points.length ? createElement('g', { key: 'connection-points' }, ...points) : null;
    }

    const { start: a, end: b } = state;
    const d = curvedPath(a, b);
    return createElement(
      'g',
      { key: 'connect-preview' },
      ...points,
      createElement('path', { d, className: 'squisq-scene-connect-preview' }),
      // Optional: a dot at the endpoint so the user sees the snap target.
      createElement('circle', {
        cx: b.x,
        cy: b.y,
        r: 4,
        className: 'squisq-scene-connect-preview',
      }),
    );
  },
};

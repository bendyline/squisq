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
import { nodeIdFromCardLayerId, NODE_WIDTH, NODE_HEIGHT } from '../layers/nodeCard';

interface ConnectState {
  sourceNodeId: string;
  /** Source node center in viewport units (cached at drag start). */
  sourceCenter: { x: number; y: number };
  /** Current pointer position in viewport units. */
  current: { x: number; y: number };
  /** Currently-hovered target node id, if any (for highlight + drop). */
  hoveredTargetId: string | null;
}

let state: ConnectState | null = null;

function pointerFromEvent(e: React.PointerEvent): { sx: number; sy: number } {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
}

function nodeCenterFromCard(
  ctx: SceneToolContext,
  nodeId: string,
): { x: number; y: number } | null {
  const card = ctx.hitItems.find((it) => it.id === `node-card-${nodeId}`);
  if (!card) return null;
  return { x: card.bounds.x + NODE_WIDTH / 2, y: card.bounds.y + NODE_HEIGHT / 2 };
}

export const ConnectTool: SceneTool = {
  id: 'connect',
  label: 'Connect',
  cursor: 'crosshair',
  shortcut: 'c',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const { sx, sy } = pointerFromEvent(e);
    const v = ctx.screenToViewport(sx, sy);
    const hitId = ctx.hit(v);
    if (!hitId) return;
    const nodeId = nodeIdFromCardLayerId(hitId);
    if (!nodeId) return;
    const center = nodeCenterFromCard(ctx, nodeId);
    if (!center) return;
    state = {
      sourceNodeId: nodeId,
      sourceCenter: center,
      current: v,
      hoveredTargetId: null,
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  },

  onPointerMove(e, ctx) {
    if (!state) return;
    const { sx, sy } = pointerFromEvent(e);
    const v = ctx.screenToViewport(sx, sy);
    state.current = v;
    const hitId = ctx.hit(v);
    const nodeId = hitId ? nodeIdFromCardLayerId(hitId) : null;
    state.hoveredTargetId = nodeId && nodeId !== state.sourceNodeId ? nodeId : null;
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

  renderOverlay(): JSX.Element | null {
    if (!state) return null;
    const { sourceCenter: a, current: b } = state;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const cp = Math.max(40, Math.abs(dx) / 2);
    // Cubic bezier matching diagramBlock.ts's `curved` edge style so the
    // preview previews exactly what will render after commit.
    const d = `M ${a.x} ${a.y} C ${a.x + cp} ${a.y}, ${b.x - cp} ${b.y}, ${b.x} ${b.y}`;
    return createElement(
      'g',
      { key: 'connect-preview' },
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

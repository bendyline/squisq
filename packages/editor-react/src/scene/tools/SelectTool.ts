/**
 * SelectTool — the default tool.
 *
 * Pointer interactions:
 *   - Press on a layer  → select (shift to add) and start a move-drag
 *   - Press on a handle → start a resize-drag (corner identifies the
 *                          fixed-anchor side; the opposite side moves
 *                          with the pointer)
 *   - Press on the pane → clear selection (unless shift) and start a
 *                          marquee box; release commits the box
 *                          intersection as the new selection
 *   - Delete / Backspace → remove every selected layer
 *
 * Drag state lives at module scope (one Scene mounted at a time in
 * practice). The Scene polls `getActiveMoveOffset()` /
 * `getActiveResize()` each render to draw a live preview of the
 * in-flight gesture against the selected layers' real positions.
 */

import { createElement, type JSX } from 'react';
import type { SceneInteractionState, SceneTool, SceneToolContext } from './SceneTool';
import type { SceneCommand } from '../commands/SceneCommand';
import type { ResizeCorner } from '../SceneSelection';

interface MoveDragState {
  kind: 'move';
  startV: { x: number; y: number };
  startS: { x: number; y: number };
  layerStarts: Map<string, { x: number; y: number }>;
  currentV: { x: number; y: number };
  movedPastThreshold: boolean;
}

interface MarqueeDragState {
  kind: 'marquee';
  startV: { x: number; y: number };
  startS: { x: number; y: number };
  currentV: { x: number; y: number };
  movedPastThreshold: boolean;
}

interface ResizeDragState {
  kind: 'resize';
  layerId: string;
  corner: ResizeCorner;
  startV: { x: number; y: number };
  startBounds: { x: number; y: number; width: number; height: number };
  currentBounds: { x: number; y: number; width: number; height: number };
}

type DragState = MoveDragState | MarqueeDragState | ResizeDragState;

const DRAG_THRESHOLD_PX = 3;
const MIN_LAYER_SIZE = 8;

function getDragState(interaction: SceneInteractionState): DragState | null {
  return (interaction.selectDrag as DragState | undefined) ?? null;
}

function setDragState(interaction: SceneInteractionState, state: DragState | null): void {
  interaction.selectDrag = state ?? undefined;
}

function pointerCoords(e: React.PointerEvent): { sx: number; sy: number } {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
}

function getLayerOrigin(ctx: SceneToolContext, id: string): { x: number; y: number } | null {
  const hit = ctx.hitItems.find((it) => it.id === id);
  return hit ? { x: hit.bounds.x, y: hit.bounds.y } : null;
}

/**
 * Resize a bounds by anchoring the opposite corner/edge to its original
 * spot and moving the corner under the pointer to `(currentV)`. Min
 * width/height is `MIN_LAYER_SIZE` so layers can't shrink to invisible.
 */
function applyResize(
  start: { x: number; y: number; width: number; height: number },
  corner: ResizeCorner,
  currentV: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  let x = start.x;
  let y = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  // Each corner identifier moves the listed edges. Anchor stays put.
  if (corner.includes('w')) x = Math.min(currentV.x, right - MIN_LAYER_SIZE);
  if (corner.includes('e')) right = Math.max(currentV.x, x + MIN_LAYER_SIZE);
  if (corner.includes('n')) y = Math.min(currentV.y, bottom - MIN_LAYER_SIZE);
  if (corner.includes('s')) bottom = Math.max(currentV.y, y + MIN_LAYER_SIZE);

  return { x, y, width: right - x, height: bottom - y };
}

/** Begin a handle-initiated resize drag. Called by the Scene when a corner is pressed. */
export function beginHandleDrag(
  args: {
    layerId: string;
    corner: ResizeCorner;
    startV: { x: number; y: number };
    startBounds: { x: number; y: number; width: number; height: number };
  },
  interaction: SceneInteractionState,
): void {
  setDragState(interaction, {
    kind: 'resize',
    layerId: args.layerId,
    corner: args.corner,
    startV: args.startV,
    startBounds: args.startBounds,
    currentBounds: args.startBounds,
  });
}

export const SelectTool: SceneTool = {
  id: 'select',
  label: 'Select',
  cursor: 'default',
  shortcut: 'v',

  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    // Resize drags are initiated by the SceneSelection handle, which
    // calls `beginHandleDrag` before this fires; the handle stops
    // propagation, so we won't see this branch when starting a resize.
    const { sx, sy } = pointerCoords(e);
    const v = ctx.screenToViewport(sx, sy);
    const hitId = ctx.hit(v);

    if (hitId) {
      const additive = e.shiftKey;
      const nextSelection = additive
        ? new Set([...ctx.selection, hitId])
        : ctx.selection.has(hitId)
          ? ctx.selection
          : new Set([hitId]);
      if (nextSelection !== ctx.selection) ctx.setSelection(nextSelection);

      const layerStarts = new Map<string, { x: number; y: number }>();
      for (const id of nextSelection) {
        const origin = getLayerOrigin(ctx, id);
        if (origin) layerStarts.set(id, origin);
      }
      setDragState(ctx.interaction, {
        kind: 'move',
        startV: v,
        startS: { x: sx, y: sy },
        layerStarts,
        currentV: v,
        movedPastThreshold: false,
      });
    } else {
      if (!e.shiftKey) ctx.setSelection([]);
      setDragState(ctx.interaction, {
        kind: 'marquee',
        startV: v,
        startS: { x: sx, y: sy },
        currentV: v,
        movedPastThreshold: false,
      });
    }

    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  },

  onPointerMove(e, ctx) {
    const dragState = getDragState(ctx.interaction);
    if (!dragState) return;
    const { sx, sy } = pointerCoords(e);
    const v = ctx.screenToViewport(sx, sy);

    if (dragState.kind === 'resize') {
      dragState.currentBounds = applyResize(dragState.startBounds, dragState.corner, v);
      return;
    }

    dragState.currentV = v;
    if (!dragState.movedPastThreshold) {
      const dx = sx - dragState.startS.x;
      const dy = sy - dragState.startS.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) dragState.movedPastThreshold = true;
    }

    if (dragState.kind === 'marquee') {
      const box = boxFromCorners(dragState.startV, v);
      const inside = ctx.hitItems.filter((it) => rectIntersects(it.bounds, box)).map((it) => it.id);
      ctx.setSelection(inside);
    }
  },

  onPointerUp(e, ctx) {
    const dragState = getDragState(ctx.interaction);
    if (!dragState) return;
    if (
      dragState.kind === 'move' &&
      dragState.movedPastThreshold &&
      dragState.layerStarts.size > 0
    ) {
      const dx = dragState.currentV.x - dragState.startV.x;
      const dy = dragState.currentV.y - dragState.startV.y;
      for (const [id, origin] of dragState.layerStarts) {
        const cmd: SceneCommand = {
          kind: 'moveLayer',
          id,
          x: origin.x + dx,
          y: origin.y + dy,
        };
        ctx.dispatch(cmd);
      }
    } else if (dragState.kind === 'resize') {
      const { x, y, width, height } = dragState.currentBounds;
      // Keep the final origin + size in one command. In particular, the ASCII
      // diagram adapter must render/reparse only once: committing a move and
      // then a resize used to normalize the art between the two halves of one
      // pointer gesture and could snap the node to a different grid position.
      ctx.dispatch({ kind: 'resizeLayer', id: dragState.layerId, x, y, width, height });
    }
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    setDragState(ctx.interaction, null);
  },

  onDoubleClick(e, ctx) {
    // Double-click a layer to edit its text inline (when the host wired a
    // text-editing config). Resolve the hit, then hand off to the Scene.
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const v = ctx.screenToViewport(e.clientX - rect.left, e.clientY - rect.top);
    const hitId = ctx.hit(v);
    if (hitId) ctx.beginTextEdit?.(hitId);
  },

  onKeyDown(e, ctx) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      for (const id of ctx.selection) {
        ctx.dispatch({ kind: 'removeLayer', id });
      }
      ctx.setSelection([]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      ctx.setSelection([]);
    }
  },

  renderOverlay(ctx): JSX.Element | null {
    const dragState = getDragState(ctx.interaction);
    if (!dragState || dragState.kind !== 'marquee' || !dragState.movedPastThreshold) return null;
    const box = boxFromCorners(dragState.startV, dragState.currentV);
    return createElement('rect', {
      key: 'select-marquee',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      className: 'squisq-scene-marquee',
    });
  },
};

/** Return the active move-drag offset (viewport units). Null if no drag, or if the drag is a marquee/resize. */
export function getActiveMoveOffset(
  interaction: SceneInteractionState,
): { dx: number; dy: number } | null {
  const dragState = getDragState(interaction);
  if (!dragState || dragState.kind !== 'move' || !dragState.movedPastThreshold) return null;
  return {
    dx: dragState.currentV.x - dragState.startV.x,
    dy: dragState.currentV.y - dragState.startV.y,
  };
}

/** Return the live bounds for the layer currently being resized. */
export function getActiveResize(interaction: SceneInteractionState): {
  layerId: string;
  bounds: { x: number; y: number; width: number; height: number };
} | null {
  const dragState = getDragState(interaction);
  if (!dragState || dragState.kind !== 'resize') return null;
  return { layerId: dragState.layerId, bounds: dragState.currentBounds };
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

function rectIntersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

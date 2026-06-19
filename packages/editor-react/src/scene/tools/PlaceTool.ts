/**
 * PlaceTool — a generic "click the canvas to drop one pre-built layer"
 * tool. The palette arms a place tool; the next canvas click drops the
 * layer its `build` function returns at the click point, then hands
 * control back to Select so the user can immediately reposition it.
 *
 * This is the shared mechanism behind both the placeholder-token tools
 * (see `createTokenTool`) and the shape tools in the template designer's
 * "Add" bin — anything that places a single layer at a point.
 */

import type { Layer } from '@bendyline/squisq/schemas';
import type { SceneTool } from './SceneTool';

export interface PlaceToolOptions {
  /** Stable tool id (e.g. `'token-title'`, `'shape-diamond'`). */
  id: string;
  /** Label shown in the toolbar / palette button. */
  label: string;
  /** Optional keyboard shortcut. */
  shortcut?: string;
  /** Cursor while the tool is armed. Default `'crosshair'`. */
  cursor?: string;
  /** Build the layer to drop, given the click point in viewport units. */
  build: (point: { x: number; y: number }) => Layer;
}

export function createPlaceTool(options: PlaceToolOptions): SceneTool {
  return {
    id: options.id,
    label: options.label,
    cursor: options.cursor ?? 'crosshair',
    shortcut: options.shortcut,

    onPointerDown(e, ctx) {
      if (e.button !== 0) return;
      const rect = (e.currentTarget as Element).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = ctx.screenToViewport(sx, sy);
      ctx.dispatch({ kind: 'addLayer', layer: options.build(v) });
      // Hand control back to Select so the user can immediately
      // reposition the newly-added layer.
      ctx.setActiveTool?.('select');
    },
  };
}

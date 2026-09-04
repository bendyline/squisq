/**
 * SceneViewport — the scrollable, zoomable SVG canvas.
 *
 * Owns the wheel/middle-button pan/zoom event handlers and applies the
 * current `SceneTransform` to a single root `<g>` element. Children
 * render at their natural viewport coordinates; the group transform
 * carries the pan/zoom.
 *
 * Dot-grid background lives behind the layer group as an SVG `<pattern>`
 * so it scales/translates with the canvas exactly the way a "real"
 * canvas grid would — see {@link dotGrid} for how its weight is held
 * steady across the zoom range.
 */

import { forwardRef, useId, type ReactNode, type WheelEvent } from 'react';
import type { SceneTransform } from './hooks/useScenePanZoom';

/** World-space spacing of the dot grid at 100% zoom. */
const BASE_GRID_STEP = 24;
/** Never let the grid tile closer than this on screen. */
const MIN_SCREEN_STEP = 18;
/** Beyond this the dots read as blobs rather than a texture. */
const MAX_DOT_RADIUS = 2;

/**
 * Dot spacing and radius for the current zoom.
 *
 * The pattern is laid out in SCREEN space, so a fixed world step with a
 * fixed dot radius makes the grid HEAVIER the further you zoom out: at 25%
 * the 24px step lands 6px apart, which is ~16x the ink per unit area of the
 * same grid at 100% and reads as noise behind the diagram (at the 0.02 zoom
 * floor the tile is sub-pixel and the grid becomes a flat wash of muted
 * colour). Doubling the world step until the on-screen spacing clears
 * {@link MIN_SCREEN_STEP} keeps the texture legible, and scaling the radius
 * with that step holds the ink-per-area — the visual weight the reader
 * actually perceives — constant at any zoom.
 */
function dotGrid(scale: number): { step: number; radius: number } {
  let step = BASE_GRID_STEP * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  // Bounded: the zoom floor is 0.02, so six doublings always suffice.
  for (let i = 0; i < 8 && step < MIN_SCREEN_STEP; i++) step *= 2;
  return { step, radius: Math.min(MAX_DOT_RADIUS, step / BASE_GRID_STEP) };
}

interface SceneViewportProps {
  width: number;
  height: number;
  transform: SceneTransform;
  /** Called with a wheel event for the viewport. */
  onWheel?: (e: WheelEvent<SVGSVGElement>) => void;
  /** Called for any pointer event over the viewport. */
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerCancel?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onDoubleClick?: (e: React.MouseEvent<SVGSVGElement>) => void;
  /** HTML5 drag-and-drop handlers — used for palette drag-to-place. */
  onDragOver?: (e: React.DragEvent<SVGSVGElement>) => void;
  onDrop?: (e: React.DragEvent<SVGSVGElement>) => void;
  /** Optional CSS cursor (set by the active tool). */
  cursor?: string;
  /** Layers + overlay are children of the transformed group. */
  children: ReactNode;
}

export const SceneViewport = forwardRef<SVGSVGElement, SceneViewportProps>(function SceneViewport(
  {
    width,
    height,
    transform,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onDragOver,
    onDrop,
    cursor,
    children,
  },
  ref,
) {
  const t = transform;
  const gridId = `squisq-scene-dot-grid-${useId().replace(/:/g, '')}`;
  const grid = dotGrid(t.scale);
  const groupTransform = `translate(${t.tx} ${t.ty}) scale(${t.scale})`;

  return (
    <svg
      ref={ref}
      className="squisq-scene-viewport"
      width={width}
      height={height}
      // `data-cursor` drives a CSS rule that picks a custom URL-based
      // cursor (see scene.css). The OS-stock `default` / `crosshair`
      // keywords render as thin or invisible shapes on Windows when
      // users have configured large/white cursor schemes; the URL
      // cursors stay high-contrast on any background.
      data-cursor={cursor ?? 'default'}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="application"
      // Focusable so the SVG can receive keyboard events directly. The
      // Scene focuses it on pointer-down so Delete/Escape/tool-shortcut
      // keys reach our handlers even when mounted inside a contentEditable
      // ProseMirror surface.
      tabIndex={-1}
      // Disable native browser gestures we don't want (pinch-zoom on the
      // SVG, pan momentum) — pointer events handle these explicitly.
      // CSS sets `touch-action: none` on the viewport class.
    >
      <defs>
        <pattern
          id={gridId}
          x={t.tx}
          y={t.ty}
          width={grid.step}
          height={grid.step}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={grid.radius} cy={grid.radius} r={grid.radius} className="squisq-scene-dot" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${gridId})`} />
      <g transform={groupTransform}>{children}</g>
    </svg>
  );
});

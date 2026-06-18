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
 * canvas grid would.
 */

import { forwardRef, type ReactNode, type WheelEvent } from 'react';
import type { SceneTransform } from './hooks/useScenePanZoom';

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
    onDoubleClick,
    onDragOver,
    onDrop,
    cursor,
    children,
  },
  ref,
) {
  const t = transform;
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
          id="squisq-scene-dot-grid"
          x={t.tx}
          y={t.ty}
          width={24 * t.scale}
          height={24 * t.scale}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={1} cy={1} r={1} className="squisq-scene-dot" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#squisq-scene-dot-grid)" />
      <g transform={groupTransform}>{children}</g>
    </svg>
  );
});

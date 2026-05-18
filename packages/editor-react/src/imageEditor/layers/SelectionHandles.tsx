/**
 * SelectionHandles
 *
 * Renders the dashed selection rectangle plus eight resize handles around
 * the currently-selected layer's bounding box. Pointer events on each
 * handle bubble back through `onHandlePointerDown` so the surrounding
 * `<CanvasSurface>` can run its drag loop with the right resize semantics.
 */

import type { CanvasRect } from '../state.js';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_SIZE = 10; // canvas-pixel size of each square handle

interface Props {
  box: CanvasRect;
  onHandlePointerDown: (e: React.PointerEvent<SVGRectElement>, handle: Handle) => void;
}

export function SelectionHandles({ box, onHandlePointerDown }: Props) {
  const half = HANDLE_SIZE / 2;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const handles: Array<{ id: Handle; x: number; y: number; cursor: string }> = [
    { id: 'nw', x: box.x, y: box.y, cursor: 'nwse-resize' },
    { id: 'n', x: cx, y: box.y, cursor: 'ns-resize' },
    { id: 'ne', x: box.x + box.width, y: box.y, cursor: 'nesw-resize' },
    { id: 'e', x: box.x + box.width, y: cy, cursor: 'ew-resize' },
    { id: 'se', x: box.x + box.width, y: box.y + box.height, cursor: 'nwse-resize' },
    { id: 's', x: cx, y: box.y + box.height, cursor: 'ns-resize' },
    { id: 'sw', x: box.x, y: box.y + box.height, cursor: 'nesw-resize' },
    { id: 'w', x: box.x, y: cy, cursor: 'ew-resize' },
  ];

  return (
    <g pointerEvents="none">
      {/*
       * Outline: rendered as two stacked rectangles so the selection
       * stays visible over both light and dark imagery. The white
       * "halo" goes underneath; the blue dashed line on top. Both use
       * `vector-effect: non-scaling-stroke` so the stroke width stays
       * crisp at any zoom level (the SVG viewBox is the canvas size,
       * which can be much larger than the rendered element).
       */}
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke="#ffffff"
        strokeOpacity={0.9}
        strokeWidth={4}
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke="#39f"
        strokeWidth={2}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {handles.map((h) => (
        <rect
          key={h.id}
          x={h.x - half}
          y={h.y - half}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          fill="#fff"
          stroke="#39f"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: h.cursor, pointerEvents: 'all' }}
          onPointerDown={(e) => onHandlePointerDown(e, h.id)}
        />
      ))}
    </g>
  );
}

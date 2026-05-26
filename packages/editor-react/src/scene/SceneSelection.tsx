/**
 * SceneSelection — selection outline + corner handles for resize.
 *
 * Renders a dashed bounding box per selected layer plus eight grip
 * handles (four corners + four edges). The Scene wires the handles to
 * SelectTool's `beginHandleDrag` so a pointer-down on a handle starts a
 * resize gesture instead of a move.
 *
 * All coordinates are viewport units — the parent group transform
 * carries pan/zoom. Handle dimensions and stroke widths use
 * `vector-effect: non-scaling-stroke` (set in scene.css) so they stay
 * the same pixel size regardless of zoom.
 */

import type { HitTestable } from './hooks/useSceneHitTest';

export type ResizeCorner = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface SceneSelectionProps {
  selection: ReadonlySet<string>;
  hitItems: readonly HitTestable[];
  /** Live offset during a move-drag (applied to outline + handles). */
  liveOffset?: { dx: number; dy: number } | null;
  /** Live resize bounds, applied to the matching layer's outline. */
  liveResize?: { layerId: string; bounds: { x: number; y: number; width: number; height: number } } | null;
  /** Fired when the user presses a corner/edge handle. */
  onHandlePointerDown?: (e: React.PointerEvent<SVGElement>, corner: ResizeCorner) => void;
}

const HANDLE_SIZE = 8;

export function SceneSelection({
  selection,
  hitItems,
  liveOffset,
  liveResize,
  onHandlePointerDown,
}: SceneSelectionProps) {
  if (selection.size === 0) return null;
  const selected = hitItems.filter((it) => selection.has(it.id));
  if (selected.length === 0) return null;
  const offset = liveOffset ?? { dx: 0, dy: 0 };

  return (
    <g className="squisq-scene-selection-group">
      {selected.map((it) => {
        // Prefer the live-resize bounds for the matching layer; otherwise
        // apply the move offset.
        let x: number;
        let y: number;
        let w: number;
        let h: number;
        if (liveResize && liveResize.layerId === it.id) {
          x = liveResize.bounds.x;
          y = liveResize.bounds.y;
          w = liveResize.bounds.width;
          h = liveResize.bounds.height;
        } else {
          x = it.bounds.x + offset.dx;
          y = it.bounds.y + offset.dy;
          w = it.bounds.width;
          h = it.bounds.height;
        }
        const corners: { corner: ResizeCorner; cx: number; cy: number; cursor: string }[] = [
          { corner: 'nw', cx: x, cy: y, cursor: 'nwse-resize' },
          { corner: 'n', cx: x + w / 2, cy: y, cursor: 'ns-resize' },
          { corner: 'ne', cx: x + w, cy: y, cursor: 'nesw-resize' },
          { corner: 'e', cx: x + w, cy: y + h / 2, cursor: 'ew-resize' },
          { corner: 'se', cx: x + w, cy: y + h, cursor: 'nwse-resize' },
          { corner: 's', cx: x + w / 2, cy: y + h, cursor: 'ns-resize' },
          { corner: 'sw', cx: x, cy: y + h, cursor: 'nesw-resize' },
          { corner: 'w', cx: x, cy: y + h / 2, cursor: 'ew-resize' },
        ];
        return (
          <g key={it.id} className="squisq-scene-selection">
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              className="squisq-scene-selection-outline"
              pointerEvents="none"
            />
            {corners.map(({ corner, cx, cy, cursor }) => (
              <rect
                key={corner}
                x={cx - HANDLE_SIZE / 2}
                y={cy - HANDLE_SIZE / 2}
                width={HANDLE_SIZE}
                height={HANDLE_SIZE}
                className="squisq-scene-selection-handle"
                style={{ cursor }}
                onPointerDown={
                  onHandlePointerDown ? (e) => onHandlePointerDown(e, corner) : undefined
                }
                data-corner={corner}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

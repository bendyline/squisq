/**
 * PathLayer Component
 *
 * Renders an SVG `<path>` for arbitrary curves, connectors, arrows, and the
 * drawing template's computed shapes. Used by the diagram template for edges
 * between nodes; usable by any template that needs a non-rect/circle/line
 * shape.
 *
 * The path's `d` attribute uses absolute SVG coordinates relative to the
 * block viewport (independent of the layer's `position` box, which is
 * present only so animations and clipping match the other layer types).
 *
 * Exception: when `content.shapeKind` is set (a standard named shape like
 * `diamond` / `star` / `arrow-right`), `d` is re-derived from the layer's
 * `position` box resolved against the viewport. That keeps named shapes
 * movable, resizable, and aspect-ratio-adaptive — matching how the native
 * rect/circle/line `ShapeLayer` behaves — rather than pinned to a baked
 * absolute path.
 *
 * End markers are configured via `startMarker`/`endMarker` (with the legacy
 * `arrow` flag mapping to a filled triangle). Marker geometry comes from
 * `markerPath` in core so the SSR renderer and the editor agree.
 */

import type { PathLayer as PathLayerType, MarkerStyle } from '@bendyline/squisq/schemas';
import { markerPath, shapePath } from '@bendyline/squisq/doc';
import { getAnimationStyle } from '../utils/animationUtils';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';
import { resolveFill, borderDashArray } from '../utils/fillStyle';

interface PathLayerProps {
  layer: PathLayerType;
  /** Viewport dimensions — used to resolve `%` positions for named shapes. */
  viewport: { width: number; height: number };
  /** Current time relative to block start. */
  blockTime: number;
}

/**
 * The effective `d`: a named shape (`content.shapeKind`) is re-derived
 * from the resolved `position` box so it tracks moves/resizes and adapts
 * to the viewport; everything else uses the stored absolute path.
 */
function effectivePath(layer: PathLayerType, viewport: { width: number; height: number }): string {
  const { content, position } = layer;
  if (!content.shapeKind) return content.d;
  const w = position.width ? resolveValue(position.width, viewport.width) : 0;
  const h = position.height ? resolveValue(position.height, viewport.height) : 0;
  const rawX = resolveValue(position.x, viewport.width);
  const rawY = resolveValue(position.y, viewport.height);
  const anchor = getAnchorOffset(position.anchor, w, h);
  const derived = shapePath(content.shapeKind, rawX + anchor.x, rawY + anchor.y, w, h);
  // Fall back to the stored path if the kind is unknown to `shapePath`.
  return derived ?? content.d;
}

/** Resolve the effective marker for an endpoint (explicit field, else `arrow`). */
function effectiveMarker(
  explicit: MarkerStyle | undefined,
  arrow: PathLayerType['content']['arrow'],
  end: 'start' | 'end',
): MarkerStyle {
  if (explicit) return explicit;
  const wants = arrow === 'both' || arrow === end;
  return wants ? 'arrow' : 'none';
}

export function PathLayer({ layer, viewport, blockTime }: PathLayerProps) {
  const { content, animation, id } = layer;
  const d = effectivePath(layer, viewport);
  const stroke = content.stroke ?? '#1e293b';
  const strokeWidth = content.strokeWidth ?? 2;
  const { fill, def: fillDef } = resolveFill(id, content.fill ?? 'none', content.gradient);
  // `borderStyle` (named shapes) takes precedence over a raw `dasharray`.
  const dash = content.borderStyle
    ? borderDashArray(content.borderStyle, strokeWidth)
    : content.dasharray;
  const animStyle = getAnimationStyle(animation, blockTime);

  const startId = `marker-start-${id}`;
  const endId = `marker-end-${id}`;
  const start = markerPath(effectiveMarker(content.startMarker, content.arrow, 'start'), 'start');
  const end = markerPath(effectiveMarker(content.endMarker, content.arrow, 'end'), 'end');

  return (
    <g
      className={`block-layer block-layer--path ${animStyle.className}`}
      style={animStyle.style}
      data-layer-id={id}
    >
      <defs>
        {fillDef}
        {end && <MarkerDef id={endId} dir="end" d={end.d} filled={end.filled} stroke={stroke} />}
        {start && (
          <MarkerDef id={startId} dir="start" d={start.d} filled={start.filled} stroke={stroke} />
        )}
      </defs>
      <path
        d={d}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
        fillOpacity={content.fillOpacity}
        strokeDasharray={dash}
        markerStart={start ? `url(#${startId})` : undefined}
        markerEnd={end ? `url(#${endId})` : undefined}
      />
    </g>
  );
}

function MarkerDef({
  id,
  dir,
  d,
  filled,
  stroke,
}: {
  id: string;
  dir: 'start' | 'end';
  d: string;
  filled: boolean;
  stroke: string;
}) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX={dir === 'end' ? 9 : 1}
      refY={5}
      markerWidth={8}
      markerHeight={8}
      orient="auto-start-reverse"
      markerUnits="userSpaceOnUse"
    >
      <path
        d={d}
        fill={filled ? stroke : 'none'}
        stroke={filled ? 'none' : stroke}
        strokeWidth={filled ? undefined : 1.5}
      />
    </marker>
  );
}

export default PathLayer;

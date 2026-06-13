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
 * End markers are configured via `startMarker`/`endMarker` (with the legacy
 * `arrow` flag mapping to a filled triangle). Marker geometry comes from
 * `markerPath` in core so the SSR renderer and the editor agree.
 */

import type { PathLayer as PathLayerType, MarkerStyle } from '@bendyline/squisq/schemas';
import { markerPath } from '@bendyline/squisq/doc';
import { getAnimationStyle } from '../utils/animationUtils';

interface PathLayerProps {
  layer: PathLayerType;
  /** Viewport dimensions (currently unused — path coords are absolute). */
  viewport: { width: number; height: number };
  /** Current time relative to block start. */
  blockTime: number;
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

export function PathLayer({ layer, blockTime }: PathLayerProps) {
  const { content, animation, id } = layer;
  const stroke = content.stroke ?? '#1e293b';
  const strokeWidth = content.strokeWidth ?? 2;
  const fill = content.fill ?? 'none';
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
        {end && <MarkerDef id={endId} dir="end" d={end.d} filled={end.filled} stroke={stroke} />}
        {start && (
          <MarkerDef id={startId} dir="start" d={start.d} filled={start.filled} stroke={stroke} />
        )}
      </defs>
      <path
        d={content.d}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
        strokeDasharray={content.dasharray}
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

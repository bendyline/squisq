/**
 * PathLayer Component
 *
 * Renders an SVG `<path>` for arbitrary curves, connectors, and arrows.
 * Used by the diagram template for edges between nodes; usable by any
 * template that needs a non-rect/circle/line shape.
 *
 * The path's `d` attribute uses absolute SVG coordinates relative to the
 * block viewport (independent of the layer's `position` box, which is
 * present only so animations and clipping match the other layer types).
 */

import type { PathLayer as PathLayerType } from '@bendyline/squisq/schemas';
import { getAnimationStyle } from '../utils/animationUtils';

interface PathLayerProps {
  layer: PathLayerType;
  /** Viewport dimensions (currently unused — path coords are absolute). */
  viewport: { width: number; height: number };
  /** Current time relative to block start. */
  blockTime: number;
}

export function PathLayer({ layer, blockTime }: PathLayerProps) {
  const { content, animation, id } = layer;
  const stroke = content.stroke ?? '#1e293b';
  const strokeWidth = content.strokeWidth ?? 2;
  const fill = content.fill ?? 'none';
  const animStyle = getAnimationStyle(animation, blockTime);

  // Arrow marker IDs are derived from the layer id + color so multiple
  // paths with different stroke colors don't share a single marker.
  const arrowEndId = `arrow-end-${id}`;
  const arrowStartId = `arrow-start-${id}`;
  const wantStart = content.arrow === 'start' || content.arrow === 'both';
  const wantEnd = content.arrow === 'end' || content.arrow === 'both';

  return (
    <g
      className={`block-layer block-layer--path ${animStyle.className}`}
      style={animStyle.style}
      data-layer-id={id}
    >
      <defs>
        {wantEnd && (
          <marker
            id={arrowEndId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        )}
        {wantStart && (
          <marker
            id={arrowStartId}
            viewBox="0 0 10 10"
            refX="1"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 10 0 L 0 5 L 10 10 z" fill={stroke} />
          </marker>
        )}
      </defs>
      <path
        d={content.d}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
        strokeDasharray={content.dasharray}
        markerStart={wantStart ? `url(#${arrowStartId})` : undefined}
        markerEnd={wantEnd ? `url(#${arrowEndId})` : undefined}
      />
    </g>
  );
}

export default PathLayer;

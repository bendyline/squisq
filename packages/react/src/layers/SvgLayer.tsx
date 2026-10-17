/**
 * SvgLayer — an SVG island (```svg fence) on a slide.
 *
 * The layer carries the fence's raw source; this renderer re-runs core's
 * sanitizer and draws only its output, as an SVG `<image>` of a data URL.
 * Loaded as an image, the island cannot run script, fetch anything, or leak
 * its ids and styles into the slide. It renders synchronously, so frame
 * capture never catches a loading state. A fence that does not sanitize to an
 * island draws a quiet notice instead of vanishing.
 */

import { useMemo } from 'react';
import { parseSvgIsland, svgIslandDataUrl } from '@bendyline/squisq/markdown';
import type { SvgLayer as SvgLayerType } from '@bendyline/squisq/schemas';
import { getAnimationStyle } from '../utils/animationUtils.js';
import { getAnchorOffset, resolveValue } from '../utils/layerUtils.js';

interface SvgLayerProps {
  layer: SvgLayerType;
  viewport: { width: number; height: number };
  blockTime: number;
  /**
   * Draw a still: no SMIL or CSS animation inside the island. Set for frame
   * capture (wall-clock animation would make frames nondeterministic),
   * reduced motion, and disabled animations.
   */
  isStatic?: boolean;
}

export function SvgLayer({ layer, viewport, blockTime, isStatic = false }: SvgLayerProps) {
  const { position, content, animation } = layer;
  const width = resolveValue(position.width ?? viewport.width, viewport.width);
  const height = resolveValue(position.height ?? viewport.height, viewport.height);
  const offset = getAnchorOffset(position.anchor, width, height);
  const x = resolveValue(position.x, viewport.width) + offset.x;
  const y = resolveValue(position.y, viewport.height) + offset.y;

  const result = useMemo(
    () => parseSvgIsland(content.source, { static: isStatic }),
    [content.source, isStatic],
  );
  const href = useMemo(
    () => (result.ok ? svgIslandDataUrl(result.island, { color: content.color }) : null),
    [result, content.color],
  );
  const animStyle = getAnimationStyle(animation, blockTime);
  const label = content.alt ?? (result.ok ? result.island.title : undefined) ?? 'Illustration';

  return (
    <g
      className={`block-layer block-layer--svg ${animStyle.className}`}
      data-layer-id={layer.id}
      style={animStyle.style}
    >
      {href ? (
        <image
          href={href}
          x={x}
          y={y}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={label}
          style={{ pointerEvents: 'none' }}
        />
      ) : (
        <g role="img" aria-label="SVG that could not be rendered">
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={Math.min(width, height) * 0.04}
            fill="none"
            stroke={content.color ?? 'currentColor'}
            strokeOpacity={0.35}
            strokeWidth={2}
            strokeDasharray="8 6"
          />
          <text
            x={x + width / 2}
            y={y + height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={content.color ?? 'currentColor'}
            fillOpacity={0.6}
            fontSize={Math.max(12, Math.min(width, height) * 0.06)}
          >
            Couldn’t render this SVG
          </text>
        </g>
      )}
    </g>
  );
}

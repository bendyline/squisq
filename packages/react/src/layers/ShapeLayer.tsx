/**
 * ShapeLayer Component
 *
 * Renders simple geometric shapes (rect, circle, line) within an SVG block.
 * Useful for visual accents, dividers, and background elements.
 */

import type { ShapeLayer as ShapeLayerType } from '@bendyline/squisq/schemas';
import { getAnimationStyle } from '../utils/animationUtils';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';
import { resolveFill, borderDashArray } from '../utils/fillStyle';

interface ShapeLayerProps {
  layer: ShapeLayerType;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** Current time relative to block start */
  blockTime: number;
}

export function ShapeLayer({ layer, viewport, blockTime }: ShapeLayerProps) {
  const { content, position, animation } = layer;

  // Resolve position values to pixels
  const rawX = resolveValue(position.x, viewport.width);
  const rawY = resolveValue(position.y, viewport.height);
  const width = position.width ? resolveValue(position.width, viewport.width) : 100;
  const height = position.height ? resolveValue(position.height, viewport.height) : 100;

  // Apply anchor offset (e.g., 'center' shifts x by -width/2 and y by -height/2)
  const anchorOffset = getAnchorOffset(position.anchor, width, height);
  const x = rawX + anchorOffset.x;
  const y = rawY + anchorOffset.y;

  // Get animation styles
  const animStyle = getAnimationStyle(animation, blockTime);

  const fill = content.fill || 'none';
  // Legacy: a CSS gradient string baked into `fill` (e.g. from older docs)
  // only works as an HTML background, so rect renders it via foreignObject.
  // The structured `content.gradient` (preferred) is handled below for all
  // shapes via an SVG <linearGradient>.
  const isCSSGradient = typeof fill === 'string' && fill.includes('gradient(');

  if (content.shape === 'rect' && isCSSGradient && !content.gradient) {
    return (
      <g
        className={`block-layer block-layer--shape ${animStyle.className}`}
        style={animStyle.style}
        data-layer-id={layer.id}
      >
        <foreignObject x={x} y={y} width={width} height={height}>
          <div
            style={{
              width: `${width}px`,
              height: `${height}px`,
              background: fill,
              borderRadius: content.borderRadius ? `${content.borderRadius}px` : undefined,
              pointerEvents: 'none',
            }}
          />
        </foreignObject>
      </g>
    );
  }

  const { fill: fillValue, def: fillDef } = resolveFill(layer.id, fill, content.gradient);
  const dash = borderDashArray(content.borderStyle, content.strokeWidth);

  // Common style props for native SVG shapes. `line` is stroke-only.
  const shapeProps = {
    fill: fillValue,
    fillOpacity: content.fillOpacity,
    stroke: content.stroke,
    strokeWidth: content.strokeWidth,
    strokeDasharray: dash,
  };

  return (
    <g
      className={`block-layer block-layer--shape ${animStyle.className}`}
      style={animStyle.style}
      data-layer-id={layer.id}
    >
      {fillDef && <defs>{fillDef}</defs>}
      {content.shape === 'rect' && (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={content.borderRadius}
          ry={content.borderRadius}
          {...shapeProps}
        />
      )}

      {content.shape === 'circle' && (
        <circle
          cx={x + width / 2}
          cy={y + height / 2}
          r={Math.min(width, height) / 2}
          {...shapeProps}
        />
      )}

      {content.shape === 'line' && (
        <line
          x1={x}
          y1={y}
          x2={x + width}
          y2={y + height}
          stroke={content.stroke || '#ffffff'}
          strokeWidth={content.strokeWidth || 2}
          strokeDasharray={dash}
        />
      )}
    </g>
  );
}

export default ShapeLayer;

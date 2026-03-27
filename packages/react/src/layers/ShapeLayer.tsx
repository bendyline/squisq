/**
 * ShapeLayer Component
 *
 * Renders simple geometric shapes (rect, circle, line) within an SVG block.
 * Useful for visual accents, dividers, and background elements.
 */

import type { ShapeLayer as ShapeLayerType } from '@bendyline/squisq/schemas';
import { getAnimationStyle } from '../utils/animationUtils';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';

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

  // Check if fill is a CSS gradient (SVG rect doesn't support CSS gradients natively)
  const fill = content.fill || 'none';
  const isCSSGradient = typeof fill === 'string' && fill.includes('gradient(');

  // For CSS gradients on rect, use foreignObject with an HTML div
  if (content.shape === 'rect' && isCSSGradient) {
    return (
      <g
        className={`block-layer block-layer--shape ${animStyle.className}`}
        style={animStyle.style}
        data-layer-id={layer.id}
      >
        <foreignObject x={x} y={y} width={width} height={height}>
          <div
            style={{
              width: '100%',
              height: '100%',
              background: fill,
              borderRadius: content.borderRadius ? `${content.borderRadius}px` : undefined,
              pointerEvents: 'none',
            }}
          />
        </foreignObject>
      </g>
    );
  }

  // Common style props for native SVG shapes
  const shapeProps = {
    fill: fill,
    stroke: content.stroke,
    strokeWidth: content.strokeWidth,
  };

  return (
    <g
      className={`block-layer block-layer--shape ${animStyle.className}`}
      style={animStyle.style}
      data-layer-id={layer.id}
    >
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
        />
      )}
    </g>
  );
}

export default ShapeLayer;

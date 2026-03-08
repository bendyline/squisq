/**
 * ImageLayer Component
 *
 * Renders an image layer within an SVG block. Supports Ken Burns and other
 * animations via CSS classes. Images are rendered using SVG <image> element
 * with proper aspect ratio handling.
 */

import type { ImageLayer as ImageLayerType, Animation } from '@bendyline/prodcore/schemas';
import { getAnimationStyle } from '../utils/animationUtils';
import { useMediaUrl } from '../hooks/MediaContext';

interface ImageLayerProps {
  layer: ImageLayerType;
  /** Base path for resolving relative image URLs */
  basePath: string;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** Current time relative to block start (for animation timing) */
  blockTime: number;
}

export function ImageLayer({ layer, basePath, viewport, blockTime }: ImageLayerProps) {
  const { content, position, animation } = layer;

  // Resolve position values to pixels
  const x = resolveValue(position.x, viewport.width);
  const y = resolveValue(position.y, viewport.height);
  const width = position.width ? resolveValue(position.width, viewport.width) : viewport.width;
  const height = position.height ? resolveValue(position.height, viewport.height) : viewport.height;

  // Apply anchor offset
  const offset = getAnchorOffset(position.anchor, width, height);
  const finalX = x + offset.x;
  const finalY = y + offset.y;

  // Resolve image URL via MediaProvider (if available), falling back to basePath
  const src = useMediaUrl(content.src, basePath);

  // Get animation styles
  const animStyle = getAnimationStyle(animation, blockTime);

  // SVG preserveAspectRatio based on fit mode
  const preserveAspectRatio = getPreserveAspectRatio(content.fit);
  const isCover = content.fit === 'cover';

  // Detect spatial (transform-based) animations that need Ken Burns treatment.
  // These animations should move the image *content* within fixed bounds rather
  // than shifting the entire image container.
  const isSpatialAnim = animation && SPATIAL_ANIMATION_TYPES.has(animation.type);

  // Ken Burns mode: cover image with spatial animation.
  // Keep the container static, animate the inner <img> within clipped bounds.
  if (isCover && isSpatialAnim && animation) {
    const kbAnim = remapToKenBurns(animation);
    const kbStyle = getAnimationStyle(kbAnim, blockTime);

    return (
      <g className="block-layer block-layer--image" data-layer-id={layer.id}>
        <foreignObject x={finalX} y={finalY} width={width} height={height}>
          <div style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
          }}>
            <img
              src={src}
              alt={content.alt || ''}
              className={kbStyle.className}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                display: 'block',
                pointerEvents: 'none',
                transformOrigin: 'center center',
                ...kbStyle.style,
              }}
            />
          </div>
        </foreignObject>
      </g>
    );
  }

  // For cover mode, use foreignObject with CSS object-fit for more reliable coverage
  // SVG's preserveAspectRatio can be inconsistent across browsers
  if (isCover) {
    return (
      <g
        className={`block-layer block-layer--image ${animStyle.className}`}
        style={animStyle.style}
        data-layer-id={layer.id}
      >
        <foreignObject x={finalX} y={finalY} width={width} height={height}>
          <img
            src={src}
            alt={content.alt || ''}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        </foreignObject>
      </g>
    );
  }

  // For contain/fill modes, use SVG image element
  return (
    <g
      className={`block-layer block-layer--image ${animStyle.className}`}
      style={animStyle.style}
      data-layer-id={layer.id}
    >
      <image
        href={src}
        x={finalX}
        y={finalY}
        width={width}
        height={height}
        preserveAspectRatio={preserveAspectRatio}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
}

/**
 * Resolve a position value (number or percentage string) to pixels.
 */
function resolveValue(value: number | string, dimension: number): number {
  if (typeof value === 'number') {
    return value;
  }
  if (value.endsWith('%')) {
    const percent = parseFloat(value);
    return (percent / 100) * dimension;
  }
  return parseFloat(value);
}

/**
 * Get offset based on anchor point.
 */
function getAnchorOffset(
  anchor: string | undefined,
  width: number,
  height: number
): { x: number; y: number } {
  switch (anchor) {
    case 'center':
      return { x: -width / 2, y: -height / 2 };
    case 'top-right':
      return { x: -width, y: 0 };
    case 'bottom-left':
      return { x: 0, y: -height };
    case 'bottom-right':
      return { x: -width, y: -height };
    case 'top-left':
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Map fit mode to SVG preserveAspectRatio.
 */
function getPreserveAspectRatio(fit?: 'cover' | 'contain' | 'fill'): string {
  switch (fit) {
    case 'cover':
      return 'xMidYMid slice';
    case 'fill':
      return 'none';
    case 'contain':
    default:
      return 'xMidYMid meet';
  }
}

// ============================================
// Ken Burns Helpers
// ============================================

/** Animation types that use CSS transforms (translate/scale). */
const SPATIAL_ANIMATION_TYPES = new Set([
  'panLeft', 'panRight', 'slowZoom', 'zoomIn', 'zoomOut',
]);

/**
 * Remap animation for Ken Burns inner-image rendering.
 *
 * Pure pan animations (panLeft/panRight) get remapped to combined slowZoom+pan
 * to maintain minimum scale and avoid revealing gaps at image edges.
 * zoomIn/zoomOut get remapped to slowZoom variants (no opacity change, which
 * is inappropriate for sustained ambient motion).
 */
function remapToKenBurns(anim: Animation): Animation {
  switch (anim.type) {
    case 'panLeft':
      return { ...anim, type: 'slowZoom', panDirection: 'left' };
    case 'panRight':
      return { ...anim, type: 'slowZoom', panDirection: 'right' };
    case 'zoomIn':
      return { ...anim, type: 'slowZoom', direction: 'in' };
    case 'zoomOut':
      return { ...anim, type: 'slowZoom', direction: 'out' };
    default:
      return anim; // slowZoom variants are already correct
  }
}

export default ImageLayer;
/**
 * ImageLayer Component
 *
 * Renders an image layer within an SVG block. Supports Ken Burns and other
 * animations via CSS classes. Images are rendered using SVG <image> element
 * with proper aspect ratio handling.
 */

import type { ImageLayer as ImageLayerType, Animation } from '@bendyline/squisq/schemas';
import { cssFilterForTreatment } from '@bendyline/squisq/doc';
import { getAnimationStyle } from '../utils/animationUtils';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';
import { useMediaUrl } from '../hooks/MediaContext';

interface ImageLayerProps {
  layer: ImageLayerType;
  /** Base path for resolving relative image URLs */
  basePath: string;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** Current time relative to block start (for animation timing) */
  blockTime: number;
  /** Whether authored and responsive image motion should run. */
  animationsEnabled?: boolean;
}

export function ImageLayer({
  layer,
  basePath,
  viewport,
  blockTime,
  animationsEnabled = true,
}: ImageLayerProps) {
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

  // Theme-derived photographic grade + optional blur, as a CSS filter
  // string (identical in the player and in headless frame capture).
  const filter = cssFilterForTreatment(content.treatment, content.blur);

  // SVG preserveAspectRatio based on fit mode
  const preserveAspectRatio = getPreserveAspectRatio(content.fit);
  const isCover = content.fit === 'cover';

  // Detect spatial (transform-based) animations that need Ken Burns treatment.
  // These animations should move the image *content* within fixed bounds rather
  // than shifting the entire image container.
  const isSpatialAnim = animation && SPATIAL_ANIMATION_TYPES.has(animation.type);

  // Wide cover photos lose most of their composition when centered inside a
  // portrait frame. For dominant imagery, scan the cover crop horizontally so
  // the whole width is revealed over time. `object-position` only moves when
  // the fitted image actually has horizontal overflow, so portrait sources stay
  // visually still. This path deliberately avoids the extra Ken Burns scale:
  // cover already scales the source by the minimum amount needed to fit one
  // viewport dimension.
  const usesPortraitPan =
    isCover && shouldUsePortraitPan(viewport, width, height, animationsEnabled, animation);

  if (usesPortraitPan) {
    const panClass = getPortraitPanClass(animation);
    const panStyle = getPortraitPanStyle(isSpatialAnim ? animation : undefined);
    // Entrance/opacity animations can safely run on the fixed container while
    // object-position pans the image. Spatial transforms are replaced by the
    // pan so they cannot zoom an already aggressive portrait crop.
    const containerAnim = isSpatialAnim ? { className: '', style: {} } : animStyle;

    return (
      <g
        className={`block-layer block-layer--image ${containerAnim.className}`}
        style={containerAnim.style}
        data-layer-id={layer.id}
        data-image-framing="portrait-pan"
      >
        <foreignObject x={finalX} y={finalY} width={width} height={height}>
          <div
            style={{
              width: `${width}px`,
              height: `${height}px`,
              overflow: 'hidden',
            }}
          >
            <img
              src={src}
              alt={content.alt || ''}
              className={panClass}
              style={{
                width: `${width}px`,
                height: `${height}px`,
                objectFit: 'cover',
                objectPosition: 'center',
                display: 'block',
                pointerEvents: 'none',
                ...(filter ? { filter } : {}),
                ...(content.blur && content.blur > 0 ? { transform: 'scale(1.06)' } : {}),
                ...panStyle,
              }}
            />
          </div>
        </foreignObject>
      </g>
    );
  }

  // Ken Burns mode: cover image with spatial animation.
  // Keep the container static, animate the inner <img> within clipped bounds.
  if (isCover && isSpatialAnim && animation) {
    const kbAnim = remapToKenBurns(animation);
    const kbStyle = getAnimationStyle(kbAnim, blockTime);

    return (
      <g className="block-layer block-layer--image" data-layer-id={layer.id}>
        <foreignObject x={finalX} y={finalY} width={width} height={height}>
          <div
            style={{
              width: `${width}px`,
              height: `${height}px`,
              overflow: 'hidden',
            }}
          >
            <img
              src={src}
              alt={content.alt || ''}
              className={kbStyle.className}
              style={{
                width: `${width}px`,
                height: `${height}px`,
                objectFit: 'cover',
                objectPosition: 'center',
                display: 'block',
                pointerEvents: 'none',
                transformOrigin: 'center center',
                ...(filter ? { filter } : {}),
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
              width: `${width}px`,
              height: `${height}px`,
              objectFit: 'cover',
              objectPosition: 'center',
              display: 'block',
              pointerEvents: 'none',
              ...(filter ? { filter } : {}),
              // Over-scan blurred imagery so the soft edges never reveal
              // the frame behind the layer.
              ...(content.blur && content.blur > 0 ? { transform: 'scale(1.06)' } : {}),
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
        style={{ pointerEvents: 'none', ...(filter ? { filter } : {}) }}
      />
    </g>
  );
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
const SPATIAL_ANIMATION_TYPES = new Set(['panLeft', 'panRight', 'slowZoom', 'zoomIn', 'zoomOut']);

/** Portrait threshold matches useViewportOrientation's 0.83 aspect cutoff. */
const PORTRAIT_ASPECT_CUTOFF = 0.83;

/**
 * Only auto-pan images that act as the slide's dominant visual. This keeps
 * photo-grid tiles, thumbnails, and small authored insets from all moving at
 * once while covering the full-screen autogenerated layouts.
 */
function shouldUsePortraitPan(
  viewport: { width: number; height: number },
  layerWidth: number,
  layerHeight: number,
  animationsEnabled: boolean,
  animation: Animation | undefined,
): boolean {
  if (!animationsEnabled || animation?.type === 'none') return false;
  if (viewport.width / viewport.height >= PORTRAIT_ASPECT_CUTOFF) return false;

  return layerWidth >= viewport.width * 0.7 && layerHeight >= viewport.height * 0.7;
}

/**
 * `panLeft` means the image moves left (the framing scans toward its right
 * edge); `panRight` is the reverse. Unspecified motion defaults to revealing
 * the source from left to right.
 */
function getPortraitPanClass(animation: Animation | undefined): string {
  const pansBack =
    animation?.type === 'panRight' ||
    (animation?.type === 'slowZoom' && animation.panDirection === 'right');
  return pansBack ? 'squisq-image--portrait-pan-left' : 'squisq-image--portrait-pan-right';
}

/** Use authored spatial timing when present, otherwise a slow ambient scan. */
function getPortraitPanStyle(animation: Animation | undefined): Record<string, string> {
  return {
    '--portrait-pan-duration': `${animation?.duration ?? 12}s`,
    '--portrait-pan-delay': `${animation?.delay ?? 0}s`,
    '--portrait-pan-easing': animation?.easing ?? 'ease-in-out',
  };
}

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

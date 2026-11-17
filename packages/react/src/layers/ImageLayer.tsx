/**
 * ImageLayer Component
 *
 * Renders an image layer within an SVG block. Supports Ken Burns and other
 * animations via CSS classes. Images are rendered using SVG <image> element
 * with proper aspect ratio handling.
 *
 * Cover images draw as an HTML <img> inside a <foreignObject> (object-fit),
 * and Ken Burns motion animates that <img>. WebKit paints an <img> there that
 * has any CSS filter or transform — a theme's photographic grade, a blur's
 * over-scan, a Ken Burns move — without the slide's scale, over the layers
 * above it, and it ignores CSS filter functions on SVG elements. So on WebKit
 * the grade is an equivalent SVG <filter> on the group around the
 * foreignObject, the over-scan a larger box, and Ken Burns runs on an SVG
 * <image> (utils/foreignObjectPaint.ts, utils/svgFilter.tsx).
 */

import { useId, type CSSProperties, type ReactNode } from 'react';
import type { ImageLayer as ImageLayerType, Animation } from '@bendyline/squisq/schemas';
import { cssFilterForTreatment } from '@bendyline/squisq/doc';
import { getAnimationStyle } from '../utils/animationUtils';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';
import { useMediaUrl } from '../hooks/MediaContext';
import { paintsForeignObjectLayersUnscaled } from '../utils/foreignObjectPaint';
import { svgFilterFromCss } from '../utils/svgFilter';
import { defsIdFor } from '../utils/defsId';

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
  /** Draw an SVG image as a still (no animation inside it), for capture. */
  isStatic?: boolean;
}

export function ImageLayer({
  layer,
  basePath,
  viewport,
  blockTime,
  animationsEnabled = true,
  isStatic = false,
}: ImageLayerProps) {
  const { content, position, animation } = layer;
  const defsId = defsIdFor(useId(), layer.id);

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
  const src = useMediaUrl(content.src, basePath, { staticSvg: isStatic });

  // Get animation styles
  const animStyle = getAnimationStyle(animation, blockTime);

  // Theme-derived photographic grade + optional blur, as a CSS filter
  // string (identical in the player and in headless frame capture).
  const filter = cssFilterForTreatment(content.treatment, content.blur);

  // SVG preserveAspectRatio based on fit mode
  const preserveAspectRatio = getPreserveAspectRatio(content.fit);
  const isCover = content.fit === 'cover';
  // WebKit draws an <img> with a CSS filter or transform unscaled over the
  // slide (see the component docs): there the grade is an SVG filter on the
  // group around the foreignObject and the blur's over-scan a larger box.
  const svgNative = paintsForeignObjectLayersUnscaled();
  const gradeId = `${defsId}-grade`;
  const svgGrade = svgNative ? svgFilterFromCss(gradeId, filter) : null;
  const blurred = Boolean(content.blur && content.blur > 0);
  const imgGrade: CSSProperties = svgNative
    ? blurred
      ? {
          width: `${width * BLUR_OVERSCAN}px`,
          height: `${height * BLUR_OVERSCAN}px`,
          margin: `${(-height * (BLUR_OVERSCAN - 1)) / 2}px 0 0 ${(-width * (BLUR_OVERSCAN - 1)) / 2}px`,
          maxWidth: 'none',
        }
      : {}
    : {
        ...(filter ? { filter } : {}),
        // Over-scan blurred imagery so the soft edges never reveal the frame
        // behind the layer.
        ...(blurred ? { transform: `scale(${BLUR_OVERSCAN})` } : {}),
      };
  const graded = (children: ReactNode): ReactNode =>
    svgGrade ? (
      <>
        <defs>{svgGrade}</defs>
        <g filter={`url(#${gradeId})`}>{children}</g>
      </>
    ) : (
      children
    );

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
        {graded(
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
                  ...imgGrade,
                  ...panStyle,
                }}
              />
            </div>
          </foreignObject>,
        )}
      </g>
    );
  }

  // Ken Burns mode: cover image with spatial animation.
  // Keep the container static, animate the inner <img> within clipped bounds.
  if (isCover && isSpatialAnim && animation) {
    const kbAnim = remapToKenBurns(animation);
    const kbStyle = getAnimationStyle(kbAnim, blockTime);

    // WebKit paints the animated <img> without the slide's scale (see
    // utils/foreignObjectPaint.ts), so there the same keyframes run on an SVG
    // <image>, clipped by a nested <svg> the size of the layer.
    if (svgNative) {
      return (
        <g
          className="block-layer block-layer--image"
          data-layer-id={layer.id}
          data-image-framing="svg-ken-burns"
        >
          <SvgCoverImage
            layerId={layer.id}
            src={src}
            alt={content.alt}
            box={{ x: finalX, y: finalY, width, height }}
            grade={svgGrade}
            gradeId={gradeId}
            className={kbStyle.className}
            style={kbStyle.style}
          />
        </g>
      );
    }

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
        {graded(
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
                ...imgGrade,
              }}
            />
          </foreignObject>,
        )}
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
      {svgGrade && <defs>{svgGrade}</defs>}
      <image
        href={src}
        x={finalX}
        y={finalY}
        width={width}
        height={height}
        preserveAspectRatio={preserveAspectRatio}
        filter={svgGrade ? `url(#${defsId}-grade)` : undefined}
        style={{ pointerEvents: 'none', ...(filter && !svgGrade ? { filter } : {}) }}
      />
    </g>
  );
}

/**
 * A cover-fitted SVG `<image>` clipped to its layer box, graded by an SVG
 * filter: the WebKit form of the Ken Burns `<img>`, whose moving transform
 * WebKit would otherwise paint unscaled.
 */
function SvgCoverImage({
  layerId,
  src,
  alt,
  box,
  grade,
  gradeId,
  className,
  style,
}: {
  layerId: string;
  src: string;
  alt?: string;
  box: { x: number; y: number; width: number; height: number };
  grade: ReturnType<typeof svgFilterFromCss>;
  gradeId: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { x, y, width, height } = box;
  return (
    <svg
      x={x}
      y={y}
      width={width}
      height={height}
      style={{ overflow: 'hidden' }}
      data-image-layer={layerId}
    >
      {grade && <defs>{grade}</defs>}
      <image
        href={src}
        width={width}
        height={height}
        preserveAspectRatio="xMidYMid slice"
        className={className}
        filter={grade ? `url(#${gradeId})` : undefined}
        {...(alt ? { role: 'img', 'aria-label': alt } : {})}
        style={{
          pointerEvents: 'none',
          transformBox: 'fill-box',
          transformOrigin: 'center center',
          ...style,
        }}
      />
    </svg>
  );
}

/** How far a blurred photo is over-scanned, so its soft edge stays outside the frame. */
const BLUR_OVERSCAN = 1.06;

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

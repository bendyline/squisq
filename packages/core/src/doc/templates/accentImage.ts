/**
 * Accent Image Utility
 *
 * Creates image layers and layout adjustments for accent images on text-based slides.
 * Accent images are tasteful additions that complement text without overwhelming it.
 *
 * Layout patterns:
 * - left-strip: 35% width vertical strip on left, text area shifted to right 65%
 * - right-strip: 35% width vertical strip on right, text area shifted to left 65%
 * - bottom-strip: 35% height horizontal strip at bottom, text area in upper 65%
 * - corner-inset: Small 25% corner image with gradient vignette
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer, ImageLayer, ShapeLayer, Animation } from '../../schemas/Doc.js';
import type { AccentImage, AccentPosition } from '../../schemas/BlockTemplates.js';

/**
 * Layout adjustments when an accent image is present.
 * Templates use these values to reposition their text content.
 */
export interface AccentLayout {
  /** X offset for text center (e.g., '64%' for left-strip) */
  textCenterX: string;
  /** Width available for text content */
  textWidth: string;
  /** Y offset adjustment for vertical positioning */
  textYAdjust: number;
  /** Whether to adjust Y positions (for bottom-strip) */
  adjustY: boolean;
}

/**
 * Default layout when no accent image is present.
 */
export const DEFAULT_LAYOUT: AccentLayout = {
  textCenterX: '50%',
  textWidth: '85%',
  textYAdjust: 0,
  adjustY: false,
};

/**
 * Map ambientMotion values to proper Ken Burns animations.
 * Matches the mapping in imageWithCaption.ts — uses slowZoom variants
 * which provide smooth pan/zoom without opacity changes.
 */
function mapAmbientMotion(motion: AccentImage['ambientMotion']): Animation | undefined {
  if (!motion) return undefined;
  switch (motion) {
    case 'zoomIn':
      return { type: 'slowZoom', direction: 'in', duration: 15 };
    case 'zoomOut':
      return { type: 'slowZoom', direction: 'out', duration: 15 };
    case 'panLeft':
      return { type: 'slowZoom', panDirection: 'left', duration: 15 };
    case 'panRight':
      return { type: 'slowZoom', panDirection: 'right', duration: 15 };
    default:
      return undefined;
  }
}

/**
 * Accent strip width/height as percentage.
 * 35% gives the image enough presence to complement the text without overwhelming it.
 */
const STRIP_SIZE = 35;
const STRIP_SIZE_PCT = `${STRIP_SIZE}%`;

/**
 * Get layout adjustments based on accent position.
 */
export function getAccentLayout(position: AccentPosition): AccentLayout {
  switch (position) {
    case 'left-strip':
      return {
        textCenterX: `${50 + STRIP_SIZE / 2}%`, // Shift center right
        textWidth: `${100 - STRIP_SIZE - 8}%`,   // Leave margin
        textYAdjust: 0,
        adjustY: false,
      };
    case 'right-strip':
      return {
        textCenterX: `${50 - STRIP_SIZE / 2}%`, // Shift center left
        textWidth: `${100 - STRIP_SIZE - 8}%`,
        textYAdjust: 0,
        adjustY: false,
      };
    case 'bottom-strip':
      return {
        textCenterX: '50%',
        textWidth: '85%',
        textYAdjust: -10, // Shift content up by 10%
        adjustY: true,
      };
    case 'corner-inset':
      return {
        textCenterX: '45%', // Slight shift to avoid corner
        textWidth: '70%',
        textYAdjust: 0,
        adjustY: false,
      };
    default:
      return DEFAULT_LAYOUT;
  }
}

/**
 * Create layers for an accent image.
 * Returns the image layer and any overlay/gradient layers needed.
 */
export function createAccentLayers(
  accent: AccentImage,
  slideId: string
): Layer[] {
  const layers: Layer[] = [];
  const { src, alt, position, ambientMotion, credit, license } = accent;

  switch (position) {
    case 'left-strip':
      layers.push(createStripImage(src, alt, 'left', slideId, ambientMotion, credit, license));
      layers.push(createStripGradient('left', slideId));
      break;

    case 'right-strip':
      layers.push(createStripImage(src, alt, 'right', slideId, ambientMotion, credit, license));
      layers.push(createStripGradient('right', slideId));
      break;

    case 'bottom-strip':
      layers.push(createBottomStripImage(src, alt, slideId, ambientMotion, credit, license));
      layers.push(createBottomStripGradient(slideId));
      break;

    case 'corner-inset':
      layers.push(createCornerInsetImage(src, alt, slideId, ambientMotion, credit, license));
      layers.push(createCornerVignette(slideId));
      break;
  }

  return layers;
}

/**
 * Create a vertical strip image layer.
 */
function createStripImage(
  src: string,
  alt: string,
  side: 'left' | 'right',
  slideId: string,
  ambientMotion?: AccentImage['ambientMotion'],
  credit?: string,
  license?: string,
): ImageLayer {
  return {
    type: 'image',
    id: `${slideId}-accent-img`,
    content: {
      src,
      alt,
      fit: 'cover',
      credit,
      license,
    },
    position: {
      x: side === 'left' ? 0 : `${100 - STRIP_SIZE}%`,
      y: 0,
      width: STRIP_SIZE_PCT,
      height: '100%',
    },
    animation: mapAmbientMotion(ambientMotion),
  };
}

/**
 * Create a gradient overlay for strip images (fades to background).
 */
function createStripGradient(
  side: 'left' | 'right',
  slideId: string
): ShapeLayer {
  // Gradient from transparent to background color at the edge
  const gradientId = side === 'left' ? 'accent-gradient-left' : 'accent-gradient-right';

  return {
    type: 'shape',
    id: `${slideId}-accent-fade`,
    content: {
      shape: 'rect',
      // SVG gradient will be handled by the renderer
      // Using a semi-transparent overlay as fallback
      fill: `url(#${gradientId})`,
    },
    position: {
      x: side === 'left' ? `${STRIP_SIZE - 8}%` : `${100 - STRIP_SIZE}%`,
      y: 0,
      width: '10%',
      height: '100%',
    },
  };
}

/**
 * Create a horizontal bottom strip image layer.
 */
function createBottomStripImage(
  src: string,
  alt: string,
  slideId: string,
  ambientMotion?: AccentImage['ambientMotion'],
  credit?: string,
  license?: string,
): ImageLayer {
  return {
    type: 'image',
    id: `${slideId}-accent-img`,
    content: {
      src,
      alt,
      fit: 'cover',
      credit,
      license,
    },
    position: {
      x: 0,
      y: `${100 - STRIP_SIZE}%`,
      width: '100%',
      height: STRIP_SIZE_PCT,
    },
    animation: mapAmbientMotion(ambientMotion),
  };
}

/**
 * Create a gradient overlay for bottom strip (fades up to background).
 */
function createBottomStripGradient(slideId: string): ShapeLayer {
  return {
    type: 'shape',
    id: `${slideId}-accent-fade`,
    content: {
      shape: 'rect',
      fill: 'url(#accent-gradient-bottom)',
    },
    position: {
      x: 0,
      y: `${100 - STRIP_SIZE - 8}%`,
      width: '100%',
      height: '12%',
    },
  };
}

/**
 * Create a corner inset image layer.
 */
function createCornerInsetImage(
  src: string,
  alt: string,
  slideId: string,
  ambientMotion?: AccentImage['ambientMotion'],
  credit?: string,
  license?: string,
): ImageLayer {
  return {
    type: 'image',
    id: `${slideId}-accent-img`,
    content: {
      src,
      alt,
      fit: 'cover',
      credit,
      license,
    },
    position: {
      x: '70%',
      y: '60%',
      width: '28%',
      height: '38%',
      anchor: 'top-left',
    },
    animation: mapAmbientMotion(ambientMotion) ?? { type: 'fadeIn', duration: 2, delay: 0.5 },
  };
}

/**
 * Create a vignette overlay around corner inset.
 */
function createCornerVignette(slideId: string): ShapeLayer {
  return {
    type: 'shape',
    id: `${slideId}-accent-vignette`,
    content: {
      shape: 'rect',
      fill: 'url(#accent-vignette-corner)',
      borderRadius: 8,
    },
    position: {
      x: '69%',
      y: '59%',
      width: '30%',
      height: '40%',
    },
  };
}

/**
 * Adjust a Y position value based on accent layout.
 * Used by templates to shift content when bottom-strip is present.
 */
export function adjustY(
  originalY: string | number,
  layout: AccentLayout
): string {
  if (!layout.adjustY || layout.textYAdjust === 0) {
    return typeof originalY === 'number' ? `${originalY}%` : originalY;
  }

  // Parse percentage value
  const yStr = typeof originalY === 'number' ? `${originalY}` : originalY;
  const match = yStr.match(/^(\d+(?:\.\d+)?)\s*%?$/);

  if (match) {
    const yValue = parseFloat(match[1]);
    const adjusted = Math.max(5, yValue + layout.textYAdjust);
    return `${adjusted}%`;
  }

  return yStr;
}

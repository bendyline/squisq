/**
 * Layout Strategy
 *
 * Provides orientation-specific layout hints for slide templates.
 * Templates use these hints to position content appropriately for
 * different aspect ratios (landscape, portrait, square).
 *
 * Key adaptations by orientation:
 * - Portrait: Larger relative text, stacked layouts instead of side-by-side
 * - Square: Balanced layout with moderate adjustments
 * - Landscape: Default/reference layout
 */

import type { ViewportOrientation, ViewportConfig } from './Viewport.js';
import { calculateFontScale } from './Viewport.js';

/**
 * Layout hints for template positioning based on orientation.
 */
export interface LayoutHints {
  /** Primary content Y position (percentage string, e.g., "35%") */
  primaryY: string;
  /** Secondary content Y position (percentage string) */
  secondaryY: string;
  /** Tertiary/detail Y position (percentage string) */
  tertiaryY: string;
  /** Title font size multiplier (relative to base) */
  titleScale: number;
  /** Body text font size multiplier (relative to base) */
  bodyScale: number;
  /** Two-column: left X position (percentage string) */
  columnLeftX: string;
  /** Two-column: right X position (percentage string) */
  columnRightX: string;
  /** Two-column in portrait: top Y position for stacked layout */
  columnTopY: string;
  /** Two-column in portrait: bottom Y position for stacked layout */
  columnBottomY: string;
  /** Whether two-column should stack vertically */
  stackColumns: boolean;
  /** Max text width (percentage string) for wrapping */
  maxTextWidth: string;
  /** Horizontal padding from edges (percentage string) */
  horizontalPadding: string;
  /** Caption position Y for imageWithCaption (percentage string) */
  captionY: string;
  /** Caption font size multiplier */
  captionScale: number;
}

/**
 * Layout configurations by orientation.
 */
const LAYOUT_CONFIGS: Record<ViewportOrientation, LayoutHints> = {
  landscape: {
    primaryY: '35%',
    secondaryY: '55%',
    tertiaryY: '75%',
    titleScale: 1.0,
    bodyScale: 1.0,
    columnLeftX: '25%',
    columnRightX: '75%',
    columnTopY: '35%',
    columnBottomY: '65%',
    stackColumns: false,
    maxTextWidth: '80%',
    horizontalPadding: '10%',
    captionY: '85%',
    captionScale: 1.0,
  },
  portrait: {
    // Content positioned higher for thumb-reach zone on mobile
    primaryY: '25%',
    secondaryY: '42%',
    tertiaryY: '58%',
    // Titles scale down for narrower width; body text scales up to fill vertical space
    titleScale: 0.7,
    bodyScale: 1.5,
    // Stacked columns instead of side-by-side
    columnLeftX: '50%',
    columnRightX: '50%',
    columnTopY: '30%',
    columnBottomY: '55%',
    stackColumns: true,
    // Wider relative to viewport to use available space
    maxTextWidth: '90%',
    horizontalPadding: '5%',
    captionY: '75%',
    captionScale: 0.85,
  },
  square: {
    primaryY: '30%',
    secondaryY: '50%',
    tertiaryY: '70%',
    titleScale: 0.85,
    bodyScale: 0.9,
    columnLeftX: '25%',
    columnRightX: '75%',
    columnTopY: '35%',
    columnBottomY: '65%',
    stackColumns: false,
    maxTextWidth: '85%',
    horizontalPadding: '7.5%',
    captionY: '82%',
    captionScale: 0.9,
  },
};

/**
 * Get layout hints for a given orientation.
 */
export function getLayoutHints(orientation: ViewportOrientation): LayoutHints {
  return LAYOUT_CONFIGS[orientation];
}

/**
 * Calculate a scaled font size based on viewport and layout hints.
 *
 * @param basePx - Base font size in pixels (designed for 1920x1080)
 * @param viewport - Target viewport configuration
 * @param orientation - Viewport orientation
 * @param isTitle - Whether this is title text (uses titleScale) or body (uses bodyScale)
 */
export function scaledFontSize(
  basePx: number,
  viewport: ViewportConfig,
  orientation: ViewportOrientation,
  isTitle: boolean = false,
): number {
  const fontScale = calculateFontScale(viewport);
  const layout = getLayoutHints(orientation);
  const typeScale = isTitle ? layout.titleScale : layout.bodyScale;
  return Math.round(basePx * fontScale * typeScale);
}

/**
 * Get position for two-column layout based on orientation.
 * Returns { left: {x, y}, right: {x, y} } positions.
 */
export function getTwoColumnPositions(orientation: ViewportOrientation): {
  left: { x: string; y: string };
  right: { x: string; y: string };
} {
  const layout = getLayoutHints(orientation);

  if (layout.stackColumns) {
    // Portrait: stack vertically
    return {
      left: { x: '50%', y: layout.columnTopY },
      right: { x: '50%', y: layout.columnBottomY },
    };
  }

  // Landscape/square: side by side
  return {
    left: { x: layout.columnLeftX, y: '50%' },
    right: { x: layout.columnRightX, y: '50%' },
  };
}

/**
 * Get safe text bounds for a given orientation.
 * Returns margins to keep text away from edges.
 */
export function getSafeTextBounds(orientation: ViewportOrientation): {
  left: string;
  right: string;
  top: string;
  bottom: string;
} {
  const layout = getLayoutHints(orientation);
  return {
    left: layout.horizontalPadding,
    right: layout.horizontalPadding,
    top: '10%',
    bottom: '10%',
  };
}

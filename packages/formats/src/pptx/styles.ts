/**
 * PPTX Constants & Style Definitions
 *
 * Shared constants for PPTX export: slide dimensions, text box positioning,
 * font sizes, and unit conversion helpers. All dimensions are in EMU
 * (English Metric Units) unless otherwise noted.
 *
 * 1 inch = 914400 EMU
 * 1 point = 12700 EMU
 * Font sizes in PPTX are in hundredths of a point (centi-points).
 */

// ============================================
// Slide Dimensions (EMU)
// ============================================

/** Widescreen slide width: 10 inches */
export const SLIDE_WIDTH = 9144000;

/** Widescreen slide height: 7.5 inches */
export const SLIDE_HEIGHT = 6858000;

// ============================================
// Title Shape Positioning (EMU)
// ============================================

/** Title shape left offset: 0.5 inches */
export const TITLE_LEFT = 457200;

/** Title shape top offset: 0.3 inches */
export const TITLE_TOP = 274638;

/** Title shape width: 9 inches */
export const TITLE_WIDTH = 8229600;

/** Title shape height: 1.25 inches */
export const TITLE_HEIGHT = 1143000;

// ============================================
// Body Shape Positioning (EMU)
// ============================================

/** Body shape left offset: 0.5 inches */
export const BODY_LEFT = 457200;

/** Body shape top offset: 1.75 inches */
export const BODY_TOP = 1600200;

/** Body shape width: 9 inches */
export const BODY_WIDTH = 8229600;

/** Body shape height: 4.95 inches */
export const BODY_HEIGHT = 4525963;

// ============================================
// Default Fonts & Sizes
// ============================================

/** Default font for body text */
export const DEFAULT_FONT = 'Calibri';

/** Default font for titles */
export const DEFAULT_TITLE_FONT = 'Calibri Light';

/** Default font for code blocks */
export const DEFAULT_CODE_FONT = 'Consolas';

/** Default title font size in centi-points (44pt) */
export const DEFAULT_TITLE_SIZE = 4400;

/** Default body font size in centi-points (18pt) */
export const DEFAULT_BODY_SIZE = 1800;

/** Default code font size in centi-points (14pt) */
export const DEFAULT_CODE_SIZE = 1400;

/** Hyperlink color (standard blue) */
export const HYPERLINK_COLOR = '0563C1';

// ============================================
// Unit Helpers
// ============================================

/**
 * Convert inches to EMUs.
 */
export function inchesToEmu(inches: number): number {
  return Math.round(inches * 914400);
}

/**
 * Convert points to centi-points (PPTX font size unit).
 */
export function pointsToCentiPoints(points: number): number {
  return Math.round(points * 100);
}

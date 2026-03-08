/**
 * DOCX Constants & Style Definitions
 *
 * Shared constants for DOCX import and export: built-in style IDs,
 * numbering format mappings, content type strings, and default
 * formatting values.
 */

// ============================================
// Built-in Style IDs
// ============================================

/**
 * Word built-in paragraph style IDs → heading depth.
 * These are the default style IDs in Word's Normal.dotm template.
 * Import uses these to detect heading levels from pStyle values.
 */
export const HEADING_STYLE_MAP: Record<string, number> = {
  Heading1: 1,
  Heading2: 2,
  Heading3: 3,
  Heading4: 4,
  Heading5: 5,
  Heading6: 6,
  heading1: 1,
  heading2: 2,
  heading3: 3,
  heading4: 4,
  heading5: 5,
  heading6: 6,
  // Some localized/legacy variants
  Title: 1,
  Subtitle: 2,
};

/**
 * Heading depth → Word style ID mapping (for export).
 */
export const DEPTH_TO_STYLE_ID: Record<number, string> = {
  1: 'Heading1',
  2: 'Heading2',
  3: 'Heading3',
  4: 'Heading4',
  5: 'Heading5',
  6: 'Heading6',
};

/**
 * Paragraph style IDs that map to blockquotes on import.
 */
export const QUOTE_STYLE_IDS = new Set([
  'Quote',
  'IntenseQuote',
  'quote',
  'BlockQuote',
]);

/**
 * Paragraph style ID for code blocks.
 */
export const CODE_STYLE_IDS = new Set([
  'Code',
  'CodeBlock',
  'HTMLCode',
  'PlainText',
]);

/**
 * Character style IDs that indicate inline code.
 */
export const INLINE_CODE_STYLE_IDS = new Set([
  'CodeChar',
  'HTMLCodeChar',
  'VerbatimChar',
]);

// ============================================
// Numbering Formats
// ============================================

/**
 * Word numbering format values that indicate an unordered (bullet) list.
 */
export const BULLET_NUM_FORMATS = new Set([
  'bullet',
  'none',
]);

/**
 * Word numbering format values that indicate an ordered (numbered) list.
 */
export const ORDERED_NUM_FORMATS = new Set([
  'decimal',
  'upperRoman',
  'lowerRoman',
  'upperLetter',
  'lowerLetter',
  'ordinal',
  'cardinalText',
  'ordinalText',
]);

// ============================================
// Default Formatting
// ============================================

/** Default font family for document body text */
export const DEFAULT_FONT = 'Calibri';

/** Default font family for headings */
export const DEFAULT_HEADING_FONT = 'Calibri Light';

/** Default font size in half-points (22 = 11pt) */
export const DEFAULT_FONT_SIZE_HALF_POINTS = 22;

/** Default code font */
export const DEFAULT_CODE_FONT = 'Consolas';

/** Default code font size in half-points (20 = 10pt) */
export const DEFAULT_CODE_FONT_SIZE = 20;

/**
 * Heading font sizes in half-points (Word default sizes).
 */
export const HEADING_FONT_SIZES: Record<number, number> = {
  1: 32, // 16pt
  2: 26, // 13pt
  3: 24, // 12pt
  4: 22, // 11pt
  5: 22, // 11pt
  6: 22, // 11pt
};

/** Hyperlink color (standard Word blue) */
export const HYPERLINK_COLOR = '0563C1';

// ============================================
// EMU (English Metric Units) Helpers
// ============================================

/**
 * Convert inches to EMUs (English Metric Units).
 * 1 inch = 914400 EMUs.
 */
export function inchesToEmu(inches: number): number {
  return Math.round(inches * 914400);
}

/**
 * Convert points to half-points (Word's internal unit for font sizes).
 */
export function pointsToHalfPoints(points: number): number {
  return Math.round(points * 2);
}

/**
 * Convert points to twentieths of a point (twips), used for spacing/margins.
 * 1 point = 20 twips.
 */
export function pointsToTwips(points: number): number {
  return Math.round(points * 20);
}

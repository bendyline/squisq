/**
 * PDF Style / Layout Constants
 *
 * Shared constants used by both PDF export and import. Defines page
 * dimensions, margins, font sizes, colours, and spacing for rendering
 * MarkdownDocument content as a paginated PDF.
 */

// ============================================
// Page Layout
// ============================================

/** Standard US Letter page width in points (8.5 in × 72 pt/in). */
export const PAGE_WIDTH_LETTER = 612;

/** Standard US Letter page height in points (11 in × 72 pt/in). */
export const PAGE_HEIGHT_LETTER = 792;

/** A4 page width in points (210 mm ≈ 595 pt). */
export const PAGE_WIDTH_A4 = 595.28;

/** A4 page height in points (297 mm ≈ 842 pt). */
export const PAGE_HEIGHT_A4 = 841.89;

/** Default page margins in points (1 inch = 72 pt). */
export const DEFAULT_MARGIN = 72;

// ============================================
// Fonts — pdf-lib standard font names
// ============================================

export const FONT_REGULAR = 'Helvetica';
export const FONT_BOLD = 'Helvetica-Bold';
export const FONT_ITALIC = 'Helvetica-Oblique';
export const FONT_BOLD_ITALIC = 'Helvetica-BoldOblique';
export const FONT_MONO = 'Courier';
export const FONT_MONO_BOLD = 'Courier-Bold';

// ============================================
// Font Sizes
// ============================================

/** Default body font size in points. */
export const DEFAULT_FONT_SIZE = 11;

/** Heading font sizes indexed by depth (1-based). */
export const HEADING_SIZES: Record<number, number> = {
  1: 24,
  2: 20,
  3: 16,
  4: 14,
  5: 13,
  6: 12,
};

/** Font size used for code blocks and inline code. */
export const CODE_FONT_SIZE = 10;

// ============================================
// Spacing (in points)
// ============================================

/** Line height multiplier (leading). */
export const LINE_HEIGHT_FACTOR = 1.4;

/** Space above a heading. */
export const HEADING_SPACE_BEFORE = 18;

/** Space below a heading. */
export const HEADING_SPACE_AFTER = 6;

/** Space between paragraphs. */
export const PARAGRAPH_SPACING = 8;

/** Extra indent per list nesting level. */
export const LIST_INDENT = 24;

/** Bullet character for unordered lists. */
export const BULLET_CHAR = '\u2022'; // •

/** Indent for blockquotes. */
export const BLOCKQUOTE_INDENT = 24;

/** Width of the blockquote left bar. */
export const BLOCKQUOTE_BAR_WIDTH = 3;

// ============================================
// Colours (RGB 0-1)
// ============================================

export const COLOR_TEXT = { r: 0.12, g: 0.12, b: 0.14 };
export const COLOR_HEADING = { r: 0.08, g: 0.08, b: 0.10 };
export const COLOR_LINK = { r: 0.05, g: 0.27, b: 0.73 };
export const COLOR_CODE_BG = { r: 0.95, g: 0.95, b: 0.97 };
export const COLOR_CODE_TEXT = { r: 0.20, g: 0.20, b: 0.22 };
export const COLOR_BLOCKQUOTE_BAR = { r: 0.75, g: 0.75, b: 0.78 };
export const COLOR_BLOCKQUOTE_TEXT = { r: 0.35, g: 0.35, b: 0.38 };
export const COLOR_THEMATIC_BREAK = { r: 0.78, g: 0.78, b: 0.80 };
export const COLOR_TABLE_BORDER = { r: 0.75, g: 0.75, b: 0.78 };
export const COLOR_TABLE_HEADER_BG = { r: 0.93, g: 0.93, b: 0.95 };

// ============================================
// Table Constants
// ============================================

/** Table cell horizontal padding in points. */
export const TABLE_CELL_PAD_X = 6;

/** Table cell vertical padding in points. */
export const TABLE_CELL_PAD_Y = 4;

/** Table border line width. */
export const TABLE_BORDER_WIDTH = 0.5;

// ============================================
// Import Heuristic Thresholds
// ============================================

/**
 * Minimum font size (in PDF points) to consider as a heading.
 * Anything ≥ this and larger than the detected body size is a heading.
 */
export const IMPORT_HEADING_MIN_SIZE = 13;

/**
 * Font size ranges mapped to heading depth for import heuristics.
 * Applied when a text item's font size exceeds the body size.
 */
export const IMPORT_HEADING_SIZE_RANGES: Array<{ min: number; depth: number }> = [
  { min: 22, depth: 1 },
  { min: 18, depth: 2 },
  { min: 15, depth: 3 },
  { min: 13.5, depth: 4 },
  { min: 12.5, depth: 5 },
  { min: 12, depth: 6 },
];

/**
 * Y-distance (in points) between lines that implies a paragraph break
 * rather than a continuation of the same paragraph.
 */
export const IMPORT_PARAGRAPH_GAP = 4;

/**
 * Characters that indicate an unordered list bullet at the start of a line.
 */
export const IMPORT_BULLET_CHARS = new Set(['\u2022', '\u2023', '\u25E6', '\u2043', '-', '*', '\u2013', '\u2014', '\u25AA', '\u25AB']);

/**
 * Regex to detect an ordered list prefix (e.g. "1.", "2)", "iv.").
 */
export const IMPORT_ORDERED_PREFIX = /^(\d+|[a-z]+|[ivxlcdm]+)[.)]\s/i;

/**
 * Column alignment tolerance — text items whose x-positions differ by
 * less than this are considered to be in the same column (for table detection).
 */
export const IMPORT_COLUMN_TOLERANCE = 8;

/**
 * Minimum number of consecutive rows with the same column count to
 * consider them a table.
 */
export const IMPORT_TABLE_MIN_ROWS = 2;

/**
 * URL pattern for detecting links in extracted text.
 */
export const IMPORT_URL_PATTERN = /https?:\/\/[^\s)>\]]+/g;

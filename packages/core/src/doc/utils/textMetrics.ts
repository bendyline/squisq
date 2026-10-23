/**
 * textMetrics
 *
 * Font-agnostic text width estimates for templates that must lay out
 * geometry before any font can be measured (templates run headless, in
 * Node and in the player alike). Renderers fit text into the boxes they
 * are given; these estimates only decide how much room a label column or
 * legend should take, so a couple of pixels either way is harmless.
 *
 * Related files:
 * - doc/templates/timelineBlock.ts — sizes the track-label column
 * - doc/templates/chart/layout.ts — legend and axis label widths (chart-local constant)
 */

/** Average advance width of Latin text as a fraction of the font size. */
export const AVERAGE_CHAR_WIDTH_EM = 0.62;

/** Bold weights run a little wider. */
export const BOLD_CHAR_WIDTH_EM = 0.66;

/** Estimated advance width of `text` at `fontSize` px. */
export function estimateTextWidth(
  text: string,
  fontSize: number,
  charWidthEm: number = AVERAGE_CHAR_WIDTH_EM,
): number {
  return text.length * fontSize * charWidthEm;
}

/**
 * Bold display-type advance widths by character class, in em. Measured from
 * the bold weights of PT Serif, Georgia, PT Sans and Inter and set near their
 * middle, so a title column sized from them is within a few percent for the
 * built-in title faces (a flat average is off by ±15% between "Marcahuamachuco"
 * and "Falkland Islands").
 */
const DISPLAY_CHAR_EM = {
  space: 0.27,
  narrowLower: 0.36,
  wideLower: 0.86,
  lower: 0.57,
  narrowUpper: 0.4,
  wideUpper: 0.95,
  upper: 0.7,
  digit: 0.57,
  punct: 0.34,
  other: 0.62,
} as const;

function displayCharEm(ch: string): number {
  if (ch === ' ') return DISPLAY_CHAR_EM.space;
  if ('fijlrt'.includes(ch)) return DISPLAY_CHAR_EM.narrowLower;
  if (ch === 'm' || ch === 'w') return DISPLAY_CHAR_EM.wideLower;
  if (ch >= 'a' && ch <= 'z') return DISPLAY_CHAR_EM.lower;
  if (ch === 'I' || ch === 'J') return DISPLAY_CHAR_EM.narrowUpper;
  if (ch === 'M' || ch === 'W') return DISPLAY_CHAR_EM.wideUpper;
  if (ch >= 'A' && ch <= 'Z') return DISPLAY_CHAR_EM.upper;
  if (ch >= '0' && ch <= '9') return DISPLAY_CHAR_EM.digit;
  if (".,:;-/'’!?()".includes(ch)) return DISPLAY_CHAR_EM.punct;
  return DISPLAY_CHAR_EM.other;
}

/**
 * Estimated advance width of one line of bold display type (titles) at
 * `fontSize` px, by character class. Accents are ignored (they do not widen
 * a glyph). For laying a panel snugly around a title; renderers that must
 * never overflow still fit the real glyphs to the box.
 */
export function estimateDisplayTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text.normalize('NFD').replace(/\p{M}/gu, '')) em += displayCharEm(ch);
  return em * fontSize;
}

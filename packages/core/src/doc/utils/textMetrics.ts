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

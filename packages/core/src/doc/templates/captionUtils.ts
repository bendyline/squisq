/**
 * Template Utilities
 *
 * Shared helpers for doc block templates:
 * - Caption text cleaning
 * - Common layer construction patterns
 */

import type { Layer } from '../../schemas/Doc.js';

const TRAILING_PUNCT_RE = /[.;:!?]+$/;

/**
 * Strip trailing punctuation from a caption string.
 * Image captions on blocks look cleaner without terminal periods,
 * semicolons, or other sentence-ending punctuation.
 */
export function cleanCaption(text: string): string {
  return text.replace(TRAILING_PUNCT_RE, '').trim();
}

/**
 * Create a full-screen background shape layer.
 * Most text-based templates start with this as their first layer.
 */
export function createBackgroundLayer(id: string, fill: string): Layer {
  return {
    type: 'shape',
    id,
    content: { shape: 'rect', fill },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
  };
}

/**
 * Estimate the rendered height (px) of a wrapped text block.
 *
 * Templates are pure functions with no access to real text metrics, but
 * stacked lockups (quote + attribution, fact + explanation + source) need
 * to place each element relative to the previous one instead of at fixed
 * slots — fixed slots leave 200px voids for short content and collide for
 * long content. The 0.52 average-glyph-width factor is tuned for the
 * sans/serif faces the built-in themes use; it only needs to be right
 * within ~20% for spacing purposes.
 */
export function estimateTextHeight(
  text: string,
  fontSizePx: number,
  maxWidthPx: number,
  lineHeight: number,
): number {
  const avgCharWidth = fontSizePx * 0.52;
  const charsPerLine = Math.max(8, Math.floor(maxWidthPx / avgCharWidth));
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  return lines * fontSizePx * lineHeight;
}

/**
 * Mirror the renderer's character-based wrapping closely enough to reserve
 * vertical space for an independently positioned text layer. Word-aware: a
 * word longer than the line is broken across lines the way the renderer
 * does, and a `\n` in the text always starts a new line.
 */
export function estimateWrappedLineCount(text: string, fontSize: number, maxWidth: number): number {
  if (!text.trim()) return 1;

  const charsPerLine = Math.floor(maxWidth / (fontSize * 0.5));
  if (charsPerLine <= 0) return 1;

  let lineCount = 0;
  let currentLineLength = 0;

  for (const word of text.split(/\s+/)) {
    const testLineLength = currentLineLength ? currentLineLength + 1 + word.length : word.length;

    if (testLineLength <= charsPerLine) {
      currentLineLength = testLineLength;
      continue;
    }

    if (currentLineLength) lineCount += 1;

    let remainingLength = word.length;
    while (remainingLength > charsPerLine) {
      lineCount += 1;
      remainingLength -= charsPerLine;
    }
    currentLineLength = remainingLength;
  }

  return Math.max(1, lineCount + (currentLineLength ? 1 : 0));
}

/**
 * Wrapped line count for multi-line text: each `\n`-separated segment wraps
 * on its own, so a nested list item or a two-paragraph body reserves the
 * forced breaks the renderer will honour (`estimateWrappedLineCount` alone
 * treats a newline as ordinary whitespace and under-counts).
 */
export function estimateProseLineCount(text: string, fontSize: number, maxWidthPx: number): number {
  return text
    .split('\n')
    .reduce((sum, line) => sum + estimateWrappedLineCount(line, fontSize, maxWidthPx), 0);
}

export interface ProseFitOptions {
  text: string;
  /** Preferred font size in px (already passed through `themedFontSize`). */
  baseFontSize: number;
  /** Smallest size the shrink pass may reach, in px. */
  minFontSize: number;
  /** Width the wrapped text may occupy, in px. */
  maxWidthPx: number;
  /** Height the wrapped block may occupy, in px. */
  maxHeightPx: number;
  /** Line-height multiplier the layer will render with. */
  lineHeight: number;
  /** Size decrement between candidates, in px (default 2). */
  step?: number;
}

export interface ProseFit {
  /** Font size to render with. */
  fontSize: number;
  /** Estimated wrapped line count at `fontSize` (after any clamp). */
  lines: number;
  /** Estimated block height at `fontSize`, in px (after any clamp). */
  heightPx: number;
  /**
   * Set only when the text still overflows at `minFontSize`: the number of
   * lines that fit, for the layer's `maxLines` (the renderer adds an ellipsis).
   */
  maxLines?: number;
}

/**
 * Shrink-to-fit for a prose slot (description, explanation, quote body…).
 *
 * Templates position text from estimates and the renderer leaves overflow
 * visible, so a body that runs long runs off the slide rather than being
 * clipped. This is the loss-averse counterpart for prose: step the font
 * size down from `baseFontSize` — re-wrapping at every step, so the slot's
 * full width is always used — until the wrapped block fits `maxHeightPx`.
 * Once the readable floor is reached, report how many lines still fit so
 * the caller can clamp with `maxLines` instead of letting the tail leave
 * the frame.
 */
export function fitProse(options: ProseFitOptions): ProseFit {
  const { text, baseFontSize, minFontSize, maxWidthPx, maxHeightPx, lineHeight } = options;
  const step = Math.max(0.5, options.step ?? 2);
  const floor = Math.min(baseFontSize, minFontSize);
  const heightAt = (lines: number, size: number) => lines * size * lineHeight;

  const candidates: number[] = [];
  for (let size = baseFontSize; size > floor; size -= step) candidates.push(size);
  candidates.push(floor);

  for (const size of candidates) {
    const lines = estimateProseLineCount(text, size, maxWidthPx);
    const heightPx = heightAt(lines, size);
    if (heightPx <= maxHeightPx) return { fontSize: size, lines, heightPx };
  }

  const linesThatFit = Math.max(1, Math.floor(maxHeightPx / (floor * lineHeight)));
  return {
    fontSize: floor,
    lines: linesThatFit,
    heightPx: heightAt(linesThatFit, floor),
    maxLines: linesThatFit,
  };
}

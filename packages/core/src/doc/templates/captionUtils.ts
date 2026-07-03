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

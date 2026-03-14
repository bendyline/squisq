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

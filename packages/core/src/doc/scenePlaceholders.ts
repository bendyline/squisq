/**
 * Untouched scene placeholders.
 *
 * Insert → Drawing adds a block titled "Drawing" with nothing drawn on it;
 * Insert → Layout adds one titled "Layout" holding a single starter text box
 * that reads "Layout". Left as inserted they show nothing worth a slide, yet
 * an exported deck or video spent a whole scene on each: an empty canvas, or
 * the word "Layout" in the middle of the frame. Anything the author changes —
 * the title, a shape, a second box, the starter's words — makes the block
 * theirs, and it keeps its slide.
 */

import type { Block } from '../schemas/Doc.js';
import { realChildren } from './accessoryBlocks.js';
import { extractPlainText } from '../markdown/utils.js';

/** The title Insert → Drawing gives a new drawing. */
export const DRAWING_PLACEHOLDER_TITLE = 'Drawing';
/** The title Insert → Layout gives a new layout, and its starter box's text. */
export const LAYOUT_PLACEHOLDER_TITLE = 'Layout';

function plainContents(block: Block): string {
  return (block.contents ?? [])
    .map((node) => extractPlainText(node))
    .join('\n')
    .trim();
}

/** Whether `block` is a drawing or layout still exactly as Insert left it. */
export function isUntouchedScenePlaceholder(block: Block): boolean {
  const title = block.title?.trim();
  const ownWords = plainContents(block);
  const children = realChildren(block);
  if (block.template === 'drawing') {
    return (
      title === DRAWING_PLACEHOLDER_TITLE &&
      !ownWords &&
      children.length === 0 &&
      (block.layers?.length ?? 0) === 0
    );
  }
  if (block.template === 'layout') {
    const [starter] = children;
    return (
      title === LAYOUT_PLACEHOLDER_TITLE &&
      !ownWords &&
      children.length === 1 &&
      starter?.template === 'text' &&
      (starter.children?.length ?? 0) === 0 &&
      plainContents(starter) === LAYOUT_PLACEHOLDER_TITLE
    );
  }
  return false;
}

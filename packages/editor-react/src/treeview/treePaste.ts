/**
 * Paste gate for bare (unfenced) ASCII tree art. `├──`/`└──` file-tree lines
 * would otherwise route through the markdown converter and mangle; when this
 * matches, the paste handler drops the text verbatim into a fresh code block
 * that the TreeViewExtension picks up as an interactive outline.
 */

import { detectTree } from '@bendyline/squisq/doc';

export function shouldPasteAsTreeFence(text: string): boolean {
  if (!text || text.includes('```')) return false;
  return detectTree(text).isTree;
}

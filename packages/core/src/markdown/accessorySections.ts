/**
 * Accessory sections in a parsed markdown tree.
 *
 * The markdown-tree counterpart of `doc/accessoryBlocks.ts`, for code that
 * reads a `MarkdownDocument` directly (the Word, PDF, EPUB, HTML and
 * spreadsheet exporters, title inference, the page renderer). An accessory
 * section is a heading tagged with a registered accessory type
 * (`### Headline {[summary]}`) and every node after it up to the next
 * heading at its level or shallower.
 */

import { isAccessoryBlockType } from '../doc/accessoryBlockTypes.js';
import type { MarkdownBlockNode, MarkdownDocument, MarkdownHeading } from './types.js';

/** True for a heading whose tag names an accessory block type. */
export function isAccessoryHeading(node: MarkdownBlockNode): node is MarkdownHeading {
  return (
    node.type === 'heading' &&
    isAccessoryBlockType((node as MarkdownHeading).templateAnnotation?.template)
  );
}

/**
 * Block nodes without accessory sections. Returns the same array when there
 * are none.
 */
export function withoutAccessorySectionNodes(nodes: MarkdownBlockNode[]): MarkdownBlockNode[] {
  let out: MarkdownBlockNode[] | null = null;
  let skippingBelow = 0; // depth of the accessory heading being skipped; 0 = none
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (skippingBelow > 0) {
      if (node.type !== 'heading' || (node as MarkdownHeading).depth > skippingBelow) continue;
      skippingBelow = 0;
    }
    if (isAccessoryHeading(node)) {
      skippingBelow = node.depth;
      out ??= nodes.slice(0, index);
      continue;
    }
    out?.push(node);
  }
  return out ?? nodes;
}

/** A markdown document without its accessory sections (the same object when it has none). */
export function withoutAccessorySections(doc: MarkdownDocument): MarkdownDocument {
  const children = withoutAccessorySectionNodes(doc.children);
  return children === doc.children ? doc : { ...doc, children };
}

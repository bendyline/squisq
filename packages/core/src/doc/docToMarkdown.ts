/**
 * Doc → Markdown Conversion
 *
 * Converts a Doc with a heading-driven Block hierarchy back into a
 * MarkdownDocument. This is the reverse of markdownToDoc() and enables
 * round-tripping: edit a Doc's block tree, then serialize back to markdown.
 *
 * **Algorithm:**
 * Walk the block tree depth-first. For each block:
 * 1. If it has a `sourceHeading`, emit that heading node
 * 2. Emit all nodes in `contents`
 * 3. Recurse into `children`
 *
 * @example
 * ```ts
 * import { markdownToDoc, docToMarkdown } from '@bendyline/squisq/doc';
 * import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
 *
 * const md = '# Hello\n\nWorld\n';
 * const doc = markdownToDoc(parseMarkdown(md));
 * const roundTripped = stringifyMarkdown(docToMarkdown(doc));
 * ```
 */

import type { Doc, Block } from '../schemas/Doc.js';
import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownHeading,
} from '../markdown/types.js';

/**
 * Convert a Doc with heading-driven blocks back to a MarkdownDocument.
 *
 * Walks the block tree depth-first, emitting heading nodes and contents
 * in document order. Blocks without a `sourceHeading` (preamble blocks)
 * emit only their contents.
 *
 * If a block has a `template` or `templateOverrides` that aren't already
 * reflected in the heading's `templateAnnotation`, the annotation is
 * injected so the round-trip preserves template assignments.
 *
 * @param doc - A Doc whose blocks may have `sourceHeading`, `contents`, and `children`
 * @returns A MarkdownDocument that can be stringified back to markdown
 */
export function docToMarkdown(doc: Doc): MarkdownDocument {
  const children: MarkdownBlockNode[] = [];

  function emitBlock(block: Block): void {
    // Emit the heading node if present
    if (block.sourceHeading) {
      const heading = ensureAnnotation(block, block.sourceHeading);
      children.push(heading);
    }

    // Emit body content
    if (block.contents) {
      children.push(...block.contents);
    }

    // Recurse into children (sub-headings)
    if (block.children) {
      for (const child of block.children) {
        emitBlock(child);
      }
    }
  }

  for (const block of doc.blocks) {
    emitBlock(block);
  }

  return {
    type: 'document',
    children,
  };
}

/**
 * Ensure the heading's `templateAnnotation` reflects the block's
 * template and templateOverrides. Returns a (possibly cloned) heading.
 */
function ensureAnnotation(block: Block, heading: MarkdownHeading): MarkdownHeading {
  // If the heading already has an annotation, trust it (it came from parsing)
  if (heading.templateAnnotation) return heading;

  // If the block has a non-default template or overrides, inject an annotation
  const hasExplicitTemplate = block.template && block.template !== 'sectionHeader';
  const hasOverrides = block.templateOverrides && Object.keys(block.templateOverrides).length > 0;

  if (!hasExplicitTemplate && !hasOverrides) return heading;

  // Clone to avoid mutating the original
  return {
    ...heading,
    children: [...heading.children],
    templateAnnotation: {
      template: block.template ?? 'sectionHeader',
      ...(hasOverrides ? { params: block.templateOverrides } : {}),
    },
  };
}

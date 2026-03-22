/**
 * Block Analyzer
 *
 * Walks Doc blocks, extracts plain text from their markdown contents,
 * and runs the content extractor on each block to identify stats, dates,
 * quotes, etc. that can be promoted to visual template blocks.
 */

import type { Block } from '../schemas/Doc.js';
import type { MarkdownBlockNode } from '../markdown/types.js';
import type { ExtractedElement, ExtractionOptions } from '../generate/contentExtractor.js';
import { extractContent, stripMarkdown } from '../generate/contentExtractor.js';
import { extractPlainText } from '../markdown/utils.js';

/** A block enriched with extraction analysis. */
export interface AnalyzedBlock {
  /** The original block. */
  block: Block;
  /** Plain text extracted from the block's contents. */
  plainText: string;
  /** Content extractions found in the block's text. */
  extractions: ExtractedElement[];
  /** Whether this block has child blocks. */
  hasChildren: boolean;
  /** Word count of the block's body text. */
  bodyWordCount: number;
}

/**
 * Extract plain text from an array of MarkdownBlockNodes.
 */
function contentsToPlainText(contents: MarkdownBlockNode[]): string {
  return contents.map(node => extractPlainText(node)).join('\n');
}

/**
 * Collect leaf blocks from a nested block tree.
 * Only returns blocks that have their own `contents` but no children,
 * preventing parent blocks from duplicating text that also appears
 * in their children. Parent-only blocks (with a title but no body
 * content) are included as structural placeholders.
 */
function collectLeafBlocks(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    if (block.children && block.children.length > 0) {
      // Parent block — only include it as a structural marker
      // (title only, no body extraction) if it has no contents of its own.
      // Then recurse into children for the actual content.
      if (!block.contents || block.contents.length === 0) {
        result.push(block);
      }
      result.push(...collectLeafBlocks(block.children));
    } else {
      // Leaf block — include for content analysis
      result.push(block);
    }
  }
  return result;
}

/**
 * Analyze all blocks in a Doc, extracting text and running content extraction.
 *
 * @param blocks - The Doc's block array (may be nested via children).
 * @param options - Extraction options (minConfidence, types filter).
 * @returns Analyzed blocks with extractions, in flattened order.
 */
export function analyzeBlocks(
  blocks: Block[],
  options?: ExtractionOptions,
): AnalyzedBlock[] {
  const flat = collectLeafBlocks(blocks);
  const results: AnalyzedBlock[] = [];

  for (const block of flat) {
    let plainText = '';

    if (block.contents && block.contents.length > 0) {
      plainText = contentsToPlainText(block.contents);
    } else if (block.title) {
      plainText = block.title;
    }

    // Strip any remaining markdown syntax
    const stripped = stripMarkdown(plainText);
    const bodyWordCount = stripped.split(/\s+/).filter(w => w.length > 0).length;

    // Run content extraction
    const extraction = extractContent(stripped, options);

    results.push({
      block,
      plainText: stripped,
      extractions: extraction.elements,
      hasChildren: !!(block.children && block.children.length > 0),
      bodyWordCount,
    });
  }

  return results;
}

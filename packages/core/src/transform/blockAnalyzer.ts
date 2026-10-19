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
import type { TransformImage } from './types.js';
import { extractContent, stripMarkdown } from '../generate/contentExtractor.js';
import { extractPlainText } from '../markdown/utils.js';
import { extractImages } from '../doc/templateInputs.js';

/** An image found in a block's markdown contents. */
export interface BlockImage {
  /** Image URL (relative or absolute). */
  src: string;
  /** Alt text. */
  alt: string;
  /** Index of the source block in the analyzed array. */
  sourceBlockIndex: number;
}

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
  /** Images found in this block's markdown contents. */
  images: BlockImage[];
}

/**
 * Extract plain text from an array of MarkdownBlockNodes.
 */
function contentsToPlainText(contents: MarkdownBlockNode[]): string {
  return contents.map((node) => extractPlainText(node)).join('\n');
}

/** Content nodes the extractors read. Everything else is not a sentence. */
const PROSE_NODE_TYPES = new Set(['paragraph', 'blockquote', 'heading']);

/**
 * `stripped` with every non-prose node -- a list, table, code block -- blanked
 * to spaces: same length and offsets, so positions still index `stripped`,
 * but nothing there can be read as a sentence. Extraction used to stitch a
 * list's items and a table's cells into one "fact" ("First item Second item
 * A B 1 2") and turn the whole section into a fact card without its heading.
 *
 * Each node's text is located in document order; one that cannot be found
 * (stripMarkdown can rewrite text across node boundaries) is left as is.
 */
function maskNonProse(stripped: string, contents: MarkdownBlockNode[]): string {
  let masked = stripped;
  let cursor = 0;
  for (const node of contents) {
    const text = stripMarkdown(extractPlainText(node));
    if (!text) continue;
    const at = stripped.indexOf(text, cursor);
    if (at < 0) continue;
    cursor = at + text.length;
    if (PROSE_NODE_TYPES.has(node.type)) continue;
    masked = masked.slice(0, at) + text.replace(/\S/g, ' ') + masked.slice(cursor);
  }
  return masked;
}

/**
 * Extract images from a block's markdown contents: `![alt](url)` and the
 * raw HTML `<img>` the WYSIWYG editor writes for a resized image.
 */
function extractBlockImages(block: Block, blockIndex: number): BlockImage[] {
  return extractImages(block.contents).map(({ src, alt }) => ({
    src,
    alt,
    sourceBlockIndex: blockIndex,
  }));
}

/**
 * Collect all unique images from all blocks in a Doc.
 * Returns them as TransformImages for use in the transform pipeline.
 */
export function extractDocImages(blocks: Block[]): TransformImage[] {
  const seen = new Set<string>();
  const images: TransformImage[] = [];

  function walk(blockList: Block[]): void {
    for (const block of blockList) {
      for (const img of extractImages(block.contents)) {
        if (!seen.has(img.src)) {
          seen.add(img.src);
          images.push({ src: img.src, alt: img.alt });
        }
      }
      if (block.children) {
        walk(block.children);
      }
    }
  }

  walk(blocks);
  return images;
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
export function analyzeBlocks(blocks: Block[], options?: ExtractionOptions): AnalyzedBlock[] {
  return analyzeFlatBlocks(collectLeafBlocks(blocks), options);
}

/** Internal flat analysis for compact modes, which retain every heading's own scope. */
export function analyzeFlatBlocks(flat: Block[], options?: ExtractionOptions): AnalyzedBlock[] {
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
    const bodyWordCount = stripped.split(/\s+/).filter((w) => w.length > 0).length;

    // Run content extraction over the prose only.
    const extraction = extractContent(
      block.contents && block.contents.length > 0
        ? maskNonProse(stripped, block.contents)
        : stripped,
      options,
    );

    // Extract images from markdown contents
    const images = extractBlockImages(block, results.length);

    results.push({
      block,
      plainText: stripped,
      extractions: extraction.elements,
      hasChildren: !!(block.children && block.children.length > 0),
      bodyWordCount,
      images,
    });
  }

  return results;
}

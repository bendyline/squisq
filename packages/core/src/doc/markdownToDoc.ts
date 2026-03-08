/**
 * Markdown → Doc Conversion
 *
 * Converts a MarkdownDocument into a hierarchical Doc whose Block tree
 * mirrors the heading structure of the markdown. Every heading (H1–H6)
 * becomes a Block; body content between headings populates `contents`;
 * sub-headings nest as `children`.
 *
 * This enables using BlockTemplates to supply alternate visualizations
 * for each section of a markdown document.
 *
 * @example
 * ```ts
 * import { parseMarkdown } from '@bendyline/squisq/markdown';
 * import { markdownToDoc } from '@bendyline/squisq/doc';
 *
 * const md = parseMarkdown('# Intro\n\nHello world\n\n## Details\n\nMore text');
 * const doc = markdownToDoc(md);
 * // doc.blocks[0].sourceHeading.depth === 1  ("# Intro")
 * // doc.blocks[0].contents  → [paragraph("Hello world")]
 * // doc.blocks[0].children[0].sourceHeading.depth === 2  ("## Details")
 * ```
 */

import type { Doc, Block } from '../schemas/Doc.js';
import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownHeading,
} from '../markdown/types.js';
import { extractPlainText } from '../markdown/utils.js';

// ============================================
// Options
// ============================================

/**
 * Options for markdownToDoc().
 */
export interface MarkdownToDocOptions {
  /** Article ID for the generated Doc. Default: 'markdown-doc' */
  articleId?: string;

  /** Default template name for heading blocks. Default: 'sectionHeader' */
  defaultTemplate?: string;

  /** Default duration per block in seconds. Default: 5 */
  defaultDuration?: number;

  /** Custom ID generator. Receives the heading node and its index. */
  generateId?: (heading: MarkdownHeading, index: number) => string;
}

// ============================================
// ID Generation
// ============================================

/**
 * Convert text to a URL-friendly slug.
 * "Getting Started & More" → "getting-started-more"
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // Remove non-word chars (except spaces and hyphens)
    .replace(/[\s_]+/g, '-')    // Replace spaces/underscores with hyphens
    .replace(/-+/g, '-')        // Collapse multiple hyphens
    .replace(/^-|-$/g, '')      // Trim leading/trailing hyphens
    || 'block';                 // Fallback for empty result
}

/**
 * Creates an ID generator that produces unique slugified IDs.
 * Appends -2, -3, etc. for duplicate headings.
 */
function createIdGenerator() {
  const used = new Map<string, number>();

  return (heading: MarkdownHeading, _index: number): string => {
    const text = extractPlainText(heading);
    const base = slugify(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);

    if (count === 0) return base;
    return `${base}-${count + 1}`;
  };
}

// ============================================
// Core Conversion
// ============================================

/**
 * Convert a MarkdownDocument into a Doc with a heading-driven Block hierarchy.
 *
 * **Algorithm:**
 * 1. Walk the document's top-level children sequentially
 * 2. Each MarkdownHeading starts a new block at its depth level
 * 3. Non-heading nodes accumulate as `contents` on the current block
 * 4. Sub-headings (deeper depth) nest as `children` of the current block
 * 5. Same-level or shallower headings close the current block and start a sibling/ancestor
 * 6. Content before the first heading goes into a "preamble" block with no sourceHeading
 *
 * @param markdownDoc - A parsed MarkdownDocument
 * @param options - Conversion options
 * @returns A Doc whose blocks mirror the markdown heading structure
 */
export function markdownToDoc(
  markdownDoc: MarkdownDocument,
  options?: MarkdownToDocOptions,
): Doc {
  const articleId = options?.articleId ?? 'markdown-doc';
  const defaultTemplate = options?.defaultTemplate ?? 'sectionHeader';
  const defaultDuration = options?.defaultDuration ?? 5;
  const generateId = options?.generateId ?? createIdGenerator();

  const rootBlocks: Block[] = [];
  let headingIndex = 0;

  // Stack tracks the nesting context: each entry is a block and its heading depth.
  // We push when we go deeper, pop when we come back up.
  const stack: Array<{ block: Block; depth: number }> = [];

  // Accumulator for content nodes that appear before any heading (preamble)
  // or between the current heading and the next heading/sub-heading.
  let pendingContents: MarkdownBlockNode[] = [];
  let currentBlock: Block | null = null;

  function flushContents() {
    if (currentBlock && pendingContents.length > 0) {
      currentBlock.contents = (currentBlock.contents ?? []).concat(pendingContents);
      pendingContents = [];
    }
  }

  function makeBlock(heading: MarkdownHeading | null): Block {
    const id = heading
      ? generateId(heading, headingIndex++)
      : 'preamble';

    // Use template from annotation if present, otherwise fall back to default
    const annotation = heading?.templateAnnotation;
    const template = annotation?.template ?? (heading ? defaultTemplate : undefined);

    const block: Block = {
      id,
      startTime: 0,
      duration: defaultDuration,
      audioSegment: 0,
      template,
      ...(heading ? { sourceHeading: heading } : {}),
    };

    // Propagate key-value params from annotation to templateOverrides
    if (annotation?.params) {
      block.templateOverrides = annotation.params;
    }

    return block;
  }

  for (const node of markdownDoc.children) {
    if (node.type === 'heading') {
      const heading = node as MarkdownHeading;
      const depth = heading.depth;

      // Flush any accumulated content to the current block
      flushContents();

      // Create the new block for this heading
      const newBlock = makeBlock(heading);

      if (stack.length === 0) {
        // If there's a preamble block with no heading, push it first
        if (currentBlock && !currentBlock.sourceHeading) {
          rootBlocks.push(currentBlock);
        }

        // This is a root-level block (or the first heading)
        rootBlocks.push(newBlock);
        stack.push({ block: newBlock, depth });
      } else {
        // Find where this heading fits in the hierarchy
        // Pop blocks from the stack until we find a parent with lower depth
        while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
          stack.pop();
        }

        if (stack.length === 0) {
          // Same level as root or shallower — new root block
          rootBlocks.push(newBlock);
          stack.push({ block: newBlock, depth });
        } else {
          // Deeper — child of the current stack top
          const parent = stack[stack.length - 1].block;
          if (!parent.children) parent.children = [];
          parent.children.push(newBlock);
          stack.push({ block: newBlock, depth });
        }
      }

      currentBlock = newBlock;
    } else {
      // Non-heading block node — accumulate as content
      if (!currentBlock) {
        // Content before any heading → create preamble block
        currentBlock = makeBlock(null);
      }
      pendingContents.push(node);
    }
  }

  // Flush remaining content
  flushContents();

  // If we only had preamble content (no headings at all), push it
  if (currentBlock && !currentBlock.sourceHeading && !rootBlocks.includes(currentBlock)) {
    rootBlocks.push(currentBlock);
  }

  // Calculate basic timing
  const allBlocks = flattenBlocks(rootBlocks);
  let currentTime = 0;
  for (const block of allBlocks) {
    block.startTime = currentTime;
    currentTime += block.duration;
  }

  return {
    articleId,
    duration: currentTime,
    blocks: rootBlocks,
    audio: {
      segments: [],
    },
    ...(markdownDoc.frontmatter ? { frontmatter: markdownDoc.frontmatter } : {}),
  };
}

// ============================================
// Utilities
// ============================================

/**
 * Flatten a nested block tree into a depth-first ordered array.
 * Useful for calculating sequential timing or iterating all blocks.
 */
export function flattenBlocks(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    result.push(block);
    if (block.children) {
      result.push(...flattenBlocks(block.children));
    }
  }
  return result;
}

/**
 * Count the total number of blocks in a nested tree (including children at all levels).
 */
export function countBlocks(blocks: Block[]): number {
  let count = 0;
  for (const block of blocks) {
    count += 1;
    if (block.children) {
      count += countBlocks(block.children);
    }
  }
  return count;
}

/**
 * Get the heading depth for a block. Returns 0 for preamble blocks (no heading).
 */
export function getBlockDepth(block: Block): number {
  return block.sourceHeading?.depth ?? 0;
}

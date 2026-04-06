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

import type { Doc, Block, CaptionTrack, CaptionPhrase, StartBlockConfig } from '../schemas/Doc.js';
import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownHeading,
  MarkdownNode,
  MarkdownImage,
} from '../markdown/types.js';
import { extractPlainText } from '../markdown/utils.js';
import { estimateReadingTime } from '../timing/readingTime.js';

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

  /**
   * Whether to auto-generate a cover startBlock from the first H1 heading.
   * When true (default), a StartBlockConfig is created using the first H1's
   * text as the title. If the document contains an image, the first image
   * is used as the hero. Set to false to suppress automatic cover generation.
   */
  generateCoverBlock?: boolean;
}

// ============================================
// ID Generation
// ============================================

/**
 * Convert text to a URL-friendly slug.
 * "Getting Started & More" → "getting-started-more"
 */
const SLUG_NON_WORD_RE = /[^\w\s-]/g;
const SLUG_SPACES_RE = /[\s_]+/g;
const SLUG_MULTI_HYPHEN_RE = /-+/g;
const SLUG_TRIM_HYPHEN_RE = /^-|-$/g;

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(SLUG_NON_WORD_RE, '') // Remove non-word chars (except spaces and hyphens)
      .replace(SLUG_SPACES_RE, '-') // Replace spaces/underscores with hyphens
      .replace(SLUG_MULTI_HYPHEN_RE, '-') // Collapse multiple hyphens
      .replace(SLUG_TRIM_HYPHEN_RE, '') || // Trim leading/trailing hyphens
    'block'
  ); // Fallback for empty result
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
export function markdownToDoc(markdownDoc: MarkdownDocument, options?: MarkdownToDocOptions): Doc {
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
    const id = heading ? generateId(heading, headingIndex++) : 'preamble';

    // Use template from annotation if present, otherwise fall back to default
    const annotation = heading?.templateAnnotation;
    const template = annotation?.template ?? (heading ? defaultTemplate : undefined);

    // Extract heading text so templates (e.g. sectionHeader) that expect a
    // `title` property receive it without having to reach into sourceHeading.
    const title = heading ? extractPlainText(heading) : undefined;

    const block: Block = {
      id,
      startTime: 0,
      duration: defaultDuration,
      audioSegment: 0,
      template,
      ...(heading ? { sourceHeading: heading } : {}),
      ...(title ? { title } : {}),
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

  // Calculate reading-time-based durations and generate captions
  const allBlocks = flattenBlocks(rootBlocks);
  const minDuration = 3; // seconds — minimum for blocks with little/no text
  const phrases: CaptionPhrase[] = [];

  // First pass: compute duration from body-content reading time
  for (const block of allBlocks) {
    const bodyText = getBlockBodyText(block);
    if (bodyText.length > 0) {
      const estimate = estimateReadingTime(bodyText);
      block.duration = Math.max(minDuration, estimate.seconds);
    } else {
      block.duration = defaultDuration;
    }
  }

  // Second pass: assign start times sequentially and build caption phrases
  let currentTime = 0;
  for (const block of allBlocks) {
    block.startTime = currentTime;

    // Generate caption phrases from the block's body content
    const bodyText = getBlockBodyText(block);
    if (bodyText.length > 0) {
      const sentences = splitIntoSentences(bodyText);
      if (sentences.length > 0) {
        const timePerSentence = block.duration / sentences.length;
        for (let i = 0; i < sentences.length; i++) {
          phrases.push({
            text: sentences[i],
            startTime: currentTime + i * timePerSentence,
            endTime: currentTime + (i + 1) * timePerSentence,
            audioSegment: 0,
          });
        }
      }
    }

    currentTime += block.duration;
  }

  const captions: CaptionTrack | undefined =
    phrases.length > 0 ? { phrases, generatedAt: new Date().toISOString(), version: 1 } : undefined;

  const doc: Doc = {
    articleId,
    duration: currentTime,
    blocks: rootBlocks,
    audio: {
      segments: [],
    },
    ...(captions ? { captions } : {}),
    ...(markdownDoc.frontmatter ? { frontmatter: markdownDoc.frontmatter } : {}),
  };

  // Auto-generate cover startBlock from the first H1 heading
  if (options?.generateCoverBlock ?? true) {
    const coverConfig = buildStartBlock(markdownDoc, rootBlocks);
    if (coverConfig) {
      doc.startBlock = coverConfig;
    }
  }

  return doc;
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

// ============================================
// Internal helpers
// ============================================

/**
 * Extract the plain text from a block's body contents (excluding heading text).
 */
function getBlockBodyText(block: Block): string {
  if (!block.contents || block.contents.length === 0) return '';
  // Join with newlines to preserve paragraph/list-item boundaries.
  // splitIntoPhrases uses these newlines as natural split points.
  return block.contents
    .map((node) => extractPlainText(node))
    .join('\n')
    .trim();
}

/** Maximum words per caption phrase. Long sentences get split at this point. */
const MAX_PHRASE_WORDS = 12;

/**
 * Split text into caption-sized phrases.
 *
 * Splits on:
 * 1. Newlines (paragraph/list-item boundaries from markdown)
 * 2. Sentence endings (.!?) followed by whitespace
 * 3. Long fragments (> MAX_PHRASE_WORDS) at clause boundaries (commas, semicolons, dashes)
 *
 * Merges very short fragments (< 15 chars) with the previous phrase.
 */
function splitIntoSentences(text: string): string[] {
  // First split on newlines (each paragraph/list item becomes separate)
  const lines = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Then split each line on sentence boundaries
  const sentenceRe = /(?<=[.!?])\s+/;
  const fragments: string[] = [];
  for (const line of lines) {
    const sentences = line
      .split(sentenceRe)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    fragments.push(...sentences);
  }

  if (fragments.length === 0) return [];

  // Split long fragments at clause boundaries
  const split: string[] = [];
  for (const frag of fragments) {
    const words = frag.split(/\s+/);
    if (words.length > MAX_PHRASE_WORDS) {
      // Try to split at comma, semicolon, or dash near the midpoint
      const mid = Math.floor(frag.length / 2);
      const clauseRe = /[,;]\s+|\s+—\s+|\s+-\s+/g;
      let bestSplit = -1;
      let bestDist = Infinity;
      let match;
      while ((match = clauseRe.exec(frag)) !== null) {
        const dist = Math.abs(match.index - mid);
        if (dist < bestDist) {
          bestDist = dist;
          bestSplit = match.index + match[0].length;
        }
      }
      if (bestSplit > 0 && bestSplit < frag.length - 5) {
        split.push(frag.slice(0, bestSplit).trim());
        split.push(frag.slice(bestSplit).trim());
      } else {
        split.push(frag);
      }
    } else {
      split.push(frag);
    }
  }

  // Merge very short fragments (< 15 chars) with the previous phrase
  const merged: string[] = [split[0]];
  for (let i = 1; i < split.length; i++) {
    if (split[i].length < 15 && merged.length > 0) {
      merged[merged.length - 1] += ' ' + split[i];
    } else {
      merged.push(split[i]);
    }
  }
  return merged;
}

/**
 * Walk a MarkdownNode tree depth-first to find the first image node.
 * Returns the MarkdownImage or undefined if none found.
 */
function findFirstImage(node: MarkdownNode): MarkdownImage | undefined {
  if (node.type === 'image') return node as MarkdownImage;
  if ('children' in node && Array.isArray((node as { children?: unknown[] }).children)) {
    for (const child of (node as { children: MarkdownNode[] }).children) {
      const found = findFirstImage(child);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Build a StartBlockConfig from the document's first H1 heading and optional
 * first image. Returns undefined if the document has no H1 heading.
 */
function buildStartBlock(
  markdownDoc: MarkdownDocument,
  rootBlocks: Block[],
): StartBlockConfig | undefined {
  // Find the first H1 block — it provides the cover title
  const firstH1 = rootBlocks.find((b) => b.sourceHeading?.depth === 1);
  if (!firstH1) return undefined;

  const title = firstH1.title ?? extractPlainText(firstH1.sourceHeading!);
  if (!title) return undefined;

  // Look for the first paragraph immediately after the H1 to use as subtitle
  const subtitle =
    firstH1.contents?.[0]?.type === 'paragraph' ? extractPlainText(firstH1.contents[0]) : undefined;

  // Scan the whole document for the first image to use as the hero
  const firstImage = findFirstImage(markdownDoc);

  const config: StartBlockConfig = {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(firstImage ? { heroSrc: firstImage.url, heroAlt: firstImage.alt ?? title } : {}),
    ambientMotion: 'zoomIn',
  };

  return config;
}

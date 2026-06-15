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

import type {
  Doc,
  Block,
  CaptionTrack,
  CaptionPhrase,
  StartBlockConfig,
  DocDiagnostic,
} from '../schemas/Doc.js';
import { readCustomTemplatesFromFrontmatter } from './customTemplatesFrontmatter.js';
import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownHeading,
  MarkdownNode,
  HtmlNode,
} from '../markdown/types.js';
import { extractPlainText } from '../markdown/utils.js';
import { estimateReadingTime } from '../timing/readingTime.js';
import { resolveTemplateName, isContainerTemplate } from './templates/index.js';
import { isDataFence, parseDataFence, findFirstTable, extractTableData } from './structuredData.js';
import { extractMediaFromContents } from './mediaAnnotations.js';
import type { MediaClip } from '../schemas/Media.js';

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

  /**
   * Timestamp recorded as `captions.generatedAt`. When omitted, the field
   * is left unset so that conversion is fully deterministic — the same
   * markdown always produces the same Doc (important for snapshot tests,
   * caching, and agents that verify their output by re-converting).
   */
  captionsGeneratedAt?: string;
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
 * Appends -2, -3, etc. for duplicate headings. `reserve()` registers an
 * author-pinned `{#id}` so a later heading whose slug matches doesn't
 * collide with it.
 */
function createIdGenerator() {
  const used = new Map<string, number>();

  const generate = (heading: MarkdownHeading, _index: number): string => {
    const text = extractPlainText(heading);
    const base = slugify(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);

    if (count === 0) return base;
    return `${base}-${count + 1}`;
  };

  generate.reserve = (id: string): void => {
    used.set(id, Math.max(used.get(id) ?? 0, 1));
  };

  return generate;
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
  const idGenerator = options?.generateId ? null : createIdGenerator();
  const generateId = options?.generateId ?? idGenerator!;

  const rootBlocks: Block[] = [];
  const diagnostics: DocDiagnostic[] = [];
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
    // Pandoc `{#id}` overrides slug-from-heading when present. Pinned ids
    // are reserved in the slug generator so a later un-pinned heading with
    // the same slugified text doesn't collide.
    const pandocId = heading?.attributes?.id;
    const id = pandocId ? pandocId : heading ? generateId(heading, headingIndex++) : 'preamble';
    if (pandocId && idGenerator) {
      idGenerator.reserve(pandocId);
    }

    // Use template from annotation if present, otherwise fall back to default.
    // Legacy template ids (e.g. `titleBlock`) are normalized to their canonical
    // short form (`title`) so downstream comparisons can rely on the new names
    // without sprinkling alias resolution everywhere.
    const annotation = heading?.templateAnnotation;
    const rawTemplate = annotation?.template ?? (heading ? defaultTemplate : undefined);
    const template = rawTemplate != null ? resolveTemplateName(rawTemplate) : undefined;

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

    // {[…]} template params → templateOverrides (template-specific overrides).
    if (annotation?.params) {
      block.templateOverrides = annotation.params;
    }

    // Pandoc {#id .class key=value} attributes → block-level fields.
    // The two annotation forms are intentionally kept distinct: template
    // params customize the template, block-level metadata describes the
    // block as an abstract entity (position, connections, classes, free-form).
    const attrs = heading?.attributes;
    if (attrs) {
      if (attrs.blockMeta) {
        const m = attrs.blockMeta;
        if (m.x != null) block.x = m.x;
        if (m.y != null) block.y = m.y;
        if (m.startTime != null) block.startTime = m.startTime;
        if (m.duration != null) block.duration = m.duration;
        if (m.connectsTo) block.connectsTo = m.connectsTo;
      }
      if (attrs.classes && attrs.classes.length > 0) {
        block.classes = attrs.classes;
      }
      if (attrs.metadata && Object.keys(attrs.metadata).length > 0) {
        block.metadata = attrs.metadata;
      }
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

  // Lift standalone body-level media annotations (`{[audio …]}` / `{[video …]}`)
  // into typed clips: block-anchored clips ride on `block.media`; clips flagged
  // `anchor=document` collect into the doc-level `documentMedia`. Done before
  // the reading-time pass so annotation text doesn't inflate block durations.
  const documentMedia: MediaClip[] = [];
  for (const block of flattenBlocks(rootBlocks)) {
    const {
      media,
      documentMedia: docMedia,
      remaining,
    } = extractMediaFromContents(
      block.contents,
      (src, i) => `${block.id}-media-${i}-${src.replace(/[^a-zA-Z0-9]+/g, '-')}`,
    );
    if (media.length > 0) block.media = media;
    if (docMedia.length > 0) documentMedia.push(...docMedia);
    if (block.contents) block.contents = remaining;
  }

  // A preamble block that held only document-media annotations is now empty —
  // drop it so a doc-spanning narration doesn't leave a phantom 5s block at the
  // top of the timeline. Only the heading-less preamble (rootBlocks[0]) can be
  // emptied this way.
  if (
    rootBlocks.length > 0 &&
    !rootBlocks[0].sourceHeading &&
    (rootBlocks[0].contents?.length ?? 0) === 0 &&
    (rootBlocks[0].children?.length ?? 0) === 0 &&
    !rootBlocks[0].media
  ) {
    rootBlocks.shift();
  }

  const allBlocks = flattenBlocks(rootBlocks);

  // Structured template data: ```json data / ```yaml data fences in a
  // block's body parse into `templateData`; for dataTable blocks the first
  // GFM table supplies headers/rows when not explicitly provided. Parse
  // failures degrade gracefully (the fence stays visible as code) and are
  // recorded as diagnostics.
  for (const block of allBlocks) {
    applyStructuredData(block, diagnostics);
  }

  // Duplicate ids make connections and navigation ambiguous. Generated
  // slugs are already deduped; this catches author-pinned `{#id}` clashes.
  const seenIds = new Map<string, Block>();
  for (const block of allBlocks) {
    if (seenIds.has(block.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-id',
        message: `Duplicate block id "${block.id}" — later connections and links are ambiguous`,
        blockId: block.id,
        ...lineOf(block),
      });
    } else {
      seenIds.set(block.id, block);
    }
  }

  // connectsTo targets must resolve to a block id in this doc.
  for (const block of allBlocks) {
    for (const conn of block.connectsTo ?? []) {
      if (!seenIds.has(conn.target)) {
        diagnostics.push({
          severity: 'warning',
          code: 'unresolved-connection',
          message: `Block "${block.id}" connects to unknown target "${conn.target}"`,
          blockId: block.id,
          ...lineOf(block),
        });
      }
    }
  }

  // Calculate reading-time-based durations and generate captions
  const minDuration = 3; // seconds — minimum for blocks with little/no text
  const phrases: CaptionPhrase[] = [];

  // First pass: compute duration from body-content reading time.
  // Skip blocks that pinned an explicit duration via a heading attribute —
  // author intent wins over reading-time heuristics.
  for (const block of allBlocks) {
    if (block.sourceHeading?.attributes?.blockMeta?.duration != null) continue;
    const bodyText = getBlockBodyText(block);
    if (bodyText.length > 0) {
      const estimate = estimateReadingTime(bodyText);
      block.duration = Math.max(minDuration, estimate.seconds);
    } else {
      block.duration = defaultDuration;
    }
  }

  // Second pass: assign start times sequentially and build caption phrases.
  // Blocks with an explicit `startTime` attribute keep their pinned value;
  // the running cursor still advances by their duration so following blocks
  // sequence after them.
  let currentTime = 0;
  for (const block of allBlocks) {
    const explicitStart = block.sourceHeading?.attributes?.blockMeta?.startTime;
    if (explicitStart == null) {
      block.startTime = currentTime;
    }

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

  // `generatedAt` is only stamped when the caller provides a timestamp —
  // conversion itself never reads the clock, so identical markdown always
  // converts to an identical Doc.
  const captions: CaptionTrack | undefined =
    phrases.length > 0
      ? {
          phrases,
          ...(options?.captionsGeneratedAt ? { generatedAt: options.captionsGeneratedAt } : {}),
          version: 1,
        }
      : undefined;

  const customTemplates = readCustomTemplatesFromFrontmatter(markdownDoc.frontmatter);
  const doc: Doc = {
    articleId,
    duration: currentTime,
    blocks: rootBlocks,
    audio: {
      segments: [],
    },
    ...(captions ? { captions } : {}),
    ...(markdownDoc.frontmatter ? { frontmatter: markdownDoc.frontmatter } : {}),
    ...(customTemplates ? { customTemplates } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(documentMedia.length > 0 ? { documentMedia } : {}),
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
 * Flatten the block tree into the list of *independently renderable*
 * blocks — like {@link flattenBlocks}, but it does NOT descend into the
 * children of a container template (`diagram`, `drawing`; see
 * `isContainerTemplate`). Those children are consumed by the parent's
 * render (as nodes / shapes), so they must not also surface as their own
 * slides or sections.
 *
 * Use this anywhere a doc is flattened for rendering (slideshow, video,
 * static pages). Use {@link flattenBlocks} when you genuinely need every
 * block regardless of role — validation, timing, duplicate-id checks.
 */
export function flattenRenderableBlocks(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    result.push(block);
    if (block.children && !isContainerTemplate(block.template)) {
      result.push(...flattenRenderableBlocks(block.children));
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

/** Source line of a block's heading, when position info is available. */
function lineOf(block: Block): { line: number } | Record<string, never> {
  const line = block.sourceHeading?.position?.start.line;
  return line != null ? { line } : {};
}

/**
 * Populate `block.templateData` from structured body content:
 * 1. Every ```json data / ```yaml data fence in the body merges its parsed
 *    object in (later fences override earlier keys).
 * 2. For `dataTable` blocks, the first GFM table supplies headers/rows/align
 *    unless the author already provided them via a fence or `{[…]}` params.
 * Parse failures are recorded on `diagnostics` and skip the fence.
 */
function applyStructuredData(block: Block, diagnostics: DocDiagnostic[]): void {
  let data: Record<string, unknown> | undefined;

  for (const node of block.contents ?? []) {
    if (node.type !== 'code' || !isDataFence(node)) continue;
    const result = parseDataFence(node);
    if (result.error) {
      diagnostics.push({
        severity: 'error',
        code: 'data-fence-parse',
        message: `Data fence in block "${block.id}": ${result.error}`,
        blockId: block.id,
        ...(node.position ? { line: node.position.start.line } : lineOf(block)),
      });
      continue;
    }
    data = { ...data, ...result.data };
  }

  if (block.template === 'dataTable') {
    const provided = (key: string) =>
      (data && key in data) || (block.templateOverrides && key in block.templateOverrides);
    if (!provided('headers') && !provided('rows')) {
      const table = findFirstTable(block.contents);
      if (table) {
        data = { ...extractTableData(table), ...data };
      }
    }
  }

  if (data && Object.keys(data).length > 0) {
    block.templateData = data;
  }
}

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

interface ImageRef {
  url: string;
  alt?: string;
}

/**
 * Walk a parsed HTML sub-tree depth-first for an `<img>` with a `src`.
 * Used to surface images that the WYSIWYG editor serialized as raw HTML
 * (e.g. when an image was resized — markdown's `![alt](url)` shorthand
 * has no width syntax, so resized images round-trip as `<img src width>`).
 */
function findFirstHtmlImage(nodes: HtmlNode[]): ImageRef | undefined {
  for (const node of nodes) {
    if (node.type !== 'htmlElement') continue;
    if (node.tagName === 'img' && node.attributes.src) {
      return { url: node.attributes.src, alt: node.attributes.alt };
    }
    const nested = findFirstHtmlImage(node.children);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Walk a MarkdownNode tree depth-first to find the first image reference,
 * whether expressed as a markdown image node or a raw HTML `<img>` tag.
 */
function findFirstImage(node: MarkdownNode): ImageRef | undefined {
  if (node.type === 'image') {
    const img = node as { url: string; alt?: string };
    return { url: img.url, alt: img.alt };
  }
  if (node.type === 'htmlBlock' || node.type === 'htmlInline') {
    const html = node as { htmlChildren?: HtmlNode[] };
    if (html.htmlChildren) {
      const found = findFirstHtmlImage(html.htmlChildren);
      if (found) return found;
    }
  }
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

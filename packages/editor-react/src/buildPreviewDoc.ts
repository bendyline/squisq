/**
 * buildPreviewDoc — Converts a markdown-derived Doc into a player-ready Doc
 * with TemplateBlock slides and interleaved images.
 *
 * Shared between PreviewPanel (live preview) and export flows (HTML/video).
 *
 * Pipeline:
 * 1. Flatten hierarchical blocks into a linear slide sequence
 * 2. Convert each block into a TemplateBlock-compatible object
 * 3. Interleave images as standalone imageWithCaption slides
 * 4. Synthesize a dummy audio segment for timer-based playback
 */

import { flattenBlocks, hasTemplate } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import { getChildren } from '@bendyline/squisq/markdown';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import type { MarkdownBlockNode, MarkdownList, MarkdownNode } from '@bendyline/squisq/markdown';

// ── Helpers ────────────────────────────────────────────────────────

function extractBodyText(contents: MarkdownBlockNode[] | undefined): string {
  if (!contents || contents.length === 0) return '';
  const parts: string[] = [];
  for (const node of contents) {
    parts.push(extractPlainText(node));
  }
  return parts.join('\n').trim();
}

function extractBlockImages(
  contents: MarkdownBlockNode[] | undefined,
): Array<{ src: string; alt: string }> {
  if (!contents || contents.length === 0) return [];
  const images: Array<{ src: string; alt: string }> = [];

  function walk(node: MarkdownNode): void {
    if ('type' in node && node.type === 'image' && 'url' in node) {
      const img = node as { url: string; alt?: string };
      if (img.url) {
        images.push({ src: img.url, alt: img.alt ?? '' });
      }
    }
    for (const child of getChildren(node)) {
      walk(child);
    }
  }

  for (const node of contents) {
    walk(node);
  }
  return images;
}

function collectAllDocImages(blocks: Block[]): Array<{ src: string; alt: string }> {
  const seen = new Set<string>();
  const images: Array<{ src: string; alt: string }> = [];

  function walkBlocks(blockList: Block[]): void {
    for (const block of blockList) {
      for (const img of extractBlockImages(block.contents)) {
        if (!seen.has(img.src)) {
          seen.add(img.src);
          images.push(img);
        }
      }
      if (block.children) {
        walkBlocks(block.children);
      }
    }
  }

  walkBlocks(blocks);
  return images;
}

function extractListItems(contents: MarkdownBlockNode[] | undefined): string[] {
  if (!contents) return [];
  const items: string[] = [];
  for (const node of contents) {
    if (node.type === 'list') {
      for (const item of (node as MarkdownList).children) {
        const text = extractPlainText(item).trim();
        if (text) items.push(text);
      }
    }
  }
  return items;
}

function getTemplateDefaults(
  templateName: string,
  headingText: string,
  block: Block,
): Record<string, unknown> {
  const body = extractBodyText(block.contents);

  switch (templateName) {
    case 'statHighlight':
      return { stat: headingText, description: body || headingText };
    case 'quoteBlock':
    case 'fullBleedQuote':
    case 'pullQuote':
      return { quote: body || headingText };
    case 'factCard':
      return { fact: headingText, explanation: body || headingText };
    case 'comparisonBar':
      return { leftLabel: 'A', leftValue: 60, rightLabel: 'B', rightValue: 40 };
    case 'listBlock':
      return { items: extractListItems(block.contents) || ['Item 1', 'Item 2', 'Item 3'] };
    case 'definitionCard':
      return { term: headingText, definition: body || headingText };
    case 'dateEvent':
      return { date: headingText, description: body || headingText };
    default:
      return {};
  }
}

function blockToSlide(block: Block, index: number): Record<string, unknown> {
  const headingText = block.sourceHeading
    ? extractPlainText(block.sourceHeading)
    : block.title || block.id || `Slide ${index + 1}`;

  const requestedTemplate = block.template || 'sectionHeader';
  const template = hasTemplate(requestedTemplate) ? requestedTemplate : 'sectionHeader';
  const defaults = getTemplateDefaults(template, headingText, block);

  const {
    id: _id,
    startTime: _st,
    duration: _d,
    audioSegment: _as,
    layers: _l,
    transition: _tr,
    template: _t,
    title: _ti,
    children: _c,
    contents: _co,
    sourceHeading: _sh,
    templateOverrides: _to,
    ...extraFields
  } = block as unknown as Record<string, unknown>;

  return {
    id: block.id,
    template,
    duration: block.duration,
    audioSegment: 0,
    transition: index > 0 ? { type: 'fade', duration: 0.5 } : undefined,
    title: headingText,
    ...defaults,
    ...extraFields,
    ...block.templateOverrides,
  };
}

const IMAGE_MOTIONS: Array<'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight'> = [
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
];

// ── Public API ─────────────────────────────────────────────────────

/**
 * Build a player-ready Doc from a markdown-derived Doc.
 *
 * Flattens hierarchical blocks, converts each to a TemplateBlock-compatible
 * slide, interleaves images, recalculates timing, and adds a synthetic
 * audio segment.
 */
export function buildPreviewDoc(doc: Doc): Doc {
  const flat = flattenBlocks(doc.blocks);
  const allImages = collectAllDocImages(doc.blocks);
  const usedImageSrcs = new Set<string>();

  const slides: Record<string, unknown>[] = [];
  let motionIndex = 0;

  for (let i = 0; i < flat.length; i++) {
    const block = flat[i];
    const blockImages = extractBlockImages(block.contents);
    const slide = blockToSlide(block, i);

    if (blockImages.length > 0 && slide.template === 'sectionHeader') {
      const img = blockImages[0];
      usedImageSrcs.add(img.src);
      slide.template = 'imageWithCaption';
      slide.imageSrc = img.src;
      slide.imageAlt = img.alt;
      slide.caption = slide.title as string;
      slide.captionPosition = 'bottom';
      slide.ambientMotion = IMAGE_MOTIONS[motionIndex++ % IMAGE_MOTIONS.length];
    } else if (blockImages.length > 0) {
      const img = blockImages[0];
      usedImageSrcs.add(img.src);
      if (!slide.accentImage) {
        slide.accentImage = {
          src: img.src,
          alt: img.alt,
          position: 'left-strip',
          ambientMotion: IMAGE_MOTIONS[motionIndex++ % IMAGE_MOTIONS.length],
        };
      }
    }

    slides.push(slide);
  }

  // Interleave unused images
  const unusedImages = allImages.filter((img) => !usedImageSrcs.has(img.src));
  if (unusedImages.length > 0 && slides.length > 0) {
    const interval = Math.max(2, Math.floor(slides.length / (unusedImages.length + 1)));
    let insertOffset = 0;
    for (let imgIdx = 0; imgIdx < unusedImages.length; imgIdx++) {
      const insertAt = Math.min((imgIdx + 1) * interval + insertOffset, slides.length);
      const img = unusedImages[imgIdx];
      slides.splice(insertAt, 0, {
        id: `img-interleave-${imgIdx}`,
        template: 'imageWithCaption',
        duration: 5,
        audioSegment: 0,
        imageSrc: img.src,
        imageAlt: img.alt,
        ambientMotion: IMAGE_MOTIONS[motionIndex++ % IMAGE_MOTIONS.length],
        transition: { type: 'fade', duration: 0.5 },
      });
      insertOffset++;
    }
  }

  // Recalculate timing
  let t = 0;
  for (const slide of slides) {
    slide.startTime = t;
    t += slide.duration as number;
  }

  return {
    articleId: doc.articleId,
    duration: t,
    blocks: slides as unknown as Block[],
    audio: {
      segments: t > 0 ? [{ src: '', name: 'preview', duration: t, startTime: 0 }] : [],
    },
    ...(doc.captions ? { captions: doc.captions } : {}),
    ...(doc.startBlock ? { startBlock: doc.startBlock } : {}),
    ...(doc.themeId ? { themeId: doc.themeId } : {}),
  };
}

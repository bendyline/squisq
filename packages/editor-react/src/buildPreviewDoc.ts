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

import { deriveTemplateInputs, flattenRenderableBlocks, hasTemplate } from '@bendyline/squisq/doc';
import { extractPlainText, KNOWN_BLOCK_META_KEYS } from '@bendyline/squisq/markdown';
import { getChildren } from '@bendyline/squisq/markdown';
import { iconMarker } from '@bendyline/squisq/icon-marker';
import type { IconFamily } from '@bendyline/squisq/icons';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import type { MarkdownBlockNode, MarkdownList, MarkdownNode } from '@bendyline/squisq/markdown';

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Like `extractPlainText`, but preserves inline icons as encoded markers so
 * template text can render them as glyphs downstream (see `iconMarker` and
 * `TextLayer`). Mirrors `extractPlainText`'s value/child/list handling; the
 * only addition is the `inlineIcon` interception.
 */
function extractRichText(node: MarkdownNode): string {
  if (node.type === 'inlineIcon') {
    const icon = node as unknown as { family: IconFamily; name: string };
    return iconMarker(icon.family, icon.name);
  }
  if ('value' in node && typeof (node as { value?: unknown }).value === 'string') {
    return (node as { value: string }).value;
  }
  const children = getChildren(node);
  const separator = node.type === 'list' || node.type === 'listItem' ? '\n' : '';
  return children.map(extractRichText).join(separator);
}

function extractBodyText(contents: MarkdownBlockNode[] | undefined): string {
  if (!contents || contents.length === 0) return '';
  const parts: string[] = [];
  for (const node of contents) {
    // Mermaid fences are visual source, not narrative copy. They stay on the
    // slide as `contents` and materialize into Mermaid layers downstream.
    if (node.type === 'code' && node.lang?.trim().toLowerCase() === 'mermaid') continue;
    parts.push(extractRichText(node));
  }
  return parts.join('\n').trim();
}

interface ExtractedImage {
  src: string;
  alt: string;
  /** Explicit width from `<img width>` (markdown shorthand has none). */
  width?: number;
  /** Explicit height from `<img height>`. */
  height?: number;
}

function parseDim(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function extractBlockImages(contents: MarkdownBlockNode[] | undefined): ExtractedImage[] {
  if (!contents || contents.length === 0) return [];
  const images: ExtractedImage[] = [];

  function walkHtml(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'htmlElement' && (n.tagName as string).toLowerCase() === 'img') {
      const attrs = n.attributes as Record<string, string> | undefined;
      const src = attrs?.src;
      if (typeof src === 'string' && src) {
        images.push({
          src,
          alt: typeof attrs?.alt === 'string' ? attrs.alt : '',
          width: parseDim(attrs?.width),
          height: parseDim(attrs?.height),
        });
      }
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) walkHtml(child);
    }
  }

  function walk(node: MarkdownNode): void {
    if ('type' in node && node.type === 'image' && 'url' in node) {
      const img = node as { url: string; alt?: string };
      if (img.url) {
        images.push({ src: img.url, alt: img.alt ?? '' });
      }
    }
    // Resized images round-trip as raw HTML. Pick them up so feature
    // and slideshow previews show the actual image rather than a blank
    // placeholder.
    if ('type' in node && (node.type === 'htmlBlock' || node.type === 'htmlInline')) {
      const html = node as unknown as { htmlChildren?: unknown[] };
      for (const child of html.htmlChildren ?? []) walkHtml(child);
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
      return (
        deriveTemplateInputs(templateName, headingText, block.contents) ?? {
          stat: headingText,
          description: body || headingText,
        }
      );
    case 'quote':
    case 'fullBleedQuote':
    case 'pullQuote':
      return { quote: body || headingText };
    case 'factCard':
      return { fact: headingText, explanation: body || headingText };
    case 'comparisonBar':
      return { leftLabel: 'A', leftValue: 60, rightLabel: 'B', rightValue: 40 };
    case 'list': {
      const items = extractListItems(block.contents);
      return { items: items.length > 0 ? items : ['Item 1', 'Item 2', 'Item 3'] };
    }
    case 'definitionCard':
      return { term: headingText, definition: body || headingText };
    case 'dateEvent':
      return { date: headingText, description: body || headingText };
    case 'leftFeature':
    case 'rightFeature': {
      // Feature blocks need imageSrc from body content and use the
      // heading text as the visible title alongside the body paragraph.
      const images = extractBlockImages(block.contents);
      const img = images[0];
      return {
        imageSrc: img?.src ?? '',
        imageAlt: img?.alt || headingText,
        imageWidth: img?.width,
        imageHeight: img?.height,
        title: headingText,
        body: body || headingText,
      };
    }
    default:
      return {};
  }
}

function blockToSlide(
  block: Block,
  index: number,
  knownTemplates?: ReadonlySet<string>,
): Record<string, unknown> {
  const headingText = block.sourceHeading
    ? extractPlainText(block.sourceHeading)
    : block.title || block.id || `Slide ${index + 1}`;

  const requestedTemplate = block.template || 'sectionHeader';
  // A template is recognized if it's a built-in OR a user-defined
  // template carried in the doc's `customTemplates` set. Without this,
  // an annotated `{[hero]}` heading would silently fall back to
  // `sectionHeader` because `hasTemplate` only knows built-ins.
  const isCustomTemplate = knownTemplates?.has(requestedTemplate) ?? false;
  const recognized = hasTemplate(requestedTemplate) || isCustomTemplate;
  const template = recognized ? requestedTemplate : 'sectionHeader';
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
    templateData: _td,
    ...extraFields
  } = block as unknown as Record<string, unknown>;

  return {
    id: block.id,
    template,
    duration: block.duration,
    audioSegment: 0,
    // Respect the block's authored transition (set via the toolbar / on-canvas
    // properties palette → `{…}` block attrs). Only fall back to a default fade
    // for blocks past the first when the author hasn't chosen one; the first
    // block has no previous slide to transition in from.
    transition: block.transition ?? (index > 0 ? { type: 'fade', duration: 0.5 } : undefined),
    title: headingText,
    // Preserve body nodes on every slide. Built-in templates ignore this
    // structural field, while the canonical materializer uses it to retain
    // authored rich elements (Mermaid fences today; other media can follow)
    // independently of the selected visual template.
    ...(block.contents ? { contents: block.contents } : {}),
    // Custom templates additionally consume child blocks through tokens.
    ...(isCustomTemplate && block.children ? { children: block.children } : {}),
    ...defaults,
    ...extraFields,
    // Structured body data (```json data fences, GFM tables for dataTable)
    // carries typed values; `{[…]}` string overrides win last so an explicit
    // annotation param can still pin any field.
    //
    // Block-meta keys (transition, startTime, duration, …) are the exception:
    // they were already coerced to typed block fields above (e.g.
    // `block.transition` → `{ type, duration, direction }`). Their raw string
    // form also rides along in `templateData`/`templateOverrides` because the
    // author wrote them inside `{[…]}`; left un-stripped, that string would
    // spread back over the typed value here and clobber it — turning
    // `transition=vortex` into the string `"vortex"`, which the player can't
    // animate. Omit them from the content spreads so the typed fields win.
    ...omitBlockMeta(block.templateData),
    ...omitBlockMeta(block.templateOverrides),
  };
}

/** Keys coerced to typed block fields; must not be re-applied as raw strings. */
const BLOCK_META_KEYS: ReadonlySet<string> = new Set(Object.keys(KNOWN_BLOCK_META_KEYS));

/** Copy of a template-param record with block-meta keys removed. */
function omitBlockMeta(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return data;
  let hit = false;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (BLOCK_META_KEYS.has(key)) {
      hit = true;
      continue;
    }
    out[key] = data[key];
  }
  return hit ? out : data;
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
  // Container templates (`diagram`, `drawing`) render their children as
  // nodes/shapes, so those children must not also become preview slides.
  const flat = flattenRenderableBlocks(doc.blocks);
  const allImages = collectAllDocImages(doc.blocks);
  const usedImageSrcs = new Set<string>();
  // Names of user-defined templates carried by the doc — passed into
  // `blockToSlide` so heading annotations like `{[hero]}` aren't
  // silently downgraded to `sectionHeader` when the template doesn't
  // exist in the built-in registry.
  const knownTemplates = doc.customTemplates
    ? new Set(doc.customTemplates.map((d) => d.name))
    : undefined;

  const slides: Record<string, unknown>[] = [];
  let motionIndex = 0;

  for (let i = 0; i < flat.length; i++) {
    const block = flat[i];
    const blockImages = extractBlockImages(block.contents);
    const slide = blockToSlide(block, i, knownTemplates);

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

  const audio =
    doc.audio?.segments?.length > 0
      ? doc.audio
      : {
          segments: t > 0 ? [{ src: '', name: 'preview', duration: t, startTime: 0 }] : [],
        };

  return {
    // Preserve document-wide capabilities (custom themes, persistent layers,
    // scheduled media, frontmatter, captions, and future schema fields).
    // Preview preparation should replace only the slide/timing projection.
    ...doc,
    duration: t,
    blocks: slides as unknown as Block[],
    audio,
  };
}

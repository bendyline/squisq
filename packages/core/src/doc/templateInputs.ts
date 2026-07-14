/**
 * Template input derivation — build a template's required inputs from a
 * block's heading + markdown body.
 *
 * Used by:
 * - `markdownToDoc`'s content-aware auto template picking, so an
 *   auto-picked `quote`/`statHighlight`/`leftFeature` block carries the
 *   inputs its template needs through every render path (player, linear
 *   view, exports).
 * - `LinearDocView` / editor previews, to render annotated blocks whose
 *   authors didn't spell out every template param.
 *
 * Two modes:
 * - strict (default): returns `null` when an essential input can't be
 *   derived (no image for a feature block, no table for dataTable…) —
 *   auto-picking uses this to fall back to the structural default.
 * - placeholders: returns visible placeholder values instead of failing —
 *   preview surfaces use this so a half-authored block still renders.
 */

import type {
  MarkdownBlockNode,
  MarkdownCodeBlock,
  MarkdownList,
  MarkdownTable,
} from '../markdown/types.js';
import { extractPlainText } from '../markdown/utils.js';
import { matchNumberHighlight } from '../recommend/numberHighlight.js';
import {
  detectAsciiDiagram,
  isEligibleAsciiFenceLang,
  isExplicitDiagramLang,
} from './asciiDiagram/detect.js';
import { asciiDiagramToTemplateData } from './asciiDiagram/mapping.js';
import { detectAsciiTimeline, isEligibleAsciiTimelineFenceLang } from './asciiTimeline/detect.js';
import { asciiTimelineToTemplateData } from './asciiTimeline/mapping.js';
import { detectTree, isEligibleTreeFenceLang, isExplicitTreeLang } from './treeview/detect.js';
import { treeToTemplateData, treeFromMarkdownList, findFirstList } from './treeview/mapping.js';

/** First image discovered in a block's body, with explicit dimensions when present. */
export interface FirstImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

/** Plain text of a block's body contents (excluding the heading). */
export function extractBodyPlainText(contents?: MarkdownBlockNode[]): string {
  if (!contents || contents.length === 0) return '';
  return contents
    .filter((node) => !(node.type === 'code' && node.lang?.trim().toLowerCase() === 'mermaid'))
    .map((n) => extractPlainText(n))
    .join('\n')
    .trim();
}

/** Extract list items as plain text. */
export function extractListItems(contents?: MarkdownBlockNode[]): string[] {
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

/** Parse a `width`/`height` HTML attribute to a positive number. */
function parseDim(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Find images referenced anywhere in block contents — both markdown
 * shorthand `![alt](url)` (type `image`) and raw HTML `<img>` tags
 * (type `htmlBlock`/`htmlInline`). The WYSIWYG editor emits the HTML form
 * whenever a user resizes an image, so missing that path silently breaks
 * every resized image.
 *
 * @param limit Stop after this many images (default: all).
 */
export function extractImages(
  contents: MarkdownBlockNode[] | undefined,
  limit = Infinity,
): FirstImage[] {
  if (!contents || contents.length === 0) return [];
  const found: FirstImage[] = [];

  function fromHtml(nodes: unknown[]): void {
    for (const node of nodes) {
      if (found.length >= limit) return;
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;
      if (n.type === 'htmlElement' && n.tagName === 'img') {
        const attrs = n.attributes as Record<string, string> | undefined;
        if (attrs && typeof attrs.src === 'string' && attrs.src) {
          found.push({
            src: attrs.src,
            alt: typeof attrs.alt === 'string' ? attrs.alt : '',
            width: parseDim(attrs.width),
            height: parseDim(attrs.height),
          });
        }
      }
      if (Array.isArray(n.children)) fromHtml(n.children);
    }
  }

  function walk(node: unknown): void {
    if (found.length >= limit) return;
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'image' && typeof n.url === 'string' && n.url) {
      found.push({ src: n.url, alt: typeof n.alt === 'string' ? n.alt : '' });
      return;
    }
    if ((n.type === 'htmlBlock' || n.type === 'htmlInline') && Array.isArray(n.htmlChildren)) {
      fromHtml(n.htmlChildren);
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) walk(child);
    }
  }

  for (const node of contents) {
    if (found.length >= limit) break;
    walk(node);
  }
  return found;
}

/** First image in a block's body, or null. */
export function extractFirstImage(contents: MarkdownBlockNode[] | undefined): FirstImage | null {
  return extractImages(contents, 1)[0] ?? null;
}

/** Extract table data (headers, rows, alignment) from block contents. */
export function extractTableFromContents(contents?: MarkdownBlockNode[]): {
  headers: string[];
  rows: string[][];
  align?: (('left' | 'right' | 'center') | null)[];
} | null {
  if (!contents) return null;
  for (const node of contents) {
    if (node.type === 'table') {
      const table = node as MarkdownTable;
      const [headerRow, ...bodyRows] = table.children;
      if (!headerRow) return null;
      const headers = headerRow.children.map((cell) => extractPlainText(cell).trim());
      const rows = bodyRows.map((row) => row.children.map((cell) => extractPlainText(cell).trim()));
      return { headers, rows, align: table.align };
    }
  }
  return null;
}

/** First blockquote's plain text, or ''. */
export function extractBlockquoteText(contents?: MarkdownBlockNode[]): string {
  if (!contents) return '';
  for (const node of contents) {
    if (node.type === 'blockquote') return extractPlainText(node).trim();
  }
  return '';
}

function firstParagraph(
  contents: MarkdownBlockNode[] | undefined,
): { node: Extract<MarkdownBlockNode, { type: 'paragraph' }>; index: number } | null {
  if (!contents) return null;
  const index = contents.findIndex((node) => node.type === 'paragraph');
  if (index < 0) return null;
  return {
    node: contents[index] as Extract<MarkdownBlockNode, { type: 'paragraph' }>,
    index,
  };
}

/** A leading bold number is an explicit authoring signal for the hero stat. */
function leadingStrongStat(
  paragraph: Extract<MarkdownBlockNode, { type: 'paragraph' }>,
): string | null {
  for (const child of paragraph.children) {
    if (child.type === 'text' && child.value.trim() === '') continue;
    if (child.type !== 'strong') return null;
    const text = extractPlainText(child).trim();
    // Explicit bold authoring is intentionally broader than automatic stat
    // recommendation: a small integer such as `**42**` is a valid hero when
    // the author chose statHighlight. Anchor at the beginning so a bold phrase
    // like `**Revenue grew 42%**` does not become oversized wholesale.
    const match = text.match(/^(?:[$€£¥]\s*)?[+-]?\d+(?:[.,]\d+)*(?:\s?(?:[%‰x×]|[A-Za-z]+))?/);
    return match?.[0].trim() || null;
  }
  return null;
}

function removeStatPhrase(text: string, start: number, end: number): string {
  const before = text.slice(0, start).trim();
  let after = text.slice(end);
  // A dash/colon visually separates inline prose, but is redundant once the
  // stat and description render on separate lines.
  if (!before) after = after.replace(/^\s*(?:[-–—:]\s*)?/, '');
  else after = after.trim();
  return [before, after].filter(Boolean).join(' ').trim();
}

function bodyWithoutParagraphStat(
  contents: MarkdownBlockNode[] | undefined,
  paragraphIndex: number,
  paragraphText: string,
  start: number,
  end: number,
): string {
  if (!contents) return '';
  return contents
    .map((node, index) =>
      index === paragraphIndex
        ? removeStatPhrase(paragraphText, start, end)
        : extractPlainText(node).trim(),
    )
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Map Markdown-authored stat content onto the template's visual roles.
 *
 * A leading bold metric in the body is the strongest signal (`**42%** of
 * teams`), followed by a stat-looking heading for backward compatibility,
 * then an unformatted metric in the first body paragraph (used by automatic
 * templates). Generic content retains the historical heading/body mapping.
 */
function deriveStatHighlightInputs(
  headingText: string,
  contents: MarkdownBlockNode[] | undefined,
  bodyText: string,
): Record<string, unknown> {
  const paragraph = firstParagraph(contents);
  if (paragraph) {
    const paragraphText = extractPlainText(paragraph.node).trim();
    const strongStat = leadingStrongStat(paragraph.node);
    if (strongStat) {
      const start = paragraphText.indexOf(strongStat);
      const description = bodyWithoutParagraphStat(
        contents,
        paragraph.index,
        paragraphText,
        start,
        start + strongStat.length,
      );
      return {
        stat: strongStat,
        description: description || headingText || strongStat,
      };
    }
  }

  const trimmedHeading = headingText.trim();
  const headingStat = matchNumberHighlight(trimmedHeading);
  if (headingStat && headingStat.index === 0 && headingStat.end === trimmedHeading.length) {
    return { stat: headingText, description: bodyText || headingText };
  }

  if (paragraph) {
    const paragraphText = extractPlainText(paragraph.node).trim();
    const bodyStat = matchNumberHighlight(paragraphText);
    if (bodyStat) {
      const description = bodyWithoutParagraphStat(
        contents,
        paragraph.index,
        paragraphText,
        bodyStat.index,
        bodyStat.end,
      );
      return {
        stat: bodyStat.value,
        description: description || headingText || bodyStat.value,
      };
    }
  }

  return { stat: headingText, description: bodyText || headingText };
}

export interface DeriveTemplateInputsOptions {
  /**
   * Return visible placeholder values instead of `null` when an essential
   * input can't be derived (preview surfaces). Default false (strict).
   */
  placeholders?: boolean;
}

/**
 * Derive a template's inputs from a block's heading text and body nodes.
 * Returns the input fields to merge onto the block, or `null` in strict
 * mode when an essential input is missing.
 */
export function deriveTemplateInputs(
  templateName: string,
  headingText: string,
  contents: MarkdownBlockNode[] | undefined,
  options: DeriveTemplateInputsOptions = {},
): Record<string, unknown> | null {
  const placeholders = options.placeholders === true;
  const bodyText = extractBodyPlainText(contents);

  switch (templateName) {
    case 'statHighlight':
      return deriveStatHighlightInputs(headingText, contents, bodyText);
    case 'quote': {
      const quote = extractBlockquoteText(contents) || bodyText || headingText;
      return { quote };
    }
    case 'fullBleedQuote':
    case 'pullQuote': {
      // These templates take `text` (not `quote`).
      const text = extractBlockquoteText(contents) || bodyText || headingText;
      return { text };
    }
    case 'factCard':
      return { fact: headingText, explanation: bodyText || headingText };
    case 'comparisonBar':
      return placeholders
        ? { leftLabel: 'A', leftValue: 60, rightLabel: 'B', rightValue: 40 }
        : null;
    case 'list': {
      const items = extractListItems(contents);
      if (items.length > 0) return { items };
      return placeholders ? { items: ['Item 1', 'Item 2', 'Item 3'] } : null;
    }
    case 'definitionCard':
      return { term: headingText, definition: bodyText || headingText };
    case 'dateEvent':
      return { date: headingText, description: bodyText || headingText };
    case 'dataTable': {
      const tableData = extractTableFromContents(contents);
      if (tableData) return tableData;
      return placeholders ? { headers: ['Column'], rows: [['Data']] } : null;
    }
    case 'imageWithCaption': {
      const img = extractFirstImage(contents);
      if (!img) return placeholders ? { caption: headingText } : null;
      return { imageSrc: img.src, imageAlt: img.alt || headingText, caption: headingText };
    }
    case 'photoGrid': {
      const images = extractImages(contents, 4);
      if (images.length < 2) return placeholders ? {} : null;
      return {
        images: images.map((i) => ({ src: i.src, alt: i.alt })),
        caption: headingText,
      };
    }
    case 'leftFeature':
    case 'rightFeature': {
      const img = extractFirstImage(contents);
      if (!img && !placeholders) return null;
      return {
        imageSrc: img?.src ?? '',
        imageAlt: img?.alt || headingText,
        imageWidth: img?.width,
        imageHeight: img?.height,
        title: headingText,
        body: bodyText,
      };
    }
    case 'diagram': {
      // Nodes/edges from an ASCII-art fence in the body (the fence itself
      // stays in `contents`, untouched, so round-trips are lossless).
      const fences = (contents ?? []).filter((n): n is MarkdownCodeBlock => n.type === 'code');
      const fence =
        fences.length === 1 && isEligibleAsciiFenceLang(fences[0].lang) ? fences[0] : undefined;
      const detection = fence
        ? detectAsciiDiagram(fence.value, { explicit: isExplicitDiagramLang(fence.lang) })
        : undefined;
      if (!detection?.isDiagram || !detection.diagram) return placeholders ? {} : null;
      const { nodes, edges } = asciiDiagramToTemplateData(detection.diagram);
      return { nodes, edges, ...(headingText ? { title: headingText } : {}) };
    }
    case 'timeline': {
      // Tracks/events from a spatial ASCII timeline fence. Calling this case
      // already implies author/template intent, so accept the detector's
      // explicit one-event form even when the fence itself is untagged.
      const fences = (contents ?? []).filter((n): n is MarkdownCodeBlock => n.type === 'code');
      const fence =
        fences.length === 1 && isEligibleAsciiTimelineFenceLang(fences[0].lang)
          ? fences[0]
          : undefined;
      const detection = fence ? detectAsciiTimeline(fence.value, { explicit: true }) : undefined;
      if (!detection?.isTimeline || !detection.timeline) return placeholders ? {} : null;
      const { tracks, links } = asciiTimelineToTemplateData(detection.timeline);
      return { tracks, links, ...(headingText ? { title: headingText } : {}) };
    }
    case 'tree': {
      // Items from an ASCII tree fence, or a nested markdown bullet list when
      // the author explicitly annotates a listed body. The fence/list stays
      // in `contents`, so round-trips are lossless.
      const fences = (contents ?? []).filter((n): n is MarkdownCodeBlock => n.type === 'code');
      const fence =
        fences.length === 1 && isEligibleTreeFenceLang(fences[0].lang) ? fences[0] : undefined;
      if (fence) {
        const detection = detectTree(fence.value, { explicit: isExplicitTreeLang(fence.lang) });
        if (detection.isTree && detection.tree) {
          const { items } = treeToTemplateData(detection.tree);
          return { items, ...(headingText ? { title: headingText } : {}) };
        }
      }
      const list = findFirstList(contents);
      if (list) {
        const { items } = treeToTemplateData(treeFromMarkdownList(list));
        if (items.length > 0) return { items, ...(headingText ? { title: headingText } : {}) };
      }
      return placeholders ? {} : null;
    }
    default:
      return placeholders ? {} : null;
  }
}

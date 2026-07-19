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
  MarkdownInlineNode,
  MarkdownList,
  MarkdownTable,
} from '../markdown/types.js';
import { sanitizeUrl } from '../markdown/sanitize.js';
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

/** First-class video reference discovered in a block body. */
export interface EmbeddedVideo {
  src: string;
  posterSrc?: string;
  alt: string;
}

const VIDEO_FILE_RE = /\.(?:webm|mp4|mov|m4v|ogv)(?:[?#].*)?$/i;

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
  return extractRichListItems(contents).map((item) => item.text);
}

/** One authored Markdown list item with both plain and rich projections. */
export interface RichListItem {
  text: string;
  markdown: MarkdownBlockNode[];
  html?: string;
}

function escapeInlineHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineHtml(nodes: MarkdownInlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return escapeInlineHtml(node.value);
        case 'emphasis':
          return `<em>${renderInlineHtml(node.children)}</em>`;
        case 'strong':
          return `<strong>${renderInlineHtml(node.children)}</strong>`;
        case 'delete':
          return `<del>${renderInlineHtml(node.children)}</del>`;
        case 'inlineCode':
          return `<code>${escapeInlineHtml(node.value)}</code>`;
        case 'link': {
          const label = renderInlineHtml(node.children);
          const href = sanitizeUrl(node.url, 'link');
          if (!href) return label;
          const title = node.title ? ` title="${escapeInlineHtml(node.title)}"` : '';
          return `<a href="${escapeInlineHtml(href)}"${title}>${label}</a>`;
        }
        case 'break':
          return '<br>';
        case 'image':
          return escapeInlineHtml(node.alt ?? '');
        case 'inlineMath':
          return escapeInlineHtml(`$${node.value}$`);
        case 'footnoteReference':
          return escapeInlineHtml(`[^${node.label ?? node.identifier}]`);
        case 'linkReference':
        case 'textDirective':
          return renderInlineHtml(node.children);
        case 'imageReference':
          return escapeInlineHtml(node.alt ?? '');
        case 'mention':
          return escapeInlineHtml(`@${node.displayName}`);
        case 'inlineIcon':
          return escapeInlineHtml(`{[${node.token}]}`);
        case 'htmlInline':
          return escapeInlineHtml(node.rawHtml);
      }
    })
    .join('');
}

function renderListItemHtml(markdown: MarkdownBlockNode[]): string {
  return markdown
    .map((node) =>
      node.type === 'paragraph' || node.type === 'heading'
        ? renderInlineHtml(node.children)
        : escapeInlineHtml(extractPlainText(node)),
    )
    .join('<br>');
}

/** Extract list items without discarding their inline Markdown formatting. */
export function extractRichListItems(contents?: MarkdownBlockNode[]): RichListItem[] {
  if (!contents) return [];
  const items: RichListItem[] = [];
  for (const node of contents) {
    if (node.type !== 'list') continue;
    for (const item of (node as MarkdownList).children) {
      const text = extractPlainText(item).trim();
      if (!text) continue;
      const html = renderListItemHtml(item.children);
      const plainHtml = escapeInlineHtml(text).replace(/\r?\n/g, '<br>');
      items.push({
        text,
        markdown: item.children,
        ...(html && html !== plainHtml ? { html } : {}),
      });
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

/**
 * Find playable video references in block contents.
 *
 * Recorder output is raw HTML (`<video src="...">`), sometimes with a
 * nested `<source>`. Direct markdown links/images to video files are also
 * accepted. Hosted watch-page/iframe URLs are deliberately excluded: an
 * HTML5 VideoLayer cannot play those URLs directly.
 */
export function extractEmbeddedVideos(
  contents: MarkdownBlockNode[] | undefined,
  limit = Infinity,
): EmbeddedVideo[] {
  if (!contents || contents.length === 0) return [];
  const found: EmbeddedVideo[] = [];
  const seen = new Set<string>();

  const add = (video: EmbeddedVideo): void => {
    if (!video.src || found.length >= limit || seen.has(video.src)) return;
    seen.add(video.src);
    found.push(video);
  };

  function nestedSource(children: unknown): string | undefined {
    if (!Array.isArray(children)) return undefined;
    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      const node = child as Record<string, unknown>;
      if (node.tagName === 'source') {
        const attrs = node.attributes as Record<string, string> | undefined;
        if (typeof attrs?.src === 'string' && attrs.src) return attrs.src;
      }
      const nested = nestedSource(node.children);
      if (nested) return nested;
    }
    return undefined;
  }

  function walk(node: unknown): void {
    if (found.length >= limit || !node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;

    if (n.type === 'htmlElement' && n.tagName === 'video') {
      const attrs = n.attributes as Record<string, string> | undefined;
      const src = attrs?.src || nestedSource(n.children);
      if (src) {
        add({
          src,
          ...(attrs?.poster ? { posterSrc: attrs.poster } : {}),
          alt: attrs?.['aria-label'] || attrs?.title || attrs?.alt || '',
        });
      }
    } else if (
      (n.type === 'link' || n.type === 'image') &&
      typeof n.url === 'string' &&
      VIDEO_FILE_RE.test(n.url)
    ) {
      add({
        src: n.url,
        alt:
          typeof n.alt === 'string'
            ? n.alt
            : extractPlainText(n as unknown as MarkdownBlockNode).trim(),
      });
    }

    if (Array.isArray(n.children)) n.children.forEach(walk);
    if (Array.isArray(n.htmlChildren)) n.htmlChildren.forEach(walk);
  }

  contents.forEach(walk);
  return found;
}

/** First directly playable video in a block body, or null. */
export function extractFirstEmbeddedVideo(
  contents: MarkdownBlockNode[] | undefined,
): EmbeddedVideo | null {
  return extractEmbeddedVideos(contents, 1)[0] ?? null;
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
  /**
   * Keep the source heading visible when a template normally promotes only
   * body content. Used by automatic templates; explicit annotations retain
   * their historical input derivation.
   */
  preserveSourceHeading?: boolean;
}

function normalizeCoverageText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Whether an automatically selected template can represent every authored
 * node in the block. Auto-selection must be conservative: the source remains
 * round-trippable either way, but a successful render may not hide sibling
 * content that the chosen template has no slot for.
 */
export function autoTemplatePreservesContent(
  templateName: string,
  contents: MarkdownBlockNode[] | undefined,
): boolean {
  const nodes = contents ?? [];

  switch (templateName) {
    case 'quote':
      return nodes.length === 1 && nodes[0]?.type === 'blockquote';
    case 'dataTable':
      return nodes.length === 1 && nodes[0]?.type === 'table';
    case 'list':
      return nodes.length === 1 && nodes[0]?.type === 'list';
    case 'diagram':
    case 'timeline':
      return nodes.length === 1 && nodes[0]?.type === 'code';
    case 'tree':
      return nodes.length === 1 && (nodes[0]?.type === 'code' || nodes[0]?.type === 'list');
    case 'photoGrid': {
      const images = extractImages(nodes);
      if (images.length < 2 || images.length > 4) return false;
      const bodyText = normalizeCoverageText(extractBodyPlainText(nodes));
      const representedText = normalizeCoverageText(
        images
          .map((image) => image.alt)
          .filter(Boolean)
          .join(' '),
      );
      return bodyText === '' || bodyText === representedText;
    }
    case 'videoWithCaption': {
      const videos = extractEmbeddedVideos(nodes);
      if (videos.length !== 1) return false;
      const bodyText = normalizeCoverageText(extractBodyPlainText(nodes));
      return bodyText === normalizeCoverageText(videos[0]?.alt ?? '');
    }
    case 'leftFeature':
    case 'rightFeature':
    case 'statHighlight':
      // Feature bodies retain all plain text; stat auto-derivation uses the
      // preserveSourceHeading mode below and retains the remaining body.
      return true;
    default:
      return false;
  }
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
    case 'statHighlight': {
      const inputs = deriveStatHighlightInputs(headingText, contents, bodyText);
      if (
        options.preserveSourceHeading &&
        headingText &&
        inputs.stat !== headingText &&
        inputs.description !== headingText
      ) {
        return {
          ...inputs,
          description: headingText,
          ...(inputs.description ? { detail: inputs.description } : {}),
        };
      }
      return inputs;
    }
    case 'quote': {
      const quote = extractBlockquoteText(contents) || bodyText;
      if (quote) return { quote, ...(headingText ? { title: headingText } : {}) };
      // A heading-only quote promotes the heading into the quote slot. Do not
      // also return it as the optional title, or renderers display the same
      // authored text twice.
      return { quote: headingText };
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
      if (items.length > 0) return { items, ...(headingText ? { title: headingText } : {}) };
      return placeholders ? { items: ['Item 1', 'Item 2', 'Item 3'] } : null;
    }
    case 'definitionCard':
      return { term: headingText, definition: bodyText || headingText };
    case 'dateEvent':
      return { date: headingText, description: bodyText || headingText };
    case 'dataTable': {
      const tableData = extractTableFromContents(contents);
      if (tableData) return { ...tableData, ...(headingText ? { title: headingText } : {}) };
      return placeholders ? { headers: ['Column'], rows: [['Data']] } : null;
    }
    case 'barChart':
    case 'columnChart':
    case 'pieChart':
    case 'donutChart':
    case 'lineChart':
    case 'areaChart':
    case 'scatterChart': {
      // Charts plot the body table; `align` is presentation-only and dropped.
      const tableData = extractTableFromContents(contents);
      if (tableData) {
        return {
          headers: tableData.headers,
          rows: tableData.rows,
          ...(headingText ? { title: headingText } : {}),
        };
      }
      // Placeholder sample data only for a truly empty block (a bare
      // annotated heading — authoring preview). A block with real body
      // content but no table must NOT get invented data: returning null
      // lets the chart engine fall back to content rendering.
      return placeholders && !bodyText.trim()
        ? {
            headers: ['Quarter', 'Revenue', 'Costs'],
            rows: [
              ['Q1', '40', '28'],
              ['Q2', '55', '31'],
              ['Q3', '48', '30'],
              ['Q4', '62', '35'],
            ],
            ...(headingText ? { title: headingText } : {}),
          }
        : null;
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
    case 'videoWithCaption': {
      const video = extractFirstEmbeddedVideo(contents);
      if (!video) return placeholders ? { caption: headingText } : null;
      return {
        videoSrc: video.src,
        posterSrc: video.posterSrc,
        videoAlt: video.alt || headingText,
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

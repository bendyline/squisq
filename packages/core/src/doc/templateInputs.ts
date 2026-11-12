import type { ContentBuildPlan } from './builds.js';
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
  HtmlElement,
  MarkdownBlockNode,
  MarkdownCodeBlock,
  MarkdownInlineNode,
  MarkdownList,
  MarkdownNode,
  MarkdownTable,
} from '../markdown/types.js';
import { parseTimeSeconds } from '../markdown/annotationCoercion.js';
import { mediaKindForUrl } from '../markdown/mediaReference.js';
import { sanitizeUrl } from '../markdown/sanitize.js';
import { extractPlainText, isHtmlLineBreak } from '../markdown/utils.js';
import { isSvgIslandLang } from '../markdown/svgIsland.js';
import { findBlockVideoEmbed } from '../markdown/videoEmbed.js';
import { matchNumberHighlight } from '../recommend/numberHighlight.js';
import { isStandaloneHtmlVideo } from './mediaAnnotations.js';
import { taskMarker } from '../schemas/Doc.js';
import { readMatrixItems, splitConceptItem } from './templates/conceptItems.js';
import {
  detectAsciiDiagram,
  isEligibleAsciiFenceLang,
  isExplicitDiagramLang,
} from './asciiDiagram/detect.js';
import { asciiDiagramToTemplateData } from './asciiDiagram/mapping.js';
import {
  detectAsciiTimeline,
  isEligibleAsciiTimelineFenceLang,
  isExplicitTimelineLang,
} from './asciiTimeline/detect.js';
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
  /** Delay within the owning block before playback begins. */
  startAt?: number;
  /** Source-media in/out points carried by inline video data attributes. */
  clipStart?: number;
  clipEnd?: number;
}

const VIDEO_FILE_RE = /\.(?:webm|mp4|mov|m4v|ogv)(?:[?#].*)?$/i;

/** An inline `<video>`/`<audio>` tag (or its `<source>`/`<track>`/closing tag). */
const INLINE_MEDIA_TAG_RE = /^<\/?(?:video|audio|source|track)\b/i;

/** A hosted video (YouTube, Vimeo, …) a block body stands for. */
export interface HostedVideo {
  /** Canonical page URL — what a `videoEmbed` layer carries. */
  url: string;
  /** The author's label (link text or iframe title), when there is one. */
  title: string | null;
  /** Width ÷ height: 16/9, or 9/16 for YouTube Shorts. */
  aspectRatio: number;
}

/**
 * Hosted videos in a block body: each TOP-LEVEL paragraph that is only a link
 * (or bare URL) to a video page, or HTML block holding a provider `<iframe>`
 * (core `findBlockVideoEmbed`). Deduplicated by page URL, in document order.
 * A video link inside prose, a list or a quote is not one — it stays a link.
 */
export function extractHostedVideos(
  contents: readonly MarkdownBlockNode[] | undefined,
  limit = Infinity,
): HostedVideo[] {
  const found: HostedVideo[] = [];
  const seen = new Set<string>();
  for (const node of contents ?? []) {
    if (found.length >= limit) break;
    const video = findBlockVideoEmbed(node);
    if (!video || seen.has(video.embed.watchUrl)) continue;
    seen.add(video.embed.watchUrl);
    found.push({
      url: video.embed.watchUrl,
      title: video.title,
      aspectRatio: video.embed.aspectRatio,
    });
  }
  return found;
}

/**
 * A fence whose language makes it a picture rather than code: ```mermaid (a
 * diagram) or ```svg (an SVG island). Decided by the language alone, so a
 * fence that fails to render is still never read as prose — narration,
 * captions and reading time must not speak diagram source or SVG markup.
 */
export function isPictureFence(node: MarkdownNode): boolean {
  if (node.type !== 'code') return false;
  return node.lang?.trim().toLowerCase() === 'mermaid' || isSvgIslandLang(node.lang);
}

/**
 * A fence the author tagged ```diagram, ```tree or ```timeline whose art
 * parses: `appendRichContentLayers` draws it as its own picture beside the
 * block's words. Its source is box-drawing and marker art (`● Start {#start}
 * ─────●`), so as prose it would print on the slide next to the picture it
 * became and be read aloud by narration. An untagged fence stays code; one
 * whose art does not parse stays visible rather than disappearing.
 */
export function isSpatialPictureFence(node: MarkdownNode): boolean {
  if (node.type !== 'code') return false;
  if (isExplicitDiagramLang(node.lang)) {
    return detectAsciiDiagram(node.value, { explicit: true }).isDiagram;
  }
  if (isExplicitTreeLang(node.lang)) return detectTree(node.value, { explicit: true }).isTree;
  if (isExplicitTimelineLang(node.lang)) {
    return detectAsciiTimeline(node.value, { explicit: true }).isTimeline;
  }
  return false;
}

/**
 * Body nodes that render as their own visual layer rather than as prose: a
 * picture fence ({@link isPictureFence}), a tagged diagram, tree or timeline
 * ({@link isSpatialPictureFence}), a hosted-video paragraph and a standalone
 * `<video>` (players, via `appendRichContentLayers`). Repeating them as body
 * text would print the diagram source, the video's link or its raw tag under
 * the very thing they became.
 */
export function isMaterializedMediaNode(node: MarkdownBlockNode): boolean {
  if (node.type === 'code') return isPictureFence(node) || isSpatialPictureFence(node);
  return findBlockVideoEmbed(node) !== null || isStandaloneHtmlVideo(node);
}

/**
 * A paragraph that is only pictures: markdown images (a video file in image
 * syntax included) or resized `<img>` tags. A media-led template shows them
 * in its media band, so their alt text repeated as body copy would caption
 * the picture twice.
 */
export function isPictureParagraph(node: MarkdownBlockNode): boolean {
  if (node.type !== 'paragraph') return false;
  let pictures = 0;
  for (const child of node.children) {
    if (child.type === 'image') {
      if (!VIDEO_FILE_RE.test(child.url) && mediaKindForUrl(child.url)) return false;
      pictures += 1;
    } else if (child.type === 'htmlInline') {
      const elements = child.htmlChildren.filter(
        (html): html is HtmlElement => html.type === 'htmlElement',
      );
      if (!elements.length || !elements.every((html) => html.tagName === 'img')) return false;
      pictures += elements.length;
    } else if (child.type !== 'break' && !(child.type === 'text' && !child.value.trim())) {
      return false;
    }
  }
  return pictures > 0;
}

/** Plain text of a block's body contents (excluding the heading). */
export function extractBodyPlainText(contents?: MarkdownBlockNode[]): string {
  if (!contents || contents.length === 0) return '';
  return contents
    .filter((node) => !isMaterializedMediaNode(node))
    .map((n) => extractPlainText(n))
    .join('\n')
    .trim();
}

/** Extract list items as plain text. */
export function extractListItems(contents?: MarkdownBlockNode[]): string[] {
  return extractRichListItems(contents).map((item) => item.text);
}

/**
 * List items as the ideas of a concept block. An item with sub-items reads as
 * `Label: detail`: its own words are the label and its sub-items the detail
 * ("Discover" over "Interview customers; Review existing data"), so a nested
 * list draws as labelled ideas instead of one run-on line.
 */
export function extractConceptItems(contents?: MarkdownBlockNode[]): string[] {
  const flat = (node: MarkdownNode): string => extractPlainText(node).replace(/\s+/g, ' ').trim();
  const items: string[] = [];
  for (const node of contents ?? []) {
    if (node.type !== 'list') continue;
    for (const item of (node as MarkdownList).children) {
      const own = item.children
        .filter((child) => child.type !== 'list')
        .map(flat)
        .filter(Boolean)
        .join(' ');
      const nested = item.children
        .filter((child): child is MarkdownList => child.type === 'list')
        .flatMap((list) => list.children.map(flat))
        .filter(Boolean);
      if (!own && !nested.length) continue;
      if (!nested.length) items.push(own);
      else if (!own) items.push(nested.join('; '));
      // An item that already has its own "Label: detail" keeps it; the sub-items extend the detail.
      else
        items.push(
          `${own.replace(/[:;,.]$/, '')}${/:\s/.test(own) ? ';' : ':'} ${nested.join('; ')}`,
        );
    }
  }
  return items;
}

/** The longest unlabelled item that can stand as a column's label. */
const COLUMN_LABEL_CHARACTERS = 40;

/**
 * The two columns a `{[twoColumn]}` block draws when its body is a list of
 * exactly two items: `Label: detail` gives a label and the words beneath it,
 * and a short item is its own label. Anything longer is not two columns.
 */
function twoColumnsFromList(
  contents?: MarkdownBlockNode[],
): { left: TwoColumnSide; right: TwoColumnSide } | null {
  const items = extractConceptItems(contents);
  if (items.length !== 2) return null;
  const sides = items.map((item): TwoColumnSide | null => {
    const { label, detail } = splitConceptItem(item);
    if (label) return { label, sublabel: detail };
    return detail.length <= COLUMN_LABEL_CHARACTERS ? { label: detail } : null;
  });
  const [left, right] = sides;
  return left && right ? { left, right } : null;
}

interface TwoColumnSide {
  label: string;
  sublabel?: string;
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
        case 'superscript':
          return `<sup>${renderInlineHtml(node.children)}</sup>`;
        case 'subscript':
          return `<sub>${renderInlineHtml(node.children)}</sub>`;
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
          return `<i class="fa-${node.family} fa-${node.name}" aria-hidden="true"></i>`;
        case 'htmlInline':
          // A `<br>` tag is a line break — the only one a table cell can hold,
          // and the one the editor writes there for Enter.
          if (isHtmlLineBreak(node.rawHtml)) return '<br>';
          // A clip plays as its own layer; its markup printed as text says
          // nothing (a recording inside a list item lands here).
          return INLINE_MEDIA_TAG_RE.test(node.rawHtml.trim())
            ? ''
            : escapeInlineHtml(node.rawHtml);
      }
    })
    .join('');
}

/**
 * Render Markdown block nodes as the small, sanitized HTML subset accepted by
 * `TextLayer.content.html`. This keeps structural content (especially lists
 * and paragraph boundaries) intact when a slide template uses one rich text
 * layer instead of the full React Markdown renderer.
 *
 * Raw HTML blocks deliberately fall through to escaped plain text. The text
 * layer renderer sanitizes this projection again, but generated HTML should
 * still be safe before it reaches that boundary.
 */
export function renderMarkdownBlocksHtml(
  nodes: readonly MarkdownBlockNode[],
  builds?: ContentBuildPlan,
): string {
  const renderBlocks = (blocks: readonly MarkdownBlockNode[]): string =>
    blocks
      .map((node, index) => {
        const previous = blocks[index - 1];
        const extraBlankLines = previous
          ? Math.max(0, markdownBlockSeparatorLines(previous, node) - 2)
          : 0;
        const sourceGap = '<div data-squisq-source-gap aria-hidden="true"><br></div>'.repeat(
          extraBlankLines,
        );
        const html = renderBlock(node);
        const step = builds?.targets.get(node);
        return `${sourceGap}${step === undefined ? html : `<div data-squisq-build-step="${step}">${html}</div>`}`;
      })
      .join('');

  const renderList = (node: MarkdownList): string => {
    const tag = node.ordered ? 'ol' : 'ul';
    const start = node.ordered && node.start != null ? ` start="${node.start}"` : '';
    const items = node.children
      .map((item, index) => {
        // A task item shows its box in place of the bullet, not `[ ]` text
        // after one.
        const task = item.checked == null ? null : taskMarker(item.checked);
        const step = builds?.targets.get(item);
        if (step === undefined) {
          // `data-squisq-task` hides the item's bullet in the slide stylesheet.
          return task === null
            ? `<li>${renderBlocks(item.children)}</li>`
            : `<li data-squisq-task><span aria-hidden="true">${task} </span>${renderBlocks(item.children)}</li>`;
        }
        const marker = task ?? (node.ordered ? `${(node.start ?? 1) + index}.` : '•');
        // A list item can resume its prose after a nested list. Keep those runs
        // in source order, but give every run the same reveal step.
        let first = true;
        let own: MarkdownBlockNode[] = [];
        const fragments: string[] = [];
        const flush = () => {
          if (!first && !own.length) return;
          fragments.push(
            `<div data-squisq-build-step="${step}" data-squisq-build-row><span aria-hidden="true">${first ? marker : ''}</span><div>${renderBlocks(own)}</div></div>`,
          );
          first = false;
          own = [];
        };
        for (const child of item.children) {
          if (child.type === 'list') {
            flush();
            fragments.push(renderList(child));
          } else own.push(child);
        }
        flush();
        return `<li data-squisq-build-item>${fragments.join('')}</li>`;
      })
      .join('');
    return `<${tag}${start}>${items}</${tag}>`;
  };

  const renderBlock = (node: MarkdownBlockNode): string => {
    switch (node.type) {
      case 'paragraph':
        return `<p>${renderInlineHtml(node.children)}</p>`;
      case 'heading':
        return `<h${node.depth}>${renderInlineHtml(node.children)}</h${node.depth}>`;
      case 'blockquote':
        return `<blockquote>${renderBlocks(node.children)}</blockquote>`;
      case 'list':
        return renderList(node);
      case 'code':
        return `<pre><code>${escapeInlineHtml(node.value)}</code></pre>`;
      case 'thematicBreak':
        return '<hr>';
      case 'table': {
        const [head, ...body] = node.children;
        const row = (cells: (typeof node.children)[number]['children'], header: boolean) =>
          `<tr>${cells
            .map((cell, columnIndex) => {
              const tag = header ? 'th' : 'td';
              const alignment = node.align?.[columnIndex];
              const alignAttribute = alignment ? ` align="${alignment}"` : '';
              return `<${tag}${alignAttribute}>${renderInlineHtml(cell.children)}</${tag}>`;
            })
            .join('')}</tr>`;
        const thead = head ? `<thead>${row(head.children, true)}</thead>` : '';
        const tbody = body.length
          ? `<tbody>${body.map((item) => row(item.children, false)).join('')}</tbody>`
          : '';
        return (
          '<div data-squisq-table-scroll role="region" aria-label="Scrollable data table">' +
          `<table>${thead}${tbody}</table>` +
          '</div>'
        );
      }
      case 'math':
        return `<pre><code>${escapeInlineHtml(node.value)}</code></pre>`;
      case 'definition':
        return '';
      default: {
        const text = extractPlainText(node).trim();
        return text ? `<p>${escapeInlineHtml(text)}</p>` : '';
      }
    }
  };

  return renderBlocks(nodes);
}

/**
 * Number of newline characters to retain in a plain-text projection between
 * two Markdown blocks. A normal block boundary gets the usual two newlines;
 * parsed source with additional blank lines keeps the larger authored gap.
 */
export function markdownBlockSeparatorLines(
  previous: MarkdownBlockNode,
  next: MarkdownBlockNode,
): number {
  const previousEndLine = previous.position?.end.line;
  const nextStartLine = next.position?.start.line;
  if (previousEndLine == null || nextStartLine == null || nextStartLine <= previousEndLine) {
    return 2;
  }
  return Math.max(2, nextStartLine - previousEndLine);
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
      // A clip or recording in image syntax is not a picture for an image slot.
      if (!mediaKindForUrl(n.url)) {
        found.push({
          src: n.url,
          alt: typeof n.alt === 'string' ? n.alt : '',
          // A resized image parses with the size it was given in the editor.
          ...(typeof n.width === 'number' ? { width: n.width } : {}),
          ...(typeof n.height === 'number' ? { height: n.height } : {}),
        });
      }
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
        const startAt = attrs?.['data-squisq-video-start-at']
          ? parseTimeSeconds(attrs['data-squisq-video-start-at'])
          : null;
        const clipStart = attrs?.['data-squisq-video-clip-start']
          ? parseTimeSeconds(attrs['data-squisq-video-clip-start'])
          : null;
        const clipEnd = attrs?.['data-squisq-video-clip-end']
          ? parseTimeSeconds(attrs['data-squisq-video-clip-end'])
          : null;
        add({
          src,
          ...(attrs?.poster ? { posterSrc: attrs.poster } : {}),
          alt: attrs?.['aria-label'] || attrs?.title || attrs?.alt || '',
          ...(startAt != null ? { startAt } : {}),
          ...(clipStart != null ? { clipStart } : {}),
          ...(clipEnd != null ? { clipEnd } : {}),
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

/** The paragraphs of the first blockquote, one line each. */
function blockquoteLines(contents?: MarkdownBlockNode[]): string[] {
  const quote = (contents ?? []).find((node) => node.type === 'blockquote');
  if (!quote) return [];
  const children = (quote as { children?: MarkdownNode[] }).children ?? [];
  return children
    .flatMap((child) => extractPlainText(child).split(/\r?\n/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * First blockquote's plain text, or ''. Its paragraphs are joined by a
 * space: read straight off the tree they ran together ("…moved on.— Ada").
 */
export function extractBlockquoteText(contents?: MarkdownBlockNode[]): string {
  return blockquoteLines(contents).join(' ');
}

/** A closing line that names who said it: "— Ada Lovelace", "-- A district nurse". */
const ATTRIBUTION_LINE = /^(?:[—–―]|-{2,})\s*(\S.*)$/u;
/** The same after the quote's last sentence, on one line: "…this early. — Marta Lind". */
const ATTRIBUTION_TAIL = /^(.*[.!?…]["”’')\]]?)\s+(?:[—–―]|-{2,})\s*([^.!?…]{2,90})$/su;

/**
 * The first blockquote as what was said and who said it. Markdown has no
 * syntax for an attribution, so authors write the convention: a last line (or
 * the end of the last line) that opens with a dash. Read as part of the
 * quote, it was set in the quote's own type and then repeated beneath it by
 * a template's `attribution`.
 */
export function extractBlockquote(contents?: MarkdownBlockNode[]): {
  text: string;
  attribution?: string;
} {
  const lines = blockquoteLines(contents);
  if (lines.length > 1) {
    const last = lines[lines.length - 1]!.match(ATTRIBUTION_LINE);
    if (last) return { text: lines.slice(0, -1).join(' '), attribution: last[1]!.trim() };
  }
  const text = lines.join(' ');
  const tail = text.match(ATTRIBUTION_TAIL);
  return tail ? { text: tail[1]!.trim(), attribution: tail[2]!.trim() } : { text };
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

/** Inline nodes a concept block's plain words cannot carry. */
const RICH_INLINE_TYPES = new Set([
  'link',
  'linkReference',
  'image',
  'imageReference',
  'inlineCode',
  'inlineMath',
  'htmlInline',
  'icon',
  'footnoteReference',
  'mention',
]);

function conceptListIsPlain(list: MarkdownList): boolean {
  const items = list.children;
  if (items.length < 2 || items.length > 6) return false;
  let plain = true;
  const visit = (node: MarkdownNode, depth: number): void => {
    if (!plain) return;
    if (RICH_INLINE_TYPES.has(node.type) || node.type === 'code' || node.type === 'table') {
      plain = false;
      return;
    }
    // A sub-item's own sub-items have no place in "Label: detail", and a
    // drawing has nowhere to show whether a task is ticked.
    const task =
      node.type === 'listItem' &&
      typeof (node as { checked?: boolean | null }).checked === 'boolean';
    if (task || (node.type === 'list' && depth >= 2)) {
      plain = false;
      return;
    }
    const children = (node as { children?: MarkdownNode[] }).children ?? [];
    for (const child of children) visit(child, node.type === 'list' ? depth + 1 : depth);
  };
  visit(list, 0);
  return plain;
}

/** Sample ideas an empty concept block shows while it is being authored. */
const CONCEPT_PLACEHOLDERS: Readonly<Record<string, string[] | undefined>> = {
  stats: ['3×: faster to make', '92%: finish a first draft', '14 days: saved each quarter'],
  pyramid: [
    'Vision: where it is going',
    'Strategy: how it gets there',
    'Daily work: what makes it happen',
  ],
  funnel: ['Everyone: who hears of it', 'Interested: who looks closer', 'Committed: who stays'],
  hub: [
    'People: who does the work',
    'Process: how it gets done',
    'Tools: what they use',
    'Goals: what it is for',
  ],
  venn: ['This: what only it has', 'That: what only it has', 'Both: what they share'],
  matrix: [
    'Do first: urgent and important',
    'Plan: important, not urgent',
    'Delegate: urgent, not important',
    'Drop: neither',
  ],
};

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
    case 'cards':
    case 'process':
    case 'cycle':
    case 'layers':
    case 'stats':
    case 'pyramid':
    case 'funnel':
    case 'hub':
    case 'venn':
    case 'matrix':
      // A concept block draws each item as plain words: two to six of them,
      // one level of sub-items, and nothing a drawing would drop (a link's
      // target, a picture, code).
      return (
        nodes.length === 1 &&
        nodes[0]?.type === 'list' &&
        conceptListIsPlain(nodes[0] as MarkdownList)
      );
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
      // Exactly one video — a clip or a hosted player — and no other prose.
      // A hosted video paragraph is never body text, so a section that is
      // only that link has an empty body.
      const videos = extractEmbeddedVideos(nodes);
      if (videos.length + extractHostedVideos(nodes).length !== 1) return false;
      const bodyText = normalizeCoverageText(extractBodyPlainText(nodes));
      return bodyText === normalizeCoverageText(videos[0]?.alt ?? '');
    }
    case 'leftFeature':
    case 'rightFeature':
    case 'statHighlight':
      // These templates retain paragraph text, but they do not retain the
      // semantics or markers of lists/tables/quotes embedded beside it.
      return nodes.length > 0 && nodes.every((node) => node.type === 'paragraph');
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
    case 'transcript': {
      // The heading names the speaker and the body is the message — the
      // natural authoring form (`## Ada Lovelace {[transcript]}` + a
      // paragraph). An explicit `speaker=` / `text=` param still wins because
      // coerced overrides are merged after derived inputs. Without this the
      // template rendered an empty bubble for every Markdown-authored beat.
      const text = extractBlockquoteText(contents) || bodyText;
      if (!text && !headingText) {
        return placeholders ? { speaker: 'Speaker', text: 'Message' } : null;
      }
      return {
        speaker: headingText || (placeholders ? 'Speaker' : ''),
        text: text || (placeholders ? 'Message' : ''),
      };
    }
    case 'quote': {
      const quoted = extractBlockquote(contents);
      const quote = quoted.text || bodyText;
      if (quote)
        return {
          quote,
          ...(quoted.attribution ? { attribution: quoted.attribution } : {}),
          ...(headingText ? { title: headingText } : {}),
        };
      // A heading-only quote promotes the heading into the quote slot. Do not
      // also return it as the optional title, or renderers display the same
      // authored text twice.
      return { quote: headingText };
    }
    case 'fullBleedQuote': {
      // These templates take `text` (not `quote`).
      const text = extractBlockquoteText(contents) || bodyText || headingText;
      return { text };
    }
    case 'pullQuote': {
      // The first body image becomes the full-bleed backdrop; without one the
      // template renders the quote on a theme surface rather than nothing.
      const quoted = extractBlockquote(contents);
      const text = quoted.text || bodyText || headingText;
      const img = extractFirstImage(contents);
      return {
        text,
        ...(quoted.attribution ? { attribution: quoted.attribution } : {}),
        ...(img ? { backgroundImage: { src: img.src, alt: img.alt || headingText } } : {}),
      };
    }
    case 'videoPullQuote': {
      const quoted = extractBlockquote(contents);
      const text = quoted.text || bodyText || headingText;
      const video = extractFirstEmbeddedVideo(contents);
      return {
        text,
        ...(quoted.attribution ? { attribution: quoted.attribution } : {}),
        ...(video
          ? {
              backgroundVideo: {
                src: video.src,
                ...(video.posterSrc ? { posterSrc: video.posterSrc } : {}),
                alt: video.alt || headingText,
                ...(video.clipStart != null ? { clipStart: video.clipStart } : {}),
                ...(video.clipEnd != null ? { clipEnd: video.clipEnd } : {}),
              },
            }
          : {}),
      };
    }
    case 'factCard':
      // A heading-only card keeps its explanation empty rather than echoing
      // the fact a second time.
      return { fact: headingText, explanation: bodyText };
    case 'twoColumn': {
      // The columns come from `left=`/`right=` params, or from a body list of
      // exactly two items; the heading is the header band above them (it was
      // silently dropped before).
      const columns = twoColumnsFromList(contents);
      if (!headingText && !columns) return placeholders ? {} : null;
      return { ...(headingText ? { header: headingText } : {}), ...columns };
    }
    case 'comparisonBar':
      // Sample values only under a bare heading: a block with a body never
      // shows invented numbers.
      return placeholders && !contents?.length
        ? { leftLabel: 'A', leftValue: 60, rightLabel: 'B', rightValue: 40 }
        : null;
    case 'list': {
      const items = extractListItems(contents);
      const firstList = (contents ?? []).find((n): n is MarkdownList => n.type === 'list');
      if (items.length > 0) {
        return {
          items,
          // Bullets stay bullets: only a numbered source list renders `1.` markers.
          ordered: firstList?.ordered === true,
          ...(headingText ? { title: headingText } : {}),
        };
      }
      // Sample items only under a bare heading, never beside a body.
      return placeholders && !contents?.length ? { items: ['Item 1', 'Item 2', 'Item 3'] } : null;
    }
    case 'cards':
    case 'process':
    case 'cycle':
    case 'layers':
    case 'stats':
    case 'pyramid':
    case 'funnel':
    case 'hub':
    case 'venn':
    case 'matrix': {
      // Each list item is an idea; without a list, each paragraph is one.
      const listed = extractConceptItems(contents);
      const items = listed.length
        ? listed
        : (contents ?? [])
            .filter((node) => node.type === 'paragraph' && !isPictureParagraph(node))
            .map((node) => extractPlainText(node).trim())
            .filter(Boolean);
      if (items.length > 0) {
        // Four items that each say where they stand on the same two measures
        // name a matrix's axes themselves. An author's order stands, so the
        // names are taken only when the items are already where they say.
        const matrix = templateName === 'matrix' ? readMatrixItems(items) : undefined;
        return {
          items,
          ...(matrix && !matrix.reordered ? { xAxis: matrix.xAxis, yAxis: matrix.yAxis } : {}),
          ...(headingText ? { title: headingText } : {}),
        };
      }
      // Sample ideas only under a bare heading: a body that holds no ideas (a
      // table, a quotation) is shown as it is, never beside invented ones.
      return placeholders && !contents?.length
        ? {
            items:
              CONCEPT_PLACEHOLDERS[templateName] ??
              (templateName === 'cards'
                ? [
                    'First idea: what makes it matter',
                    'Second idea: how it differs',
                    'Third idea: why it helps',
                  ]
                : templateName === 'layers'
                  ? [
                      'Core: the innermost part',
                      'Middle: what surrounds it',
                      'Outer: the outermost layer',
                    ]
                  : [
                      'Begin: the first stage',
                      'Grow: what happens next',
                      'Finish: where it leads',
                    ]),
          }
        : null;
    }
    case 'definitionCard':
      return { term: headingText, definition: bodyText };
    case 'dateEvent':
      return { date: headingText, description: bodyText };
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
    case 'bigText': {
      // The heading is the display text; a body image (when present) becomes
      // the full-bleed background behind the contrast bloom.
      const img = extractFirstImage(contents);
      return {
        title: headingText,
        ...(img ? { imageSrc: img.src, imageAlt: img.alt || headingText } : {}),
      };
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
      if (!video) {
        // A hosted video plays in the same slot; the template swaps the clip
        // layer for the provider's player when `videoSrc` is a video page.
        const hosted = extractHostedVideos(contents, 1)[0];
        if (hosted) {
          return {
            videoSrc: hosted.url,
            videoAlt: hosted.title || headingText,
            caption: headingText,
          };
        }
        return placeholders ? { caption: headingText } : null;
      }
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

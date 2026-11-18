/**
 * HTML Import Module — @bendyline/squisq-formats/html
 *
 * Converts an HTML document (or fragment) into a squisq `MarkdownDocument`.
 * Built on the existing `parseHtmlToNodes` (parse5-backed) + `sanitizeHtmlNodes`
 * from `@bendyline/squisq/markdown`, so no new dependency is introduced.
 *
 * The primary consumer is email: HTML mail bodies are hostile input, so the
 * parse is sanitized by default (scripts/styles/event handlers/dangerous URLs
 * stripped) before the tree is walked into markdown nodes.
 *
 * Two entry points mirror the docx/pdf importers:
 *   - `htmlToMarkdownDoc(data, options?)` → `MarkdownDocument`
 *   - `htmlToMarkdown(html, options?)` → markdown string (convenience for the
 *     string-in/string-out path email body conversion needs)
 */

import {
  type MarkdownBlockNode,
  type MarkdownDocument,
  type MarkdownInlineNode,
  type MarkdownListItem,
  type MarkdownTableCell,
  type MarkdownTableRow,
  type HtmlElement,
  type HtmlNode,
  extractPlainText,
  parseHtmlToNodes,
  sanitizeHtmlNodes,
  stringifyMarkdown,
  videoEmbedFromIframe,
} from '@bendyline/squisq/markdown';
import { docToMarkdown } from '@bendyline/squisq/doc';
import type { Doc } from '@bendyline/squisq/schemas';
import {
  extractFootnoteSection,
  linkFootnoteReferences,
  buildFootnoteDefinitions,
} from './footnoteImport.js';
import { extractHtmlPageTemplateContent } from './pageTemplate.js';

/** An `<img>` as written, handed to an {@link HtmlImageResolver}. */
export interface HtmlImageInfo {
  /**
   * The `src` as written, before sanitizing — `cid:` and other schemes the
   * sanitizer would drop included — resolved against `baseUrl` when one is
   * given. Empty when the image has none.
   */
  src: string;
  /** The `alt` text, whitespace collapsed. Empty for a decorative image. */
  alt: string;
  title?: string;
  /** Declared width in CSS pixels (the attribute, else inline `style`). */
  width?: number;
  /** Declared height in CSS pixels (the attribute, else inline `style`). */
  height?: number;
}

/** What becomes of one image. */
export type HtmlImageDecision =
  /** An image at `url`, written as given (the resolver owns it), with `alt` when given. */
  | { action: 'image'; url: string; alt?: string }
  /** Text in place of the image; nothing when `text` is blank. */
  | { action: 'text'; text: string }
  | { action: 'drop' };

/**
 * Decides each image before the tree is sanitized, so a host can keep a
 * picture the message carries (`cid:`), point it at a copy it saved, or leave
 * a remote one behind. Never called for an image `dropHidden` or
 * `dropTrackingPixels` removed.
 */
export type HtmlImageResolver = (image: HtmlImageInfo) => HtmlImageDecision;

export interface HtmlImportOptions {
  /** Cancel before parsing. */
  signal?: AbortSignal;
  /** Maximum HTML source characters. Default: 16 MiB. */
  maxInputChars?: number;
  /**
   * What happens to HTML longer than `maxInputChars`: `'throw'` (default)
   * refuses it with a `RangeError`; `'truncate'` converts the first
   * `maxInputChars` characters.
   */
  oversize?: 'throw' | 'truncate';
  /**
   * Drop elements the page hides from its reader: the `hidden` attribute, and
   * inline `display: none`, `visibility: hidden`, `mso-hide: all`,
   * `opacity: 0`, or a zero width or height with `overflow: hidden`. Mail
   * hides its preview line and duplicate mobile copy this way. Default `false`.
   */
  dropHidden?: boolean;
  /**
   * Drop images declared at most 1 pixel wide or tall: open-tracking pixels
   * and spacers. Default `false`.
   */
  dropTrackingPixels?: boolean;
  /**
   * `'table'` (default) imports every `<table>` as a table. `'unwrap'` reads
   * tables used for page layout as ordinary content, row by row and cell by
   * cell: a table marked `role="presentation"` or `"none"`, one holding
   * another table, one with a single column (and no `<caption>` or
   * `<thead>`), or one with a cell holding a heading, list, quote, rule or more
   * than one block. Rows left with no content are dropped from the tables
   * that remain.
   */
  layoutTables?: 'table' | 'unwrap';
  /**
   * Images: `'keep'` (default) imports each as written; `'alt'` writes its
   * alt text instead (nothing for a decorative image); `'drop'` removes it;
   * a function decides each one. With anything but `'keep'`, a link whose
   * only content was an image that is gone is dropped too.
   */
  images?: 'keep' | 'alt' | 'drop' | HtmlImageResolver;
  /**
   * Resolve relative `href`, `src` and `poster` URLs against this absolute
   * URL, keeping only results that are `http(s)`. In-page `#fragment` links
   * and URLs that already name a scheme are left as written.
   */
  baseUrl?: string;
  /**
   * Import a squisq document embedded in the page (`<script
   * data-squisq-doc>`) in place of the page. Default `true`. Pass `false` for
   * untrusted HTML: an embedded document is taken as it is, so none of the
   * other options apply to it.
   */
  embeddedDocs?: boolean;
  /**
   * Strip scripts / styles / event handlers / dangerous URLs before walking
   * the tree. Default `true` — HTML email is untrusted; only disable for
   * trusted input where you want raw fidelity.
   */
  sanitize?: boolean;
  /**
   * Keep the page's `<title>` and `<meta name="description">` as frontmatter
   * `title` / `description`. Default `true`. Head content never becomes body
   * text either way; pass `false` where frontmatter is unwanted (for example
   * when converting an email body).
   */
  headMetadata?: boolean;
}

// ── tag classification ──────────────────────────────────────────────

const HEADINGS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

// Containers with no semantic block meaning — unwrap and walk their children.
const TRANSPARENT_BLOCK = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'figure',
  'figcaption',
  'form',
  'fieldset',
  'body',
  'html',
  'center',
]);

// Elements that carry no content we want (and whose text must not leak).
const DROP = new Set(['script', 'style', 'head', 'title', 'noscript', 'template', 'svg']);

const INLINE_STRONG = new Set(['strong', 'b']);
const INLINE_EM = new Set(['em', 'i']);
const INLINE_DEL = new Set(['del', 's', 'strike']);
const INLINE_SUP = new Set(['sup']);
const INLINE_SUB = new Set(['sub']);
// Tags with no Markdown counterpart: their CHILDREN are kept, the tag dropped.
const INLINE_TRANSPARENT = new Set(['span', 'font', 'abbr', 'mark', 'small', 'u']);

const isElement = (n: HtmlNode): n is HtmlElement => n.type === 'htmlElement';
const isText = (n: HtmlNode): n is { type: 'htmlText'; value: string } => n.type === 'htmlText';

const collapseWs = (s: string): string => s.replace(/\s+/g, ' ');

/** Longest `title` / `description` kept from the page head. */
const HEAD_METADATA_MAX_CHARS = 1024;

// ── head content ────────────────────────────────────────────────────

function headMetadataValue(raw: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- strip control characters from page metadata
  const value = collapseWs(raw.replace(/[\u0000-\u001f\u007f]/g, ' ')).trim();
  return value ? value.slice(0, HEAD_METADATA_MAX_CHARS) : undefined;
}

/**
 * The page's own `<title>` and `<meta name="description">`. The fragment
 * parse flattens `<html>`/`<head>`, so head elements surface at the top
 * level; nested ones (an SVG's `<title>` tooltip) are not page metadata.
 */
function readHeadMetadata(nodes: HtmlNode[]): Record<string, string> {
  const metadata: Record<string, string> = {};
  const visit = (list: HtmlNode[]) => {
    for (const node of list) {
      if (!isElement(node)) continue;
      const tag = node.tagName.toLowerCase();
      if (tag === 'html' || tag === 'head') {
        visit(node.children);
      } else if (tag === 'title' && metadata.title === undefined) {
        const title = headMetadataValue(textContent(node));
        if (title) metadata.title = title;
      } else if (
        tag === 'meta' &&
        metadata.description === undefined &&
        node.attributes.name?.toLowerCase() === 'description'
      ) {
        const description = headMetadataValue(node.attributes.content ?? '');
        if (description) metadata.description = description;
      }
    }
  };
  visit(nodes);
  return metadata;
}

/**
 * Remove elements whose text must never become document content. This runs
 * BEFORE sanitizing: the sanitizer unwraps elements it does not allow (such
 * as `<title>`) and keeps their text, which is how a page title used to leak
 * into the body as a stray first paragraph.
 */
function dropContentlessElements(nodes: HtmlNode[]): HtmlNode[] {
  return nodes.flatMap((node): HtmlNode[] => {
    if (!isElement(node)) return [node];
    if (DROP.has(node.tagName.toLowerCase())) return [];
    return [{ ...node, children: dropContentlessElements(node.children) }];
  });
}

// ── before sanitizing ───────────────────────────────────────────────
//
// Hidden elements, pixel sizes and `cid:` images are read from what the
// sanitizer removes (`style`, `hidden`, non-web schemes), so these passes run
// on the tree as written.

/**
 * Carries an image's index in the resolver's decisions through the sanitizer,
 * which keeps `data-*` attributes. Every `<img>` gets its own value when a
 * resolver runs, overwriting any the document wrote; the walk reads it only on
 * `<img>` and only then.
 */
const IMAGE_DECISION_ATTR = 'data-squisq-image';

interface PrepareContext {
  dropHidden: boolean;
  dropTrackingPixels: boolean;
  baseUrl: string | undefined;
  resolveImage: HtmlImageResolver | undefined;
  decisions: HtmlImageDecision[];
}

/** An inline `style` attribute as lowercase property → value, `!important` removed. */
function inlineStyle(style: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!style) return out;
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon <= 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .replace(/!\s*important/gi, '')
      .trim()
      .toLowerCase();
    if (property) out.set(property, value);
  }
  return out;
}

const isZeroLength = (value: string | undefined): boolean =>
  value !== undefined && Number.parseFloat(value) === 0;

function isHiddenElement(node: HtmlElement): boolean {
  if ('hidden' in node.attributes) return true;
  const style = inlineStyle(node.attributes.style);
  if (style.size === 0) return false;
  if (style.get('display') === 'none') return true;
  const visibility = style.get('visibility');
  if (visibility === 'hidden' || visibility === 'collapse') return true;
  if (style.get('mso-hide') === 'all') return true;
  if (isZeroLength(style.get('opacity'))) return true;
  const clipped = ['overflow', 'overflow-x', 'overflow-y'].some((p) => style.get(p) === 'hidden');
  return (
    clipped &&
    ['width', 'max-width', 'height', 'max-height'].some((p) => isZeroLength(style.get(p)))
  );
}

/** A length in CSS pixels: a bare number or `Npx`. Percentages and other units are not. */
function pixelLength(value: string | undefined): number | undefined {
  const match = value === undefined ? null : /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);
  return match ? Number(match[1]) : undefined;
}

function imageInfo(attributes: Record<string, string>): HtmlImageInfo {
  const style = inlineStyle(attributes.style);
  const width = pixelLength(attributes.width) ?? pixelLength(style.get('width'));
  const height = pixelLength(attributes.height) ?? pixelLength(style.get('height'));
  const title = collapseWs(attributes.title ?? '').trim();
  return {
    src: (attributes.src ?? '').trim(),
    alt: collapseWs(attributes.alt ?? '').trim(),
    ...(title ? { title } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

function isTrackingPixel(attributes: Record<string, string>): boolean {
  const { width, height } = imageInfo(attributes);
  return (width !== undefined && width <= 1) || (height !== undefined && height <= 1);
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** `value` against `base` when it is relative and resolves to http(s); else as written. */
function resolveRelativeUrl(value: string, base: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#') || HAS_SCHEME.test(trimmed)) return value;
  try {
    const url = new URL(trimmed, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : value;
  } catch {
    return value;
  }
}

const URL_ATTRIBUTES = ['href', 'src', 'poster'] as const;

function resolveUrlAttributes(
  attributes: Record<string, string>,
  base: string,
): Record<string, string> {
  let out = attributes;
  for (const name of URL_ATTRIBUTES) {
    const value = attributes[name];
    if (value === undefined) continue;
    const resolved = resolveRelativeUrl(value, base);
    if (resolved === value) continue;
    if (out === attributes) out = { ...attributes };
    out[name] = resolved;
  }
  return out;
}

function prepareNodes(nodes: HtmlNode[], ctx: PrepareContext): HtmlNode[] {
  return nodes.flatMap((node): HtmlNode[] => {
    if (!isElement(node)) return [node];
    if (ctx.dropHidden && isHiddenElement(node)) return [];
    const tag = node.tagName.toLowerCase();
    if (tag === 'img' && ctx.dropTrackingPixels && isTrackingPixel(node.attributes)) return [];
    let attributes = ctx.baseUrl
      ? resolveUrlAttributes(node.attributes, ctx.baseUrl)
      : node.attributes;
    if (tag === 'img' && ctx.resolveImage) {
      const index = ctx.decisions.push(ctx.resolveImage(imageInfo(attributes))) - 1;
      attributes = { ...attributes, [IMAGE_DECISION_ATTR]: String(index) };
    }
    return [{ ...node, attributes, children: prepareNodes(node.children, ctx) }];
  });
}

// ── whitespace ──────────────────────────────────────────────────────

type InlineParent = Extract<
  MarkdownInlineNode,
  { type: 'strong' | 'emphasis' | 'delete' | 'link' | 'superscript' | 'subscript' }
>;

const INLINE_PARENT_TYPES = new Set<string>([
  'strong',
  'emphasis',
  'delete',
  'link',
  'superscript',
  'subscript',
]);

const isInlineParent = (node: MarkdownInlineNode): node is InlineParent =>
  INLINE_PARENT_TYPES.has(node.type);

/** Remove trailing spaces from the end of a run, dropping emptied text nodes. */
function trimRunEnd(run: MarkdownInlineNode[]): void {
  for (let last = run[run.length - 1]; last?.type === 'text'; last = run[run.length - 1]) {
    const value = last.value.replace(/ +$/, '');
    if (value) {
      run[run.length - 1] = { ...last, value };
      return;
    }
    run.pop();
  }
}

function mergeAdjacentText(run: MarkdownInlineNode[]): MarkdownInlineNode[] {
  const out: MarkdownInlineNode[] = [];
  for (const node of run) {
    const previous = out[out.length - 1];
    if (node.type === 'text' && previous?.type === 'text') {
      out[out.length - 1] = { ...previous, value: previous.value + node.value };
    } else if (isInlineParent(node)) {
      out.push({ ...node, children: mergeAdjacentText(node.children) } as MarkdownInlineNode);
    } else {
      out.push(node);
    }
  }
  return out;
}

/**
 * Lay out one block's inline content the way a browser does: whitespace runs
 * collapse across element boundaries, vanish at the block's edges, and sit
 * outside emphasis and links rather than inside them. Markdown preserves what
 * it is given — edge spaces come out as `&#x20;` and `** bold **` is not
 * emphasis — so pretty-printed HTML must be normalized here.
 */
function normalizeInlineWhitespace(inlines: MarkdownInlineNode[]): MarkdownInlineNode[] {
  // At the start of a block, leading whitespace is dropped as if a space preceded it.
  const state = { spaced: true };
  const walk = (run: MarkdownInlineNode[]): MarkdownInlineNode[] => {
    const out: MarkdownInlineNode[] = [];
    for (const node of run) {
      if (node.type === 'text') {
        const value = state.spaced ? node.value.replace(/^ +/, '') : node.value;
        if (!value) continue;
        out.push({ ...node, value });
        state.spaced = value.endsWith(' ');
      } else if (node.type === 'break') {
        trimRunEnd(out);
        out.push(node);
        state.spaced = true;
      } else if (isInlineParent(node)) {
        const children = walk(node.children);
        // A leading space inside the container belongs before it.
        const first = children[0];
        if (first?.type === 'text' && first.value.startsWith(' ')) {
          const value = first.value.replace(/^ +/, '');
          if (value) children[0] = { ...first, value };
          else children.shift();
          out.push({ type: 'text', value: ' ' });
        }
        // A trailing space inside the container belongs after it.
        const last = children[children.length - 1];
        const trailing = last?.type === 'text' && last.value.endsWith(' ');
        if (trailing) trimRunEnd(children);
        if (children.length > 0) {
          out.push({ ...node, children } as MarkdownInlineNode);
        } else if (node.type === 'link') {
          out.push({ ...node, children: [{ type: 'text', value: node.url }] });
        }
        if (trailing) {
          out.push({ type: 'text', value: ' ' });
          state.spaced = true;
        } else if (children.length > 0 || node.type === 'link') {
          state.spaced = false;
        }
      } else {
        out.push(node);
        state.spaced = false;
      }
    }
    return out;
  };
  const out = walk(inlines);
  trimRunEnd(out);
  return mergeAdjacentText(out);
}

/** Inline content for one block, laid out as a browser would show it. */
const blockInlines = (nodes: HtmlNode[], ctx: WalkContext): MarkdownInlineNode[] =>
  normalizeInlineWhitespace(inlinesFromNodes(nodes, ctx));

// ── walk context ────────────────────────────────────────────────────

interface WalkContext {
  /** `'resolved'`: each `<img>` carries its decision's index. */
  images: 'keep' | 'alt' | 'drop' | 'resolved';
  decisions: readonly HtmlImageDecision[];
  unwrapLayoutTables: boolean;
}

/** Schemes a resolver's URL may not use, whatever the host returned. */
const EXECUTABLE_URL = /^\s*(?:javascript|vbscript):/i;

/** Text standing in for an image, spaced so it never fuses with its neighbors. */
const imageText = (text: string): MarkdownInlineNode[] => {
  const value = collapseWs(text).trim();
  return value ? [{ type: 'text', value: ` ${value} ` }] : [];
};

function imageInlines(node: HtmlElement, ctx: WalkContext): MarkdownInlineNode[] {
  const alt = node.attributes.alt;
  if (ctx.images === 'drop') return [];
  if (ctx.images === 'alt') return imageText(alt ?? '');
  if (ctx.images === 'resolved') {
    const index = Number(node.attributes[IMAGE_DECISION_ATTR]);
    const decision = Number.isInteger(index) ? ctx.decisions[index] : undefined;
    if (!decision || decision.action === 'drop') return [];
    if (decision.action === 'text') return imageText(decision.text);
    if (!decision.url || EXECUTABLE_URL.test(decision.url)) return [];
    const kept = decision.alt ?? alt;
    return [{ type: 'image', url: decision.url, ...(kept ? { alt: kept } : {}) }];
  }
  const url = node.attributes.src ?? '';
  return url ? [{ type: 'image', url, ...(alt ? { alt } : {}) }] : [];
}

function containsImage(node: HtmlElement): boolean {
  return node.children.some(
    (child) => isElement(child) && (child.tagName.toLowerCase() === 'img' || containsImage(child)),
  );
}

const isBlankInlines = (nodes: MarkdownInlineNode[]): boolean =>
  nodes.every((n) => n.type === 'text' && !n.value.trim());

// ── inline conversion ───────────────────────────────────────────────

/** Move boundary whitespace outside marks so CommonMark can represent them. */
function appendMarkedInlines(
  output: MarkdownInlineNode[],
  type: 'strong' | 'emphasis' | 'delete',
  input: MarkdownInlineNode[],
): void {
  const children = [...input];
  let leading = '';
  let trailing = '';
  while (children[0]?.type === 'text') {
    const first = children[0];
    const space = /^ +/.exec(first.value)?.[0] ?? '';
    if (!space) break;
    leading += space;
    if (space.length === first.value.length) children.shift();
    else {
      children[0] = { ...first, value: first.value.slice(space.length) };
      break;
    }
  }
  while (children[children.length - 1]?.type === 'text') {
    const last = children[children.length - 1];
    if (last.type !== 'text') break;
    const space = / +$/.exec(last.value)?.[0] ?? '';
    if (!space) break;
    trailing = space + trailing;
    if (space.length === last.value.length) children.pop();
    else {
      children[children.length - 1] = { ...last, value: last.value.slice(0, -space.length) };
      break;
    }
  }
  if (leading) output.push({ type: 'text', value: leading });
  if (children.length) output.push({ type, children });
  if (trailing) output.push({ type: 'text', value: trailing });
}

function inlinesFromNodes(nodes: HtmlNode[], ctx: WalkContext): MarkdownInlineNode[] {
  const out: MarkdownInlineNode[] = [];
  for (const node of nodes) {
    if (isText(node)) {
      const value = collapseWs(node.value);
      if (value) out.push({ type: 'text', value });
      continue;
    }
    if (!isElement(node)) continue; // comment
    const tag = node.tagName.toLowerCase();
    if (DROP.has(tag)) continue;

    if (tag === 'br') {
      out.push({ type: 'break' });
    } else if (INLINE_STRONG.has(tag)) {
      appendMarkedInlines(out, 'strong', inlinesFromNodes(node.children, ctx));
    } else if (INLINE_EM.has(tag)) {
      appendMarkedInlines(out, 'emphasis', inlinesFromNodes(node.children, ctx));
    } else if (INLINE_DEL.has(tag)) {
      appendMarkedInlines(out, 'delete', inlinesFromNodes(node.children, ctx));
    } else if (INLINE_SUP.has(tag)) {
      out.push({ type: 'superscript', children: inlinesFromNodes(node.children, ctx) });
    } else if (INLINE_SUB.has(tag)) {
      out.push({ type: 'subscript', children: inlinesFromNodes(node.children, ctx) });
    } else if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') {
      out.push({ type: 'inlineCode', value: textContent(node) });
    } else if (tag === 'a') {
      const url = node.attributes.href ?? '';
      const children = inlinesFromNodes(node.children, ctx);
      // A logo or button that was only a picture leaves nothing to click.
      if (ctx.images !== 'keep' && isBlankInlines(children) && containsImage(node)) continue;
      out.push({
        type: 'link',
        url,
        children: children.length > 0 ? children : [{ type: 'text', value: url }],
      });
    } else if (tag === 'img') {
      out.push(...imageInlines(node, ctx));
    } else {
      // Unknown / transparent inline (span, font, …): flatten children.
      out.push(...inlinesFromNodes(node.children, ctx));
    }
  }
  return out;
}

/** Flatten an element's descendant text (for code blocks / inline code). */
function textContent(node: HtmlNode): string {
  if (isText(node)) return node.value;
  if (isElement(node)) return node.children.map(textContent).join('');
  return '';
}

// ── block conversion ────────────────────────────────────────────────

function blocksFromNodes(nodes: HtmlNode[], ctx: WalkContext): MarkdownBlockNode[] {
  const out: MarkdownBlockNode[] = [];
  let inlineBuffer: HtmlNode[] = [];

  const flush = () => {
    if (inlineBuffer.length === 0) return;
    const inlines = blockInlines(inlineBuffer, ctx);
    inlineBuffer = [];
    if (inlines.length > 0) out.push({ type: 'paragraph', children: inlines });
  };

  for (const node of nodes) {
    if (isText(node)) {
      inlineBuffer.push(node);
      continue;
    }
    if (!isElement(node)) continue;
    const tag = node.tagName.toLowerCase();
    if (DROP.has(tag)) continue;

    const block = blockForElement(node, tag, ctx);
    if (block === 'inline') {
      inlineBuffer.push(node);
    } else if (block) {
      flush();
      out.push(...block);
    }
  }
  flush();
  return out;
}

/** Returns the block node(s) for a block element, `'inline'` for inline ones. */
function blockForElement(
  node: HtmlElement,
  tag: string,
  ctx: WalkContext,
): MarkdownBlockNode[] | 'inline' | null {
  if (tag in HEADINGS) {
    const children = blockInlines(node.children, ctx);
    // A heading whose only content was a picture that is gone is not a heading.
    if (children.length === 0 && ctx.images !== 'keep') return [];
    return [{ type: 'heading', depth: HEADINGS[tag]!, children }];
  }
  if (tag === 'p') {
    const children = blockInlines(node.children, ctx);
    return children.length > 0 ? [{ type: 'paragraph', children }] : [];
  }
  if (tag === 'br') return 'inline';
  if (tag === 'hr') return [{ type: 'thematicBreak' }];
  if (tag === 'iframe') {
    // A YouTube/Vimeo/… player becomes the paragraph-that-is-only-a-link
    // form, which renders as the player again and reads as a link anywhere
    // else. Any other iframe has no markdown counterpart.
    const video = videoEmbedFromIframe(node);
    if (!video) return [];
    const url = video.embed.watchUrl;
    return [
      {
        type: 'paragraph',
        children: [{ type: 'link', url, children: [{ type: 'text', value: video.title ?? url }] }],
      },
    ];
  }
  if (tag === 'blockquote') {
    return [{ type: 'blockquote', children: blocksFromNodes(node.children, ctx) }];
  }
  if (tag === 'pre') {
    return [{ type: 'code', value: stripTrailingNewline(textContent(node)) }];
  }
  if (tag === 'ul' || tag === 'ol') {
    return [listFromElement(node, tag === 'ol', ctx)];
  }
  if (tag === 'table') {
    if (ctx.unwrapLayoutTables && isLayoutTable(node)) return unwrapLayoutTable(node, ctx);
    const table = tableFromElement(node, ctx);
    return table ? [table] : [];
  }
  if (TRANSPARENT_BLOCK.has(tag)) {
    return blocksFromNodes(node.children, ctx);
  }
  if (
    INLINE_STRONG.has(tag) ||
    INLINE_EM.has(tag) ||
    INLINE_DEL.has(tag) ||
    INLINE_TRANSPARENT.has(tag) ||
    tag === 'a' ||
    tag === 'img' ||
    tag === 'code' ||
    tag === 'kbd' ||
    tag === 'samp'
  ) {
    return 'inline';
  }
  // Unknown element: treat as a transparent container so its content survives.
  return blocksFromNodes(node.children, ctx);
}

function listFromElement(node: HtmlElement, ordered: boolean, ctx: WalkContext): MarkdownBlockNode {
  const items: MarkdownListItem[] = [];
  for (const child of node.children) {
    if (isElement(child) && child.tagName.toLowerCase() === 'li') {
      const blocks = blocksFromNodes(child.children, ctx);
      items.push({ type: 'listItem', children: blocks });
    }
  }
  const startAttr = node.attributes.start;
  const start = ordered && startAttr ? Number.parseInt(startAttr, 10) : undefined;
  return {
    type: 'list',
    ordered,
    ...(start !== undefined && Number.isFinite(start) ? { start } : {}),
    children: items,
  };
}

function tableFromElement(node: HtmlElement, ctx: WalkContext): MarkdownBlockNode | null {
  const rows: MarkdownTableRow[] = [];
  for (const row of tableRowElements(node)) {
    const cells: MarkdownTableCell[] = tableCellElements(row).map((cell) => ({
      type: 'tableCell',
      children: blockInlines(cell.children, ctx),
    }));
    if (cells.length === 0) continue;
    if (ctx.unwrapLayoutTables && cells.every((cell) => cell.children.length === 0)) continue;
    rows.push({ type: 'tableRow', children: cells });
  }
  if (rows.length === 0) return null;
  return { type: 'table', children: rows };
}

// ── layout tables ───────────────────────────────────────────────────

const tagOf = (node: HtmlNode): string | undefined =>
  isElement(node) ? node.tagName.toLowerCase() : undefined;

/** A table's own rows: direct, or in its `thead` / `tbody` / `tfoot`. */
function tableRowElements(table: HtmlElement): HtmlElement[] {
  const rows: HtmlElement[] = [];
  for (const child of table.children) {
    const tag = tagOf(child);
    if (tag === 'tr') rows.push(child as HtmlElement);
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (const row of (child as HtmlElement).children) {
        if (tagOf(row) === 'tr') rows.push(row as HtmlElement);
      }
    }
  }
  return rows;
}

const tableCellElements = (row: HtmlElement): HtmlElement[] =>
  row.children.filter((cell): cell is HtmlElement => {
    const tag = tagOf(cell);
    return tag === 'td' || tag === 'th';
  });

/** Elements whose presence in a cell means the cell is a page region, not a datum. */
const LAYOUT_CONTENT = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'blockquote',
  'hr',
]);
/** Block children that count toward "more than one block". */
const CELL_BLOCKS = new Set(['p', 'div', 'table', 'pre', ...LAYOUT_CONTENT]);

function containsTag(node: HtmlElement, tags: ReadonlySet<string>): boolean {
  return node.children.some((child) => {
    const tag = tagOf(child);
    return tag !== undefined && (tags.has(tag) || containsTag(child as HtmlElement, tags));
  });
}

const TABLE_TAG = new Set(['table']);

function isLayoutCell(cell: HtmlElement): boolean {
  if (containsTag(cell, LAYOUT_CONTENT)) return true;
  let blocks = 0;
  for (const child of cell.children) {
    const tag = tagOf(child);
    if (tag !== undefined && CELL_BLOCKS.has(tag) && ++blocks > 1) return true;
  }
  return false;
}

/**
 * Whether a table lays out a page rather than holding data. Mail and older
 * web pages are built from nested tables; a data table rarely nests one or
 * puts headings and paragraphs in its cells.
 */
function isLayoutTable(table: HtmlElement): boolean {
  const role = table.attributes.role?.trim().toLowerCase();
  if (role === 'presentation' || role === 'none') return true;
  const rows = tableRowElements(table);
  const cells = rows.flatMap(tableCellElements);
  if (cells.some((cell) => containsTag(cell, TABLE_TAG))) return true;
  const hasHeader = table.children.some((c) => tagOf(c) === 'caption' || tagOf(c) === 'thead');
  if (hasHeader) return false;
  if (rows.every((row) => tableCellElements(row).length <= 1)) return true;
  return cells.some(isLayoutCell);
}

/** A layout table's content in reading order: each cell's blocks, row by row. */
function unwrapLayoutTable(table: HtmlElement, ctx: WalkContext): MarkdownBlockNode[] {
  const out: MarkdownBlockNode[] = [];
  for (const child of table.children) {
    if (tagOf(child) === 'caption')
      out.push(...blocksFromNodes((child as HtmlElement).children, ctx));
  }
  for (const row of tableRowElements(table)) {
    for (const cell of tableCellElements(row)) out.push(...blocksFromNodes(cell.children, ctx));
  }
  return out;
}

const stripTrailingNewline = (s: string): string => s.replace(/\n+$/, '');

// ── public API ──────────────────────────────────────────────────────

function toHtmlString(data: ArrayBuffer | Uint8Array | string): string {
  if (typeof data === 'string') return data;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new TextDecoder('utf-8').decode(bytes);
}

function findEmbeddedSquisqDoc(nodes: HtmlNode[]): HtmlElement | undefined {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.tagName.toLowerCase() === 'script' && 'data-squisq-doc' in node.attributes) {
      return node;
    }
    const nested = findEmbeddedSquisqDoc(node.children);
    if (nested) return nested;
  }
  return undefined;
}

function parseEmbeddedSquisqDoc(script: HtmlElement): Doc {
  const version = script.attributes['data-squisq-doc'];
  if (version !== '1') {
    throw new Error(`Unsupported embedded Squisq Doc version "${version || '(missing)'}"`);
  }

  let value: unknown;
  try {
    value = JSON.parse(textContent(script));
  } catch {
    throw new SyntaxError('Invalid embedded Squisq Doc JSON');
  }

  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as Partial<Doc>).articleId !== 'string' ||
    !Number.isFinite((value as Partial<Doc>).duration) ||
    !Array.isArray((value as Partial<Doc>).blocks) ||
    (value as Partial<Doc>).audio === null ||
    typeof (value as Partial<Doc>).audio !== 'object'
  ) {
    throw new TypeError('Embedded Squisq Doc has an invalid shape');
  }

  return value as Doc;
}

/** Parse HTML into a squisq `MarkdownDocument`. */
export function htmlToMarkdownDocSync(
  html: string,
  options: HtmlImportOptions = {},
): MarkdownDocument {
  options.signal?.throwIfAborted();
  const maxInputChars = options.maxInputChars ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxInputChars) || maxInputChars < 0) {
    throw new RangeError('maxInputChars must be a non-negative safe integer');
  }
  if (html.length > maxInputChars) {
    if (options.oversize !== 'truncate') {
      throw new RangeError(`HTML exceeds the ${maxInputChars}-character safety limit`);
    }
    html = html.slice(0, maxInputChars);
  }
  const nodes = parseHtmlToNodes(html);
  const embedded = options.embeddedDocs === false ? undefined : findEmbeddedSquisqDoc(nodes);
  if (embedded) return docToMarkdown(parseEmbeddedSquisqDoc(embedded));
  // Footnotes come apart in HTML: a marker anchor in the prose and a list item
  // at the foot of the page, joined only by a fragment id. Lift the definitions
  // out FIRST so they do not also import as an ordinary trailing list, then
  // reconnect the markers that point at them.
  //
  // This runs BEFORE sanitization because the markers ARE the structure: a
  // `<section data-footnotes>` is not on the sanitizer's element allowlist, so
  // by the time it has run the wrapper is gone and only a bare `<ol>` remains.
  // Both halves are sanitized below, so nothing skips the filter — the pass
  // only reads the shape, it never trusts the content.
  const headMetadata = options.headMetadata === false ? {} : readHeadMetadata(nodes);
  // A page generated from a page template marks the document it carries;
  // everything outside the markers is the template's chrome, not content.
  const templated = extractHtmlPageTemplateContent(html);
  const contentNodes = templated === null ? nodes : parseHtmlToNodes(templated);
  const resolveImage = typeof options.images === 'function' ? options.images : undefined;
  const prepare: PrepareContext = {
    dropHidden: options.dropHidden === true,
    dropTrackingPixels: options.dropTrackingPixels === true,
    baseUrl: options.baseUrl,
    resolveImage,
    decisions: [],
  };
  const prepared =
    prepare.dropHidden || prepare.dropTrackingPixels || prepare.baseUrl || resolveImage
      ? prepareNodes(dropContentlessElements(contentNodes), prepare)
      : dropContentlessElements(contentNodes);
  const { nodes: bodyNodes, bodies, identifiers } = extractFootnoteSection(prepared);
  const clean = (input: HtmlNode[]): HtmlNode[] =>
    options.sanitize === false ? input : sanitizeHtmlNodes(input);
  const ctx: WalkContext = {
    images: resolveImage
      ? 'resolved'
      : typeof options.images === 'string'
        ? options.images
        : 'keep',
    decisions: prepare.decisions,
    unwrapLayoutTables: options.layoutTables === 'unwrap',
  };

  const children = blocksFromNodes(clean(bodyNodes), ctx);
  if (bodies.size > 0) {
    linkFootnoteReferences(children, identifiers ?? new Map());
    const definitions = new Map<string, MarkdownBlockNode[]>();
    for (const [id, body] of bodies) definitions.set(id, blocksFromNodes(clean(body), ctx));
    children.push(...buildFootnoteDefinitions(definitions));
  }
  return {
    type: 'document',
    children,
    ...(Object.keys(headMetadata).length > 0 ? { frontmatter: headMetadata } : {}),
  };
}

/** Async, ArrayBuffer-accepting entry mirroring docx/pdf importers. */
export async function htmlToMarkdownDoc(
  data: ArrayBuffer | Uint8Array | string,
  options: HtmlImportOptions = {},
): Promise<MarkdownDocument> {
  return htmlToMarkdownDocSync(toHtmlString(data), options);
}

/** Convenience string→string conversion (used for email HTML bodies). */
export function htmlToMarkdown(html: string, options: HtmlImportOptions = {}): string {
  return stringifyMarkdown(htmlToMarkdownDocSync(html, options), { signal: options.signal });
}

/**
 * The text a reader sees: entities decoded, markup and head content removed,
 * whitespace laid out as a browser would, blocks separated by a blank line.
 * Takes the same options as {@link htmlToMarkdown}; images become their alt
 * text unless `images` says otherwise, and there is never frontmatter.
 */
export function htmlToPlainText(html: string, options: HtmlImportOptions = {}): string {
  const doc = htmlToMarkdownDocSync(html, {
    ...options,
    images: options.images ?? 'alt',
    headMetadata: false,
  });
  return doc.children
    .map((block) => extractPlainText(block).trim())
    .filter(Boolean)
    .join('\n\n');
}

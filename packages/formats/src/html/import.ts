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

export interface HtmlImportOptions {
  /** Cancel before parsing. */
  signal?: AbortSignal;
  /** Maximum HTML source characters. Default: 16 MiB. */
  maxInputChars?: number;
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
const blockInlines = (nodes: HtmlNode[]): MarkdownInlineNode[] =>
  normalizeInlineWhitespace(inlinesFromNodes(nodes));

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

function inlinesFromNodes(nodes: HtmlNode[]): MarkdownInlineNode[] {
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
      appendMarkedInlines(out, 'strong', inlinesFromNodes(node.children));
    } else if (INLINE_EM.has(tag)) {
      appendMarkedInlines(out, 'emphasis', inlinesFromNodes(node.children));
    } else if (INLINE_DEL.has(tag)) {
      appendMarkedInlines(out, 'delete', inlinesFromNodes(node.children));
    } else if (INLINE_SUP.has(tag)) {
      out.push({ type: 'superscript', children: inlinesFromNodes(node.children) });
    } else if (INLINE_SUB.has(tag)) {
      out.push({ type: 'subscript', children: inlinesFromNodes(node.children) });
    } else if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') {
      out.push({ type: 'inlineCode', value: textContent(node) });
    } else if (tag === 'a') {
      const url = node.attributes.href ?? '';
      const children = inlinesFromNodes(node.children);
      out.push({
        type: 'link',
        url,
        children: children.length > 0 ? children : [{ type: 'text', value: url }],
      });
    } else if (tag === 'img') {
      const url = node.attributes.src ?? '';
      const alt = node.attributes.alt;
      if (url) out.push({ type: 'image', url, ...(alt ? { alt } : {}) });
    } else {
      // Unknown / transparent inline (span, font, …): flatten children.
      out.push(...inlinesFromNodes(node.children));
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

function blocksFromNodes(nodes: HtmlNode[]): MarkdownBlockNode[] {
  const out: MarkdownBlockNode[] = [];
  let inlineBuffer: HtmlNode[] = [];

  const flush = () => {
    if (inlineBuffer.length === 0) return;
    const inlines = blockInlines(inlineBuffer);
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

    const block = blockForElement(node, tag);
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
function blockForElement(node: HtmlElement, tag: string): MarkdownBlockNode[] | 'inline' | null {
  if (tag in HEADINGS) {
    const children = blockInlines(node.children);
    return [{ type: 'heading', depth: HEADINGS[tag]!, children }];
  }
  if (tag === 'p') {
    const children = blockInlines(node.children);
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
    return [{ type: 'blockquote', children: blocksFromNodes(node.children) }];
  }
  if (tag === 'pre') {
    return [{ type: 'code', value: stripTrailingNewline(textContent(node)) }];
  }
  if (tag === 'ul' || tag === 'ol') {
    return [listFromElement(node, tag === 'ol')];
  }
  if (tag === 'table') {
    const table = tableFromElement(node);
    return table ? [table] : [];
  }
  if (TRANSPARENT_BLOCK.has(tag)) {
    return blocksFromNodes(node.children);
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
  return blocksFromNodes(node.children);
}

function listFromElement(node: HtmlElement, ordered: boolean): MarkdownBlockNode {
  const items: MarkdownListItem[] = [];
  for (const child of node.children) {
    if (isElement(child) && child.tagName.toLowerCase() === 'li') {
      const blocks = blocksFromNodes(child.children);
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

function tableFromElement(node: HtmlElement): MarkdownBlockNode | null {
  const rows: MarkdownTableRow[] = [];
  const collectRows = (n: HtmlElement) => {
    for (const child of n.children) {
      if (!isElement(child)) continue;
      const t = child.tagName.toLowerCase();
      if (t === 'tr') {
        const cells: MarkdownTableCell[] = [];
        for (const cell of child.children) {
          if (
            isElement(cell) &&
            (cell.tagName.toLowerCase() === 'td' || cell.tagName.toLowerCase() === 'th')
          ) {
            cells.push({ type: 'tableCell', children: blockInlines(cell.children) });
          }
        }
        if (cells.length > 0) rows.push({ type: 'tableRow', children: cells });
      } else if (t === 'thead' || t === 'tbody' || t === 'tfoot') {
        collectRows(child);
      }
    }
  };
  collectRows(node);
  if (rows.length === 0) return null;
  return { type: 'table', children: rows };
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
    throw new RangeError(`HTML exceeds the ${maxInputChars}-character safety limit`);
  }
  const nodes = parseHtmlToNodes(html);
  const embedded = findEmbeddedSquisqDoc(nodes);
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
  const {
    nodes: bodyNodes,
    bodies,
    identifiers,
  } = extractFootnoteSection(dropContentlessElements(nodes));
  const clean = (input: HtmlNode[]): HtmlNode[] =>
    options.sanitize === false ? input : sanitizeHtmlNodes(input);

  const children = blocksFromNodes(clean(bodyNodes));
  if (bodies.size > 0) {
    linkFootnoteReferences(children, identifiers ?? new Map());
    const definitions = new Map<string, MarkdownBlockNode[]>();
    for (const [id, body] of bodies) definitions.set(id, blocksFromNodes(clean(body)));
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

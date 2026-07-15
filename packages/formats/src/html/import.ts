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
} from '@bendyline/squisq/markdown';

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
const INLINE_TRANSPARENT = new Set(['span', 'font', 'abbr', 'mark', 'small', 'sub', 'sup', 'u']);

const isElement = (n: HtmlNode): n is HtmlElement => n.type === 'htmlElement';
const isText = (n: HtmlNode): n is { type: 'htmlText'; value: string } => n.type === 'htmlText';

const collapseWs = (s: string): string => s.replace(/\s+/g, ' ');

// ── inline conversion ───────────────────────────────────────────────

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
      out.push({ type: 'strong', children: inlinesFromNodes(node.children) });
    } else if (INLINE_EM.has(tag)) {
      out.push({ type: 'emphasis', children: inlinesFromNodes(node.children) });
    } else if (INLINE_DEL.has(tag)) {
      out.push({ type: 'delete', children: inlinesFromNodes(node.children) });
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

const onlyWhitespace = (inlines: MarkdownInlineNode[]): boolean =>
  inlines.every((n) => n.type === 'text' && n.value.trim() === '');

// ── block conversion ────────────────────────────────────────────────

function blocksFromNodes(nodes: HtmlNode[]): MarkdownBlockNode[] {
  const out: MarkdownBlockNode[] = [];
  let inlineBuffer: HtmlNode[] = [];

  const flush = () => {
    if (inlineBuffer.length === 0) return;
    const inlines = inlinesFromNodes(inlineBuffer);
    inlineBuffer = [];
    if (inlines.length > 0 && !onlyWhitespace(inlines)) {
      out.push({ type: 'paragraph', children: inlines });
    }
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
    const children = inlinesFromNodes(node.children);
    return [{ type: 'heading', depth: HEADINGS[tag]!, children }];
  }
  if (tag === 'p') {
    const children = inlinesFromNodes(node.children);
    return children.length > 0 && !onlyWhitespace(children)
      ? [{ type: 'paragraph', children }]
      : [];
  }
  if (tag === 'br') return 'inline';
  if (tag === 'hr') return [{ type: 'thematicBreak' }];
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
            cells.push({ type: 'tableCell', children: inlinesFromNodes(cell.children) });
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
  let nodes = parseHtmlToNodes(html);
  if (options.sanitize !== false) nodes = sanitizeHtmlNodes(nodes);
  return { type: 'document', children: blocksFromNodes(nodes) };
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

/**
 * Plain text → Markdown. Plain text is not Markdown: `be**t@x.com`, a line
 * starting `# `, `> ` or `1. ` all mean something to a Markdown reader that the
 * writer never intended. The text is laid into a document of text nodes and
 * the stringifier escapes it, so the Markdown reads back as exactly the text
 * that went in.
 *
 * Web addresses can become links. Besides bare `https://…`, mail clients write
 * the links of an HTML message into its plain-text copy as `text <https://…>`
 * (Gmail) or `text [https://…]` (Outlook); the brackets are taken with the
 * address.
 */

import { stringifyMarkdown } from './stringify.js';
import type { MarkdownDocument, MarkdownInlineNode } from './types.js';

export interface PlainTextToMarkdownOptions {
  /**
   * Turn `http(s)://` addresses into links, including the `<https://…>` and
   * `[https://…]` forms mail clients write. Default `true`.
   */
  linkify?: boolean;
  /**
   * How a single line break inside a paragraph is kept. `'hard'` (default)
   * keeps every line as written, the way a mail client shows a plain-text
   * message; `'soft'` joins the lines so the paragraph reflows. Blank lines
   * always separate paragraphs.
   */
  lineBreaks?: 'hard' | 'soft';
}

/**
 * An address in angle brackets, an address in square brackets, or a bare
 * address. Every run stops at whitespace or a bracket, so the scan is linear.
 */
const ADDRESS = /<(https?:\/\/[^\s<>]+)>|\[(https?:\/\/[^\s[\]<>]+)\]|(https?:\/\/[^\s<>]+)/gi;

/** Punctuation that ends a sentence rather than an address. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);

/** A bare address without the sentence punctuation or unmatched bracket after it. */
function trimBareAddress(address: string): string {
  // Counted once and updated as characters come off, so a long run of
  // closing brackets stays linear.
  const counts: Record<string, number> = { '(': 0, ')': 0, '[': 0, ']': 0 };
  for (const c of address) if (c in counts) counts[c]!++;
  let end = address.length;
  for (;;) {
    const last = address[end - 1];
    if (last === undefined) break;
    const open = last === ')' ? '(' : last === ']' ? '[' : undefined;
    const unmatched = open !== undefined && counts[open]! < counts[last]!;
    if (!TRAILING_PUNCTUATION.has(last) && !unmatched) break;
    if (open !== undefined) counts[last]!--;
    end--;
  }
  return address.slice(0, end);
}

function linkNode(url: string): MarkdownInlineNode {
  return { type: 'link', url, children: [{ type: 'text', value: url }] };
}

/** One line's inline nodes, with its addresses as links. */
function lineInlines(line: string, linkify: boolean): MarkdownInlineNode[] {
  if (!linkify) return line ? [{ type: 'text', value: line }] : [];
  const out: MarkdownInlineNode[] = [];
  let at = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const previous = out[out.length - 1];
    if (previous?.type === 'text')
      out[out.length - 1] = { ...previous, value: previous.value + value };
    else out.push({ type: 'text', value });
  };
  for (const match of line.matchAll(ADDRESS)) {
    const start = match.index ?? 0;
    pushText(line.slice(at, start));
    const bracketed = match[1] ?? match[2];
    if (bracketed !== undefined) {
      out.push(linkNode(bracketed));
      at = start + match[0].length;
    } else {
      const url = trimBareAddress(match[3] ?? '');
      // `https://` followed only by punctuation names no host.
      if (/^https?:\/\/[^/]/i.test(url)) out.push(linkNode(url));
      else pushText(url);
      at = start + url.length;
    }
  }
  pushText(line.slice(at));
  return out;
}

/** Plain text as a Markdown document of paragraphs. */
export function plainTextToMarkdownDoc(
  text: string,
  options: PlainTextToMarkdownOptions = {},
): MarkdownDocument {
  const linkify = options.linkify !== false;
  const hard = options.lineBreaks !== 'soft';
  const children: MarkdownDocument['children'] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    const inlines: MarkdownInlineNode[] = [];
    paragraph.forEach((line, i) => {
      if (i > 0) inlines.push(hard ? { type: 'break' } : { type: 'text', value: ' ' });
      inlines.push(...lineInlines(line, linkify));
    });
    paragraph = [];
    children.push({ type: 'paragraph', children: mergeText(inlines) });
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    // Markdown has no way to keep a line's indentation inside a paragraph.
    const line = raw.trim();
    if (line) paragraph.push(line);
    else flush();
  }
  flush();
  return { type: 'document', children };
}

function mergeText(inlines: MarkdownInlineNode[]): MarkdownInlineNode[] {
  const out: MarkdownInlineNode[] = [];
  for (const node of inlines) {
    const previous = out[out.length - 1];
    if (node.type === 'text' && previous?.type === 'text') {
      out[out.length - 1] = { ...previous, value: previous.value + node.value };
    } else {
      out.push(node);
    }
  }
  return out;
}

/** Plain text as Markdown that reads back as the same text. */
export function plainTextToMarkdown(
  text: string,
  options: PlainTextToMarkdownOptions = {},
): string {
  return stringifyMarkdown(plainTextToMarkdownDoc(text, options));
}

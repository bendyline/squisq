/**
 * Blockquotes for the Tiptap bridge: which lines are quote lines, and a
 * quote's body in both directions. A quote holds blocks, not just paragraphs
 * -- a list, task list, code block, table or nested quote must survive a save.
 *
 * The bridge's converters are injected (`QuoteConverters`) because a quote's
 * nested blocks are converted by the bridge itself, which imports this module.
 */

/** The bridge conversions a quote body delegates its nested blocks to. */
export interface QuoteConverters {
  markdownToHtml(markdown: string): string;
  inlineToHtml(text: string): string;
  htmlToMarkdown(html: string): string;
  htmlToInline(html: string): string;
  matchBalancedTag(html: string, start: number, tag: string): { inner: string; end: number } | null;
}

/** A blockquote line: `> text`, or a bare `>` separating quote paragraphs. */
export function isQuoteLine(line: string): boolean {
  return line.startsWith('> ') || line.trimEnd() === '>';
}

export function quoteLineContent(line: string): string {
  return line.trimEnd() === '>' ? '' : line.slice(2);
}

/**
 * Quote-body lines that open a nested block rather than an inline paragraph:
 * a list or task item, fence, table row, ATX heading, thematic break, or a
 * nested quote. Media lines stay inline, as they always have inside quotes.
 */
const RE_QUOTE_BLOCK_START =
  /^ {0,3}(?:#{1,6}(?:\s|$)|>|[-*+]\s|\d+[.)]\s|```|~~~|\||(?:-{3,}|\*{3,}|_{3,})\s*$)/;
const RE_LIST_ITEM_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * Index one past the last line of the nested block that starts at `start`.
 * A fence runs to its closing fence; a table or nested quote runs while its
 * marker repeats; a list runs through its items, indented continuations and
 * any blank line that the list itself continues past. Headings and rules are
 * one line.
 */
function quoteBlockRunEnd(body: string[], start: number): number {
  const first = body[start].trimStart();
  const fence = /^(`{3,}|~{3,})/.exec(first)?.[1];
  if (fence) {
    for (let k = start + 1; k < body.length; k++) {
      if (body[k].trimStart().startsWith(fence)) return k + 1;
    }
    return body.length;
  }
  const repeats = (marker: string) => {
    let k = start + 1;
    while (k < body.length && body[k].trimStart().startsWith(marker)) k++;
    return k;
  };
  if (first.startsWith('|')) return repeats('|');
  if (first.startsWith('>')) return repeats('>');
  if (!RE_LIST_ITEM_LINE.test(body[start])) return start + 1;
  const continuesList = (line: string | undefined) =>
    line !== undefined && (RE_LIST_ITEM_LINE.test(line) || /^\s+\S/.test(line));
  let k = start + 1;
  while (k < body.length) {
    if (continuesList(body[k])) {
      k++;
    } else if (body[k] === '' && continuesList(body[k + 1])) {
      k += 2;
    } else {
      break;
    }
  }
  return k;
}

/**
 * HTML for a quote's body (its lines with the `> ` removed). Plain lines keep
 * the bridge's convention -- one paragraph per line, a bare `>` an empty
 * paragraph -- while a run of block syntax parses as those blocks. Reading
 * every line as inline text turned a list inside a quote into literal
 * `- [ ] Task` paragraphs; saving that fused them into one line of text.
 *
 * A bare `>` directly after a nested block is the separator
 * `quoteBodyToMarkdown` writes there, not an empty paragraph.
 */
export function quoteBodyToHtml(body: string[], convert: QuoteConverters): string {
  const parts: string[] = [];
  let afterBlock = false;
  for (let k = 0; k < body.length;) {
    const content = body[k];
    if (RE_QUOTE_BLOCK_START.test(content)) {
      const end = quoteBlockRunEnd(body, k);
      parts.push(convert.markdownToHtml(body.slice(k, end).join('\n')));
      afterBlock = true;
      k = end;
      continue;
    }
    if (content === '' && afterBlock) {
      afterBlock = false;
      k++;
      continue;
    }
    parts.push(content ? `<p>${convert.inlineToHtml(content)}</p>` : '<p></p>');
    afterBlock = false;
    k++;
  }
  return parts.join('');
}

/**
 * Markdown lines (each `>`-prefixed) for a blockquote's inner HTML: the
 * inverse of `quoteBodyToHtml`. Paragraphs write one `> ` line each, an empty
 * paragraph a bare `>`; any other block -- a list, task list, code block,
 * table, rule or nested quote -- is serialized in full and prefixed, then
 * separated from whatever follows by a bare `>` so CommonMark readers do not
 * fold the next paragraph into it.
 */
export function quoteBodyToMarkdown(inner: string, convert: QuoteConverters): string[] {
  const out: string[] = [];
  let rest = inner.trim();
  let afterBlock = false;
  while (rest.length > 0) {
    const paragraph = /^<p\b[^>]*>(.*?)<\/p>/s.exec(rest);
    if (paragraph) {
      if (afterBlock) out.push('>');
      afterBlock = false;
      const inline = convert.htmlToInline(paragraph[1]);
      // An empty quote paragraph is the separator `markdownToTiptap` read
      // from a bare `>`; write it back the same way.
      if (!inline.trim()) {
        out.push('>');
      } else {
        for (const quoteLine of inline.split('\n')) out.push('> ' + quoteLine);
      }
      rest = rest.slice(paragraph[0].length).trimStart();
      continue;
    }
    const tag = /^<([a-z][a-z0-9]*)\b/i.exec(rest)?.[1];
    const element = tag ? convert.matchBalancedTag(rest, 0, tag) : null;
    if (!element) {
      // Unrecognized markup: keep its text rather than drop it.
      if (afterBlock) out.push('>');
      const inline = convert.htmlToInline(rest);
      for (const quoteLine of inline.split('\n')) out.push(inline.trim() ? '> ' + quoteLine : '>');
      break;
    }
    if (afterBlock) out.push('>');
    const blockLines = convert
      .htmlToMarkdown(rest.slice(0, element.end))
      .replace(/\n+$/, '')
      .split('\n');
    for (const blockLine of blockLines) out.push(blockLine ? '> ' + blockLine : '>');
    afterBlock = true;
    rest = rest.slice(element.end).trimStart();
  }
  return out;
}

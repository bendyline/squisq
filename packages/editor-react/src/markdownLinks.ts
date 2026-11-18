/**
 * Markdown link syntax for the Tiptap bridge.
 *
 * Inline links (`[text](url "title")`) are found by a delimiter scanner that
 * respects balanced brackets and backslash escapes, and their destinations are
 * split from an optional title. Autolinks (`<https://…>`, `<me@x.test>`, and
 * GFM's literal `https://…` / `www.…`) become links that remember how they
 * were written, so `tiptapToMarkdown` writes each back in its own form
 * ({@link restoreAutolinkSource}) and opening a document never rewrites its
 * addresses.
 */

import { unwrapLinkDestination } from './markdownDestination';
import { escapeHtml, unescapeHtml } from './htmlEntities';

/**
 * `<https://…>` or `<me@x.test>`: CommonMark autolinks for the schemes the
 * editor opens. Other schemes stay literal text, as they always have.
 * Control characters end an address: CommonMark excludes them, and the
 * bridge's own placeholders (`\u0000PH0\u0000`) must never fall inside one.
 */
const RE_ANGLE_AUTOLINK =
  // eslint-disable-next-line no-control-regex -- see above
  /<(https?:\/\/[^\s<>\u0000-\u001f]+)>|<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/gi;

/** Text wrapped only in emphasis, strong or strike tags: opening tags, text, closing tags. */
const RE_MARKED_TEXT = /^((?:<(?:em|strong|s)>)*)([^<]*)((?:<\/(?:em|strong|s)>)*)$/i;

/** A GFM literal autolink candidate, before its trailing punctuation is trimmed. */
// eslint-disable-next-line no-control-regex -- placeholders end an address (see RE_ANGLE_AUTOLINK)
const RE_GFM_LITERAL = /(?:https?:\/\/|www\.)[^\s<>\u0000-\u001f]+/gi;

/** Characters GFM never ends a literal autolink on. */
const GFM_TRAILING_PUNCTUATION = new Set(['?', '!', '.', ',', ':', '*', '_', '~']);

/**
 * The part of a literal autolink candidate GFM links: trailing punctuation,
 * unmatched closing parentheses and a trailing entity reference stay text.
 */
function trimGfmLiteral(candidate: string): string {
  let open = 0;
  let close = 0;
  for (const ch of candidate) {
    if (ch === '(') open++;
    else if (ch === ')') close++;
  }
  let end = candidate.length;
  for (;;) {
    const last = candidate[end - 1];
    if (last === undefined) break;
    if (GFM_TRAILING_PUNCTUATION.has(last)) {
      end--;
    } else if (last === ')' && close > open) {
      close--;
      end--;
    } else if (last === ';') {
      const entity = /&[A-Za-z0-9]+;$/.exec(candidate.slice(0, end));
      if (!entity) break;
      end -= entity[0].length;
    } else {
      break;
    }
  }
  return candidate.slice(0, end);
}

/**
 * Autolinks as links that remember how they were written (`data-autolink`),
 * so `htmlToInline` writes each back in its own form. GFM links a literal
 * address only at the start of text or after whitespace, `*`, `_`, `~` or
 * `(`, and only when something follows the scheme or `www.`.
 */
export function stageAutolinks(text: string, stash: (html: string) => string): string {
  const angled = text.replace(
    RE_ANGLE_AUTOLINK,
    (full, uri: string | undefined, email: string | undefined, offset: number, whole: string) => {
      if (isEscapedMarkdownCharacter(whole, offset)) return full;
      const address = uri ?? email ?? '';
      const href = uri ?? `mailto:${address}`;
      return stash(
        `<a href="${escapeHtml(href)}" data-autolink="angle">${escapeHtml(address)}</a>`,
      );
    },
  );
  let out = '';
  let at = 0;
  for (const match of angled.matchAll(RE_GFM_LITERAL)) {
    const start = match.index ?? 0;
    const before = angled[start - 1];
    if (before !== undefined && !/[\s*_~(]/.test(before)) continue;
    const address = trimGfmLiteral(match[0]);
    if (!/^(?:https?:\/\/|www\.)[A-Za-z0-9]/i.test(address)) continue;
    const href = /^www\./i.test(address) ? `http://${address}` : address;
    out +=
      angled.slice(at, start) +
      stash(`<a href="${escapeHtml(href)}" data-autolink="bare">${escapeHtml(address)}</a>`);
    at = start + address.length;
  }
  return out + angled.slice(at);
}

/** An `<a …>…</a>` element in the editor's HTML. */
const RE_ANCHOR = /<a\b([^>]*)>(.*?)<\/a>/g;

/**
 * An autolink still showing its own address goes back out in the form it
 * came in (`<https://…>`, `<me@x.test>`, bare `https://…`), through `protect`
 * so later passes leave it alone: a backslash inside one is part of the
 * address. Once its text is edited or marked up, it stays an ordinary
 * `<a>` for the `[text](url)` pass. ProseMirror puts the link mark outside
 * emphasis (`<a><em>…</em></a>`), so marks wrapping the whole address stay
 * around it.
 */
export function restoreAutolinkSource(html: string, protect: (raw: string) => string): string {
  return html.replace(RE_ANCHOR, (full, attrs: string, inner: string) => {
    const form = /\bdata-autolink="(angle|bare)"/i.exec(attrs)?.[1];
    const href = /\bhref="([^"]*)"/i.exec(attrs)?.[1];
    const parts = RE_MARKED_TEXT.exec(inner);
    if (!form || href === undefined || !parts) return full;
    const [, open = '', text = '', close = ''] = parts;
    const address = unescapeHtml(text);
    const target = unescapeHtml(href);
    if (form === 'angle' && (target === address || target === `mailto:${address}`)) {
      return `${open}${protect(`&lt;${text}&gt;`)}${close}`;
    }
    if (form === 'bare' && (target === address || target === `http://${address}`)) {
      return `${open}${protect(text)}${close}`;
    }
    return full;
  });
}

/**
 * Replace inline links while respecting balanced label brackets. A regex like
 * `\[(.+?)\]\((.+?)\)` incorrectly joins the two bracket pairs in prose such
 * as `[squiggly square], or [squisq](https://squisq.com)`, creating one giant
 * link. The small delimiter scanner also preserves valid nested link labels.
 */
export function replaceMarkdownLinks(
  text: string,
  replace: (label: string, href: string) => string,
): string {
  let output = '';
  let consumedThrough = 0;
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const labelOpen = text.indexOf('[', searchFrom);
    if (labelOpen < 0) break;
    if (isEscapedMarkdownCharacter(text, labelOpen)) {
      searchFrom = labelOpen + 1;
      continue;
    }

    const labelClose = findMatchingMarkdownDelimiter(text, labelOpen, '[', ']');
    const destinationOpen = labelClose + 1;
    if (labelClose < 0 || text[destinationOpen] !== '(') {
      searchFrom = labelOpen + 1;
      continue;
    }

    const destinationClose = findMatchingMarkdownDelimiter(text, destinationOpen, '(', ')');
    if (destinationClose < 0) {
      searchFrom = labelOpen + 1;
      continue;
    }

    const label = text.slice(labelOpen + 1, labelClose);
    const href = text.slice(destinationOpen + 1, destinationClose);
    // Match the bridge's historical regex behavior: empty labels or
    // destinations remain literal source.
    if (!label || !href) {
      searchFrom = labelOpen + 1;
      continue;
    }

    output += text.slice(consumedThrough, labelOpen) + replace(label, href);
    consumedThrough = destinationClose + 1;
    searchFrom = consumedThrough;
  }

  return output + text.slice(consumedThrough);
}

/**
 * Split a link destination into its URL and optional title.
 *
 * CommonMark allows `[t](url "title")`, `'title'` and `(title)`. Only a title
 * that runs to the very end of the destination counts, which is what keeps a
 * URL that merely CONTAINS quotes or parens — `http://x.com/a_(b)` — intact:
 * no separating whitespace, so the whole string stays the URL.
 */
export function splitLinkDestination(destination: string): { url: string; title: string | null } {
  // Keyed by CLOSER: the title always ends the destination, so the final
  // character is what tells us which delimiter to look for.
  const OPENER_FOR: Record<string, string> = { '"': '"', "'": "'", ')': '(' };
  const trimmed = destination.trimEnd();
  const opener = OPENER_FOR[trimmed[trimmed.length - 1] ?? ''];
  if (!opener) return { url: unwrapLinkDestination(destination.trim()), title: null };

  // Walk backwards from just inside the closer. `"` and `'` are their own
  // closer, so scanning FORWARD (or taking the last index outright) would
  // land on the closing delimiter rather than the opening one.
  for (let index = trimmed.length - 2; index > 0; index--) {
    if (trimmed[index] !== opener) continue;
    if (isEscapedMarkdownCharacter(trimmed, index)) continue;
    // A title must be separated from the URL by whitespace. Without this,
    // `http://x.com/a_(b)` would lose `(b)` to a phantom title.
    if (!/\s/.test(trimmed[index - 1])) continue;
    const url = trimmed.slice(0, index).trim();
    if (!url) continue;
    return {
      url: unwrapLinkDestination(url),
      // Backslash escapes inside a title are real escapes (`\"` is a literal
      // quote), matching core's parser.
      title: trimmed.slice(index + 1, -1).replace(/\\([\\"'()])/g, '$1'),
    };
  }
  return { url: unwrapLinkDestination(destination.trim()), title: null };
}

/**
 * Markdown-escape a link title that is still in its HTML-ESCAPED form.
 *
 * Every `htmlToInline` handler leaves attribute values entity-encoded and lets
 * the single trailing `unescapeHtml` decode them once; unescaping here instead
 * would decode a title twice (a literal `&amp;` would collapse to `&`). So the
 * quote is escaped through its entity: `\&quot;` decodes to `\"` on that final
 * pass. Backslashes go first so the one added for the quote isn't doubled.
 */
export function escapeLinkTitleAttr(attrValue: string): string {
  return attrValue.replace(/\\/g, '\\\\').replace(/&quot;/g, '\\&quot;');
}

function findMatchingMarkdownDelimiter(
  text: string,
  start: number,
  open: '[' | '(',
  close: ']' | ')',
): number {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (isEscapedMarkdownCharacter(text, index)) continue;
    if (text[index] === open) depth++;
    if (text[index] !== close) continue;
    depth--;
    if (depth === 0) return index;
  }
  return -1;
}

export function isEscapedMarkdownCharacter(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

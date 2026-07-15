/**
 * JSON → Markdown Serializer
 *
 * Converts a MarkdownDocument JSON structure back to a markdown string
 * using the unified/remark ecosystem with GFM, math, and directive extensions.
 */

import { unified } from 'unified';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import type { MarkdownDocument, StringifyOptions } from './types.js';
import { toMdast } from './convert.js';
import { formatFrontmatterYaml } from './utils.js';
import { assertMarkdownDocumentWithinLimits } from './limits.js';

// Cache the default processor (all extensions, default formatting) to avoid rebuilding on every call.
let defaultProcessor: any;

// ============================================
// Annotation-span unescaping
// ============================================

// Quoted runs as they appear in remark-stringify output. Backslashes inside
// the span are doubled by remark (a literal `\` before punctuation becomes
// `\\`), so `\\.` covers both authored escapes and remark's own.
const DQ_RUN = `"(?:[^"\\\\]|\\\\.)*"`;
const SQ_RUN = `'(?:[^'\\\\]|\\\\.)*'`;

/**
 * A `{[…]}` template-annotation (or inline-icon) span as it appears in
 * remark output: `{\[inner]}`, where `inner` may contain backslash escapes
 * and quoted runs (which may themselves contain `]`).
 */
const ESCAPED_TEMPLATE_SPAN_RE = new RegExp(
  `\\{\\\\\\[((?:${DQ_RUN}|${SQ_RUN}|\\\\.|[^\\]\\\\])*)\\]\\}`,
  'g',
);

/** A heading line (annotations are only emitted trailing on headings). */
const HEADING_LINE_RE = /^#{1,6} .*$/gm;

/**
 * The trailing Pandoc `{…}` span on a heading line, possibly followed by an
 * already-unescaped `{[…]}` template span (canonical emit order).
 */
const TRAILING_ESCAPED_PANDOC_SPAN_RE = new RegExp(
  `\\{(?!\\\\?\\[)((?:${DQ_RUN}|${SQ_RUN}|\\\\.|[^}\\\\])*)\\}(?=\\s*(?:\\{\\[.*)?$)`,
);

/**
 * Backslash+punctuation pairs that are safe to unescape inside an
 * annotation span: the bare character re-parses as literal text in
 * trailing-heading position, so removing the backslash is purely
 * cosmetic and round-trips.
 *
 * Deliberately EXCLUDED (left escaped in the emitted markdown): emphasis
 * and other inline-construct openers (`*`, `_`, `` ` ``, `~`, `<`, `>`,
 * `&`, `!`, `|`, `^`). Unescaping those could make remark-parse split the
 * heading's text run into inline nodes on reparse, which would hide the
 * annotation from the extractor. remark-parse resolves the surviving
 * `\X` escapes back to bare characters, so values still round-trip —
 * the escapes are a cosmetic cost only.
 *
 * Pairs are consumed left to right, so an authored `\"` that remark
 * doubled to `\\"` correctly comes back as `\"`.
 */
const UNESCAPE_PUNCT_RE = /\\([\\[\]:#.,+=/?;@%$(){}'"-])/g;

function unescapeMarkdownPunct(text: string): string {
  return text.replace(UNESCAPE_PUNCT_RE, '$1');
}

// ============================================
// Code-region masking
// ============================================

/**
 * The annotation unescape passes below rewrite *prose*. Code is emitted
 * verbatim by remark, so a backslash inside a fence or an inline-code span
 * is the author's own text — deleting it corrupts their code (and a
 * `# …`-looking line inside a fence is not a heading). Everything code-ish
 * is therefore swapped for an inert placeholder before the passes run and
 * restored afterwards.
 *
 * Placeholders are masked in place, one per region, so line structure is
 * preserved for the `^…$` anchored heading pass: a fenced block collapses
 * to a single line, and an inline span stays within its line.
 *
 * NUL is the PREFERRED sentinel because markdown can't carry it —
 * remark-parse replaces U+0000 with U+FFFD — so it can never occur in parsed
 * content. A doc built programmatically (or imported from DOCX/PPTX/XLSX/CSV/
 * HTML) can still carry one, so the sentinel is chosen per call against the
 * text at hand; see {@link pickMaskSentinel}.
 */
const PREFERRED_MASK_SENTINEL = '\u0000';

/**
 * Choose a sentinel that does not occur in `text`, so masking is unambiguous.
 *
 * Falls back to the private-use area when the text carries a literal NUL.
 * Bailing out of the transform instead would leave the PROSE passes unrun, so
 * every `{[template]}` annotation would stay escaped as `{\[template]}` —
 * which `markdownToDoc` no longer recognizes, silently stripping the template
 * off the block. Returns null only if the text contains NUL *and* every one of
 * the 6400 private-use code points, in which case the caller leaves it alone.
 */
function pickMaskSentinel(text: string): string | null {
  const present = new Set(text);
  if (!present.has(PREFERRED_MASK_SENTINEL)) return PREFERRED_MASK_SENTINEL;
  for (let cp = 0xe000; cp <= 0xf8ff; cp++) {
    const ch = String.fromCodePoint(cp);
    if (!present.has(ch)) return ch;
  }
  return null;
}

/** Opening fence: any indent, 3+ backticks/tildes. Backtick info strings can't contain a backtick. */
const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

/**
 * Find the fenced-code blocks in serialized markdown, as [start, end) offsets.
 *
 * Only fenced blocks are recognized: `stringifyMarkdown` never emits
 * indented code blocks (remark-stringify fences every `code` node, including
 * lang-less ones — pinned by a regression test). Treating 4-space
 * indentation as code here would instead misfire on ordinary nested-list
 * content and stop annotations there from being unescaped.
 */
function findFencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let open: { marker: string; length: number; indent: number; start: number } | null = null;

  for (const line of text.split('\n')) {
    const lineEnd = offset + line.length;
    if (open) {
      const close = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (
        close &&
        close[2][0] === open.marker &&
        close[2].length >= open.length &&
        close[1].length <= open.indent + 3
      ) {
        ranges.push([open.start, lineEnd]);
        open = null;
      }
    } else {
      const match = FENCE_OPEN_RE.exec(line);
      if (match && !(match[2][0] === '`' && match[3].includes('`'))) {
        open = {
          marker: match[2][0],
          length: match[2].length,
          indent: match[1].length,
          start: offset,
        };
      }
    }
    offset = lineEnd + 1; // account for the '\n'
  }
  // An unterminated fence runs to the end of the document (CommonMark).
  if (open) ranges.push([open.start, text.length]);
  return ranges;
}

/** True when the backtick at `i` is escaped (preceded by an odd run of backslashes). */
function isEscapedAt(text: string, i: number): boolean {
  let slashes = 0;
  for (let k = i - 1; k >= 0 && text[k] === '\\'; k--) slashes++;
  return slashes % 2 === 1;
}

/**
 * Find inline code spans within `[from, to)`. A run of N backticks opens a
 * span that the next run of exactly N backticks closes; an unmatched run is
 * literal text. Escaped backticks (remark writes a literal backtick in a
 * text node as `` \` ``) never open a span.
 */
function findInlineCodeRanges(text: string, from: number, to: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = from;
  while (i < to) {
    if (text[i] !== '`' || isEscapedAt(text, i)) {
      i++;
      continue;
    }
    let openEnd = i;
    while (openEnd < to && text[openEnd] === '`') openEnd++;
    const runLength = openEnd - i;

    let j = openEnd;
    let closed = -1;
    while (j < to) {
      if (text[j] !== '`') {
        j++;
        continue;
      }
      let runEnd = j;
      while (runEnd < to && text[runEnd] === '`') runEnd++;
      if (runEnd - j === runLength) {
        closed = runEnd;
        break;
      }
      j = runEnd;
    }
    if (closed === -1) {
      i = openEnd; // unmatched opener — ordinary text
      continue;
    }
    ranges.push([i, closed]);
    i = closed;
  }
  return ranges;
}

/**
 * Apply `transform` to the non-code parts of serialized markdown, leaving
 * fenced blocks and inline code spans byte-identical.
 */
function transformOutsideCode(text: string, transform: (masked: string) => string): string {
  const fenced = findFencedRanges(text);

  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of fenced) {
    ranges.push(...findInlineCodeRanges(text, cursor, start));
    ranges.push([start, end]);
    cursor = end;
  }
  ranges.push(...findInlineCodeRanges(text, cursor, text.length));

  if (ranges.length === 0) return transform(text);

  // Pick a sentinel absent from THIS text so masking is unambiguous even for
  // in-memory docs carrying a literal NUL. Only if no sentinel is available
  // at all do we leave the text untouched.
  const sentinel = pickMaskSentinel(text);
  if (sentinel === null) return text;

  const protectedText: string[] = [];
  let masked = '';
  let last = 0;
  for (const [start, end] of ranges) {
    masked += text.slice(last, start);
    masked += `${sentinel}${protectedText.length}${sentinel}`;
    protectedText.push(text.slice(start, end));
    last = end;
  }
  masked += text.slice(last);

  // `sentinel` is always NUL or a private-use code point — never a regex
  // metacharacter — so it interpolates safely without escaping.
  return transform(masked).replace(
    new RegExp(`${sentinel}(\\d+)${sentinel}`, 'g'),
    (_m, index: string) => protectedText[Number(index)],
  );
}

/**
 * Serialize a MarkdownDocument back to a markdown string.
 *
 * All extensions (GFM, math, directives) are enabled by default.
 * Use the `options` parameter to control formatting and disable extensions.
 *
 * @param doc - The MarkdownDocument to serialize
 * @param options - Serialization options (formatting, extensions)
 * @returns A markdown string
 *
 * @example
 * ```ts
 * const doc: MarkdownDocument = {
 *   type: 'document',
 *   children: [
 *     { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Hello' }] },
 *     { type: 'paragraph', children: [{ type: 'text', value: 'World' }] },
 *   ],
 * };
 * const md = stringifyMarkdown(doc);
 * // '# Hello\n\nWorld\n'
 * ```
 */
export function stringifyMarkdown(doc: MarkdownDocument, options?: StringifyOptions): string {
  options?.signal?.throwIfAborted();
  assertMarkdownDocumentWithinLimits(doc, options?.limits, options?.signal);
  // Convert MarkdownDocument → mdast tree
  const mdastTree = toMdast(doc);

  // Use cached default processor when all extensions and default formatting are used.
  const useDefaults =
    !options ||
    (options.gfm !== false &&
      options.math !== false &&
      options.directive !== false &&
      !options.bullet &&
      !options.bulletOrdered &&
      !options.emphasis &&
      !options.strong &&
      !options.rule &&
      !options.fence &&
      options.setext == null);

  let processor: any;

  if (useDefaults) {
    if (!defaultProcessor) {
      defaultProcessor = unified()
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkDirective)
        .use(remarkStringify, {
          bullet: '-',
          bulletOrdered: '.',
          emphasis: '*',
          strong: '*',
          rule: '-',
          fence: '`',
          setext: false,
        });
    }
    processor = defaultProcessor;
  } else {
    // Build a custom processor with requested options.
    // unified's .use() chaining changes the generic signature each time,
    // making strict typing impractical — use a widened Processor type.
    processor = unified();

    if (options?.gfm !== false) {
      processor = processor.use(remarkGfm);
    }
    if (options?.math !== false) {
      processor = processor.use(remarkMath);
    }
    if (options?.directive !== false) {
      processor = processor.use(remarkDirective);
    }

    processor = processor.use(remarkStringify, {
      bullet: options?.bullet ?? '-',
      bulletOrdered: options?.bulletOrdered ?? '.',
      emphasis: options?.emphasis ?? '*',
      strong: options?.strong ?? '*',
      rule: options?.rule ?? '-',
      fence: options?.fence ?? '`',
      setext: options?.setext ?? false,
    });
  }

  // Stringify mdast → markdown string
  const result = processor.stringify(mdastTree) as string;

  // The passes below all rewrite prose only — code is masked out first, so
  // authored backslashes inside fences and inline-code spans survive and a
  // `# …` line inside a fence is never read as a heading.
  const cleaned = transformOutsideCode(result, (text) => {
    // remark-stringify backslash-escapes markdown-significant characters in
    // text nodes (`[` to prevent link syntax, `:` for directives, `*`/`_` for
    // emphasis, a literal `\` before punctuation, …). Our annotations are
    // injected as plain text, so their interiors come back escaped. Undo that
    // inside `{[…]}` template-annotation spans: removing one backslash from
    // each backslash+punctuation pair (left to right) exactly inverts
    // remark's escaping — including restoring an authored `\"` that remark
    // doubled to `\\"`. The span regex understands quoted values, so a
    // quoted `]` doesn't terminate the span.
    let out = text.replace(
      ESCAPED_TEMPLATE_SPAN_RE,
      (_m, inner: string) => `{[${unescapeMarkdownPunct(inner)}]}`,
    );

    // Same treatment for the trailing Pandoc `{…}` attribute block on heading
    // lines (canonical emit order is Pandoc block then template annotation,
    // so the span sits at end-of-line or just before a `{[…]}` span).
    out = out.replace(HEADING_LINE_RE, (line) =>
      line.replace(
        TRAILING_ESCAPED_PANDOC_SPAN_RE,
        (_m, inner: string) => `{${unescapeMarkdownPunct(inner)}}`,
      ),
    );

    // remark-directive escapes `:` in text (since `:name` would round-trip as
    // a text directive). Inside any other Pandoc-style `{…}` brace span, `:`
    // is purely a value separator (e.g. `connectsTo=foo:flow`), so unescape
    // it to keep round-trips lossless. The negative lookahead skips `{[…]}`
    // template annotations — those are handled above.
    return out.replace(/\{(?!\\?\[)[^}]*\}/g, (match) => match.replace(/\\:/g, ':'));
  });

  // Prepend YAML frontmatter if present. Objects and arrays are emitted as
  // real block YAML (not JSON.stringify'd), so structured frontmatter reads
  // back as the same structure with the same types.
  if (doc.frontmatter && Object.keys(doc.frontmatter).length > 0) {
    const yaml = formatFrontmatterYaml(doc.frontmatter);
    if (yaml) return `---\n${yaml}\n---\n\n${cleaned}`;
  }

  return cleaned;
}

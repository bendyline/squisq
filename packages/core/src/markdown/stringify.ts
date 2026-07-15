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
import { formatFrontmatterValue } from './utils.js';
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

  // remark-stringify backslash-escapes markdown-significant characters in
  // text nodes (`[` to prevent link syntax, `:` for directives, `*`/`_` for
  // emphasis, a literal `\` before punctuation, …). Our annotations are
  // injected as plain text, so their interiors come back escaped. Undo that
  // inside `{[…]}` template-annotation spans: removing one backslash from
  // each backslash+punctuation pair (left to right) exactly inverts
  // remark's escaping — including restoring an authored `\"` that remark
  // doubled to `\\"`. The span regex understands quoted values, so a
  // quoted `]` doesn't terminate the span.
  let cleaned = result.replace(
    ESCAPED_TEMPLATE_SPAN_RE,
    (_m, inner: string) => `{[${unescapeMarkdownPunct(inner)}]}`,
  );

  // Same treatment for the trailing Pandoc `{…}` attribute block on heading
  // lines (canonical emit order is Pandoc block then template annotation,
  // so the span sits at end-of-line or just before a `{[…]}` span).
  cleaned = cleaned.replace(HEADING_LINE_RE, (line) =>
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
  cleaned = cleaned.replace(/\{(?!\\?\[)[^}]*\}/g, (match) => match.replace(/\\:/g, ':'));

  // Prepend YAML frontmatter if present
  if (doc.frontmatter && Object.keys(doc.frontmatter).length > 0) {
    const yamlLines = Object.entries(doc.frontmatter).map(([k, v]) => {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        return `${k}: ${formatFrontmatterValue(v)}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    });
    return `---\n${yamlLines.join('\n')}\n---\n\n${cleaned}`;
  }

  return cleaned;
}

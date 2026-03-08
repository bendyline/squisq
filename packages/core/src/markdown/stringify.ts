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
  // Convert MarkdownDocument → mdast tree
  const mdastTree = toMdast(doc);

  // Build the processor with serialization options.
  // unified's .use() chaining changes the generic signature each time,
  // making strict typing impractical — use a widened Processor type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processor: any = unified();

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

  // Stringify mdast → markdown string
  const result = processor.stringify(mdastTree) as string;

  // remark-stringify escapes `[` in text nodes (to prevent link syntax),
  // which turns `{[template]}` into `{\[template]}`. Unescape our annotation syntax.
  const cleaned = result.replace(/\{\\\[([^\]]+)\]\}/g, '{[$1]}');

  // Prepend YAML frontmatter if present
  if (doc.frontmatter && Object.keys(doc.frontmatter).length > 0) {
    const yamlLines = Object.entries(doc.frontmatter).map(
      ([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`,
    );
    return `---\n${yamlLines.join('\n')}\n---\n\n${cleaned}`;
  }

  return cleaned;
}

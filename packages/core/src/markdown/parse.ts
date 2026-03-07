/**
 * Markdown → JSON Parser
 *
 * Parses a markdown string into a MarkdownDocument JSON structure
 * using the unified/remark ecosystem with GFM, math, and directive extensions.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import type { MarkdownDocument, ParseOptions } from './types.js';
import { fromMdast } from './convert.js';

/**
 * Parse a markdown string into a MarkdownDocument.
 *
 * All extensions (GFM, math, directives) are enabled by default.
 * Use the `options` parameter to disable specific extensions.
 *
 * @param markdown - The markdown source text
 * @param options - Parser options (extensions, HTML parsing)
 * @returns A MarkdownDocument representing the parsed markdown
 *
 * @example
 * ```ts
 * const doc = parseMarkdown('# Hello\n\nWorld **bold** and *italic*');
 * // doc.type === 'document'
 * // doc.children[0].type === 'heading'
 * // doc.children[1].type === 'paragraph'
 * ```
 */
export function parseMarkdown(markdown: string, options?: ParseOptions): MarkdownDocument {
  // Build the processor with requested extensions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processor: any = unified().use(remarkParse);

  if (options?.gfm !== false) {
    processor = processor.use(remarkGfm);
  }
  if (options?.math !== false) {
    processor = processor.use(remarkMath);
  }
  if (options?.directive !== false) {
    processor = processor.use(remarkDirective);
  }

  // Parse markdown → mdast tree
  const mdastTree = processor.parse(markdown);

  // Convert mdast → MarkdownDocument
  return fromMdast(mdastTree, { parseHtml: options?.parseHtml });
}

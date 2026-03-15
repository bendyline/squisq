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
import remarkFrontmatter from 'remark-frontmatter';
import type { MarkdownDocument, ParseOptions } from './types.js';
import { fromMdast } from './convert.js';
import { parseFrontmatter } from './utils.js';

// Cache the default processor (all extensions enabled) to avoid rebuilding on every call.
let defaultProcessor: any;

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
  // Use cached default processor when all extensions are enabled (the common case).
  const useDefaults =
    !options ||
    (options.gfm !== false &&
      options.math !== false &&
      options.directive !== false &&
      options.frontmatter !== false);

  let processor: any;

  if (useDefaults) {
    if (!defaultProcessor) {
      defaultProcessor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkDirective)
        .use(remarkFrontmatter, ['yaml']);
    }
    processor = defaultProcessor;
  } else {
    // Build a custom processor with requested extensions.
    // unified's .use() chaining changes the generic signature each time,
    // making strict typing impractical — use a widened Processor type.
    processor = unified().use(remarkParse);

    if (options?.gfm !== false) {
      processor = processor.use(remarkGfm);
    }
    if (options?.math !== false) {
      processor = processor.use(remarkMath);
    }
    if (options?.directive !== false) {
      processor = processor.use(remarkDirective);
    }
    if (options?.frontmatter !== false) {
      processor = processor.use(remarkFrontmatter, ['yaml']);
    }
  }

  // Parse markdown → mdast tree (result is an mdast Root node)
  const mdastTree = processor.parse(markdown) as {
    type: string;
    children?: Array<{ type: string; value?: string }>;
  };

  // Convert mdast → MarkdownDocument
  const doc = fromMdast(mdastTree as Parameters<typeof fromMdast>[0], {
    parseHtml: options?.parseHtml,
  });

  // Extract YAML frontmatter if present
  if (options?.frontmatter !== false) {
    const yamlNode = mdastTree.children?.find((n) => n.type === 'yaml');
    if (yamlNode?.value) {
      const fm = parseFrontmatter(yamlNode.value);
      if (fm && Object.keys(fm).length > 0) {
        doc.frontmatter = fm;
      }
    }
  }

  return doc;
}

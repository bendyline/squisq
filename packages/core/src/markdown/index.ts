/**
 * @bendyline/squisq Markdown Module
 *
 * Provides a complete JSON representation of markdown documents with
 * perfect-fidelity round-trip conversion (markdown ↔ JSON).
 *
 * Supports CommonMark + GFM (tables, strikethrough, task lists, footnotes) +
 * math ($...$, $$...$$) + directives (:::container, ::leaf, :text).
 * Raw HTML is parsed into a structured HtmlNode sub-DOM.
 *
 * @example
 * ```ts
 * import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
 *
 * // Parse markdown to JSON
 * const doc = parseMarkdown('# Hello\n\nWorld **bold** and *italic*');
 *
 * // Inspect the tree
 * console.log(doc.children[0].type); // 'heading'
 *
 * // Serialize back to markdown
 * const md = stringifyMarkdown(doc);
 * ```
 */

// Types (all interfaces + union types)
export type {
  // Position tracking
  MarkdownPoint,
  MarkdownSourcePosition,

  // Heading template annotation
  HeadingTemplateAnnotation,

  // HTML sub-DOM
  HtmlElement,
  HtmlText,
  HtmlComment,
  HtmlNode,

  // Document root
  MarkdownDocument,

  // Block content
  MarkdownHeading,
  MarkdownParagraph,
  MarkdownBlockquote,
  MarkdownList,
  MarkdownListItem,
  MarkdownCodeBlock,
  MarkdownThematicBreak,
  MarkdownTable,
  MarkdownTableRow,
  MarkdownTableCell,
  MarkdownHtmlBlock,
  MarkdownMathBlock,
  MarkdownLinkDefinition,
  MarkdownFootnoteDefinition,
  MarkdownContainerDirective,
  MarkdownLeafDirective,
  MarkdownDefinitionList,
  MarkdownDefinitionTerm,
  MarkdownDefinitionDescription,

  // Inline content
  MarkdownText,
  MarkdownEmphasis,
  MarkdownStrong,
  MarkdownStrikethrough,
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownImage,
  MarkdownBreak,
  MarkdownInlineHtml,
  MarkdownInlineMath,
  MarkdownFootnoteReference,
  MarkdownLinkReference,
  MarkdownImageReference,
  MarkdownTextDirective,

  // Union types
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownNode,

  // Options
  ParseOptions,
  StringifyOptions,
} from './types.js';

// Parser + serializer
export { parseMarkdown } from './parse.js';
export { stringifyMarkdown } from './stringify.js';

// Conversion layer (for advanced use: working with remark plugins directly)
export { fromMdast, toMdast } from './convert.js';

// HTML sub-DOM utilities
export { parseHtmlToNodes, stringifyHtmlNodes } from './htmlParse.js';

// Tree utilities
export {
  getChildren,
  walkMarkdownTree,
  findNodesByType,
  extractPlainText,
  countNodes,
  createDocument,
  parseFrontmatter,
} from './utils.js';

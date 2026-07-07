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

  // Pandoc-style heading attributes
  HeadingAttributes,

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
  MarkdownMention,

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

// Pandoc-style heading attribute helpers — exposed so editor-react can
// mutate `data-block-attrs` strings without reimplementing the tokenizer.
export { parsePandocAttrTokens, serializePandocAttributes } from './convert.js';

// Shared key=value attribute machinery for both annotation forms
// (`{[templateName key=value]}` and Pandoc `{#id .class key=value}`) —
// exposed so editor-react's tiptap bridge tokenizes and matches headings
// with the exact same grammar as the parser, by import rather than by copy.
export {
  tokenizeAttrTokens,
  splitKeyValueToken,
  unquoteAttrValue,
  needsQuoting,
  quoteAttrValue,
  matchTrailingTemplateAnnotation,
  matchTrailingPandocAttr,
} from './attrTokens.js';
export type { TrailingAnnotationMatch } from './attrTokens.js';

// Known `{[name key=value]}` block-meta keys and their editor-facing
// descriptors — exposed so the markdown editor's attribute autocomplete
// suggests keys and (where closed) values from the same registry the parser
// coerces against, rather than a hand-maintained copy.
export {
  KNOWN_BLOCK_META_KEYS,
  BLOCK_META_KEY_DESCRIPTORS,
  parseTimeSeconds,
} from './annotationCoercion.js';
export type { KnownBlockMetaKey, BlockMetaKeyDescriptor } from './annotationCoercion.js';

// HTML sub-DOM utilities
export { parseHtmlToNodes, stringifyHtmlNodes } from './htmlParse.js';
export { sanitizeHtmlNodes, sanitizeUrl } from './sanitize.js';
export type { HtmlPolicy, SanitizeUrlOptions, UrlKind } from './sanitize.js';

// Tree utilities
export {
  getChildren,
  walkMarkdownTree,
  findNodesByType,
  extractPlainText,
  countNodes,
  createDocument,
  parseFrontmatter,
  formatBlockScalar,
  setFrontmatterValues,
  inferDocumentTitle,
  readFrontmatterThemeId,
  plainTextFromInlineHtml,
} from './utils.js';

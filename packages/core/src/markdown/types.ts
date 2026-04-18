/**
 * Markdown DOM Types
 *
 * A complete hierarchical JSON representation of a Markdown document.
 * Supports perfect-fidelity round-trip conversion between Markdown text
 * and this JSON format: parseMarkdown(stringifyMarkdown(doc)) ≡ doc.
 *
 * Coverage:
 * - CommonMark (headings, paragraphs, lists, code, blockquotes, etc.)
 * - GFM (tables, strikethrough, task lists, autolinks, footnotes)
 * - Math (inline $...$ and display $$...$$)
 * - Directives (:::container, ::leaf, :text — used for admonitions, etc.)
 * - Raw HTML (parsed into an HtmlNode sub-DOM for programmatic access)
 * - Definition lists (type only — for programmatic construction)
 */

// ============================================
// Position Tracking
// ============================================

/**
 * A specific point in the source markdown text.
 */
export interface MarkdownPoint {
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  column: number;
  /** 0-based byte offset from start of document */
  offset?: number;
}

/**
 * Source position range for a node (start inclusive, end exclusive).
 * Present when parsed from markdown, absent when constructed programmatically.
 */
export interface MarkdownSourcePosition {
  start: MarkdownPoint;
  end: MarkdownPoint;
}

// ============================================
// HTML Sub-DOM
// ============================================

/**
 * An HTML element with tag name, attributes, and children.
 */
export interface HtmlElement {
  type: 'htmlElement';
  /** HTML tag name (lowercase, e.g., 'div', 'span', 'br') */
  tagName: string;
  /** HTML attributes as name→value pairs (uses HTML attribute names, e.g., 'class' not 'className') */
  attributes: Record<string, string>;
  /** Child nodes */
  children: HtmlNode[];
  /** Whether this is a void/self-closing element (br, hr, img, etc.) */
  selfClosing: boolean;
}

/**
 * A raw text node inside HTML.
 */
export interface HtmlText {
  type: 'htmlText';
  value: string;
}

/**
 * An HTML comment (<!-- ... -->).
 */
export interface HtmlComment {
  type: 'htmlComment';
  value: string;
}

/** Any node in the HTML sub-DOM tree. */
export type HtmlNode = HtmlElement | HtmlText | HtmlComment;

// ============================================
// Document Root
// ============================================

/**
 * Root node of a parsed markdown document.
 */
export interface MarkdownDocument {
  type: 'document';
  /** Top-level block content */
  children: MarkdownBlockNode[];
  /** Source position (present when parsed from markdown) */
  position?: MarkdownSourcePosition;
  /**
   * YAML frontmatter key-value pairs extracted from the `---` block
   * at the top of the document. Present only when the source contains
   * frontmatter and `frontmatter` parsing is enabled (default: true).
   */
  frontmatter?: Record<string, unknown>;
}

// ============================================
// Block Content Types
// ============================================

/** Base properties shared by all markdown nodes. */
interface MarkdownNodeBase {
  /** Source position (present when parsed from markdown, absent when programmatically constructed) */
  position?: MarkdownSourcePosition;
}

/**
 * Template annotation extracted from a heading's trailing `{[templateName key=value …]}` syntax.
 *
 * @example
 * ```markdown
 * ### Report Data {[chart colorScheme=blue]}
 * ```
 * → `{ template: 'chart', params: { colorScheme: 'blue' } }`
 */
export interface HeadingTemplateAnnotation {
  /** Template name (first token inside `{[…]}`).
   *  Optional when the annotation contains only key=value pairs
   *  (e.g., `{[audio=intro.mp3]}`). */
  template?: string;
  /** Optional key-value parameters (remaining `key=value` tokens) */
  params?: Record<string, string>;
}

/**
 * ATX or setext heading (# Heading).
 */
export interface MarkdownHeading extends MarkdownNodeBase {
  type: 'heading';
  /** Heading level (1–6) */
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  /** Inline content */
  children: MarkdownInlineNode[];
  /**
   * Template annotation parsed from trailing `{[templateName …]}` syntax.
   * Present only when the heading text ends with `{[…]}`. The annotation
   * is stripped from `children` during parsing and re-injected during
   * stringification, so it round-trips transparently.
   */
  templateAnnotation?: HeadingTemplateAnnotation;
}

/**
 * A paragraph of inline content.
 */
export interface MarkdownParagraph extends MarkdownNodeBase {
  type: 'paragraph';
  children: MarkdownInlineNode[];
}

/**
 * A blockquote (> ...).
 */
export interface MarkdownBlockquote extends MarkdownNodeBase {
  type: 'blockquote';
  children: MarkdownBlockNode[];
}

/**
 * An ordered or unordered list.
 */
export interface MarkdownList extends MarkdownNodeBase {
  type: 'list';
  /** Whether the list is ordered (numbered) or unordered (bulleted) */
  ordered: boolean;
  /** Starting number for ordered lists (default: 1) */
  start?: number | null;
  /** Whether items are separated by blank lines (loose list) */
  spread?: boolean | null;
  children: MarkdownListItem[];
}

/**
 * A single item in a list. May be a task list item if `checked` is non-null.
 */
export interface MarkdownListItem extends MarkdownNodeBase {
  type: 'listItem';
  /** null = not a task item, true = checked [x], false = unchecked [ ] */
  checked?: boolean | null;
  /** Whether this item contains blank lines (loose) */
  spread?: boolean | null;
  /** Block content (typically paragraphs, but can contain nested lists, etc.) */
  children: MarkdownBlockNode[];
}

/**
 * A fenced or indented code block.
 */
export interface MarkdownCodeBlock extends MarkdownNodeBase {
  type: 'code';
  /** Language identifier (e.g., 'typescript', 'python') */
  lang?: string | null;
  /** Additional metadata after the language on the fence line */
  meta?: string | null;
  /** The code content (no trailing newline) */
  value: string;
}

/**
 * A thematic break (---, ***, or ___).
 */
export interface MarkdownThematicBreak extends MarkdownNodeBase {
  type: 'thematicBreak';
}

/**
 * A GFM table.
 */
export interface MarkdownTable extends MarkdownNodeBase {
  type: 'table';
  /** Column alignment: null = default, 'left', 'center', 'right' */
  align?: (('left' | 'right' | 'center') | null)[];
  /** First row is always the header row */
  children: MarkdownTableRow[];
}

/**
 * A row in a table.
 */
export interface MarkdownTableRow extends MarkdownNodeBase {
  type: 'tableRow';
  children: MarkdownTableCell[];
}

/**
 * A cell in a table row.
 */
export interface MarkdownTableCell extends MarkdownNodeBase {
  type: 'tableCell';
  /** Whether this cell is in the header row */
  isHeader?: boolean;
  children: MarkdownInlineNode[];
}

/**
 * A block of raw HTML.
 *
 * The `rawHtml` field contains the original HTML string and is used for
 * serialization (round-tripping). The `htmlChildren` field contains a
 * parsed HTML DOM tree for programmatic traversal.
 *
 * Note: For partial HTML tags (e.g., just `<div>` without `</div>`),
 * `htmlChildren` may not fully represent the structure. The `rawHtml`
 * field always preserves the exact original text.
 */
export interface MarkdownHtmlBlock extends MarkdownNodeBase {
  type: 'htmlBlock';
  /** The original raw HTML string (source of truth for serialization) */
  rawHtml: string;
  /** Parsed HTML DOM tree (for programmatic access) */
  htmlChildren: HtmlNode[];
}

/**
 * A display math block ($$...$$).
 */
export interface MarkdownMathBlock extends MarkdownNodeBase {
  type: 'math';
  /** The math content (without $$ delimiters) */
  value: string;
  /** Optional metadata after the opening $$ */
  meta?: string | null;
}

/**
 * A link reference definition: [id]: url "title"
 * These are typically not rendered but define targets for reference links.
 */
export interface MarkdownLinkDefinition extends MarkdownNodeBase {
  type: 'definition';
  /** Reference identifier (lowercase, normalized) */
  identifier: string;
  /** Original label text */
  label?: string;
  /** URL target */
  url: string;
  /** Optional title */
  title?: string | null;
}

/**
 * A footnote definition: [^id]: content
 */
export interface MarkdownFootnoteDefinition extends MarkdownNodeBase {
  type: 'footnoteDefinition';
  /** Footnote identifier */
  identifier: string;
  /** Original label text */
  label?: string;
  /** Footnote content (block-level) */
  children: MarkdownBlockNode[];
}

/**
 * A container directive (:::name[label]{attrs}\ncontent\n:::).
 * Used for admonitions, callouts, and other structural extensions.
 */
export interface MarkdownContainerDirective extends MarkdownNodeBase {
  type: 'containerDirective';
  /** Directive name (e.g., 'note', 'warning', 'tip') */
  name: string;
  /** Key-value attributes from {attr=value} */
  attributes?: Record<string, string>;
  /** Label text from [label] (extracted from children for clean round-tripping) */
  label?: string;
  /** Block content inside the directive */
  children: MarkdownBlockNode[];
}

/**
 * A leaf directive (::name[label]{attrs}).
 * Self-contained block-level directive with no content body.
 */
export interface MarkdownLeafDirective extends MarkdownNodeBase {
  type: 'leafDirective';
  /** Directive name */
  name: string;
  /** Key-value attributes */
  attributes?: Record<string, string>;
  /** Inline content from [label] */
  children: MarkdownInlineNode[];
}

/**
 * A definition list (<dl>).
 * This type is for programmatic construction — no standard remark parser
 * produces these nodes, but they can be built and rendered.
 */
export interface MarkdownDefinitionList extends MarkdownNodeBase {
  type: 'definitionList';
  children: (MarkdownDefinitionTerm | MarkdownDefinitionDescription)[];
}

/**
 * A term in a definition list (<dt>).
 */
export interface MarkdownDefinitionTerm extends MarkdownNodeBase {
  type: 'definitionTerm';
  children: MarkdownInlineNode[];
}

/**
 * A description in a definition list (<dd>).
 */
export interface MarkdownDefinitionDescription extends MarkdownNodeBase {
  type: 'definitionDescription';
  children: MarkdownBlockNode[];
}

// ============================================
// Inline Content Types
// ============================================

/**
 * Plain text content.
 */
export interface MarkdownText extends MarkdownNodeBase {
  type: 'text';
  value: string;
}

/**
 * Emphasized text (*text* or _text_).
 */
export interface MarkdownEmphasis extends MarkdownNodeBase {
  type: 'emphasis';
  children: MarkdownInlineNode[];
}

/**
 * Strong emphasis (**text** or __text__).
 */
export interface MarkdownStrong extends MarkdownNodeBase {
  type: 'strong';
  children: MarkdownInlineNode[];
}

/**
 * Strikethrough text (~~text~~). GFM extension.
 */
export interface MarkdownStrikethrough extends MarkdownNodeBase {
  type: 'delete';
  children: MarkdownInlineNode[];
}

/**
 * Inline code (`code`).
 */
export interface MarkdownInlineCode extends MarkdownNodeBase {
  type: 'inlineCode';
  value: string;
}

/**
 * A hyperlink [text](url "title").
 */
export interface MarkdownLink extends MarkdownNodeBase {
  type: 'link';
  /** URL target */
  url: string;
  /** Optional title (shown on hover) */
  title?: string | null;
  /** Link text (inline content) */
  children: MarkdownInlineNode[];
}

/**
 * An image ![alt](url "title").
 */
export interface MarkdownImage extends MarkdownNodeBase {
  type: 'image';
  /** Image URL */
  url: string;
  /** Alt text */
  alt?: string;
  /** Optional title */
  title?: string | null;
}

/**
 * A hard line break (two trailing spaces or backslash before newline).
 */
export interface MarkdownBreak extends MarkdownNodeBase {
  type: 'break';
}

/**
 * Inline raw HTML.
 *
 * In markdown, individual HTML tags like `<em>` or `</em>` appear as
 * separate inline nodes. The `rawHtml` preserves the exact tag text.
 * The `htmlChildren` is a best-effort parse (partial tags may not
 * produce meaningful trees).
 */
export interface MarkdownInlineHtml extends MarkdownNodeBase {
  type: 'htmlInline';
  /** The original raw HTML string */
  rawHtml: string;
  /** Parsed HTML DOM tree (best-effort for partial tags) */
  htmlChildren: HtmlNode[];
}

/**
 * Inline math ($...$).
 */
export interface MarkdownInlineMath extends MarkdownNodeBase {
  type: 'inlineMath';
  /** Math content (without $ delimiters) */
  value: string;
}

/**
 * A footnote reference [^id]. GFM extension.
 */
export interface MarkdownFootnoteReference extends MarkdownNodeBase {
  type: 'footnoteReference';
  /** Footnote identifier */
  identifier: string;
  /** Original label text */
  label?: string;
}

/**
 * A link via reference [text][id] or [text][] or [text].
 */
export interface MarkdownLinkReference extends MarkdownNodeBase {
  type: 'linkReference';
  /** Reference identifier (normalized) */
  identifier: string;
  /** Original label text */
  label?: string;
  /** How the reference is written */
  referenceType: 'full' | 'collapsed' | 'shortcut';
  /** Link text (inline content) */
  children: MarkdownInlineNode[];
}

/**
 * An image via reference ![alt][id].
 */
export interface MarkdownImageReference extends MarkdownNodeBase {
  type: 'imageReference';
  /** Reference identifier (normalized) */
  identifier: string;
  /** Original label text */
  label?: string;
  /** How the reference is written */
  referenceType: 'full' | 'collapsed' | 'shortcut';
  /** Alt text */
  alt?: string;
}

/**
 * An inline text directive (:name[label]{attrs}).
 */
export interface MarkdownTextDirective extends MarkdownNodeBase {
  type: 'textDirective';
  /** Directive name */
  name: string;
  /** Key-value attributes */
  attributes?: Record<string, string>;
  /** Inline content from [label] */
  children: MarkdownInlineNode[];
}

/**
 * An @-mention of a named entity such as a user or agent.
 *
 * Wire format: `@[Display Name](scheme:id)` — a regular Markdown link
 * preceded by `@`, with a namespaced URL scheme that identifies what
 * kind of entity is being mentioned. Parsers that don't know about
 * mentions still render it as a link with text "Display Name" pointing
 * at "scheme:id" — graceful fallback.
 */
export interface MarkdownMention extends MarkdownNodeBase {
  type: 'mention';
  /** Namespace for the mentioned entity (e.g. `"gezel"`, `"user"`). */
  targetKind: string;
  /** Stable identifier within the namespace. */
  targetId: string;
  /** Text shown to the reader. */
  displayName: string;
}

// ============================================
// Union Types
// ============================================

/** Block-level content that can appear as direct children of the document root, blockquotes, list items, etc. */
export type MarkdownBlockNode =
  | MarkdownHeading
  | MarkdownParagraph
  | MarkdownBlockquote
  | MarkdownList
  | MarkdownCodeBlock
  | MarkdownThematicBreak
  | MarkdownTable
  | MarkdownHtmlBlock
  | MarkdownMathBlock
  | MarkdownLinkDefinition
  | MarkdownFootnoteDefinition
  | MarkdownContainerDirective
  | MarkdownLeafDirective
  | MarkdownDefinitionList;

/** Inline/phrasing content that appears inside paragraphs, headings, links, etc. */
export type MarkdownInlineNode =
  | MarkdownText
  | MarkdownEmphasis
  | MarkdownStrong
  | MarkdownStrikethrough
  | MarkdownInlineCode
  | MarkdownLink
  | MarkdownImage
  | MarkdownBreak
  | MarkdownInlineHtml
  | MarkdownInlineMath
  | MarkdownFootnoteReference
  | MarkdownLinkReference
  | MarkdownImageReference
  | MarkdownTextDirective
  | MarkdownMention;

/**
 * Any node in the markdown tree. Includes structural nodes (listItem,
 * tableRow, tableCell, etc.) that only appear as children of specific parents.
 * Useful for generic tree-walking functions.
 */
export type MarkdownNode =
  | MarkdownDocument
  | MarkdownBlockNode
  | MarkdownInlineNode
  | MarkdownListItem
  | MarkdownTableRow
  | MarkdownTableCell
  | MarkdownDefinitionTerm
  | MarkdownDefinitionDescription;

// ============================================
// Options
// ============================================

/**
 * Options for parseMarkdown().
 */
export interface ParseOptions {
  /** Enable GFM extensions (tables, strikethrough, task lists, autolinks, footnotes). Default: true */
  gfm?: boolean;
  /** Enable math extensions ($...$ and $$...$$). Default: true */
  math?: boolean;
  /** Enable directive extensions (:::container, ::leaf, :text). Default: true */
  directive?: boolean;
  /** Parse raw HTML into HtmlNode sub-DOM trees. Default: true */
  parseHtml?: boolean;
  /** Enable YAML frontmatter parsing (--- blocks at top of document). Default: true */
  frontmatter?: boolean;
}

/**
 * Options for stringifyMarkdown().
 */
export interface StringifyOptions {
  /** Enable GFM extensions in output. Default: true */
  gfm?: boolean;
  /** Enable math extensions in output. Default: true */
  math?: boolean;
  /** Enable directive extensions in output. Default: true */
  directive?: boolean;
  /** Bullet character for unordered lists. Default: '-' */
  bullet?: '-' | '*' | '+';
  /** Ordered list delimiter. Default: '.' */
  bulletOrdered?: '.' | ')';
  /** Emphasis marker character. Default: '*' */
  emphasis?: '*' | '_';
  /** Strong emphasis marker character. Default: '*' */
  strong?: '*' | '_';
  /** Thematic break character. Default: '-' */
  rule?: '-' | '*' | '_';
  /** Code fence character. Default: '`' */
  fence?: '`' | '~';
  /** Use setext-style headings (underlined) for depth 1-2. Default: false */
  setext?: boolean;
}

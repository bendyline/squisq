/**
 * Shared inline walker for the "run-based" exporters.
 *
 * DOCX (`<w:r>`) and PPTX (`<a:r>`) both render inline markdown by threading an
 * active character-format object DOWN through nested nodes (strong → bold,
 * emphasis → italic, …) and emitting flat styled runs at the leaves — as
 * opposed to the HTML exporters, which WRAP children in tags, or the PDF
 * exporter, which accumulates positioned spans. That control flow is identical
 * between DOCX and PPTX; only the leaf serialization differs.
 *
 * This module owns the traversal once. Each exporter supplies the handful of
 * leaf handlers (`run`, `link`, `image`, `lineBreak`, optional `footnoteRef`)
 * via {@link InlineRunHandlers}. Because the handler interface is typed, adding
 * a new inline node type here forces both exporters to be considered — there's
 * no longer a per-exporter `default:` that can silently drift.
 */

import type {
  MarkdownInlineNode,
  MarkdownLink,
  MarkdownImage,
  MarkdownFootnoteReference,
  MarkdownInlineIcon,
} from '@bendyline/squisq/markdown';
import { stripHtmlTags } from './text.js';

/** Active character formatting threaded down through nested inline nodes. */
export interface InlineRunFormat {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** Explicit run color (hex without `#`); only some exporters use this. */
  color?: string;
}

/**
 * Per-format leaf handlers. The walker handles the shared format-threading
 * control flow; these turn the leaves into the target dialect's markup.
 */
export interface InlineRunHandlers {
  /** Emit a styled text run for `text`, given the active format. */
  run(text: string, format: InlineRunFormat): string;
  /** Emit a hyperlink (the handler manages its own child rendering). */
  link(node: MarkdownLink, format: InlineRunFormat): string;
  /** Emit an inline image. */
  image(node: MarkdownImage, format: InlineRunFormat): string;
  /** Emit a resolved Font Awesome inline icon. */
  icon(node: MarkdownInlineIcon, format: InlineRunFormat): string;
  /** Emit a hard line break. */
  lineBreak(): string;
  /** Emit a footnote reference. Omit to drop footnote refs (PPTX). */
  footnoteRef?(node: MarkdownFootnoteReference): string;
}

/** Walk a list of inline nodes, concatenating each rendered run. */
export function inlineNodesToRuns(
  nodes: MarkdownInlineNode[],
  handlers: InlineRunHandlers,
  format: InlineRunFormat = {},
): string {
  let out = '';
  for (const node of nodes) {
    out += inlineNodeToRuns(node, handlers, format);
  }
  return out;
}

/** Render a single inline node under the active format. */
export function inlineNodeToRuns(
  node: MarkdownInlineNode,
  handlers: InlineRunHandlers,
  format: InlineRunFormat,
): string {
  switch (node.type) {
    case 'text':
      return handlers.run(node.value, format);
    case 'strong':
      return inlineNodesToRuns(node.children, handlers, { ...format, bold: true });
    case 'emphasis':
      return inlineNodesToRuns(node.children, handlers, { ...format, italic: true });
    case 'delete':
      return inlineNodesToRuns(node.children, handlers, { ...format, strike: true });
    case 'inlineCode':
      return handlers.run(node.value, { ...format, code: true });
    case 'inlineMath':
      return handlers.run(node.value, { ...format, code: true });
    case 'htmlInline':
      return handlers.run(stripHtmlTags(node.rawHtml), format);
    case 'link':
      return handlers.link(node, format);
    case 'image':
      return handlers.image(node, format);
    case 'inlineIcon':
      return handlers.icon(node, format);
    case 'break':
      return handlers.lineBreak();
    case 'footnoteReference':
      return handlers.footnoteRef ? handlers.footnoteRef(node) : '';
    default:
      // linkReference, imageReference, textDirective, … — skip.
      return '';
  }
}

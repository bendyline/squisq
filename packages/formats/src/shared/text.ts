/**
 * Shared plain-text helpers used by every format exporter.
 *
 * These were previously copy-pasted into the docx / pptx / epub exporters with
 * subtle drift (e.g. some handled `inlineMath`, some handled `break`). Keeping a
 * single implementation here means a fix or a newly-supported inline node type
 * only has to be added in one place.
 */

import type { MarkdownInlineNode } from '@bendyline/squisq/markdown';

/** Strip HTML tags from a string, keeping only the text content. */
export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/** Flatten a single inline node to its plain-text content. */
export function inlineToPlainText(node: MarkdownInlineNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'inlineMath':
      return node.value;
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'link':
      return extractPlainText(node.children);
    case 'image':
      return node.alt ?? '';
    case 'break':
      return ' ';
    default:
      return '';
  }
}

/** Flatten an array of inline nodes to their concatenated plain-text content. */
export function extractPlainText(nodes: MarkdownInlineNode[]): string {
  return nodes.map(inlineToPlainText).join('');
}

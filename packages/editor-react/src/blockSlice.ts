/**
 * Helpers for extracting the immediate body of the heading-defined block
 * that's currently being edited. The template picker uses this slice to
 * decide which templates to surface as "Recommended for this block".
 *
 * Block boundary: from the target heading's position, take subsequent
 * top-level siblings up to (but not including) the next heading at any
 * depth. This matches the doc model where each heading owns its
 * immediate `contents` and subheadings become nested blocks.
 */

import { parseMarkdown } from '@bendyline/squisq/markdown';
import type {
  MarkdownBlockNode,
  MarkdownDocument,
  MarkdownHeading,
} from '@bendyline/squisq/markdown';

function slicePastHeading(
  doc: MarkdownDocument,
  headingNode: MarkdownHeading,
): MarkdownBlockNode[] {
  const children = doc.children;
  const startIdx = children.indexOf(headingNode);
  if (startIdx < 0) return [];
  const out: MarkdownBlockNode[] = [];
  for (let i = startIdx + 1; i < children.length; i++) {
    const node = children[i];
    if (node.type === 'heading') break;
    out.push(node);
  }
  return out;
}

/**
 * Parse `source` and return the body of the heading whose source range
 * covers `lineNumber` (1-indexed). Returns `null` if `lineNumber` isn't
 * on a heading line.
 */
export function findBlockSliceAtLine(
  source: string,
  lineNumber: number,
): MarkdownBlockNode[] | null {
  const doc = parseMarkdown(source);
  for (const node of doc.children) {
    if (node.type !== 'heading') continue;
    const pos = node.position;
    if (!pos) continue;
    if (pos.start.line <= lineNumber && pos.end.line >= lineNumber) {
      return slicePastHeading(doc, node);
    }
  }
  return null;
}

/**
 * Parse `source` and return the body of the Nth top-level heading
 * (0-indexed). Used by the WYSIWYG path, which knows the heading's
 * index in the Tiptap doc but not its source line.
 */
export function findBlockSliceByHeadingIndex(
  source: string,
  headingIndex: number,
): MarkdownBlockNode[] | null {
  const doc = parseMarkdown(source);
  let seen = 0;
  for (const node of doc.children) {
    if (node.type !== 'heading') continue;
    if (seen === headingIndex) {
      return slicePastHeading(doc, node);
    }
    seen++;
  }
  return null;
}

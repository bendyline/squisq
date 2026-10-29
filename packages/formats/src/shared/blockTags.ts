/**
 * Block tags in documents shown as documents.
 *
 * A `{[…]}` tag types the content around it for the player: a paragraph that
 * is nothing but a tag (`{[quote]}`) opens a heading-less block, and a single
 * tag at the end of an unannotated section — on its own line or glued to the
 * last sentence (`… grew 40% {[statHighlight]}`) — becomes that section's
 * template. A format that shows the Markdown as a document has nothing to
 * type, and printing the tag would show markup as prose, so these are removed.
 * As in the player, tags count only at the top level: inside a list or a quote
 * they are text.
 */

import type { MarkdownBlockNode, MarkdownDocument } from '@bendyline/squisq/markdown';
import {
  detectPromotableBodyAnnotation,
  hasTemplate,
  isMediaAnnotationName,
  parseStandaloneAnnotation,
} from '@bendyline/squisq/doc';

export interface BlockTagOptions {
  /**
   * Keep standalone `{[audio …]}` / `{[video …]}` tags, for a renderer that
   * turns each into its file's player. Default: removed, like other tags.
   */
  keepMedia?: boolean;
}

/** The document without its block tags; the same object when it has none. */
export function withoutBlockTags(
  doc: MarkdownDocument,
  options: BlockTagOptions = {},
): MarkdownDocument {
  const children = withoutPromotedTags(doc.children);
  const kept = children.filter((node) => !isRemovedTag(node, options));
  return kept.length === doc.children.length && children === doc.children
    ? doc
    : { ...doc, children: kept };
}

function isRemovedTag(node: MarkdownBlockNode, options: BlockTagOptions): boolean {
  const tag = parseStandaloneAnnotation(node)?.template;
  if (!tag) return false;
  if (isMediaAnnotationName(tag)) return !options.keepMedia;
  return hasTemplate(tag);
}

/**
 * Strip the tag `markdownToDoc` would promote from each unannotated section:
 * its body runs from the heading to the next heading of any depth.
 */
function withoutPromotedTags(children: MarkdownBlockNode[]): MarkdownBlockNode[] {
  const out: MarkdownBlockNode[] = [];
  let changed = false;
  let index = 0;
  while (index < children.length) {
    const node = children[index++];
    out.push(node);
    if (node.type !== 'heading' || node.templateAnnotation?.template) continue;
    let end = index;
    while (end < children.length && children[end].type !== 'heading') end++;
    const body = children.slice(index, end);
    const found = detectPromotableBodyAnnotation(body);
    const tag = found?.data.template;
    if (found && tag && !isMediaAnnotationName(tag) && hasTemplate(tag)) {
      out.push(...found.strippedContents);
      changed = true;
    } else {
      out.push(...body);
    }
    index = end;
  }
  return changed ? out : children;
}

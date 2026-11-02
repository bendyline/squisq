import { getHTMLFromFragment } from '@tiptap/core';
import { Fragment, type Node } from '@tiptap/pm/model';

/**
 * ProseMirror keeps unchanged nodes by identity. Cache their HTML so a keystroke
 * only builds DOM for the edited top-level block, while the existing Markdown
 * bridge and source-preservation pipeline still receive the complete document
 * synchronously. Weak keys release replaced documents and obsolete revisions.
 */
export function createDocumentHtmlSerializer(): (doc: Node) => string {
  const cache = new WeakMap<Node, string>();
  return (doc) => {
    // Marks on block nodes may span siblings in DOMSerializer. Preserve that
    // grouping with the original whole-fragment serializer in that rare case.
    let hasBlockMarks = false;
    doc.forEach((node) => {
      hasBlockMarks ||= node.marks.length > 0;
    });
    if (hasBlockMarks) return getHTMLFromFragment(doc.content, doc.type.schema);

    const parts: string[] = [];
    doc.forEach((node) => {
      let html = cache.get(node);
      if (html === undefined) {
        html = getHTMLFromFragment(Fragment.from(node), doc.type.schema);
        cache.set(node, html);
      }
      parts.push(html);
    });
    return parts.join('');
  };
}

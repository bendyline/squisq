/**
 * wysiwygMinimalSync
 *
 * Load new content into the Write view by replacing only the range that
 * differs from what it already shows, instead of resetting the whole
 * document. Unchanged nodes keep their DOM and widgets (a Mermaid diagram or
 * scene canvas does not remount), the selection and scroll position map
 * through the change, and the update is one undo step of its own.
 */

import { createDocument, type Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { needsTrailingParagraph, withoutTrailingParagraph } from './trailingParagraph';

/**
 * `next` ending with the editor's own trailing paragraph (the same node) when
 * the editor would append one to it anyway.
 *
 * The source never contains that paragraph, so without this every diff ran to
 * the end of the document: the replaced range swallowed the block before it,
 * and a tray clip or diagram there lost its identity and remounted — an Apply
 * in the media-edit dialog collapsed the clip's tray pill.
 */
function keepTrailingParagraph(current: PMNode, next: PMNode): PMNode {
  const trailing = current.lastChild;
  if (!trailing || withoutTrailingParagraph(current) === current) return next;
  if (!needsTrailingParagraph(next)) return next;
  return next.copy(next.content.append(Fragment.from(trailing)));
}

/**
 * Replace the editor's document with `content` (Tiptap HTML) as a minimal
 * change. Falls back to a full `setContent` when the documents cannot be
 * diffed or the change does not fit.
 */
export function replaceDocumentMinimal(
  editor: Editor,
  content: string,
  frontmatter?: string,
): void {
  const { state } = editor;
  try {
    const next = keepTrailingParagraph(
      state.doc,
      createDocument(
        content,
        editor.schema,
        {},
        {
          errorOnInvalidContent: editor.options.enableContentCheck,
        },
      ),
    );
    const start = state.doc.content.findDiffStart(next.content);
    const metadataChanged =
      frontmatter !== undefined && state.doc.attrs.sourceFrontmatter !== frontmatter;
    if (start === null && !metadataChanged) return;
    const tr = state.tr;
    if (metadataChanged) tr.setDocAttribute('sourceFrontmatter', frontmatter);
    if (start !== null) {
      const end = state.doc.content.findDiffEnd(next.content);
      if (!end) throw new Error('Documents differ but have no common end.');
      let endA = end.a;
      let endB = end.b;
      // The two scans can overlap when the change repeats text next to it;
      // widen both ends past the start so the slice stays well-formed.
      const overlap = start - Math.min(endA, endB);
      if (overlap > 0) {
        endA += overlap;
        endB += overlap;
      }
      tr.replace(start, endA, next.slice(start, endB));
    }
    closeHistory(tr);
    tr.setMeta('preventUpdate', true);
    editor.view.dispatch(tr);
  } catch {
    editor
      .chain()
      .setContent(content)
      .command(({ tr }) => {
        if (frontmatter !== undefined) tr.setDocAttribute('sourceFrontmatter', frontmatter);
        return true;
      })
      .run();
  }
}

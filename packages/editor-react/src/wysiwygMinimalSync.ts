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
import { closeHistory } from '@tiptap/pm/history';

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
    const next = createDocument(
      content,
      editor.schema,
      {},
      {
        errorOnInvalidContent: editor.options.enableContentCheck,
      },
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

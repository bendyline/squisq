/**
 * insertMediaBlock — drop a recorded clip into the WYSIWYG editor as a
 * *top-level* block, not at the raw caret position.
 *
 * The recorder's media nodes (`TiptapVideo` / `TiptapAudio`) are block
 * atoms. A plain `insertContent` at a caret that happens to sit inside a
 * list item (or blockquote) nests the atom inside that container — and
 * `tiptapToMarkdown`'s list serializer emits only the item's inline text,
 * so the nested `<video>` / `<audio>` is silently dropped on the next
 * sync and never reaches the markdown source (so it also never shows up
 * as a timeline clip). Lifting the insertion to the position right after
 * the caret's top-level ancestor keeps the tag at document level, where
 * the serializer's block-media handler round-trips it.
 */
import type { Editor } from '@tiptap/core';

export interface MediaNodeSpec {
  type: 'video' | 'audio';
  attrs: Record<string, unknown>;
}

/**
 * Insert one or more block-media atoms at the top level, in order, in a single
 * transaction. Inserting them one-by-one would break for the second node: the
 * first insert leaves a NodeSelection at depth 0, so a follow-up call would
 * compute the document end and separate a pair that must stay adjacent (e.g. a
 * screen clip immediately followed by its camera picture-in-picture).
 */
export function insertMediaBlocks(editor: Editor, nodes: MediaNodeSpec[]): void {
  if (nodes.length === 0) return;
  const { $from } = editor.state.selection;
  // `after(1)` is the position immediately after the depth-1 (top-level)
  // ancestor of the selection — after the whole list / blockquote /
  // paragraph the caret is in. Fall back to the document end for the rare
  // depth-0 (node) selection.
  const pos = $from.depth >= 1 ? $from.after(1) : editor.state.doc.content.size;
  editor.chain().focus().insertContentAt(pos, nodes).run();
}

export function insertMediaBlock(editor: Editor, node: MediaNodeSpec): void {
  insertMediaBlocks(editor, [node]);
}

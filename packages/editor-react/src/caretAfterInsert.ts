/**
 * Where the caret goes after a picture, player or embed is inserted.
 *
 * ProseMirror selects an inserted atom (a picture, a player) when nothing
 * after it can hold a text caret — the usual case for something added at the
 * end of a document — and an inserted link paragraph (an online video) keeps
 * the caret at the end of its link. Either way the first key the author types
 * next undoes the insert: it replaces the picture, or joins the link's
 * paragraph so the video turns back into a bare URL. These helpers move the
 * caret to the empty line after the block instead: the line that is already
 * there when there is one (usually the trailing paragraph, which is not saved
 * unless typed into), or a new one.
 */
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

type CaretView = Pick<EditorView, 'state' | 'dispatch'>;

/** Media node types that must never be left node-selected after an insert. */
const MEDIA_NODES = new Set(['image', 'video', 'audio']);

/**
 * Put the caret on an empty line after the block that holds the selection:
 * the selected node, or the textblock the caret is in. Does nothing where a
 * paragraph cannot follow that block.
 */
export function caretAfterInsertedBlock(view: CaretView): void {
  const { state } = view;
  const { selection } = state;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return;
  const end = selection instanceof NodeSelection ? selection.to : selection.$to.after();
  const $end = state.doc.resolve(end);
  const next = $end.nodeAfter;
  const tr = state.tr;
  if (!next || next.type !== paragraph || next.content.size > 0) {
    if (!$end.parent.canReplaceWith($end.index(), $end.index(), paragraph)) return;
    tr.insert(end, paragraph.create());
  }
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView());
}

/**
 * After a paste or drop: when the media just inserted ended up node-selected,
 * move the caret after it. A caret the author placed elsewhere is left alone.
 */
export function caretAfterSelectedMedia(view: CaretView): void {
  const { selection } = view.state;
  if (selection instanceof NodeSelection && MEDIA_NODES.has(selection.node.type.name)) {
    caretAfterInsertedBlock(view);
  }
}

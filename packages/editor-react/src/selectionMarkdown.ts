import { DOMSerializer, Fragment } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { tiptapToMarkdown } from './tiptapBridge';

/** Serialize selected content rather than flattening its structure to plain text. */
export function selectionMarkdown(state: EditorState): string {
  const { selection } = state;
  if (selection.empty) return '';
  const { $from, $to, from, to } = selection;
  let fragment = selection.content().content;
  let inline = false;
  if ($from.sameParent($to) && $from.parent.isTextblock) {
    // A whole heading carries its level and annotations. A few words within
    // it carry only inline marks: replacing them must not insert a new block.
    // Isolate a single textblock from list/table ancestors as well, so editing
    // text in one cell does not ask a host to replace it with an entire table.
    inline = $from.parentOffset !== 0 || $to.parentOffset !== $from.parent.content.size;
    fragment = !inline ? Fragment.from($from.parent) : state.doc.slice(from, to).content;
  }
  const container = document.createElement('div');
  // The bridge serializes inline marks inside a textblock, not bare HTML.
  const target = inline ? container.appendChild(document.createElement('p')) : container;
  target.append(DOMSerializer.fromSchema(state.schema).serializeFragment(fragment));
  return tiptapToMarkdown(container.innerHTML).trimEnd();
}

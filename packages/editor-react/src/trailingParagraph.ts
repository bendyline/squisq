/**
 * TrailingParagraphExtension — keeps somewhere to type after a document's
 * last block when that block offers none of its own.
 *
 * Most rich blocks in the Write view are a hidden source node with a widget
 * drawn after it: a `diagram`, `mermaid`, `tree` or `timeline` fence, a code
 * snippet, an SVG island, a data card's link paragraph. ProseMirror still
 * treats that hidden text as the last place a caret can go, so when one of
 * them ends the document, Ctrl+End, the arrow keys and a click below all put
 * the caret inside invisible text or back above the widget, and a
 * double-click below selects the hidden source so the next keystroke deletes
 * the block. Tables, media and template headings (a drawing's canvas sits
 * under its heading) have the same problem with less drama.
 *
 * The extension appends one empty paragraph after such a block:
 *
 * - after any transaction that changed the document, as an appended step
 *   that is not added to the undo history, and
 * - once when the editor is created, with Tiptap's `preventUpdate` meta so
 *   merely opening a document never reports an edit.
 *
 * The Markdown bridge keeps an author's own trailing blank lines as empty
 * paragraphs, so this one is remembered by identity and left out when the
 * document is saved ({@link withoutTrailingParagraph}): the file is unchanged
 * until the author types into it.
 */

import { Extension } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { dataLinkHrefOf } from './dataCard/DataCardExtension';

export const TRAILING_PARAGRAPH_KEY = new PluginKey('squisq-trailing-paragraph');

/** Last-block types whose own keyboard handling already leaves them. */
const SELF_EXITING_BLOCKS = new Set(['bulletList', 'orderedList', 'taskList', 'blockquote']);

/**
 * True when the document's last top-level block leaves no visible place to
 * keep typing after it.
 */
export function needsTrailingParagraph(doc: PMNode): boolean {
  const last = doc.lastChild;
  if (!last) return false;
  const name = last.type.name;
  // A paragraph is a place to type — unless it is a data card's link line,
  // which the card hides and draws over.
  if (name === 'paragraph') return dataLinkHrefOf(last) !== null;
  // A template heading hosts a widget under itself (drawing canvas, data
  // table); a plain heading is followed by a paragraph on Enter as usual.
  if (name === 'heading') {
    return Boolean((last.attrs as { dataTemplate?: string | null }).dataTemplate);
  }
  if (SELF_EXITING_BLOCKS.has(name)) return false;
  // Code fences (most of them draw a widget over hidden text), tables,
  // images, video, rules: nothing after them to put a caret in.
  return true;
}

/**
 * The paragraphs this extension appended. ProseMirror shares unchanged nodes
 * between documents, so the same object stays the last child until the
 * author types into it (which replaces it) — in this document and in every
 * later or earlier version of it.
 */
const appendedParagraphs = new WeakSet<PMNode>();

/**
 * An empty paragraph to end the document with, left out of the saved
 * Markdown until something is typed into it. Commands that put the caret
 * below a block they inserted at the end use this too.
 */
export function createTrailingParagraph(schema: Schema): PMNode | null {
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return null;
  const node = paragraph.create();
  appendedParagraphs.add(node);
  return node;
}

/** A transaction appending the empty paragraph, or null when none is needed. */
export function trailingParagraphTransaction(state: EditorState): Transaction | null {
  if (!needsTrailingParagraph(state.doc)) return null;
  const node = createTrailingParagraph(state.schema);
  if (!node) return null;
  return state.tr
    .insert(state.doc.content.size, node)
    .setMeta(TRAILING_PARAGRAPH_KEY, true)
    .setMeta('addToHistory', false);
}

/**
 * `doc` without the empty paragraph this extension appended, if it still ends
 * the document untouched. Serialize this, not the editor's document, so a
 * place to type is never written to the file as a blank line.
 */
export function withoutTrailingParagraph(doc: PMNode): PMNode {
  const last = doc.lastChild;
  if (!last || !appendedParagraphs.has(last) || last.content.size > 0) return doc;
  return doc.copy(doc.content.cut(0, doc.content.size - last.nodeSize));
}

export const TrailingParagraphExtension = Extension.create({
  name: 'squisqTrailingParagraph',

  onCreate() {
    if (!this.editor.isEditable) return;
    const tr = trailingParagraphTransaction(this.editor.state);
    // Opening a document is not an edit: no update event, no undo step.
    if (tr) this.editor.view.dispatch(tr.setMeta('preventUpdate', true));
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: TRAILING_PARAGRAPH_KEY,
        appendTransaction: (transactions, _oldState, newState) => {
          if (!editor.isEditable) return null;
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => tr.getMeta(TRAILING_PARAGRAPH_KEY))) return null;
          return trailingParagraphTransaction(newState);
        },
      }),
    ];
  },
});

export default TrailingParagraphExtension;

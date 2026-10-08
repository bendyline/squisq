/**
 * Pasting a provider's embed code into the Write view.
 *
 * YouTube's Share → Embed (and Vimeo's, Loom's …) copies an `<iframe>`
 * snippet. Pasted as-is it would land as a paragraph of literal HTML; instead
 * it becomes the paragraph-that-is-only-a-link form — a link to the video's
 * page — which `VideoEmbedExtension` plays and every other renderer shows as a
 * link. A pasted bare URL needs no help: it lands as a URL (Tiptap autolinks
 * it), and on an empty line that is already the embed form.
 */

import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { parseVideoEmbedInput } from '@bendyline/squisq/markdown';
import { videoEmbedParagraphNode } from './videoEmbedParagraph';

/** Clipboard text that is HTML containing an iframe (cheap pre-check). */
function looksLikeEmbedCode(text: string): boolean {
  return /^<(?!https?:)/i.test(text) && /<iframe\b/i.test(text);
}

/**
 * Put a block at the top level: in place of the caret's paragraph when that
 * paragraph is empty, otherwise after the caret's top-level block — never
 * inside a list item or quote. The caret lands at the end of the new block.
 */
export function insertTopLevelBlock(state: EditorState, node: PMNode): Transaction {
  const { $from } = state.selection;
  const tr = state.tr;
  let start: number;
  if ($from.depth < 1) {
    start = state.doc.content.size;
    tr.insert(start, node);
  } else {
    const block = $from.node(1);
    if (block.type.name === 'paragraph' && block.content.size === 0) {
      start = $from.before(1);
      tr.replaceWith(start, $from.after(1), node);
    } else {
      start = $from.after(1);
      tr.insert(start, node);
    }
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(start + node.nodeSize - 1), -1));
  return tr.scrollIntoView();
}

/** Handle a Write-view paste of embed code; false leaves the paste to others. */
export function pasteVideoEmbedCode(view: EditorView, text: string): boolean {
  const trimmed = text.trim();
  if (!looksLikeEmbedCode(trimmed)) return false;
  const found = parseVideoEmbedInput(trimmed);
  if (!found) return false;
  const paragraph = videoEmbedParagraphNode(view.state.schema, found.embed.watchUrl, found.title);
  view.dispatch(insertTopLevelBlock(view.state, paragraph));
  return true;
}

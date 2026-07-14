/** Lossless edits for language-tagged code fences. */

import type { Editor } from '@tiptap/react';
import { findCodeSnippetBlockPos, isCodeSnippetNode } from './CodeSnippetExtension';

export function replaceCodeSnippetText(editor: Editor, blockId: string, nextText: string): boolean {
  const pos = findCodeSnippetBlockPos(editor, blockId);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !isCodeSnippetNode(node)) return false;
  if (node.textContent === nextText) return true;

  const from = pos + 1;
  const to = pos + node.nodeSize - 1;
  const tr =
    nextText.length > 0
      ? editor.state.tr.replaceWith(from, to, editor.state.schema.text(nextText))
      : editor.state.tr.delete(from, to);
  editor.view.dispatch(tr);
  return true;
}

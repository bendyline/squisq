/** ProseMirror write boundary for Mermaid source-backed diagram gestures. */

import type { Editor } from '@tiptap/react';
import { findMermaidDiagramBlockPos, isMermaidDiagramNode } from './MermaidDiagramExtension';
import type { MermaidSourceEditResult } from './mermaidSourceOps';

export function replaceMermaidFenceSource(
  editor: Editor,
  blockId: string,
  nextSource: string,
): boolean {
  const pos = findMermaidDiagramBlockPos(editor, blockId);
  if (pos === null) return false;
  return editor
    .chain()
    .command(({ tr, state }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node || !isMermaidDiagramNode(node) || node.textContent === nextSource) return false;
      const from = pos + 1;
      const to = pos + node.nodeSize - 1;
      if (nextSource) tr.replaceWith(from, to, state.schema.text(nextSource));
      else tr.delete(from, to);
      return true;
    })
    .run();
}

export function applyMermaidSourceEdit(
  editor: Editor,
  blockId: string,
  edit: MermaidSourceEditResult,
): boolean {
  return edit.ok && replaceMermaidFenceSource(editor, blockId, edit.source);
}

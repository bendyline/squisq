/** Live source view for one registered Mermaid code fence. */

import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { findMermaidDiagramBlockPos, isMermaidDiagramNode } from './MermaidDiagramExtension';

export interface MermaidDiagramData {
  /** Mermaid source exactly as stored inside the code block. */
  source: string;
}

export function useMermaidDiagramData(editor: Editor, blockId: string): MermaidDiagramData | null {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onTransaction = () => setVersion((value) => value + 1);
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  return useMemo(() => {
    const pos = findMermaidDiagramBlockPos(editor, blockId);
    if (pos === null) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || !isMermaidDiagramNode(node)) return null;
    return { source: node.textContent };
    // `version` is the transaction-backed invalidation token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, blockId, version]);
}

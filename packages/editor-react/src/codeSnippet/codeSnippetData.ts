/** Live source/language view for one registered code snippet fence. */

import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { findCodeSnippetBlockPos, isCodeSnippetNode } from './CodeSnippetExtension';
import { codeSnippetLanguageLabel, monacoLanguageForFence } from './codeSnippetLanguages';

export interface CodeSnippetData {
  /** Fence language exactly as stored in the ProseMirror node. */
  fenceLanguage: string;
  label: string;
  monacoLanguage: string;
  /** Source exactly as stored inside the code block. */
  source: string;
}

export function useCodeSnippetData(editor: Editor, blockId: string): CodeSnippetData | null {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onTransaction = () => setVersion((value) => value + 1);
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  return useMemo(() => {
    const pos = findCodeSnippetBlockPos(editor, blockId);
    if (pos === null) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || !isCodeSnippetNode(node)) return null;
    const rawLanguage = (node.attrs as { language?: unknown }).language;
    const fenceLanguage = typeof rawLanguage === 'string' ? rawLanguage : '';
    return {
      fenceLanguage,
      label: codeSnippetLanguageLabel(fenceLanguage),
      monacoLanguage: monacoLanguageForFence(fenceLanguage),
      source: node.textContent,
    };
    // `version` is the transaction-backed invalidation token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, blockId, version]);
}

/**
 * Read direction of the tree loop: fence text → outline view.
 *
 * `useTreeViewData` re-derives on every editor transaction; parsing is
 * memoized per PMNode by the extension's WeakMap caches, so untouched
 * fences cost nothing.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Tree } from '@bendyline/squisq/doc';
import { findTreeBlockPos, parseTreeForNode } from './TreeViewExtension';

export interface TreeViewData {
  tree: Tree;
  text: string;
  warnings: string[];
}

/** Live view of one registered tree block; null when it no longer parses. */
export function useTreeViewData(editor: Editor, blockId: string): TreeViewData | null {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor]);

  return useMemo(() => {
    const pos = findTreeBlockPos(editor, blockId);
    if (pos === null) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'codeBlock') return null;
    const tree = parseTreeForNode(node);
    if (!tree) return null;
    return { tree, text: node.textContent, warnings: tree.warnings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, blockId, version]);
}

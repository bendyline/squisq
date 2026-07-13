/**
 * Write direction of the tree loop: outline command → fence rewrite.
 *
 * parse → op → render → verify-reparse → single-transaction fence replace
 * (one undo step). Reuses the generic `replaceAsciiFenceText` (it only
 * touches codeBlock text, attributes untouched).
 */

import type { Editor } from '@tiptap/react';
import { parseTree, renderTree, type Tree } from '@bendyline/squisq/doc';
import { replaceAsciiFenceText } from '../asciiDiagram/asciiDiagramCommands';
import { findTreeBlockPos, parseTreeForNode } from './TreeViewExtension';
import {
  addItemOp,
  indentItemOp,
  moveItemDownOp,
  moveItemUpOp,
  outdentItemOp,
  removeItemOp,
  renameItemOp,
  toggleDirOp,
} from './treeOps';

export type TreeCommand =
  | {
      kind: 'addItem';
      targetId: string;
      position: 'child' | 'siblingAfter';
      label?: string;
      isDir?: boolean;
    }
  | { kind: 'renameItem'; id: string; label: string }
  | { kind: 'indentItem'; id: string }
  | { kind: 'outdentItem'; id: string }
  | { kind: 'moveItemUp'; id: string }
  | { kind: 'moveItemDown'; id: string }
  | { kind: 'removeItem'; id: string }
  | { kind: 'toggleDir'; id: string };

/** Re-export so the widget can rewrite raw fence text without a second copy. */
export { replaceAsciiFenceText as replaceTreeFenceText } from '../asciiDiagram/asciiDiagramCommands';

function countNodes(nodes: readonly Tree['roots'][number][]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countNodes(node.children);
  return n;
}

function applyOp(editor: Editor, blockId: string, op: (t: Tree) => Tree): boolean {
  const pos = findTreeBlockPos(editor, blockId);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'codeBlock') return false;
  const tree = parseTreeForNode(node);
  if (!tree) return false;

  const next = op(tree);
  if (next === tree) return false;
  const rendered = renderTree(next);

  // Verify before committing: the rendered art must re-parse to the same
  // node count, or we'd write a tree the outline can't read back.
  if (countNodes(parseTree(rendered).roots) !== countNodes(next.roots)) return false;

  // Promote the fence language to the explicit `tree` tag so this block's
  // identity survives a later flatten → markdown → re-import round-trip.
  return replaceAsciiFenceText(editor, pos, rendered, 'tree');
}

export function applyTreeCommand(editor: Editor, blockId: string, cmd: TreeCommand): boolean {
  switch (cmd.kind) {
    case 'addItem':
      return applyOp(editor, blockId, (t) =>
        addItemOp(t, cmd.targetId, cmd.position, cmd.label, cmd.isDir),
      );
    case 'renameItem':
      return applyOp(editor, blockId, (t) => renameItemOp(t, cmd.id, cmd.label));
    case 'indentItem':
      return applyOp(editor, blockId, (t) => indentItemOp(t, cmd.id));
    case 'outdentItem':
      return applyOp(editor, blockId, (t) => outdentItemOp(t, cmd.id));
    case 'moveItemUp':
      return applyOp(editor, blockId, (t) => moveItemUpOp(t, cmd.id));
    case 'moveItemDown':
      return applyOp(editor, blockId, (t) => moveItemDownOp(t, cmd.id));
    case 'removeItem':
      return applyOp(editor, blockId, (t) => removeItemOp(t, cmd.id));
    case 'toggleDir':
      return applyOp(editor, blockId, (t) => toggleDirOp(t, cmd.id));
  }
  const _exhaustive: never = cmd;
  void _exhaustive;
  return false;
}

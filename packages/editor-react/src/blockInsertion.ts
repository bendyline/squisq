/**
 * blockInsertion
 *
 * Write-view (ProseMirror) side of block placement: builds the top-level
 * outline of a Tiptap document and resolves where a new block goes for the
 * current selection, using the same rule as the Source view
 * ({@link resolveOutlineInsertion} in `sourceEdits`).
 */

import type { EditorState } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { isContainerTemplate } from '@bendyline/squisq/doc';
import {
  resolveOutlineInsertion,
  type BlockInsertionContext,
  type BlockPlacement,
  type OutlineBlock,
} from './sourceEdits';

/** Top-level blocks of a Write-view document and the position each starts at. */
export function tiptapOutline(doc: ProseMirrorNode): {
  blocks: OutlineBlock[];
  positions: number[];
} {
  const blocks: OutlineBlock[] = [];
  const positions: number[] = [];
  doc.forEach((node, offset) => {
    positions.push(offset);
    if (node.type.name === 'heading') {
      const attrs = node.attrs as { level?: number; dataTemplate?: string | null };
      blocks.push({
        headingDepth: attrs.level ?? 1,
        container: isContainerTemplate(attrs.dataTemplate ?? undefined),
      });
    } else {
      blocks.push({ headingDepth: null, container: false });
    }
  });
  return { blocks, positions };
}

/** Where a block goes for the current Write-view selection. */
export function tiptapBlockInsertion(
  state: EditorState,
  placement: BlockPlacement,
): BlockInsertionContext & { pos: number } {
  const { blocks, positions } = tiptapOutline(state.doc);
  const { $to } = state.selection;
  // Inside a block, index(0) is that block. Between top-level blocks (a node
  // or gap selection) the cursor belongs to the block before the position.
  const cursorIndex = $to.depth > 0 ? $to.index(0) : $to.index(0) - 1;
  const { index, ...context } = resolveOutlineInsertion(blocks, cursorIndex, placement);
  const pos = index < positions.length ? (positions[index] ?? 0) : state.doc.content.size;
  return { pos, ...context };
}

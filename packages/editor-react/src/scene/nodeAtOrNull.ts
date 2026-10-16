import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * `doc.nodeAt(pos)` for a position that may be stale. ProseMirror THROWS
 * (`Position N outside of fragment`) for a position past the end of the
 * document rather than returning null, and scene widgets hold positions
 * across transactions that can shrink the document under them.
 */
export function nodeAtOrNull(doc: PMNode, pos: number): PMNode | null {
  if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null;
  return doc.nodeAt(pos);
}

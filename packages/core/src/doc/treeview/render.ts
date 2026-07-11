/**
 * ASCII tree renderer: nested nodes → clean tree art.
 *
 * A deterministic depth-first walk emitting rail/branch prefixes. The
 * fixpoint is structural: `parseTree(renderTree(t))` preserves the node
 * hierarchy + labels + comments, and `renderTree(parseTree(renderTree(t)))`
 * is byte-identical (idempotent after one normalization cycle). Unlike the
 * diagram renderer there is no spatial layout, so jitter is impossible.
 */

import { ASCII_TREE_VOCAB, UNICODE_TREE_VOCAB } from './chars.js';
import type { Tree, TreeNode } from './types.js';

export interface RenderTreeOptions {
  /** Character vocabulary; defaults to the tree's own detected style. */
  style?: 'unicode' | 'ascii';
}

export function renderTree(tree: Tree, options: RenderTreeOptions = {}): string {
  const vocab = (options.style ?? tree.style) === 'ascii' ? ASCII_TREE_VOCAB : UNICODE_TREE_VOCAB;
  const lines: string[] = [];

  const label = (node: TreeNode): string =>
    node.comment ? `${node.label}  # ${node.comment}` : node.label;

  const walk = (nodes: readonly TreeNode[], prefix: string): void => {
    nodes.forEach((node, i) => {
      const last = i === nodes.length - 1;
      lines.push(prefix + (last ? vocab.elbow : vocab.tee) + label(node));
      walk(node.children, prefix + (last ? vocab.gap : vocab.rail));
    });
  };

  // Roots sit at column 0 with no connector; their children get branches.
  for (const root of tree.roots) {
    lines.push(label(root));
    walk(root.children, '');
  }

  return lines.join('\n');
}

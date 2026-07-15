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

/**
 * Render-time text normalization — the ONLY normalization applied to authored
 * text, and applied so that `parseTree(renderTree(t))` returns `t`.
 *
 * Whitespace runs collapse to one space, then trim. A node's text occupies a
 * single line, so a newline/tab has no meaning in the art; more importantly
 * the parser reads a GAP (≥2 spaces) before `#`/`<--`/`//` as the comment
 * delimiter, so a label carrying a gap of its own would re-parse as a
 * comment. Collapsing makes that impossible: after normalization the only
 * gap on a line is the one this renderer emits.
 *
 * Comment MARKERS inside a label (`release # notes`) are deliberately NOT
 * stripped or escaped — with the gap rule they are unambiguous, so such
 * labels survive verbatim, matching how the diagram codec keeps `stdin | out`
 * intact by disambiguating structure from text instead of escaping it.
 */
function normalizeText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

export function renderTree(tree: Tree, options: RenderTreeOptions = {}): string {
  const vocab = (options.style ?? tree.style) === 'ascii' ? ASCII_TREE_VOCAB : UNICODE_TREE_VOCAB;
  const lines: string[] = [];

  const label = (node: TreeNode): string => {
    const text = normalizeText(node.label);
    const comment = node.comment ? normalizeText(node.comment) : '';
    return comment ? `${text}  # ${comment}` : text;
  };

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

/**
 * Public types for the ASCII treeview codec.
 *
 * A tree is a hierarchy of labelled nodes (file trees, dependency trees,
 * category outlines). Unlike the diagram codec's spatial grid model, the
 * tree model is a plain nested structure — rendering is a deterministic
 * tree-walk, so the parse↔render fixpoint is structural and trivially
 * byte-stable.
 */

export interface TreeNode {
  /**
   * Stable id: slug of the label, deduplicated with `-2`/`-3` suffixes in
   * document (depth-first) order. Identical art re-parses to identical ids
   * (the outline widget's selection resolves by id).
   */
  id: string;
  /** Display label, verbatim (may keep a trailing `/`). */
  label: string;
  /** Child nodes (empty for leaves). */
  children: TreeNode[];
  /** True when this node reads as a container (trailing `/` or has children). */
  isDir?: boolean;
  /** Trailing `# …` / `<-- …` comment, preserved across round-trips. */
  comment?: string;
}

export interface Tree {
  /** Top-level nodes (a forest — usually one root for a file tree). */
  roots: TreeNode[];
  /** Character vocabulary detected in the source; render emits the same. */
  style: 'unicode' | 'ascii';
  /** Non-fatal parse notes (ragged dedents, dropped lines, …). */
  warnings: string[];
}

export interface TreeDetection {
  isTree: boolean;
  /** Present when `isTree` — avoids a second parse in callers. */
  tree?: Tree;
  /** Machine-greppable accept/reject reasons. */
  reasons: string[];
}

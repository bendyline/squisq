/**
 * Pure outline operations over the tree model — the write-direction half of
 * the fence-is-source-of-truth loop:
 *
 *   fence text → parseTree → op → renderTree → fence text
 *
 * Every op returns a NEW Tree (inputs untouched). These are the genuinely
 * new operations with no diagram analog: indent / outdent (re-parent a node
 * carrying its subtree), move-up / move-down (reorder siblings), plus
 * add / rename / remove / toggle-directory. Connector rails re-derive in
 * render, so ops only touch structure + labels.
 */

import type { Tree, TreeNode } from '@bendyline/squisq/doc';

/** Make an arbitrary rename safe as a tree label: no connector glyphs / newlines. */
export function sanitizeTreeLabel(label: string): string {
  return label
    .replace(/[├└│─┃┏┓┗┛┣┫┳┻╋╰╭╮╯|`]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cloneNode(n: TreeNode): TreeNode {
  return {
    id: n.id,
    label: n.label,
    children: n.children.map(cloneNode),
    ...(n.isDir ? { isDir: true } : {}),
    ...(n.comment ? { comment: n.comment } : {}),
  };
}
function cloneTree(t: Tree): Tree {
  return { roots: t.roots.map(cloneNode), style: t.style, warnings: [...t.warnings] };
}

interface Loc {
  siblings: TreeNode[];
  index: number;
  node: TreeNode;
  parent: TreeNode | null;
}

export type TreeDropPosition = 'before' | 'child' | 'after';

/** Locate a node by id in a (cloned) tree, returning its sibling array + index + parent. */
function locate(roots: TreeNode[], id: string, parent: TreeNode | null = null): Loc | null {
  for (let i = 0; i < roots.length; i++) {
    if (roots[i].id === id) return { siblings: roots, index: i, node: roots[i], parent };
    const inner = locate(roots[i].children, id, roots[i]);
    if (inner) return inner;
  }
  return null;
}

function markDir(n: TreeNode): void {
  n.isDir = n.label.endsWith('/') || n.children.length > 0;
}

function containsNode(node: TreeNode, id: string): boolean {
  return node.id === id || node.children.some((child) => containsNode(child, id));
}

export function renameItemOp(tree: Tree, id: string, label: string): Tree {
  const clean = sanitizeTreeLabel(label);
  const next = cloneTree(tree);
  const loc = locate(next.roots, id);
  if (!loc || clean.length === 0 || clean === loc.node.label) return tree;
  loc.node.label = clean;
  markDir(loc.node);
  return next;
}

export function addItemOp(
  tree: Tree,
  targetId: string,
  position: 'child' | 'siblingAfter',
  label?: string,
  isDir?: boolean,
): Tree {
  const next = cloneTree(tree);
  const loc = locate(next.roots, targetId);
  if (!loc) return tree;
  let name = sanitizeTreeLabel(label ?? '') || freshLabel(next, isDir);
  // A folder carries a trailing slash so it re-parses as a directory.
  if (isDir && !name.endsWith('/')) name += '/';
  const node: TreeNode = {
    id: `__new-${name}`,
    label: name,
    children: [],
    ...(isDir ? { isDir: true } : {}),
  };
  if (position === 'child') {
    loc.node.children.push(node);
    markDir(loc.node);
  } else {
    loc.siblings.splice(loc.index + 1, 0, node);
  }
  return next;
}

export function removeItemOp(tree: Tree, id: string): Tree {
  const next = cloneTree(tree);
  const loc = locate(next.roots, id);
  if (!loc) return tree;
  loc.siblings.splice(loc.index, 1);
  if (loc.parent) markDir(loc.parent);
  return next;
}

/** Node becomes the last child of its immediate preceding sibling. */
export function indentItemOp(tree: Tree, id: string): Tree {
  const next = cloneTree(tree);
  const loc = locate(next.roots, id);
  if (!loc || loc.index === 0) return tree; // nothing to indent under
  const [moved] = loc.siblings.splice(loc.index, 1);
  const newParent = loc.siblings[loc.index - 1];
  newParent.children.push(moved);
  markDir(newParent);
  return next;
}

/** Node becomes a sibling of its parent, inserted directly after it (subtree carried). */
export function outdentItemOp(tree: Tree, id: string): Tree {
  const next = cloneTree(tree);
  const loc = locate(next.roots, id);
  if (!loc || !loc.parent) return tree; // roots can't outdent
  const grand = locate(next.roots, loc.parent.id);
  if (!grand) return tree;
  const [moved] = loc.siblings.splice(loc.index, 1);
  grand.siblings.splice(grand.index + 1, 0, moved);
  markDir(loc.parent);
  return next;
}

/**
 * Move a node and its complete subtree relative to any other node. Dropping
 * before/after adopts the target's parent; dropping as a child appends to the
 * target. A node can never be moved into its own subtree.
 */
export function moveItemOp(
  tree: Tree,
  id: string,
  targetId: string,
  position: TreeDropPosition,
): Tree {
  const currentSource = locate(tree.roots, id);
  const currentTarget = locate(tree.roots, targetId);
  if (
    !currentSource ||
    !currentTarget ||
    id === targetId ||
    containsNode(currentSource.node, targetId)
  ) {
    return tree;
  }

  // Avoid a fence rewrite when the drop describes the node's current slot.
  if (currentSource.siblings === currentTarget.siblings) {
    if (position === 'before' && currentSource.index === currentTarget.index - 1) return tree;
    if (position === 'after' && currentSource.index === currentTarget.index + 1) return tree;
  }
  if (
    position === 'child' &&
    currentSource.parent?.id === currentTarget.node.id &&
    currentSource.index === currentSource.siblings.length - 1
  ) {
    return tree;
  }

  const next = cloneTree(tree);
  const source = locate(next.roots, id);
  if (!source) return tree;
  const [moved] = source.siblings.splice(source.index, 1);
  if (source.parent) markDir(source.parent);

  // Locate again after removal so same-sibling indices are current.
  const target = locate(next.roots, targetId);
  if (!target) return tree;
  if (position === 'child') {
    target.node.children.push(moved);
    markDir(target.node);
  } else {
    target.siblings.splice(target.index + (position === 'after' ? 1 : 0), 0, moved);
  }
  return next;
}

export function moveItemUpOp(tree: Tree, id: string): Tree {
  const next = cloneTree(tree);
  const loc = locate(next.roots, id);
  if (!loc || loc.index === 0) return tree;
  [loc.siblings[loc.index - 1], loc.siblings[loc.index]] = [
    loc.siblings[loc.index],
    loc.siblings[loc.index - 1],
  ];
  return next;
}

export function moveItemDownOp(tree: Tree, id: string): Tree {
  const next = cloneTree(tree);
  const loc = locate(next.roots, id);
  if (!loc || loc.index >= loc.siblings.length - 1) return tree;
  [loc.siblings[loc.index], loc.siblings[loc.index + 1]] = [
    loc.siblings[loc.index + 1],
    loc.siblings[loc.index],
  ];
  return next;
}

/** Toggle the trailing-slash directory marker on a node's label. */
export function toggleDirOp(tree: Tree, id: string): Tree {
  const next = cloneTree(tree);
  const loc = locate(next.roots, id);
  if (!loc) return tree;
  loc.node.label = loc.node.label.endsWith('/')
    ? loc.node.label.slice(0, -1)
    : `${loc.node.label}/`;
  markDir(loc.node);
  return next;
}

function freshLabel(tree: Tree, isDir?: boolean): string {
  const labels = new Set<string>();
  const walk = (ns: TreeNode[]): void => ns.forEach((n) => (labels.add(n.label), walk(n.children)));
  walk(tree.roots);
  const base = isDir ? 'folder' : 'item';
  let i = 1;
  while (labels.has(`${base}${i}`) || labels.has(`${base}${i}/`)) i++;
  return `${base}${i}`;
}

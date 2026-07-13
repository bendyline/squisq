/**
 * Mapping between the tree model and the template/layer data model, plus a
 * nested-markdown-list → tree walker (none exists in core — `extractListItems`
 * flattens, losing depth).
 */

import type { MarkdownBlockNode, MarkdownList, MarkdownListItem } from '../../markdown/types.js';
import { extractPlainText } from '../../markdown/utils.js';
import type { Tree, TreeNode } from './types.js';

/** JSON-serializable tree item carried on `templateData.items` / a `TreeLayer`. */
export interface TreeItem {
  id: string;
  label: string;
  isDir?: boolean;
  comment?: string;
  children: TreeItem[];
}

/** Tree model → template/layer items (structure-preserving). */
export function treeToTemplateData(tree: Tree): { items: TreeItem[] } {
  return { items: tree.roots.map(toItem) };
}

function toItem(node: TreeNode): TreeItem {
  return {
    id: node.id,
    label: node.label,
    ...(node.isDir ? { isDir: true } : {}),
    ...(node.comment ? { comment: node.comment } : {}),
    children: node.children.map(toItem),
  };
}

/** Template/layer items → tree model (editor write-back / render). */
export function treeFromTemplateData(
  items: readonly TreeItem[],
  options: { style?: 'unicode' | 'ascii' } = {},
): Tree {
  const roots = items.map(fromItem);
  return { roots, style: options.style ?? 'unicode', warnings: [] };
}

function fromItem(item: TreeItem): TreeNode {
  const children = Array.isArray(item.children) ? item.children.map(fromItem) : [];
  return {
    id: typeof item.id === 'string' && item.id ? item.id : 'node',
    label: typeof item.label === 'string' ? item.label : '',
    children,
    isDir: item.isDir === true || children.length > 0,
    ...(item.comment ? { comment: item.comment } : {}),
  };
}

/**
 * Recursively convert a nested markdown bullet list into a tree. Used by
 * `deriveTemplateInputs` when an author explicitly `{[tree]}`-annotates a
 * block whose body is a nested list rather than a fence.
 */
export function treeFromMarkdownList(list: MarkdownList): Tree {
  const usedIds = new Map<string, number>();
  const slugify = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node';
  const idFor = (label: string): string => {
    const base = slugify(label.replace(/\/$/, ''));
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  const itemToNode = (item: MarkdownListItem): TreeNode => {
    // The item's own label = its first non-list block's plain text.
    const labelNode = item.children.find((c) => c.type !== 'list');
    const label = labelNode ? extractPlainText(labelNode).trim() : '';
    const childLists = item.children.filter((c): c is MarkdownList => c.type === 'list');
    const children: TreeNode[] = [];
    for (const cl of childLists) for (const ci of cl.children) children.push(itemToNode(ci));
    return {
      id: idFor(label),
      label,
      children,
      isDir: label.endsWith('/') || children.length > 0,
    };
  };

  return { roots: list.children.map(itemToNode), style: 'unicode', warnings: [] };
}

/** Find the first top-level markdown list in a block's body, if any. */
export function findFirstList(contents: MarkdownBlockNode[] | undefined): MarkdownList | undefined {
  return contents?.find((n): n is MarkdownList => n.type === 'list');
}

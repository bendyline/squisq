/**
 * Markdown Tree Utilities
 *
 * Helper functions for traversing and querying the MarkdownDocument tree.
 * All functions are pure and operate on the JSON node interfaces.
 */

import type { MarkdownNode, MarkdownDocument } from './types.js';

/**
 * Get the children of any markdown node, if it has children.
 * Returns an empty array for leaf nodes (text, code, break, etc.).
 *
 * This is useful for generic tree walking where you don't want to
 * check the specific node type.
 */
export function getChildren(node: MarkdownNode): MarkdownNode[] {
  if ('children' in node && Array.isArray(node.children)) {
    return node.children as MarkdownNode[];
  }
  return [];
}

/**
 * Walk the markdown tree depth-first, calling the visitor for each node.
 *
 * The visitor receives the current node and its parent. Return `true`
 * from the visitor to skip the node's children (prune).
 *
 * @param node - The root node to start walking from
 * @param visitor - Called for each node; return true to skip children
 * @param parent - (internal) Parent node
 */
export function walkMarkdownTree(
  node: MarkdownNode,
  visitor: (node: MarkdownNode, parent?: MarkdownNode) => void | boolean,
  parent?: MarkdownNode,
): void {
  const skip = visitor(node, parent);
  if (skip === true) return;

  const children = getChildren(node);
  for (const child of children) {
    walkMarkdownTree(child, visitor, node);
  }
}

/**
 * Find all nodes of a specific type in the tree.
 *
 * @param root - The document or node to search within
 * @param type - The node type to find (e.g., 'heading', 'link', 'text')
 * @returns Array of matching nodes
 *
 * @example
 * ```ts
 * const headings = findNodesByType(doc, 'heading');
 * const links = findNodesByType(doc, 'link');
 * ```
 */
export function findNodesByType<T extends MarkdownNode>(
  root: MarkdownNode,
  type: T['type'],
): T[] {
  const results: T[] = [];
  walkMarkdownTree(root, (node) => {
    if (node.type === type) {
      results.push(node as T);
    }
  });
  return results;
}

/**
 * Extract all plain text content from a node and its descendants.
 * Concatenates text values, ignoring formatting, links, etc.
 *
 * @param node - The node to extract text from
 * @returns Plain text content
 *
 * @example
 * ```ts
 * const heading = doc.children[0]; // { type: 'heading', children: [{ type: 'text', value: 'Hello' }] }
 * extractPlainText(heading); // 'Hello'
 * ```
 */
export function extractPlainText(node: MarkdownNode): string {
  if ('value' in node && typeof node.value === 'string') {
    return node.value;
  }

  const children = getChildren(node);
  return children.map(extractPlainText).join('');
}

/**
 * Count the total number of nodes in the tree.
 *
 * @param node - The root node
 * @returns Total node count (including the root)
 */
export function countNodes(node: MarkdownNode): number {
  let count = 1;
  const children = getChildren(node);
  for (const child of children) {
    count += countNodes(child);
  }
  return count;
}

/**
 * Create a minimal MarkdownDocument from a list of block nodes.
 * Convenience function for programmatic document construction.
 */
export function createDocument(
  ...children: MarkdownDocument['children']
): MarkdownDocument {
  return {
    type: 'document',
    children,
  };
}

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
export function findNodesByType<T extends MarkdownNode>(root: MarkdownNode, type: T['type']): T[] {
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
  // Preserve boundaries between block-level elements (list items, paragraphs
  // inside list items, blockquotes) so downstream consumers like caption
  // splitting can treat each item as a separate phrase.
  const separator = node.type === 'list' || node.type === 'listItem' ? '\n' : '';
  return children.map(extractPlainText).join(separator);
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
 * Parse a YAML frontmatter string into a key-value record.
 *
 * Handles simple `key: value` pairs common in markdown frontmatter.
 * Values are trimmed; quoted strings have their quotes removed.
 * Returns `null` if parsing fails or the input is empty.
 *
 * @param yaml - The raw YAML string (without the `---` delimiters)
 * @returns A record of string keys to parsed values, or null
 */
export function parseFrontmatter(yaml: string): Record<string, unknown> | null {
  if (!yaml || !yaml.trim()) return null;

  const result: Record<string, unknown> = {};

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: string | boolean | number = trimmed.slice(colonIdx + 1).trim();

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Parse booleans and numbers
    if (value === 'true') {
      result[key] = true;
    } else if (value === 'false') {
      result[key] = false;
    } else if (value !== '' && !isNaN(Number(value))) {
      result[key] = Number(value);
    } else {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/;

/** Quote a frontmatter scalar so it round-trips cleanly through `parseFrontmatter`. */
function formatFrontmatterValue(value: string | number | boolean): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  // Quote when needed: leading/trailing whitespace, leading punctuation that
  // could trigger YAML modes, or values that look like reserved literals.
  const needsQuote =
    /^\s|\s$/.test(value) ||
    /^[!&*?|>%@`]/.test(value) ||
    /[:#]/.test(value) ||
    value === '' ||
    value === 'true' ||
    value === 'false' ||
    /^-?\d+(\.\d+)?$/.test(value);
  if (!needsQuote) return value;
  // Prefer double quotes; escape any embedded double-quote / backslash.
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Update a markdown source string's YAML frontmatter block, applying the
 * given key/value updates. A `null` or `undefined` value removes the key.
 * If no frontmatter block exists and any non-null update is supplied, a
 * new block is prepended; if every update is a removal and no block
 * exists, the source is returned unchanged.
 *
 * Existing key order is preserved; new keys are appended in the order
 * they appear in `updates`. The simple parser used here handles plain
 * `key: value` pairs only — comments, multi-line scalars, and nested
 * structures are left untouched (we only rewrite lines whose key matches
 * one in `updates`).
 *
 * @param source - The markdown source string.
 * @param updates - Map of key → new value (or null/undefined to remove).
 * @returns The updated markdown source string.
 */
export function setFrontmatterValues(
  source: string,
  updates: Record<string, string | number | boolean | null | undefined>,
): string {
  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) return source;

  const match = source.match(FRONTMATTER_BLOCK_RE);
  const handled = new Set<string>();

  // Existing frontmatter block — rewrite line-by-line, preserving order.
  if (match) {
    const inner = match[1];
    const lines = inner.split(/\r?\n/);
    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        newLines.push(line);
        continue;
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 1) {
        newLines.push(line);
        continue;
      }
      const key = trimmed.slice(0, colonIdx).trim();
      if (!Object.prototype.hasOwnProperty.call(updates, key)) {
        newLines.push(line);
        continue;
      }
      handled.add(key);
      const next = updates[key];
      if (next === null || next === undefined) continue; // remove
      newLines.push(`${key}: ${formatFrontmatterValue(next)}`);
    }

    // Append any keys that weren't already present.
    for (const key of updateKeys) {
      if (handled.has(key)) continue;
      const next = updates[key];
      if (next === null || next === undefined) continue;
      newLines.push(`${key}: ${formatFrontmatterValue(next)}`);
    }

    // If every line got removed, drop the block entirely.
    const nonEmpty = newLines.filter((l) => l.trim().length > 0);
    const rest = source.slice(match[0].length);
    if (nonEmpty.length === 0) return rest;
    return `---\n${newLines.join('\n')}\n---\n${rest}`;
  }

  // No existing block — only create one if there's at least one non-null
  // value to write.
  const fresh: string[] = [];
  for (const key of updateKeys) {
    const next = updates[key];
    if (next === null || next === undefined) continue;
    fresh.push(`${key}: ${formatFrontmatterValue(next)}`);
  }
  if (fresh.length === 0) return source;
  return `---\n${fresh.join('\n')}\n---\n${source}`;
}

/**
 * Create a minimal MarkdownDocument from a list of block nodes.
 * Convenience function for programmatic document construction.
 */
export function createDocument(...children: MarkdownDocument['children']): MarkdownDocument {
  return {
    type: 'document',
    children,
  };
}

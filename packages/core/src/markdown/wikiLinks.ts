/** Wiki article paths are literal, relative names, never URLs or OS paths. */
export function wikiLinkPath(target: string, extension: '.md' | '.html' = '.md'): string | null {
  if (!target || target.length > 2048 || target !== target.trim()) return null;
  // Percent escapes are intentionally unsupported: no second decoder may turn
  // a seemingly safe name into traversal. Keep names portable across hosts.
  if (/[\\%:#?<>"|*[\]]/u.test(target)) return null;
  if ([...target].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return null;
  const parts = target.split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part !== part.trim() ||
        /[. ]$/.test(part) ||
        part.length > 250 ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    return null;
  return /\.(?:md|html?)$/i.test(target) ? target : `${target}${extension}`;
}

/** Parse the literal inside [[target|label]]; labels never carry markup. */
export function parseWikiLink(value: string): { target: string; label?: string } | null {
  const separator = value.indexOf('|');
  const target = separator < 0 ? value : value.slice(0, separator);
  if (!wikiLinkPath(target)) return null;
  if (separator < 0) return { target };
  const label = value.slice(separator + 1);
  if (
    !label.trim() ||
    label.length > 2048 ||
    /[[\]|]/u.test(label) ||
    [...label].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
  )
    return null;
  return { target, label };
}

export interface WikiLinkSuggestion {
  target: string;
  label: string;
  kind: 'article' | 'folder';
}

/** A host owns workspace authority, save ordering, creation and navigation.
 * Targets are document-relative wiki names (without mandatory .md).
 * Resolution must not create anything. A rejected lookup is not absence.
 */
export interface WikiLinkSupport {
  exists(target: string): Promise<boolean>;
  /** Bounded suggestions for a literal document-relative path prefix. */
  suggest?(query: string): Promise<readonly WikiLinkSuggestion[]>;
  /** Optional host URL for formats or public paths beyond the default .md.
   * Return an encoded relative/workspace path, or null for a missing article. */
  resolve?(target: string): Promise<string | null>;
  open(target: string, options: { create: boolean }): Promise<void>;
}

import type { MarkdownDocument, MarkdownNode } from './types.js';
import { sanitizeUrl } from './sanitize.js';

/** Projection only: unknown/missing targets remain plain text in presentations.
 * Sequential, deduplicated lookups avoid a fan-out of filesystem operations.
 * The authored wikiTarget survives serialization regardless of resolution.
 */
export async function resolveWikiLinks(
  document: MarkdownDocument,
  exists: (target: string) => Promise<boolean | string | null>,
): Promise<MarkdownDocument> {
  const targets = new Map<string, string>();
  function collect(node: MarkdownNode): void {
    if (node.type === 'link' && node.wikiTarget !== undefined) {
      const path = wikiLinkPath(node.wikiTarget);
      if (path && targets.size < 256) targets.set(node.wikiTarget, path);
    }
    if ('children' in node) node.children.forEach(collect);
  }
  collect(document);
  if (!targets.size) return document;
  const urls = new Map<string, string>();
  for (const [target, path] of targets) {
    const result = await exists(target);
    const url =
      typeof result === 'string'
        ? sanitizeUrl(result, 'link')
        : result
          ? path.split('/').map(encodeURIComponent).join('/')
          : null;
    if (url) urls.set(target, url);
  }
  function project<T extends MarkdownNode>(node: T): T {
    if (node.type === 'link' && node.wikiTarget !== undefined) {
      const url = urls.get(node.wikiTarget) ?? '';
      return node.url === url ? node : { ...node, url };
    }
    if (!('children' in node)) return node;
    const children = node.children.map(project);
    return children.every((child, index) => child === node.children[index])
      ? node
      : { ...node, children };
  }
  return project(document);
}

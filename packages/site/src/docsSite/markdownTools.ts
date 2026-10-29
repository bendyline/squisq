/**
 * Markdown AST helpers for the documentation site build: GitHub-compatible
 * heading slugs, plain-text extraction, and an in-order walk over the nodes
 * the plain-HTML exporter renders.
 */

import type { MarkdownDocument, MarkdownNode } from '@bendyline/squisq/markdown';

/** A node as the walkers see it: any markdown node, read structurally. */
export interface LooseNode {
  type: string;
  value?: string;
  url?: string;
  lang?: string | null;
  meta?: string | null;
  depth?: number;
  alt?: string;
  children?: LooseNode[];
  attributes?: Record<string, string>;
  templateAnnotation?: unknown;
}

export function asLoose(node: MarkdownNode | MarkdownDocument): LooseNode {
  return node as unknown as LooseNode;
}

/**
 * GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens.
 * Matches the anchors the repository's markdown already links to when it is
 * read on GitHub, so `docs/API.md#bendylinesquisq-core` keeps working here.
 */
export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Hands out unique slugs, suffixing repeats `-1`, `-2`, … as GitHub does. */
export class Slugger {
  private readonly occurrences = new Map<string, number>();

  slug(text: string): string {
    return this.claim(githubSlug(text));
  }

  /** Take `id` (an explicit `{#id}`, or a computed slug), suffixed if already used. */
  claim(id: string): string {
    let result = id;
    while (this.occurrences.has(result)) {
      const next = (this.occurrences.get(id) ?? 0) + 1;
      this.occurrences.set(id, next);
      result = `${id}-${next}`;
    }
    this.occurrences.set(result, 0);
    return result;
  }
}

/** Concatenated text of a node's inline content (text, code, link labels). */
export function plainText(node: LooseNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'image') return node.alt ?? '';
  if (!node.children) return '';
  return node.children.map(plainText).join('');
}

/** Visit every node depth-first, in document order. */
export function walk(node: LooseNode, visit: (node: LooseNode, parent: LooseNode) => void): void {
  for (const child of node.children ?? []) {
    visit(child, node);
    walk(child, visit);
  }
}

/** Every heading, in the order the exporter writes `<hN>` tags. */
export function collectHeadings(doc: LooseNode): LooseNode[] {
  const headings: LooseNode[] = [];
  walk(doc, (node) => {
    if (node.type === 'heading') headings.push(node);
  });
  return headings;
}

/** Every link destination, as written. */
export function collectLinkUrls(doc: LooseNode): string[] {
  const urls: string[] = [];
  walk(doc, (node) => {
    if (node.type === 'link' && node.url) urls.push(node.url);
  });
  return urls;
}

/** Every image source, as written. */
export function collectImageUrls(doc: LooseNode): string[] {
  const urls: string[] = [];
  walk(doc, (node) => {
    if (node.type === 'image' && node.url) urls.push(node.url);
  });
  return urls;
}

/** Searchable prose: paragraphs, list items, table cells, headings — no code blocks. */
export function proseText(doc: LooseNode): string {
  const parts: string[] = [];
  const visit = (node: LooseNode) => {
    if (node.type === 'code' || node.type === 'html') return;
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') {
      parts.push(plainText(node));
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(doc);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const DECLARATION = /\b(?:function|interface|type|class|const|enum)\s+([A-Za-z_$][\w$]*)/g;

/** Names declared in TypeScript code blocks, so API symbols are searchable. */
export function declaredNames(doc: LooseNode): string[] {
  const names = new Set<string>();
  walk(doc, (node) => {
    if (node.type !== 'code' || !node.value) return;
    for (const match of node.value.matchAll(DECLARATION)) names.add(match[1]);
  });
  return [...names];
}

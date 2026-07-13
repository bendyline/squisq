/**
 * Shared DOM-read helpers for OOXML importers.
 *
 * Every importer walks parts with `getElementsByTagNameNS` and resolves
 * relationship targets relative to the referencing part; these helpers hold
 * the common pieces so new readers (theme, slide layouts) don't re-implement
 * them per format.
 */

import type { Relationship } from './types.js';

/**
 * Read a namespaced attribute with a qualified-name fallback for documents
 * whose producer omitted the namespace declaration (e.g. `r:id`).
 */
export function attrNS(el: Element, ns: string, local: string, qualified: string): string | null {
  return el.getAttributeNS(ns, local) ?? el.getAttribute(qualified);
}

/** Directory portion of a part path, e.g. `ppt/slides/slide1.xml` → `ppt/slides`. */
export function baseDirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * Resolve a relationship target against the referencing part's directory.
 * Absolute targets (leading `/`) are package-rooted; relative targets may
 * climb with `..` segments (e.g. `../slideLayouts/slideLayout1.xml`).
 */
export function resolveTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\//, '');
  const stack = baseDir ? baseDir.split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '..') stack.pop();
    else if (seg !== '.') stack.push(seg);
  }
  return stack.join('/');
}

/** First relationship of the given type, if any. */
export function findRelByType(rels: Relationship[], type: string): Relationship | undefined {
  return rels.find((r) => r.type === type);
}

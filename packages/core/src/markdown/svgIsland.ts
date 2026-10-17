/**
 * SVG islands — a ```svg code fence that renders as a picture.
 *
 * The authored form is an ordinary fenced code block whose language is `svg`:
 *
 * ```markdown
 * ```svg
 * <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>
 * ```
 * ```
 *
 * The fence language is the durable block tag (it survives the Write-view
 * round-trip, where fence meta does not); `xml`, `html` and untagged fences
 * stay code, which is how an author shows SVG markup rather than a picture.
 */

import type { MarkdownNode } from './types.js';

/** Whether a fence language marks an SVG island (`svg`, any case/padding). */
export function isSvgIslandLang(lang: string | null | undefined): boolean {
  return lang?.trim().toLowerCase() === 'svg';
}

/** Whether a markdown node is a ```svg fence. */
export function isSvgIslandFence(node: MarkdownNode): boolean {
  return node.type === 'code' && isSvgIslandLang(node.lang);
}

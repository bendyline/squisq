/**
 * Paste gate: raw SVG markup (`<svg …>…</svg>`, optionally with an XML
 * prolog, as an editor's "Copy SVG" or a file's text produces) pasted into
 * the Write view becomes a ```svg fence — an SVG island — rather than a
 * paragraph of literal markup.
 */

import { parseSvgIsland } from '@bendyline/squisq/markdown';

/** A cheap prefilter before the sanitizer: starts like SVG, ends like SVG. */
const LOOKS_LIKE_SVG_RE =
  /^(?:<\?xml[^>]*>|<!--[\s\S]*?-->|<!doctype[^[>]*(?:\[[\s\S]*?\])?\s*>|\s)*<svg[\s>/]/i;
const ENDS_LIKE_SVG_RE = /(?:<\/svg\s*>|<svg[^>]*\/>)(?:\s|<!--[\s\S]*?-->)*$/i;

/** Whether pasted text is one SVG document that renders as an island. */
export function shouldPasteAsSvgFence(text: string): boolean {
  const trimmed = text.trim();
  if (!LOOKS_LIKE_SVG_RE.test(trimmed) || !ENDS_LIKE_SVG_RE.test(trimmed)) return false;
  return parseSvgIsland(trimmed).ok;
}

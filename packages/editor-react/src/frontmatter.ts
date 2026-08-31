/**
 * frontmatter
 *
 * Small helpers for the YAML frontmatter block at the top of a markdown
 * document. The WYSIWYG editor hides frontmatter from its editing surface
 * (and re-prepends it on save), and the block-at-a-time slicer
 * (`blockRange.ts`) needs to know where the body starts so it never folds
 * frontmatter into a block slice. Both share this one definition.
 */

/**
 * Regex matching a YAML frontmatter block at the start of the document,
 * INCLUDING the blank line(s) that separate it from the body.
 *
 * The separator belongs to the frontmatter, not to the body. Canonical
 * markdown serialization always puts a blank line after the closing fence,
 * so a match that stopped at that fence handed the body a leading blank
 * line — which `markdownToTiptap` renders as a real empty paragraph at the
 * top of the document. Deleting it could never stick: the write dropped the
 * blank line, the next canonical serialization put it back, and the phantom
 * paragraph returned on the next open.
 */
export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?(?:[ \t]*\r?\n)*/;

/** Strip YAML frontmatter from markdown, returning both parts. */
export function stripFrontmatter(md: string): { body: string; frontmatter: string } {
  const m = md.match(FRONTMATTER_RE);
  if (!m) return { body: md, frontmatter: '' };
  return { body: md.slice(m[0].length), frontmatter: m[0] };
}

/**
 * Character offset where the document body begins — i.e. the length of the
 * leading frontmatter block (including its trailing newline and any blank
 * separator lines), or 0 when the source has no frontmatter.
 */
export function frontmatterEndOffset(source: string): number {
  const m = source.match(FRONTMATTER_RE);
  return m ? m[0].length : 0;
}

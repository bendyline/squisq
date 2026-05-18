/**
 * Filename helpers for export downloads.
 *
 * Derives a stable, filesystem-safe filename from the document's title
 * (frontmatter `title` → first H1/H2 → fallback `document`), suffixed
 * with the current ISO date so repeated exports stay distinguishable
 * (e.g. `welcome-to-docblocks-2026-05-17.docx`).
 */

import { inferDocumentTitle, parseMarkdown } from '@bendyline/squisq/markdown';

/**
 * Slugify an arbitrary title string into a path-safe filename stem.
 * Strips characters Windows/macOS/Linux reject in filenames, replaces
 * whitespace with hyphens, collapses runs, lowercases, and caps the
 * length so OSes that limit path components don't get punished by a
 * 300-char doc title. Returns `document` when the slugify reduces to
 * the empty string (title was only unsafe chars).
 */
export function slugifyTitle(raw: string): string {
  const slug = raw
    // Decompose accented characters, then strip the combining marks —
    // turns "Café résumé" into "cafe-resume" instead of "café-résumé"
    // (some download paths transcode poorly).
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // Drop characters that filesystems reject or that confuse path
    // tooling (control chars + Windows-reserved set).
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\-.]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return slug || 'document';
}

/**
 * Build a download filename for the given markdown source and file
 * extension. The extension is appended verbatim (callers handle
 * compound extensions like `html.zip` themselves).
 */
export function buildExportFilename(markdownSource: string, ext: string): string {
  const title = inferDocumentTitle(parseMarkdown(markdownSource));
  const slug = slugifyTitle(title ?? 'document');
  const ts = new Date().toISOString().slice(0, 10);
  return `${slug}-${ts}.${ext}`;
}

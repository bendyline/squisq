/**
 * Detect image URLs that were malformed by an MS "Save Page As Web Page" /
 * pandoc import: a relative path like `mikehome_files/foo.png` gets
 * `http://` prepended somewhere upstream, so the URL parser interprets
 * `mikehome_files` as a hostname. The browser then either fails to load
 * the image or has it blocked by CSP.
 *
 * Heuristic: hostname has no dots and no port, and ends in `_files` —
 * that's the Word-style asset-folder naming convention, not a real host.
 *
 * Returns the recovered relative path (e.g. `mikehome_files/foo.png`)
 * when the shape matches, or `null` otherwise.
 */
export function normalizeMalformedAssetUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  const match = src.match(/^https?:\/\/([^/?#]+)\/(.+)$/i);
  if (!match) return null;
  const [, host, rest] = match;
  if (host.includes('.') || host.includes(':')) return null;
  if (!host.toLowerCase().endsWith('_files')) return null;
  return `${host}/${rest}`;
}

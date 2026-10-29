/**
 * Markdown carried in the URL fragment — `#md=<base64url of UTF-8>` — so a
 * page can link straight into the editor with a document open. The
 * documentation site's "Open in editor" links are built with
 * {@link encodeSharedMarkdown}; the demo app reads them back on load.
 *
 * The fragment never reaches a server, so the document stays in the browser.
 */

const PREFIX = '#md=';

/** Hard cap on what a link may carry, decoded. */
export const MAX_SHARED_MARKDOWN_BYTES = 64 * 1024;

export function encodeSharedMarkdown(markdown: string): string {
  const bytes = new TextEncoder().encode(markdown);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${PREFIX}${base64url}`;
}

/** The markdown in `hash`, or null when it carries none (or carries garbage). */
export function decodeSharedMarkdown(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  const payload = hash.slice(PREFIX.length);
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    if (binary.length > MAX_SHARED_MARKDOWN_BYTES) return null;
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

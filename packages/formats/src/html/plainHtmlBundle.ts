/**
 * Recursive plain-HTML bundle export.
 *
 * `markdownDocsToPlainHtmlBundle` starts from a single entry markdown
 * file, walks its relative `[…](other.md)` links, recursively pulls in
 * any sibling/child documents (scope-limited to the entry doc's
 * directory tree), renders every visited file via
 * `markdownDocToPlainHtml`, rewrites cross-doc references from `.md`
 * to `.html`, and ships everything as a single ZIP.
 *
 * The function is provider-agnostic — callers pass `readDocument` and
 * `readBinary` callbacks that resolve relative paths against whatever
 * storage they use (`FileSystemContentContainer`, `MemoryContent-
 * Container`, in-memory map for tests, …). Failure to read any
 * discovered file aborts the whole export with a thrown error.
 */

import JSZip from 'jszip';
import { parseMarkdown, inferDocumentTitle } from '@bendyline/squisq/markdown';
import type { MarkdownDocument, HtmlNode } from '@bendyline/squisq/markdown';
import type { Theme } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
import { markdownDocToPlainHtml } from './plainHtml.js';

// ── Public Types ───────────────────────────────────────────────────

export interface PlainHtmlBundleOptions {
  /** Entry document path relative to the container root (e.g. `'home.md'`). */
  entryPath: string;
  /** Reads a UTF-8 markdown file from the container. Returns null when absent. */
  readDocument: (path: string) => Promise<string | null>;
  /** Reads a binary asset (image) from the container. Returns null when absent. */
  readBinary: (path: string) => Promise<ArrayBuffer | null>;
  /** Optional document title for the entry. Others derive from filename. */
  title?: string;
  /** Optional theme applied uniformly to every page. Overrides {@link themeId}. */
  theme?: Theme;
  /**
   * Optional theme id (e.g. `'warm-earth'`, `'gezellig'`). Resolved via
   * `resolveTheme` and applied to every page. Convenient for callers
   * that track themes by id (like the host export dialog) without
   * having to resolve to a `Theme` object first. When both `theme` and
   * `themeId` are supplied, `theme` wins.
   */
  themeId?: string;
  /** Maximum recursion depth (default: unlimited; cycles always handled). */
  maxDepth?: number;
  /**
   * Emit the entry doc as `index.html` (preserving its parent directory)
   * instead of `<basename>.html`. Cross-doc links pointing at the entry
   * also rewrite to `index.html`, so a sibling `resume.md → home.md`
   * link doesn't 404 after the rename. Convenient for static-site
   * deploys where the landing page must be named `index.html`.
   * Default: false.
   */
  entryAsIndex?: boolean;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Render an entry markdown document and every reachable sibling/child
 * `.md` document it links to, bundled as a single ZIP with plain-HTML
 * pages, per-document asset folders, and cross-doc `<a href>`
 * references rewritten from `.md` to `.html`.
 */
export async function markdownDocsToPlainHtmlBundle(
  options: PlainHtmlBundleOptions,
): Promise<Blob> {
  const {
    entryPath,
    readDocument,
    readBinary,
    title,
    theme,
    themeId,
    maxDepth = Infinity,
    entryAsIndex = false,
  } = options;
  const resolvedTheme = theme ?? (themeId ? resolveTheme(themeId) : undefined);
  const entry = normalizePath(entryPath);
  if (!entry) {
    throw new Error('markdownDocsToPlainHtmlBundle: entryPath is required');
  }
  const scopeRoot = posixDirname(entry); // '' for root-level files
  // When `entryAsIndex`, the entry doc writes to `<entryDir>/index.html`
  // and every cross-doc link pointing at it rewrites to that path too.
  // Other docs keep the `<basename>.html` convention.
  const entryHtmlPath = entryAsIndex
    ? scopeRoot
      ? `${scopeRoot}/index.html`
      : 'index.html'
    : entry.slice(0, -3) + '.html';
  const htmlPathFor = (mdPath: string): string =>
    mdPath === entry ? entryHtmlPath : mdPath.slice(0, -3) + '.html';

  const zip = new JSZip();
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: entry, depth: 0 }];

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const source = await readDocument(path);
    if (source === null) {
      throw new Error(`markdownDocsToPlainHtmlBundle: failed to read "${path}"`);
    }
    const mdDoc = parseMarkdown(source);

    // Discover this doc's relative .md links — both for enqueueing new
    // targets and for building the per-doc link rewrite map. We resolve
    // each link to a canonical container-relative path so the same doc
    // referenced two different ways (./resume.md vs resume.md) is
    // visited once and rewritten consistently.
    const docDir = posixDirname(path);
    const linkMap = new Map<string, string>();
    for (const raw of collectLinkRefs(mdDoc)) {
      const parsed = parseLinkRef(raw);
      if (!parsed) continue;
      const resolved = resolveRelative(docDir, parsed.path);
      if (resolved === null) continue; // escaped via ..
      if (!isInScope(resolved, scopeRoot)) continue;
      if (!resolved.toLowerCase().endsWith('.md')) continue;

      // Compute the .html replacement relative to the current doc so
      // the rewritten href stays local (e.g. `subdir/notes.html`, not
      // an absolute container path). `htmlPathFor` also handles the
      // entry-as-index case so a sibling linking to the entry lands
      // on `index.html` after rename.
      const htmlTarget = htmlPathFor(resolved);
      const relHref = relativeFrom(docDir, htmlTarget) + parsed.fragment;
      linkMap.set(raw, relHref);

      if (depth + 1 <= maxDepth && !visited.has(resolved)) {
        queue.push({ path: resolved, depth: depth + 1 });
      }
    }

    // Walk images, fetch each one, write at the original relative path
    // resolved against the container root (so `resume_files/hero.png`
    // sits next to `resume.html` in the zip). Failures here are *not*
    // fatal — images can be missing without breaking the document
    // structure — but we surface them as console warnings.
    const images = await readImagesForDoc(mdDoc, docDir, readBinary);
    for (const [, { data, zipPath }] of images) {
      const safe = sanitizeZipPath(zipPath);
      if (!safe) continue;
      zip.file(safe, data);
    }

    // Render the document. The image rewrite map keys are the URLs
    // exactly as authored (so `markdownDocToPlainHtml` can match them
    // verbatim), and the values are paths relative to the rendered
    // doc's own location — so `<img src>` works after unzip without
    // any post-processing.
    const imageRewriteMap = new Map<string, string>();
    for (const [authored, { zipPath }] of images) {
      imageRewriteMap.set(authored, relativeFrom(docDir, zipPath));
    }

    const docTitle = depth === 0 ? title : undefined;
    const html = markdownDocToPlainHtml(mdDoc, {
      title: docTitle ?? titleForFilename(path, mdDoc),
      images: imageRewriteMap,
      links: linkMap,
      theme: resolvedTheme,
    });

    const htmlPath = htmlPathFor(path);
    zip.file(htmlPath, html);
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

// ── Link discovery ─────────────────────────────────────────────────

/**
 * Collect every `<a>`-style link URL referenced in a document. Markdown
 * `link` nodes plus any raw HTML `<a href>` tags. Returns the raw URLs
 * as authored, so callers can use them as both the linkMap *key* and
 * the basis for resolution.
 */
export function collectLinkRefs(doc: MarkdownDocument): Set<string> {
  const refs = new Set<string>();

  function visitHtml(nodes: HtmlNode[]): void {
    for (const n of nodes) {
      if (n.type !== 'htmlElement') continue;
      if (n.tagName.toLowerCase() === 'a') {
        const href = n.attributes.href;
        if (typeof href === 'string' && href) refs.add(href);
      }
      visitHtml(n.children);
    }
  }

  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'link' && typeof n.url === 'string' && n.url) {
      refs.add(n.url);
    }
    if ((n.type === 'htmlBlock' || n.type === 'htmlInline') && Array.isArray(n.htmlChildren)) {
      visitHtml(n.htmlChildren as HtmlNode[]);
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) visit(child);
    }
  }

  for (const child of doc.children) visit(child);
  return refs;
}

function collectImageRefs(doc: MarkdownDocument): Set<string> {
  const refs = new Set<string>();
  function visitHtml(nodes: HtmlNode[]): void {
    for (const n of nodes) {
      if (n.type !== 'htmlElement') continue;
      const tag = n.tagName.toLowerCase();
      // <img>/<video>/<audio>/<source> all reference media via `src`;
      // we feed them into the same `images` map (effectively a generic
      // media map — see header comment) so the export pipeline rewrites
      // and bundles each one the same way.
      if (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'source') {
        const src = n.attributes.src;
        if (typeof src === 'string' && src) refs.add(src);
      }
      if (tag === 'video' || tag === 'audio') {
        const poster = n.attributes.poster;
        if (typeof poster === 'string' && poster) refs.add(poster);
      }
      visitHtml(n.children);
    }
  }
  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'image' && typeof n.url === 'string' && n.url) refs.add(n.url);
    if ((n.type === 'htmlBlock' || n.type === 'htmlInline') && Array.isArray(n.htmlChildren)) {
      visitHtml(n.htmlChildren as HtmlNode[]);
    }
    if (Array.isArray(n.children)) for (const c of n.children) visit(c);
  }
  for (const child of doc.children) visit(child);
  return refs;
}

interface ParsedLinkRef {
  /** Pathname portion before any `#` or `?`. */
  path: string;
  /** `#fragment` suffix (with leading `#`) or empty string. */
  fragment: string;
}

/**
 * Split an authored URL into path + fragment, returning null for
 * external / non-document references (http(s), mailto, data, blob,
 * absolute paths, fragment-only). The fragment is preserved so a
 * link like `resume.md#experience` rewrites cleanly to
 * `resume.html#experience`.
 */
function parseLinkRef(url: string): ParsedLinkRef | null {
  if (!url) return null;
  if (url.startsWith('#')) return null; // intra-doc anchor
  if (
    /^[a-z][a-z0-9+.-]*:/.test(url) || // http:, https:, mailto:, ftp:, …
    url.startsWith('//') ||
    url.startsWith('/')
  ) {
    return null;
  }
  const hashIdx = url.indexOf('#');
  const queryIdx = url.indexOf('?');
  const cut =
    hashIdx >= 0 && queryIdx >= 0 ? Math.min(hashIdx, queryIdx) : hashIdx >= 0 ? hashIdx : queryIdx;
  const path = cut >= 0 ? url.slice(0, cut) : url;
  const fragment = hashIdx >= 0 ? url.slice(hashIdx) : '';
  return { path, fragment };
}

// ── Image gathering ────────────────────────────────────────────────

/**
 * Resolve every image referenced by a document to container-relative
 * paths and fetch their bytes. The returned map keys are the authored
 * URLs (so the renderer's `images` map can substitute them); the values
 * are tuples of `[bytes, zipPath]` where `zipPath` is the path used
 * inside the zip.
 *
 * Images that can't be read are silently dropped — the rendered HTML
 * will keep its `<img src>` pointing at the authored URL, which a
 * reader's browser will 404. That matches the user-facing "abort on
 * missing linked doc" rule which applies to `.md` links only.
 */
async function readImagesForDoc(
  mdDoc: MarkdownDocument,
  docDir: string,
  readBinary: (path: string) => Promise<ArrayBuffer | null>,
): Promise<Map<string, { data: ArrayBuffer; zipPath: string }>> {
  const out = new Map<string, { data: ArrayBuffer; zipPath: string }>();
  for (const authored of collectImageRefs(mdDoc)) {
    if (/^[a-z][a-z0-9+.-]*:/.test(authored) || authored.startsWith('//')) continue;
    const cleanAuthored = authored.replace(/[#?].*$/, '');
    const resolved = resolveRelative(docDir, cleanAuthored);
    if (resolved === null) continue;
    const data = await readBinary(resolved);
    if (!data) continue;
    out.set(authored, { data, zipPath: resolved });
  }
  return out;
}

// ── Path helpers (POSIX-style, no Node `path`) ─────────────────────

/**
 * Strip a path to its parent directory (POSIX-style). Returns `''`
 * for root-level files so subsequent joins read like a fresh path.
 */
export function posixDirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx < 0 ? '' : p.slice(0, idx);
}

/**
 * Normalize a POSIX path: collapse `./`, resolve `..`, drop trailing
 * slashes, never produce a leading `/`. Returns null when the path
 * escapes the start ("..").
 */
export function normalizePath(p: string): string | null {
  const parts = p.split('/');
  const out: string[] = [];
  for (const segment of parts) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/**
 * Resolve `rel` against `baseDir`. Returns null when the result
 * escapes the container root via `..`.
 */
export function resolveRelative(baseDir: string, rel: string): string | null {
  if (rel.startsWith('/')) return null; // absolute paths are out of scope
  const joined = baseDir ? `${baseDir}/${rel}` : rel;
  return normalizePath(joined);
}

/**
 * True when `target` is inside `root` (or equal to it). Empty root
 * means "entire container is in scope".
 */
export function isInScope(target: string, root: string): boolean {
  if (!root) return true;
  return target === root || target.startsWith(root + '/');
}

/**
 * Compute a relative path from `fromDir` to `toPath` (both POSIX-
 * normalized, container-relative). Used to emit hrefs that work after
 * unzipping anywhere — `home.md → subfolder/notes.md` becomes
 * `subfolder/notes.html`; `subfolder/intro.md → resume.md` becomes
 * `../resume.html`.
 */
export function relativeFrom(fromDir: string, toPath: string): string {
  const fromParts = fromDir ? fromDir.split('/') : [];
  const toParts = toPath.split('/');
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const up = fromParts.length - common;
  const down = toParts.slice(common);
  const prefix = Array(up).fill('..').join('/');
  if (!prefix) return down.join('/');
  return `${prefix}/${down.join('/')}`;
}

/**
 * Sanitize a path for use as a zip entry. Strips leading slashes,
 * normalizes backslashes (Windows-authored paths), and rejects any
 * path containing `..` segments after normalization (defensive — the
 * resolver above already filters those out for links).
 */
function sanitizeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return null;
  if (normalized.split('/').some((seg) => seg === '..')) return null;
  return normalized;
}

/**
 * Derive a default page title for a non-entry doc: prefer frontmatter
 * `title`, fall back to the shallowest heading text, then the filename
 * without extension.
 */
function titleForFilename(path: string, mdDoc: MarkdownDocument): string {
  const inferred = inferDocumentTitle(mdDoc);
  if (inferred) return inferred;
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '');
}

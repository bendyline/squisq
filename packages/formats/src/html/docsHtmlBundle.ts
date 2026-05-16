/**
 * Recursive rendered-HTML bundle export.
 *
 * `markdownDocsToHtmlBundle` is the rendered-pipeline counterpart of
 * `markdownDocsToPlainHtmlBundle`. Starting from a single entry markdown
 * file, it walks every relative `[…](other.md)` link, builds a Doc for
 * each visited page via `markdownToDoc`, rewrites cross-doc link URLs
 * inside the Doc tree from `.md` → relative `.html`, then renders each
 * Doc to a SquisqPlayer-backed HTML page sharing one `squisq-player.js`.
 * Images preserve their authored relative paths so per-doc folders
 * (`resume_files/hero.png`, etc.) sit beside the rendered HTML.
 *
 * The rewrite happens on the Doc, *before* JSON serialization, because
 * the rendered HTML embeds the Doc as JSON and SquisqPlayer emits the
 * `<a href>` at runtime — there is no post-render link rewrite hook in
 * the player path.
 */

import JSZip from 'jszip';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownInlineNode,
  HtmlNode,
} from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import { generateExternalHtml } from './htmlTemplate.js';
import {
  collectLinkRefs,
  isInScope,
  normalizePath,
  posixDirname,
  relativeFrom,
  resolveRelative,
} from './plainHtmlBundle.js';

// ── Public Types ───────────────────────────────────────────────────

export interface HtmlBundleOptions {
  /** Entry document path relative to the container root (e.g. `'home.md'`). */
  entryPath: string;
  /** Reads a UTF-8 markdown file from the container. Returns null when absent. */
  readDocument: (path: string) => Promise<string | null>;
  /** Reads a binary asset (image) from the container. Returns null when absent. */
  readBinary: (path: string) => Promise<ArrayBuffer | null>;
  /** SquisqPlayer IIFE bundle. Written once as `squisq-player.js` in the zip. */
  playerScript: string;
  /** Optional document title for the entry. Other pages derive from filename. */
  title?: string;
  /** Theme id applied uniformly to every page. */
  themeId?: string;
  /** Rendering mode for every page (default: 'static' — scrollable, link-friendly). */
  mode?: 'slideshow' | 'static';
  /** Maximum recursion depth (default: unlimited; cycles always handled). */
  maxDepth?: number;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Render an entry markdown document and every reachable sibling/child
 * `.md` document it links to, bundled as a single ZIP with one rendered
 * HTML page per doc, per-document asset folders, a shared
 * `squisq-player.js`, and cross-doc `<a href>` references rewritten
 * from `.md` to `.html` inside each Doc's serialized AST.
 */
export async function markdownDocsToHtmlBundle(options: HtmlBundleOptions): Promise<Blob> {
  const {
    entryPath,
    readDocument,
    readBinary,
    playerScript,
    title,
    themeId,
    mode = 'static',
    maxDepth = Infinity,
  } = options;

  const entry = normalizePath(entryPath);
  if (!entry) {
    throw new Error('markdownDocsToHtmlBundle: entryPath is required');
  }
  const scopeRoot = posixDirname(entry);

  const zip = new JSZip();
  zip.file('squisq-player.js', playerScript);

  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: entry, depth: 0 }];

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const source = await readDocument(path);
    if (source === null) {
      throw new Error(`markdownDocsToHtmlBundle: failed to read "${path}"`);
    }
    const mdDoc = parseMarkdown(source);

    const docDir = posixDirname(path);
    const linkMap = new Map<string, string>();
    for (const raw of collectLinkRefs(mdDoc)) {
      const parsed = parseInternalRef(raw);
      if (!parsed) continue;
      const resolved = resolveRelative(docDir, parsed.path);
      if (resolved === null) continue;
      if (!isInScope(resolved, scopeRoot)) continue;
      if (!resolved.toLowerCase().endsWith('.md')) continue;

      const htmlTarget = resolved.slice(0, -3) + '.html';
      const relHref = relativeFrom(docDir, htmlTarget) + parsed.fragment;
      linkMap.set(raw, relHref);

      if (depth + 1 <= maxDepth && !visited.has(resolved)) {
        queue.push({ path: resolved, depth: depth + 1 });
      }
    }

    // Gather and stash images per doc. Same convention as the plain
    // bundle: keep authored relative paths so `<img src>` paths inside
    // the Doc still resolve after unzip. Missing assets are non-fatal.
    const imageRewriteMap = new Map<string, string>();
    for (const authored of collectImageRefs(mdDoc)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(authored) || authored.startsWith('//')) continue;
      const clean = authored.replace(/[#?].*$/, '');
      const resolvedImg = resolveRelative(docDir, clean);
      if (resolvedImg === null) continue;
      const data = await readBinary(resolvedImg);
      if (!data) continue;
      const safe = sanitizeZipPath(resolvedImg);
      if (!safe) continue;
      zip.file(safe, data);
      imageRewriteMap.set(authored, relativeFrom(docDir, resolvedImg));
    }

    // markdownToDoc embeds the markdown AST in `block.contents`, so the
    // link rewrite must walk that tree on every Doc before we serialize
    // it into the rendered HTML.
    let doc = markdownToDoc(mdDoc);
    if (themeId) doc = { ...doc, themeId };
    if (linkMap.size > 0) {
      doc = rewriteDocLinks(doc, linkMap);
    }

    const pageTitle = depth === 0 ? (title ?? titleForDoc(path, mdDoc)) : titleForDoc(path, mdDoc);
    const htmlPath = path.slice(0, -3) + '.html';
    const playerScriptPath = relativeFrom(docDir, 'squisq-player.js');

    const html = generateExternalHtml(doc, {
      playerScriptPath,
      // Convert Map → plain record for the template (which expects a
      // record). The renderer reads this map at runtime to swap image
      // sources before rendering each block.
      imagePathMap:
        imageRewriteMap.size > 0 ? Object.fromEntries(imageRewriteMap.entries()) : undefined,
      mode,
      title: pageTitle,
    });
    zip.file(htmlPath, html);
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

// ── Link rewriting ─────────────────────────────────────────────────

/**
 * Return a deep-cloned Doc with every `[text](url)` link URL inside
 * `block.contents` rewritten through `linkMap`, including raw HTML
 * `<a href="…">` tags carried inside `htmlBlock`/`htmlInline` nodes.
 * Authoring keys that aren't in the map pass through untouched.
 */
function rewriteDocLinks(doc: Doc, linkMap: Map<string, string>): Doc {
  if (linkMap.size === 0) return doc;

  function rewriteHtmlNodes(nodes: HtmlNode[]): HtmlNode[] {
    return nodes.map((n) => {
      if (n.type !== 'htmlElement') return n;
      const tag = n.tagName.toLowerCase();
      const nextAttrs =
        tag === 'a' && typeof n.attributes.href === 'string' && linkMap.has(n.attributes.href)
          ? { ...n.attributes, href: linkMap.get(n.attributes.href)! }
          : n.attributes;
      return {
        ...n,
        attributes: nextAttrs,
        children: rewriteHtmlNodes(n.children),
      };
    });
  }

  function rewriteInline(node: MarkdownInlineNode): MarkdownInlineNode {
    if (node.type === 'link') {
      const nextUrl = linkMap.get(node.url) ?? node.url;
      return {
        ...node,
        url: nextUrl,
        children: node.children.map(rewriteInline),
      };
    }
    if (node.type === 'htmlInline') {
      const withChildren = node as MarkdownInlineNode & { htmlChildren?: HtmlNode[] };
      if (Array.isArray(withChildren.htmlChildren)) {
        return {
          ...node,
          htmlChildren: rewriteHtmlNodes(withChildren.htmlChildren),
        } as MarkdownInlineNode;
      }
      return node;
    }
    if ('children' in node && Array.isArray((node as { children?: unknown }).children)) {
      const children = (node as { children: MarkdownInlineNode[] }).children.map(rewriteInline);
      return { ...node, children } as MarkdownInlineNode;
    }
    return node;
  }

  function rewriteBlockNode(node: MarkdownBlockNode): MarkdownBlockNode {
    if (node.type === 'htmlBlock') {
      const withChildren = node as MarkdownBlockNode & { htmlChildren?: HtmlNode[] };
      if (Array.isArray(withChildren.htmlChildren)) {
        return {
          ...node,
          htmlChildren: rewriteHtmlNodes(withChildren.htmlChildren),
        } as MarkdownBlockNode;
      }
      return node;
    }
    if ('children' in node && Array.isArray((node as { children?: unknown }).children)) {
      const rewritten = (node as { children: unknown[] }).children.map((c) => {
        const child = c as { type?: string };
        if (child && typeof child === 'object' && 'type' in child) {
          if (isBlockNodeType(child.type as string)) {
            return rewriteBlockNode(c as MarkdownBlockNode);
          }
          return rewriteInline(c as MarkdownInlineNode);
        }
        return c;
      });
      return { ...node, children: rewritten } as MarkdownBlockNode;
    }
    return node;
  }

  function rewriteBlock(block: Block): Block {
    const next: Block = { ...block };
    if (Array.isArray(block.contents)) {
      next.contents = block.contents.map(rewriteBlockNode);
    }
    if (Array.isArray(block.children)) {
      next.children = block.children.map(rewriteBlock);
    }
    return next;
  }

  return {
    ...doc,
    blocks: doc.blocks.map(rewriteBlock),
  };
}

/** Block-level markdown node `type` discriminator. Inline node types are
 *  everything else (text, link, emphasis, strong, image, etc.). Keeps
 *  the recursive rewrite from mistakenly applying block logic to inline
 *  link descendants. */
function isBlockNodeType(t: string): boolean {
  return (
    t === 'paragraph' ||
    t === 'heading' ||
    t === 'list' ||
    t === 'listItem' ||
    t === 'blockquote' ||
    t === 'code' ||
    t === 'thematicBreak' ||
    t === 'table' ||
    t === 'tableRow' ||
    t === 'tableCell' ||
    t === 'htmlBlock'
  );
}

// ── Helpers (kept local to avoid widening plainHtmlBundle's API) ───

interface ParsedRef {
  path: string;
  fragment: string;
}

function parseInternalRef(url: string): ParsedRef | null {
  if (!url) return null;
  if (url.startsWith('#')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('/')) {
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

function collectImageRefs(doc: MarkdownDocument): Set<string> {
  const refs = new Set<string>();
  function visitHtml(nodes: HtmlNode[]): void {
    for (const n of nodes) {
      if (n.type !== 'htmlElement') continue;
      if (n.tagName.toLowerCase() === 'img') {
        const src = n.attributes.src;
        if (typeof src === 'string' && src) refs.add(src);
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

function sanitizeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return null;
  if (normalized.split('/').some((seg) => seg === '..')) return null;
  return normalized;
}

function titleForDoc(path: string, mdDoc: MarkdownDocument): string {
  const fmTitle = mdDoc.frontmatter?.title;
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim();
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '');
}

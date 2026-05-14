/**
 * PlainHtmlPreview
 *
 * Live WYSIWYG preview of the plain-HTML export. Renders the result of
 * `markdownDocToPlainHtml` inside a sandboxed `<iframe srcDoc>` so the
 * exported document's inline `<style>` block can't leak into the host
 * page — and so the preview looks identical to what users get when they
 * open the downloaded `.html`.
 *
 * Image handling: relative `<img src>` references in the markdown can't
 * load directly from inside the iframe (there's no real document
 * origin). When a `mediaProvider` is supplied, this component walks the
 * parsed markdown for image refs, resolves each through
 * `mediaProvider.resolveUrl()` (which returns a cached blob URL), and
 * passes the resolved map to the renderer so the iframe gets blob URLs
 * it can fetch.
 */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownDocument, HtmlNode } from '@bendyline/squisq/markdown';
import type { MediaProvider, Theme } from '@bendyline/squisq/schemas';
import { markdownDocToPlainHtml } from '@bendyline/squisq-formats/html';

export interface PlainHtmlPreviewProps {
  /** Raw markdown source. */
  markdown: string;
  /** Document title — populates the iframe's `<title>`. */
  title?: string;
  /**
   * Pre-resolved image substitutions (export-time use). Takes precedence
   * over live `mediaProvider` resolution for any URL it contains.
   */
  images?: Map<string, string>;
  /**
   * When passed, relative image URLs in the markdown are resolved live
   * via this provider. Skip for static previews where `images` already
   * contains everything.
   */
  mediaProvider?: MediaProvider | null;
  /** Token that, when changed, forces re-resolution of media URLs.
   *  Mirrors the `mediaRevision` bump the editor uses after an image
   *  edit so saves show up in the preview without remount. */
  mediaRevision?: number;
  /**
   * Squisq theme to apply. When set, the iframe loads any Google-
   * hosted fonts the theme uses and the rendered HTML adopts the
   * theme's colors and typography.
   */
  theme?: Theme;
  className?: string;
  style?: CSSProperties;
}

const IFRAME_STYLE: CSSProperties = {
  width: '100%',
  height: '100%',
  border: 'none',
  background: '#fff',
  display: 'block',
};

export function PlainHtmlPreview({
  markdown,
  title,
  images,
  mediaProvider,
  mediaRevision,
  theme,
  className,
  style,
}: PlainHtmlPreviewProps) {
  const mdDoc = useMemo<MarkdownDocument>(() => parseMarkdown(markdown), [markdown]);

  // Resolve any relative image URLs the doc references. Blob URLs are
  // cheap once cached, so re-resolving on every keystroke is fine —
  // `resolveUrl` is memoized inside the provider.
  const [resolvedImages, setResolvedImages] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    if (!mediaProvider) {
      setResolvedImages(null);
      return;
    }
    let cancelled = false;
    const refs = Array.from(collectImageRefs(mdDoc));
    Promise.all(
      refs.map(async (ref) => {
        if (isExternal(ref)) return [ref, ref] as const;
        try {
          const url = await mediaProvider.resolveUrl(ref);
          return [ref, url] as const;
        } catch {
          return [ref, ref] as const;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const next = new Map<string, string>(pairs);
      setResolvedImages(next);
    });
    return () => {
      cancelled = true;
    };
  }, [mdDoc, mediaProvider, mediaRevision]);

  const mergedImages = useMemo(() => {
    if (!resolvedImages && !images) return undefined;
    const merged = new Map<string, string>();
    if (resolvedImages) for (const [k, v] of resolvedImages) merged.set(k, v);
    if (images) for (const [k, v] of images) merged.set(k, v);
    return merged;
  }, [resolvedImages, images]);

  const html = useMemo(
    () => markdownDocToPlainHtml(mdDoc, { title, images: mergedImages, theme }),
    [mdDoc, title, mergedImages, theme],
  );

  return (
    <iframe
      className={className}
      data-testid="plain-html-preview"
      title={title ?? 'HTML preview'}
      srcDoc={html}
      // `allow-same-origin` is required so the iframe can fetch blob:
      // URLs created by the host's media provider. We intentionally do
      // NOT include `allow-scripts` — the rendered HTML is plain-output
      // markup with no JS, and refusing scripts hardens against
      // accidental `<script>` content in user markdown.
      sandbox="allow-same-origin"
      style={{ ...IFRAME_STYLE, ...style }}
    />
  );
}

// ── Image collection ───────────────────────────────────────────────

function isExternal(url: string): boolean {
  return (
    !url ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('//')
  );
}

/**
 * Collect every image URL referenced anywhere in the doc — markdown
 * `image` nodes plus any `<img src>` inside raw HTML blocks/inlines
 * (the WYSIWYG editor emits the HTML form for resized images).
 */
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
    if (n.type === 'image' && typeof n.url === 'string' && n.url) {
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

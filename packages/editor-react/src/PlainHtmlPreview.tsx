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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownDocument, HtmlNode } from '@bendyline/squisq/markdown';
import type { MediaProvider, Theme } from '@bendyline/squisq/schemas';
import { normalizeMalformedAssetUrl } from './utils/normalizeMalformedAssetUrl';
import { collectInlineFontAwesomeCss } from './utils/collectInlineFontAwesomeCss';

// formats/html is ~50 KB and only needed for the plain-HTML preview pane.
// Lazy-load on first render so it doesn't sit in the editor's main chunk.
type RenderFn = typeof import('@bendyline/squisq-formats/html').markdownDocToPlainHtml;
let cachedRender: RenderFn | null = null;
let cachedRenderPromise: Promise<RenderFn> | null = null;
function loadRenderFn(): Promise<RenderFn> {
  if (cachedRender) return Promise.resolve(cachedRender);
  if (!cachedRenderPromise) {
    cachedRenderPromise = import('@bendyline/squisq-formats/html').then((m) => {
      cachedRender = m.markdownDocToPlainHtml;
      return cachedRender;
    });
  }
  return cachedRenderPromise;
}

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
  /** Let unmodified Up/Down arrows scroll the preview without requiring iframe focus. */
  globalKeyboardShortcuts?: boolean;
  /** Receives the rendered iframe, primarily for printing its isolated document. */
  onFrameChange?: (frame: HTMLIFrameElement | null) => void;
  /**
   * Delegate link activation from the isolated iframe to the embedding host.
   * Return `false` to allow the iframe's default navigation.
   */
  onLinkClick?: (href: string) => boolean | undefined;
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
  globalKeyboardShortcuts = false,
  onFrameChange,
  onLinkClick,
}: PlainHtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const removeFrameLinkHandlerRef = useRef<() => void>(() => undefined);
  const setIframeRef = useCallback(
    (frame: HTMLIFrameElement | null) => {
      iframeRef.current = frame;
      onFrameChange?.(frame);
    },
    [onFrameChange],
  );
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
        // Word-style imports may have `http://<doc>_files/foo.png` —
        // recover the relative path so the workspace provider resolves
        // it, otherwise the iframe tries to fetch a nonsense hostname.
        const recovered = normalizeMalformedAssetUrl(ref);
        if (!recovered && isExternal(ref)) return [ref, ref] as const;
        const lookup = recovered ?? ref;
        try {
          const url = await mediaProvider.resolveUrl(lookup);
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

  // Gather FontAwesome @font-face + utility rules from the host page's
  // own stylesheets so the iframe doesn't have to depend on a cross-
  // origin CDN fetch (which sandbox / tracking-prevention can silently
  // drop, leaving the icons invisible). The host (editor-react) already
  // bundles FA, so the rules are guaranteed to be present and the font
  // URLs inside them resolve to same-origin assets the iframe can
  // fetch under `allow-same-origin`.
  const iconsCss = useMemo(() => collectInlineFontAwesomeCss(), []);

  const [renderFn, setRenderFn] = useState<RenderFn | null>(() => cachedRender);
  useEffect(() => {
    if (renderFn) return;
    let cancelled = false;
    loadRenderFn().then((fn) => {
      if (!cancelled) setRenderFn(() => fn);
    });
    return () => {
      cancelled = true;
    };
  }, [renderFn]);

  const html = useMemo(
    () => (renderFn ? renderFn(mdDoc, { title, images: mergedImages, theme, iconsCss }) : ''),
    [renderFn, mdDoc, title, mergedImages, theme, iconsCss],
  );

  const installFrameLinkHandler = useCallback(() => {
    removeFrameLinkHandlerRef.current();
    removeFrameLinkHandlerRef.current = () => undefined;

    const frameDocument = iframeRef.current?.contentDocument;
    const FrameElement = frameDocument?.defaultView?.Element;
    if (!frameDocument || !FrameElement || !onLinkClick) return;

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target instanceof FrameElement ? event.target : null;
      const anchor = target?.closest('a[href]');
      if (!anchor || !frameDocument.contains(anchor)) return;
      const href = anchor.getAttribute('href');
      if (!href || onLinkClick(href) === false) return;
      event.preventDefault();
      event.stopPropagation();
    };

    frameDocument.addEventListener('click', handleClick, true);
    removeFrameLinkHandlerRef.current = () =>
      frameDocument.removeEventListener('click', handleClick, true);
  }, [onLinkClick]);

  useEffect(() => {
    installFrameLinkHandler();
    return () => removeFrameLinkHandlerRef.current();
  }, [html, installFrameLinkHandler]);

  useEffect(() => {
    if (!globalKeyboardShortcuts) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"], [aria-modal="true"], .monaco-editor',
        )
      ) {
        return;
      }
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow) return;
      event.preventDefault();
      const distance = Math.max(64, Math.round(iframeRef.current?.clientHeight ?? 0) * 0.12);
      frameWindow.scrollBy({
        top: event.key === 'ArrowDown' ? distance : -distance,
        behavior: 'smooth',
      });
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [globalKeyboardShortcuts]);

  return (
    <iframe
      ref={setIframeRef}
      className={className}
      data-testid="plain-html-preview"
      title={title ?? 'HTML preview'}
      srcDoc={html}
      onLoad={installFrameLinkHandler}
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
      const tag = n.tagName.toLowerCase();
      // <img>, <video>, and <audio> all reference media via `src`.
      // The export pipeline rewrites whichever map entries exist, so
      // collecting them under the same set is enough — `ctx.images`
      // is generic media despite the historical name.
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

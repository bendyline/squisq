/**
 * Standalone Entry Point — IIFE bundle for self-contained HTML rendering.
 *
 * This file is the entry point for the standalone `squisq-player.iife.js` bundle.
 * It bundles Preact (via preact/compat), squisq core, and all rendering components
 * into a single self-contained script that can be loaded in any HTML page.
 *
 * The bundle exposes a global `SquisqPlayer` object with methods to mount
 * interactive or static document views into any DOM element.
 *
 * Usage (in HTML):
 *   <script src="squisq-player.iife.js"></script>
 *   <div id="root"></div>
 *   <script>
 *     SquisqPlayer.mount(document.getElementById('root'), docJson, {
 *       mode: 'slideshow',
 *       images: { 'hero.jpg': 'data:image/jpeg;base64,...' }
 *     });
 *   </script>
 */

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Doc, MediaProvider } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import { DocPlayer } from './DocPlayer';
import { LinearDocView } from './LinearDocView';
import { MediaContext } from './hooks/MediaContext';

// CSS is loaded as text via esbuild's text loader (configured in tsup.standalone.config.ts)
// @ts-expect-error — .css import returns a string when esbuild uses 'text' loader (standalone build only)
import animationCss from './styles/doc-animations.css';

// ── Types ──────────────────────────────────────────────────────────

export interface MountOptions {
  /** Rendering mode: 'slideshow' (interactive, default) or 'static' (scrollable) */
  mode?: 'slideshow' | 'static';
  /** Base path for resolving relative media URLs */
  basePath?: string;
  /**
   * Map of relative image paths to data URIs or blob URLs.
   * Used in single-HTML exports where images are inlined as base64.
   * Example: { 'hero.jpg': 'data:image/jpeg;base64,...' }
   */
  images?: Record<string, string>;
  /**
   * Map of audio segment names/paths to URLs (data URIs, blob URLs, or relative paths).
   * Used in ZIP exports where audio files are included alongside the HTML.
   */
  audio?: Record<string, string>;
  /** Optional theme override */
  theme?: Theme;
  /** Auto-play on mount (only for slideshow mode, default: false) */
  autoPlay?: boolean;
}

// ── CSS Injection ──────────────────────────────────────────────────

let cssInjected = false;

function injectCss(): void {
  if (cssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-squisq-player', 'animations');
  style.textContent = animationCss;
  document.head.appendChild(style);
  cssInjected = true;
}

// ── Inline Media Provider ──────────────────────────────────────────

/**
 * Creates a MediaProvider that resolves URLs from an inline image map.
 * Falls back to basePath-based resolution for unknown paths.
 */
function createInlineMediaProvider(
  images: Record<string, string>,
  basePath: string,
): MediaProvider {
  return {
    async resolveUrl(relativePath: string): Promise<string> {
      if (relativePath in images) return images[relativePath];
      // Fallback to basePath
      if (
        relativePath.startsWith('http') ||
        relativePath.startsWith('data:') ||
        relativePath.startsWith('blob:')
      ) {
        return relativePath;
      }
      return `${basePath}/${relativePath}`;
    },
    async listMedia() {
      return Object.keys(images).map((name) => ({
        name,
        mimeType: inferMimeType(name),
        size: 0,
      }));
    },
    async addMedia() {
      throw new Error('Standalone player is read-only');
    },
    async removeMedia() {
      throw new Error('Standalone player is read-only');
    },
    dispose() {
      // no-op
    },
  };
}

function inferMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  return map[ext] ?? 'application/octet-stream';
}

// ── Audio Rewriting ────────────────────────────────────────────────

/**
 * Rewrite audio segment URLs in a Doc if an audio map is provided.
 * Returns a shallow-modified copy — does not mutate the original.
 */
function rewriteAudioUrls(doc: Doc, audioMap: Record<string, string>): Doc {
  if (!doc.audio?.segments?.length) return doc;

  const segments = doc.audio.segments.map((seg) => {
    const resolved = audioMap[seg.name] ?? audioMap[seg.src] ?? seg.src;
    return { ...seg, src: resolved };
  });

  return { ...doc, audio: { ...doc.audio, segments } };
}

// ── Root Tracking ──────────────────────────────────────────────────

const roots = new WeakMap<Element, Root>();

// ── Public API ─────────────────────────────────────────────────────

/**
 * Mount a SquisqPlayer into a DOM element.
 *
 * @param element - The DOM element to render into
 * @param doc - A Doc object (parsed JSON)
 * @param options - Rendering options
 */
export function mount(element: Element, doc: Doc, options: MountOptions = {}): void {
  injectCss();

  const { mode = 'slideshow', basePath = '.', images, audio, autoPlay = false, theme } = options;

  // Rewrite audio URLs if map provided
  const finalDoc = audio ? rewriteAudioUrls(doc, audio) : doc;

  // Build the media provider if images are provided
  const mediaProvider = images ? createInlineMediaProvider(images, basePath) : null;

  let content: ReturnType<typeof createElement>;

  if (mode === 'static') {
    content = createElement(LinearDocView, {
      doc: finalDoc,
      basePath,
      theme,
    });
  } else {
    content = createElement(DocPlayer, {
      script: finalDoc,
      basePath,
      displayMode: 'slideshow',
      autoPlay,
      showControls: true,
      theme,
    });
  }

  // Wrap in MediaContext if provider is available
  if (mediaProvider) {
    content = createElement(MediaContext.Provider, { value: mediaProvider }, content);
  }

  // Create or reuse React root
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(content);
}

/**
 * Mount a static scrollable document view (alias for mount with mode='static').
 */
export function mountStatic(
  element: Element,
  doc: Doc,
  options: Omit<MountOptions, 'mode'> = {},
): void {
  mount(element, doc, { ...options, mode: 'static' });
}

/**
 * Unmount a previously mounted SquisqPlayer from an element.
 */
export function unmount(element: Element): void {
  const root = roots.get(element);
  if (root) {
    root.unmount();
    roots.delete(element);
  }
}

/** Package version — injected at build time via esbuild define */
declare const __SQUISQ_VERSION__: string;
export const version: string =
  typeof __SQUISQ_VERSION__ !== 'undefined' ? __SQUISQ_VERSION__ : '0.0.0';

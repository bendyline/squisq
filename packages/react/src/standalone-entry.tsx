/**
 * Standalone Entry Point — IIFE bundle for self-contained HTML rendering.
 *
 * This file is the entry point for the standalone `squisq-player.iife.js` bundle.
 * It bundles Preact (via preact/compat), squisq core, rendering components, and
 * animation CSS. Raw-script consumers load the package stylesheet for shared
 * icon webfonts; standalone-source and the CLI compose those styles once.
 *
 * The bundle exposes a global `SquisqPlayer` object with methods to mount
 * interactive or static document views into any DOM element.
 *
 * Usage (in HTML):
 *   <script src="squisq-player.iife.js"></script>
 *   <div id="root"></div>
 *   <script>
 *     const root = document.getElementById('root');
 *     const handle = SquisqPlayer.mount(root, docJson, {
 *       mode: 'slideshow',
 *       images: { 'hero.jpg': 'data:image/jpeg;base64,...' }
 *     });
 *     // In render mode: const api = await handle.renderAPI;
 *   </script>
 */

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  Doc,
  MediaProvider,
  Theme,
  VideoPipPosition,
  VideoPipShape,
  VideoPipSize,
  VideoPresentation,
} from '@bendyline/squisq/schemas';
import type { SquisqRenderAPI } from './types';
import { DocPlayer } from './DocPlayer';
import { LinearDocView } from './LinearDocView';
import { MediaContext } from './hooks/MediaContext';
import type { CodeBlockCopyHandler } from './MarkdownRenderer';

// Animation CSS is loaded as text and injected into the standalone player.
// Font Awesome's webfonts remain in the package stylesheet instead of being
// duplicated into the light bundle, full bundle, and standalone-source module.
// @ts-expect-error — .css imports return text in the standalone build
import animationCss from './styles/doc-animations.css';

// ── Types ──────────────────────────────────────────────────────────

export interface MountOptions {
  /**
   * Rendering mode: 'slideshow' (interactive, default), 'static'
   * (scrollable page), or 'dashboard' (one canvas of arranged blocks).
   */
  mode?: 'slideshow' | 'static' | 'dashboard';
  /** Dashboard-mode options (ignored by the other modes). */
  dashboard?: {
    /** Layout id or 'auto'. Overrides doc frontmatter. */
    layout?: string;
    /** Title-band override. Overrides doc frontmatter. */
    title?: boolean;
    /** Host-supplied title fallback (typically the file name). */
    documentTitle?: string;
  };
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
  /** Player-level video placement override. Omitted values resolve from the Doc. */
  videoPresentation?: VideoPresentation;
  /** Picture-in-picture size override. Omitted values resolve from the Doc. */
  pipSize?: VideoPipSize;
  /** Picture-in-picture shape override. Omitted values resolve from the Doc. */
  pipShape?: VideoPipShape;
  /** Picture-in-picture corner override. Omitted values resolve from the Doc. */
  pipPosition?: VideoPipPosition;
  /** Auto-play on mount (only for slideshow mode, default: false) */
  autoPlay?: boolean;
  /**
   * Capture presentation arrow keys without requiring focus (default: true).
   * Disable when mounting multiple interactive players on the same page.
   */
  globalKeyboardShortcuts?: boolean;
  /**
   * Enable render mode for headless frame capture. The instance API is
   * available through the returned mount handle. Disables controls and
   * auto-play.
   */
  renderMode?: boolean;
  /**
   * Whether to render slide transitions and per-layer animations (default: true).
   * Timed media continues to play when disabled.
   */
  animationsEnabled?: boolean;
  /** Caption style: 'standard' or 'social'. Omit or set to undefined for no captions. */
  captionStyle?: 'standard' | 'social';
  /** Show a Copy button on fenced code blocks in static mode (default: false). */
  showCodeCopyButton?: boolean;
  /** Optional host clipboard adapter; otherwise the browser Clipboard API is used. */
  onCopyCode?: CodeBlockCopyHandler;
}

/** Instance handle returned by {@link mount}. */
export interface SquisqPlayerHandle {
  /** DOM element that owns this player instance. */
  readonly element: Element;
  /** Resolves to this instance's render API, or null when render mode is off. */
  readonly renderAPI: Promise<SquisqRenderAPI | null>;
  /** Current render API without waiting for effects to run. */
  getRenderAPI(): SquisqRenderAPI | null;
  /** Unmount this exact player instance. */
  unmount(): void;
}

// ── CSS Injection ──────────────────────────────────────────────────

let cssInjected = false;

function injectCss(): void {
  if (cssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-squisq-player', 'animations');
  const iconCss = (
    globalThis as typeof globalThis & {
      __SQUISQ_PLAYER_ICON_STYLES__?: string;
    }
  ).__SQUISQ_PLAYER_ICON_STYLES__;
  style.textContent = animationCss;
  if (iconCss) style.textContent += `\n${iconCss}`;
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
  // Doc image references may not exactly match image map keys
  // (e.g., "images/hero.jpg" vs "hero.jpg"). Build a filename-keyed
  // lookup so resolution can fall back to basename matching.
  const byFilename: Record<string, string> = {};
  for (const key of Object.keys(images)) {
    const filename = key.split('/').pop()!;
    byFilename[filename] = images[key];
  }

  return {
    async resolveUrl(relativePath: string): Promise<string> {
      if (relativePath in images) return images[relativePath];
      const stripped = relativePath.replace(/^\.\//, '');
      if (stripped !== relativePath && stripped in images) return images[stripped];
      const filename = relativePath.split('/').pop()!;
      if (filename in byFilename) return byFilename[filename];
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

interface InternalPlayerHandle extends SquisqPlayerHandle {
  setRenderAPI(api: SquisqRenderAPI | null): void;
  cancel(): void;
}

const handles = new WeakMap<Element, InternalPlayerHandle>();

function createPlayerHandle(element: Element, expectsRenderAPI: boolean): InternalPlayerHandle {
  let currentAPI: SquisqRenderAPI | null = null;
  let active = true;
  let settled = false;
  let resolveRenderAPI!: (api: SquisqRenderAPI | null) => void;
  const renderAPI = new Promise<SquisqRenderAPI | null>((resolve) => {
    resolveRenderAPI = resolve;
  });

  const settle = (api: SquisqRenderAPI | null) => {
    if (settled) return;
    settled = true;
    resolveRenderAPI(api);
  };
  if (!expectsRenderAPI) settle(null);

  const handle: InternalPlayerHandle = {
    element,
    renderAPI,
    getRenderAPI: () => currentAPI,
    unmount: () => {
      if (handles.get(element) === handle) unmount(element);
    },
    setRenderAPI(api) {
      if (!active) return;
      currentAPI = api;
      if (api) settle(api);
    },
    cancel() {
      active = false;
      currentAPI = null;
      settle(null);
    },
  };
  return handle;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Mount a SquisqPlayer into a DOM element.
 *
 * @param element - The DOM element to render into
 * @param doc - A Doc object (parsed JSON)
 * @param options - Rendering options
 */
export function mount(element: Element, doc: Doc, options: MountOptions = {}): SquisqPlayerHandle {
  injectCss();

  const {
    mode = 'slideshow',
    dashboard,
    basePath = '.',
    images,
    audio,
    autoPlay = false,
    theme,
    videoPresentation,
    pipSize,
    pipShape,
    pipPosition,
    renderMode = false,
    animationsEnabled = true,
    captionStyle,
    globalKeyboardShortcuts = true,
    showCodeCopyButton = false,
    onCopyCode,
  } = options;

  // Rewrite audio URLs if map provided
  const finalDoc = audio ? rewriteAudioUrls(doc, audio) : doc;

  // Build the media provider if images are provided
  const mediaProvider = images ? createInlineMediaProvider(images, basePath) : null;
  handles.get(element)?.cancel();
  // Dashboard mounts publish a render API too (single-frame capture waits
  // on it), so both player-backed modes expect one in render mode.
  const handle = createPlayerHandle(
    element,
    (mode === 'slideshow' || mode === 'dashboard') && renderMode,
  );
  handles.set(element, handle);

  let content: ReturnType<typeof createElement>;

  if (mode === 'static') {
    content = createElement(LinearDocView, {
      doc: finalDoc,
      basePath,
      theme,
      animationsEnabled,
      globalKeyboardShortcuts,
      showCodeCopyButton,
      onCopyCode,
    });
  } else {
    // Dashboard canvases fill the host element's box: the render page pins
    // `#squisq-root` to the export dimensions, and a live host sizes it with
    // CSS. Without this, DocPlayer's render-mode fallback (landscape) would
    // letterbox a square/portrait dashboard inside the page.
    const hostRect = mode === 'dashboard' ? element.getBoundingClientRect() : undefined;
    const dashboardViewport =
      hostRect && hostRect.width > 0 && hostRect.height > 0
        ? {
            width: Math.round(hostRect.width),
            height: Math.round(hostRect.height),
            name: 'Host viewport',
          }
        : undefined;
    content = createElement(DocPlayer, {
      doc: finalDoc,
      basePath,
      displayMode: mode === 'dashboard' ? 'dashboard' : 'slideshow',
      dashboardLayout: dashboard?.layout,
      dashboardShowTitle: dashboard?.title,
      dashboardDocumentTitle: dashboard?.documentTitle,
      forceViewport: dashboardViewport,
      autoPlay: renderMode ? false : autoPlay,
      showControls: !renderMode,
      renderMode,
      animationsEnabled,
      theme,
      videoPresentation,
      pipSize,
      pipShape,
      pipPosition,
      captionsEnabled: !!captionStyle,
      captionStyle: captionStyle ?? 'standard',
      globalKeyboardShortcuts,
      onRenderAPIReady: (api: SquisqRenderAPI | null) => handle.setRenderAPI(api),
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
  return handle;
}

/** Return the handle for the player mounted into `element`, if any. */
export function getHandle(element: Element): SquisqPlayerHandle | undefined {
  return handles.get(element);
}

/**
 * Unmount a previously mounted SquisqPlayer from an element.
 */
export function unmount(element: Element): void {
  const handle = handles.get(element);
  handle?.cancel();
  handles.delete(element);
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

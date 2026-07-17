/**
 * useFrameCapture — Hidden div + html2canvas frame capture.
 *
 * Mounts a DocPlayer in renderMode inside a hidden div (same document),
 * then captures individual frames by seeking the player and rendering
 * the DOM to a canvas via html2canvas.
 *
 * Uses React directly — no script injection, no iframes, no eval.
 *
 * Returns either a reusable canvas or an ImageBitmap snapshot for a Worker.
 */

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRef, useCallback, useMemo } from 'react';
import type { Doc, MediaProvider } from '@bendyline/squisq/schemas';
import type { RenderHtmlOptions } from '@bendyline/squisq-video';
import { DocPlayer, MediaContext } from '@bendyline/squisq-react';
import type { SquisqRenderAPI, CaptionMode, CaptionStyle } from '@bendyline/squisq-react';
import html2canvas from 'html2canvas';

export interface FrameCaptureOptions {
  /**
   * Reuse the previous raster when seeking produced the same visual state.
   * The timeline is still advanced so animations, captions, and media remain
   * correct; only the expensive html2canvas pass is skipped.
   */
  reuseIfUnchanged?: boolean;
}

export interface FrameCaptureHandle {
  /** Initialize the hidden player. Returns the video duration in seconds. */
  init: (
    doc: Doc,
    renderOptions: Omit<RenderHtmlOptions, 'playerScript'>,
    captionMode?: CaptionMode,
  ) => Promise<number>;
  /** Capture a single frame at the given time (seconds). Returns an ImageBitmap. */
  captureFrame: (time: number, options?: FrameCaptureOptions) => Promise<ImageBitmap>;
  /**
   * Render into the hook's reusable canvas without allocating an ImageBitmap.
   * The canvas remains valid until the next capture or destroy call.
   */
  captureCanvasFrame: (time: number, options?: FrameCaptureOptions) => Promise<HTMLCanvasElement>;
  /** Clean up resources. */
  destroy: () => void;
}

/** Extension → MIME type map (hoisted to avoid per-image allocation). */
const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

const VISUAL_UPDATE_FALLBACK_MS = 100;
const POTENTIALLY_ANIMATED_IMAGE_URL =
  /(?:^data:image\/(?:gif|webp|avif)[;,]|\.(?:gif|webp|avif)(?:[?#]|$))/i;

/**
 * Let React and the browser present DOM changes without waiting forever for
 * animation frames that Chromium may suspend in a background tab/window.
 */
export function waitForVisualUpdate(frameCount = 1): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let animationFrame: number | null = null;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resolve();
    };
    const fallback = window.setTimeout(
      finish,
      document.visibilityState === 'visible' ? VISUAL_UPDATE_FALLBACK_MS : 0,
    );

    if (document.visibilityState !== 'visible') return;

    const waitForFrame = (remaining: number): void => {
      animationFrame = window.requestAnimationFrame(() => {
        if (remaining <= 1) finish();
        else waitForFrame(remaining - 1);
      });
    };
    waitForFrame(Math.max(1, frameCount));
  });
}

/**
 * Create a temporary MediaProvider backed by blob URLs. This avoids retaining
 * a second, base64-expanded copy of every export asset in JavaScript strings.
 */
export function createInlineProvider(images: Map<string, ArrayBuffer>): MediaProvider {
  const blobUrls = new Map<string, string>();
  const mimeTypes = new Map<string, string>();
  for (const [path, buffer] of images) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME_MAP[ext] ?? 'application/octet-stream';
    blobUrls.set(path, URL.createObjectURL(new Blob([buffer], { type: mime })));
    mimeTypes.set(path, mime);
  }

  return {
    async resolveUrl(relativePath: string): Promise<string> {
      return blobUrls.get(relativePath) ?? relativePath;
    },
    async listMedia() {
      return [...blobUrls.keys()].map((name) => ({
        name,
        mimeType: mimeTypes.get(name) ?? 'application/octet-stream',
        size: images.get(name)?.byteLength ?? 0,
      }));
    },
    async addMedia() {
      throw new Error('Read-only');
    },
    async removeMedia() {
      throw new Error('Read-only');
    },
    dispose() {
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
      blobUrls.clear();
    },
  };
}

/** Keep html2canvas's document clone limited to the rendered player and styles. */
function shouldIgnoreCaptureSibling(element: Element, captureRoot: HTMLElement): boolean {
  const { head } = captureRoot.ownerDocument;
  const isInDocumentHead = element === head || head.contains(element);
  const isInCaptureBranch =
    element === captureRoot || element.contains(captureRoot) || captureRoot.contains(element);
  return !isInDocumentHead && !isInCaptureBranch;
}

function finiteMediaTime(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : 'unknown';
}

/**
 * Describe everything in the capture subtree that can affect its pixels at a
 * point on the document timeline. Equal keys mean the previous raster can be
 * reused safely. This is deliberately conservative for visual sources whose
 * internal state cannot be inspected (animated images, canvas, embeds, SMIL).
 */
export function getFrameVisualStateKey(captureRoot: HTMLElement, timelineTime: number): string {
  const markup = captureRoot.innerHTML;
  let needsTimelineKey = false;

  const animationStates: string[] = [];
  if (typeof captureRoot.getAnimations === 'function') {
    const animations = captureRoot.getAnimations({ subtree: true });
    animations.forEach((animation, index) => {
      try {
        const timing = animation.effect?.getComputedTiming();
        if (!timing) {
          needsTimelineKey = true;
          return;
        }
        animationStates.push(
          `${index}:${animation.playState}:${String(timing.progress)}:${String(
            timing.currentIteration,
          )}`,
        );
      } catch {
        needsTimelineKey = true;
      }
    });
  } else if (/\b(?:anim-|transition-)|animation(?:-name)?\s*:/i.test(markup)) {
    needsTimelineKey = true;
  }

  const imageStates = Array.from(captureRoot.querySelectorAll('img')).map((image) => {
    const src = image.currentSrc || image.src;
    if (POTENTIALLY_ANIMATED_IMAGE_URL.test(src)) needsTimelineKey = true;
    return `${src}:${image.complete}:${image.naturalWidth}x${image.naturalHeight}`;
  });
  if (POTENTIALLY_ANIMATED_IMAGE_URL.test(markup)) needsTimelineKey = true;

  const videoStates = Array.from(captureRoot.querySelectorAll('video')).map(
    (video) =>
      `${video.currentSrc || video.src}:${finiteMediaTime(video.currentTime)}:${video.readyState}:` +
      `${video.videoWidth}x${video.videoHeight}`,
  );

  if (
    captureRoot.querySelector(
      'canvas, iframe, object, embed, animate, animateMotion, animateTransform, set',
    )
  ) {
    needsTimelineKey = true;
  }

  const fontStatus = captureRoot.ownerDocument.fonts?.status ?? 'unsupported';
  return JSON.stringify({
    markup,
    animationStates,
    imageStates,
    videoStates,
    fontStatus,
    timelineTime: needsTimelineKey ? timelineTime.toFixed(6) : null,
  });
}

/**
 * Hook that manages a hidden div for frame capture.
 */
export function useFrameCapture(): FrameCaptureHandle {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);
  const renderAPIRef = useRef<SquisqRenderAPI | null>(null);
  const mediaProviderRef = useRef<MediaProvider | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastVisualStateKeyRef = useRef<string | null>(null);
  const hasCapturedFrameRef = useRef(false);
  const dimensionsRef = useRef<{ width: number; height: number }>({ width: 1920, height: 1080 });

  const init = useCallback(
    async (
      doc: Doc,
      renderOptions: Omit<RenderHtmlOptions, 'playerScript'>,
      captionMode?: CaptionMode,
    ): Promise<number> => {
      // Clean up any existing container.
      // Defer unmount to avoid "synchronously unmount a root while React
      // was already rendering" when init() is called from a React handler.
      if (
        rootRef.current ||
        containerRef.current ||
        mediaProviderRef.current ||
        captureCanvasRef.current
      ) {
        const oldRoot = rootRef.current;
        const oldContainer = containerRef.current;
        const oldMediaProvider = mediaProviderRef.current;
        const oldCaptureCanvas = captureCanvasRef.current;
        rootRef.current = null;
        containerRef.current = null;
        renderAPIRef.current = null;
        mediaProviderRef.current = null;
        captureCanvasRef.current = null;
        lastVisualStateKeyRef.current = null;
        hasCapturedFrameRef.current = false;
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            if (oldRoot) oldRoot.unmount();
            if (oldContainer) oldContainer.remove();
            oldMediaProvider?.dispose();
            if (oldCaptureCanvas) {
              oldCaptureCanvas.width = 0;
              oldCaptureCanvas.height = 0;
            }
            resolve();
          }, 0);
        });
      }

      const width = renderOptions.width ?? 1920;
      const height = renderOptions.height ?? 1080;
      const animationsEnabled = renderOptions.animationsEnabled ?? true;
      dimensionsRef.current = { width, height };

      // Keep one html2canvas destination for the full export. The main-thread
      // WebCodecs path can consume this canvas directly, avoiding a second
      // full-resolution ImageBitmap allocation for every frame. Chromium may
      // retain those bitmap surfaces long after close(), which is what makes a
      // long export eventually hit memory-pressure thrashing.
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = width;
      captureCanvas.height = height;
      captureCanvas.style.width = `${width}px`;
      captureCanvas.style.height = `${height}px`;
      captureCanvasRef.current = captureCanvas;
      lastVisualStateKeyRef.current = null;
      hasCapturedFrameRef.current = false;

      // Create a hidden container
      const container = document.createElement('div');
      container.style.cssText =
        `position:fixed;left:0;top:0;width:${width}px;height:${height}px;` +
        'opacity:0;pointer-events:none;z-index:-1;overflow:hidden;';
      document.body.appendChild(container);
      containerRef.current = container;

      // Create render root
      const renderRoot = document.createElement('div');
      renderRoot.id = 'squisq-capture-root';
      renderRoot.style.cssText = `width:${width}px;height:${height}px;`;
      container.appendChild(renderRoot);

      // Build media provider from images
      const mediaProvider = renderOptions.images
        ? createInlineProvider(renderOptions.images)
        : null;
      mediaProviderRef.current = mediaProvider;

      // Mount DocPlayer in renderMode via React
      const root = createRoot(renderRoot);
      rootRef.current = root;

      // Derive caption props from captionMode
      const captionsEnabled = captionMode !== undefined && captionMode !== 'off';
      const captionStyle: CaptionStyle = captionMode === 'social' ? 'social' : 'standard';
      let resolveRenderAPI!: (api: SquisqRenderAPI) => void;
      const renderAPIReady = new Promise<SquisqRenderAPI>((resolve) => {
        resolveRenderAPI = resolve;
      });

      const playerElement = createElement(DocPlayer, {
        doc,
        basePath: '.',
        renderMode: true,
        animationsEnabled,
        showControls: false,
        autoPlay: false,
        forceViewport: { width, height, name: 'export' },
        captionsEnabled,
        captionStyle,
        onRenderAPIReady: (api: SquisqRenderAPI | null) => {
          if (containerRef.current !== container) return;
          renderAPIRef.current = api;
          if (api) resolveRenderAPI(api);
        },
      });

      // Defer rendering to the next microtask to avoid "synchronously unmount
      // a root while React was already rendering" when init() is called during
      // a React render cycle (e.g., from startExport in VideoExportModal).
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      if (mediaProvider) {
        root.render(createElement(MediaContext.Provider, { value: mediaProvider }, playerElement));
      } else {
        root.render(playerElement);
      }

      // Wait for this exact player's instance API.
      return new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const api = renderAPIRef.current;
          const hasSeek = typeof api?.seekTo === 'function';
          const hasDur = typeof api?.getDuration === 'function';
          const rootEl = containerRef.current?.querySelector('#squisq-capture-root');
          const hasPlayer = rootEl ? rootEl.querySelector('.doc-player') !== null : false;
          reject(
            new Error(
              `Render API did not initialize within 15s. ` +
                `seekTo=${hasSeek}, getDuration=${hasDur}, player=${hasPlayer}, root=${!!rootEl}`,
            ),
          );
        }, 15000);

        void renderAPIReady.then((api) => {
          clearTimeout(timeout);
          resolve(api.getDuration());
        });
      });
    },
    [],
  );

  const captureCanvasFrame = useCallback(
    async (time: number, options: FrameCaptureOptions = {}): Promise<HTMLCanvasElement> => {
      const container = containerRef.current;
      const api = renderAPIRef.current;
      const captureCanvas = captureCanvasRef.current;
      if (!container || !api || !captureCanvas) {
        throw new Error('Frame capture not initialized — call init() first');
      }

      const { width, height } = dimensionsRef.current;

      // Seek the player to the target time
      await api.seekTo(time);

      // Wait for the DOM to update after seek. Keep a task-based fallback so a
      // backgrounded browser/Electron renderer cannot deadlock the export.
      await waitForVisualUpdate(2);

      const root = container.querySelector('#squisq-capture-root') as HTMLElement;
      if (!root) {
        throw new Error('Capture root element not found');
      }

      const visualStateKey = options.reuseIfUnchanged ? getFrameVisualStateKey(root, time) : null;
      if (
        visualStateKey !== null &&
        hasCapturedFrameRef.current &&
        lastVisualStateKeyRef.current === visualStateKey
      ) {
        return captureCanvas;
      }

      // html2canvas scales/translates a supplied context but does not reset it
      // between calls. Restore the reusable surface to its initial state and
      // clear the previous frame before rendering the next one.
      const captureContext = captureCanvas.getContext('2d');
      if (!captureContext) throw new Error('Could not create the frame capture canvas context');
      captureContext.setTransform(1, 0, 0, 1, 0, 0);
      captureContext.clearRect(0, 0, width, height);

      // Render the DOM to the bounded, reusable canvas via html2canvas.
      // We're in the same document (no iframe), so COEP doesn't block cloning.
      const canvas = await html2canvas(root, {
        canvas: captureCanvas,
        width,
        height,
        scale: 1,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#000000',
        logging: false,
        // html2canvas starts cloning at documentElement. Do not clone the rest
        // of the editor/site UI on every frame; only the capture root, its
        // ancestors, descendants, and document styles can affect this render.
        ignoreElements: (element) => shouldIgnoreCaptureSibling(element, root),
      });

      hasCapturedFrameRef.current = true;
      lastVisualStateKeyRef.current = visualStateKey;

      // The reusable canvas is returned directly for the main-thread encoder.
      return canvas;
    },
    [],
  );

  const captureFrame = useCallback(
    async (time: number, options: FrameCaptureOptions = {}): Promise<ImageBitmap> => {
      const canvas = await captureCanvasFrame(time, options);
      return createImageBitmap(canvas);
    },
    [captureCanvasFrame],
  );

  const destroy = useCallback(() => {
    if (rootRef.current) {
      rootRef.current.unmount();
      rootRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.remove();
      containerRef.current = null;
    }
    mediaProviderRef.current?.dispose();
    mediaProviderRef.current = null;
    if (captureCanvasRef.current) {
      captureCanvasRef.current.width = 0;
      captureCanvasRef.current.height = 0;
      captureCanvasRef.current = null;
    }
    lastVisualStateKeyRef.current = null;
    hasCapturedFrameRef.current = false;
    renderAPIRef.current = null;
  }, []);

  // Return a stable object to prevent useEffect cleanup loops
  // in consumers that depend on the handle reference.
  return useMemo(
    () => ({ init, captureFrame, captureCanvasFrame, destroy }),
    [init, captureFrame, captureCanvasFrame, destroy],
  );
}

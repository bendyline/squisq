/**
 * useFrameCapture — Hidden div + html2canvas frame capture.
 *
 * Mounts a DocPlayer in renderMode inside a hidden div (same document),
 * then captures individual frames by seeking the player and rendering
 * the DOM to a canvas via html2canvas.
 *
 * Uses React directly — no script injection, no iframes, no eval.
 *
 * Returns an ImageBitmap for each frame (transferable to a Worker).
 */

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRef, useCallback, useMemo } from 'react';
import type { Doc, MediaProvider } from '@bendyline/squisq/schemas';
import type { RenderHtmlOptions } from '@bendyline/squisq-video';
import { DocPlayer, MediaContext } from '@bendyline/squisq-react';
import type { SquisqWindow, CaptionMode, CaptionStyle } from '@bendyline/squisq-react';
import html2canvas from 'html2canvas';

export interface FrameCaptureHandle {
  /** Initialize the hidden player. Returns the video duration in seconds. */
  init: (
    doc: Doc,
    renderOptions: Omit<RenderHtmlOptions, 'playerScript'>,
    captionMode?: CaptionMode,
  ) => Promise<number>;
  /** Capture a single frame at the given time (seconds). Returns an ImageBitmap. */
  captureFrame: (time: number) => Promise<ImageBitmap>;
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

/** Convert an ArrayBuffer to a base64 data URI using chunked encoding (O(n)). */
function arrayBufferToDataUrl(buffer: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return `data:${mime};base64,${btoa(chunks.join(''))}`;
}

/**
 * Create an inline MediaProvider from a map of paths to ArrayBuffers.
 */
function createInlineProvider(images: Map<string, ArrayBuffer>): MediaProvider {
  const dataUrls = new Map<string, string>();
  const mimeTypes = new Map<string, string>();
  for (const [path, buffer] of images) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME_MAP[ext] ?? 'application/octet-stream';
    dataUrls.set(path, arrayBufferToDataUrl(buffer, mime));
    mimeTypes.set(path, mime);
  }

  return {
    async resolveUrl(relativePath: string): Promise<string> {
      return dataUrls.get(relativePath) ?? relativePath;
    },
    async listMedia() {
      return [...dataUrls.keys()].map((name) => ({
        name,
        mimeType: mimeTypes.get(name) ?? 'application/octet-stream',
        size: 0,
      }));
    },
    async addMedia() {
      throw new Error('Read-only');
    },
    async removeMedia() {
      throw new Error('Read-only');
    },
    dispose() {},
  };
}

/**
 * Hook that manages a hidden div for frame capture.
 */
export function useFrameCapture(): FrameCaptureHandle {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);
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
      if (rootRef.current || containerRef.current) {
        const oldRoot = rootRef.current;
        const oldContainer = containerRef.current;
        rootRef.current = null;
        containerRef.current = null;
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            if (oldRoot) oldRoot.unmount();
            if (oldContainer) oldContainer.remove();
            resolve();
          }, 0);
        });
      }

      const width = renderOptions.width ?? 1920;
      const height = renderOptions.height ?? 1080;
      dimensionsRef.current = { width, height };

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

      // Mount DocPlayer in renderMode via React
      const root = createRoot(renderRoot);
      rootRef.current = root;

      // Derive caption props from captionMode
      const captionsEnabled = captionMode !== undefined && captionMode !== 'off';
      const captionStyle: CaptionStyle = captionMode === 'social' ? 'social' : 'standard';

      const playerElement = createElement(DocPlayer, {
        script: doc,
        basePath: '.',
        renderMode: true,
        showControls: false,
        autoPlay: false,
        forceViewport: { width, height, name: 'export' },
        captionsEnabled,
        captionStyle,
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

      // Wait for the render API to appear on window
      return new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const w = window as SquisqWindow;
          const hasSeek = typeof w.seekTo === 'function';
          const hasDur = typeof w.getDuration === 'function';
          const rootEl = containerRef.current?.querySelector('#squisq-capture-root');
          const hasPlayer = rootEl ? rootEl.querySelector('.doc-player') !== null : false;
          reject(
            new Error(
              `Render API did not initialize within 15s. ` +
                `seekTo=${hasSeek}, getDuration=${hasDur}, player=${hasPlayer}, root=${!!rootEl}`,
            ),
          );
        }, 15000);

        const checkApi = () => {
          const w = window as SquisqWindow;
          if (typeof w.getDuration === 'function' && typeof w.seekTo === 'function') {
            clearTimeout(timeout);
            const duration = w.getDuration();
            resolve(duration);
          } else {
            requestAnimationFrame(checkApi);
          }
        };

        // Give React time to mount and run useEffects
        setTimeout(checkApi, 500);
      });
    },
    [],
  );

  const captureFrame = useCallback(async (time: number): Promise<ImageBitmap> => {
    const container = containerRef.current;
    const w = window as SquisqWindow;
    if (!container || typeof w.seekTo !== 'function') {
      throw new Error('Frame capture not initialized — call init() first');
    }

    const { width, height } = dimensionsRef.current;

    // Seek the player to the target time
    await w.seekTo(time);

    // Wait for the DOM to update after seek
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const root = container.querySelector('#squisq-capture-root') as HTMLElement;
    if (!root) {
      throw new Error('Capture root element not found');
    }

    // Render the DOM to a canvas via html2canvas.
    // We're in the same document (no iframe), so COEP doesn't block cloning.
    const canvas = await html2canvas(root, {
      width,
      height,
      scale: 1,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#000000',
      logging: false,
    });

    // Convert to ImageBitmap (transferable to worker — zero-copy)
    const bitmap = await createImageBitmap(canvas);
    return bitmap;
  }, []);

  const destroy = useCallback(() => {
    if (rootRef.current) {
      rootRef.current.unmount();
      rootRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.remove();
      containerRef.current = null;
    }
  }, []);

  // Return a stable object to prevent useEffect cleanup loops
  // in consumers that depend on the handle reference.
  return useMemo(() => ({ init, captureFrame, destroy }), [init, captureFrame, destroy]);
}

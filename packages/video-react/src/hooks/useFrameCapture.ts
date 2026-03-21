/**
 * useFrameCapture — Hidden iframe + html2canvas frame capture.
 *
 * Creates a hidden iframe loaded with the SquisqPlayer in renderMode,
 * then captures individual frames by seeking the player and rendering
 * the DOM to a canvas via html2canvas.
 *
 * Returns an ImageBitmap for each frame (transferable to a Worker).
 */

import { useRef, useCallback } from 'react';
import type { Doc } from '@bendyline/squisq/schemas';
import type { RenderHtmlOptions } from '@bendyline/squisq-video';
import { generateRenderHtml } from '@bendyline/squisq-video';
import html2canvas from 'html2canvas';

/** SquisqRenderAPI shape exposed on the iframe's contentWindow. */
interface RenderAPI {
  seekTo: (time: number) => void;
  getDuration: () => number;
  getBlocks: () => unknown[];
}

export interface FrameCaptureHandle {
  /** Initialize the iframe player. Returns the video duration in seconds. */
  init: (
    doc: Doc,
    renderOptions: Omit<RenderHtmlOptions, 'playerScript'>,
    playerScript: string,
  ) => Promise<number>;
  /** Capture a single frame at the given time (seconds). Returns an ImageBitmap. */
  captureFrame: (time: number) => Promise<ImageBitmap>;
  /** Clean up the iframe and resources. */
  destroy: () => void;
}

/**
 * Hook that manages a hidden iframe for frame capture.
 */
export function useFrameCapture(): FrameCaptureHandle {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const renderApiRef = useRef<RenderAPI | null>(null);
  const dimensionsRef = useRef<{ width: number; height: number }>({ width: 1920, height: 1080 });

  const init = useCallback(
    async (
      doc: Doc,
      renderOptions: Omit<RenderHtmlOptions, 'playerScript'>,
      playerScript: string,
    ): Promise<number> => {
      // Clean up any existing iframe
      if (iframeRef.current) {
        iframeRef.current.remove();
        iframeRef.current = null;
        renderApiRef.current = null;
      }

      const width = renderOptions.width ?? 1920;
      const height = renderOptions.height ?? 1080;
      dimensionsRef.current = { width, height };

      const html = generateRenderHtml(doc, {
        ...renderOptions,
        playerScript,
        width,
        height,
      });

      // Create hidden iframe
      const iframe = document.createElement('iframe');
      iframe.style.cssText =
        'position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:none;visibility:hidden;';
      iframe.width = String(width);
      iframe.height = String(height);
      document.body.appendChild(iframe);
      iframeRef.current = iframe;

      // Write content into iframe
      return new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Render API did not initialize within 15 seconds'));
        }, 15000);

        iframe.srcdoc = html;

        const checkApi = () => {
          const win = iframe.contentWindow as (Window & RenderAPI) | null;
          if (win && typeof win.getDuration === 'function') {
            clearTimeout(timeout);
            renderApiRef.current = win;
            const duration = win.getDuration();
            resolve(duration);
          } else {
            requestAnimationFrame(checkApi);
          }
        };

        iframe.onload = () => {
          // Give React a tick to mount and run useEffect
          setTimeout(checkApi, 200);
        };
      });
    },
    [],
  );

  const captureFrame = useCallback(async (time: number): Promise<ImageBitmap> => {
    const api = renderApiRef.current;
    const iframe = iframeRef.current;
    if (!api || !iframe) {
      throw new Error('Frame capture not initialized — call init() first');
    }

    const { width, height } = dimensionsRef.current;

    // Seek the player to the target time
    api.seekTo(time);

    // Wait a frame for the DOM to update after seek
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) {
      throw new Error('Cannot access iframe document');
    }

    const root = iframeDoc.getElementById('squisq-root');
    if (!root) {
      throw new Error('squisq-root element not found in iframe');
    }

    // Render the DOM to a canvas via html2canvas
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
    if (iframeRef.current) {
      iframeRef.current.remove();
      iframeRef.current = null;
    }
    renderApiRef.current = null;
  }, []);

  return { init, captureFrame, destroy };
}

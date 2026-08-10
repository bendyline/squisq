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

export interface FrameCaptureRenderOptions extends Omit<RenderHtmlOptions, 'playerScript'> {
  /** Whether the hidden player should materialize its managed cover. */
  showCoverSlide?: boolean;
  /** Visual template used to materialize the managed cover. */
  coverSlideTemplate?: import('@bendyline/squisq/doc').CoverSlideTemplate;
  /** Existing provider to use for media resolution. It remains caller-owned. */
  mediaProvider?: MediaProvider;
}

export interface FrameCaptureHandle {
  /** Initialize the hidden player. Returns the video duration in seconds. */
  init: (
    doc: Doc,
    renderOptions: FrameCaptureRenderOptions,
    captionMode?: CaptionMode,
  ) => Promise<number>;
  /** Force the managed cover on or off before capturing export frames. */
  setCoverVisible: (visible: boolean) => Promise<void>;
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

interface CaptureMediaResolutionTracker {
  provider: MediaProvider;
  waitForSettled: () => Promise<boolean>;
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
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

const VISUAL_UPDATE_FALLBACK_MS = 100;
const CAPTURE_ASSET_TIMEOUT_MS = 15_000;
const RENDER_TIME_EPSILON_SECONDS = 0.000_001;
const POTENTIALLY_ANIMATED_IMAGE_URL =
  /(?:^data:image\/(?:gif|webp|avif)[;,]|\.(?:gif|webp|avif)(?:[?#]|$))/i;
const CAPTURE_SVG_SELECTOR = 'svg.block-svg';
const CAPTURE_VIDEO_READINESS_POLL_MS = 16;
const CAPTURE_VIDEO_END_PROBE_TIME = 1e101;
const SCHEDULED_MEDIA_SELECTOR = '.doc-player__media-clips';
const SCHEDULED_VIDEO_SELECTOR = `${SCHEDULED_MEDIA_SELECTOR} video[data-clip-id]`;
const CAPTION_OVERLAY_SELECTOR = '.caption-overlay, .social-caption-overlay';
const COVER_BLOCK_SELECTOR = '.doc-player__block--cover';

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

async function waitForImageDecode(image: HTMLImageElement): Promise<void> {
  const src = image.currentSrc || image.src;
  if (!src) return;
  const decoded =
    typeof image.decode === 'function'
      ? image.decode()
      : new Promise<void>((resolve, reject) => {
          if (image.complete) {
            if (image.naturalWidth > 0) resolve();
            else reject(new Error(`Image could not be decoded: ${src}`));
            return;
          }
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener(
            'error',
            () => reject(new Error(`Image could not be loaded: ${src}`)),
            {
              once: true,
            },
          );
        });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      decoded,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Image did not become ready within 15s: ${src}`)),
          CAPTURE_ASSET_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Wait for capture-visible fonts and images without adding refresh delays. */
export async function waitForCaptureAssets(
  captureRoot: HTMLElement,
  decodedImages: WeakSet<HTMLImageElement> = new WeakSet(),
): Promise<void> {
  const fonts = captureRoot.ownerDocument.fonts;
  if (fonts) await fonts.ready;

  const pendingImages = Array.from(captureRoot.querySelectorAll('img')).filter(
    (image) => !decodedImages.has(image),
  );
  await Promise.all(
    pendingImages.map(async (image) => {
      await waitForImageDecode(image);
      decodedImages.add(image);
    }),
  );
}

function waitForCaptureVideoState(
  video: HTMLVideoElement,
  description: string,
  isReady: () => boolean,
  update?: () => void,
): Promise<void> {
  if (isReady()) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const events = ['loadedmetadata', 'durationchange', 'loadeddata', 'canplay', 'seeked'] as const;
    const cleanup = (): void => {
      clearTimeout(timeout);
      clearInterval(poll);
      events.forEach((eventName) => video.removeEventListener(eventName, check));
      video.removeEventListener('error', fail);
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Video did not become ready while ${description} within 15s: ` +
            `${video.currentSrc || video.src}`,
        ),
      );
    };
    function check(): void {
      if (isReady()) finish();
    }

    const timeout = setTimeout(fail, CAPTURE_ASSET_TIMEOUT_MS);
    const poll = setInterval(check, CAPTURE_VIDEO_READINESS_POLL_MS);
    events.forEach((eventName) => video.addEventListener(eventName, check));
    video.addEventListener('error', fail, { once: true });

    try {
      update?.();
      queueMicrotask(check);
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

/**
 * Whether an element still needs an indexing pass before it can be seeked.
 *
 * Membership in the primed set is not sufficient on its own. A scheduled clip
 * mounts before its MediaProvider URL resolves, and React can retain the
 * element while replacing its src, so an already-seen node can still be holding
 * a fresh, unindexed recorder WebM. Any visual source without a finite duration
 * must be indexed again before the first non-zero seek, whatever the set
 * remembers about this element.
 */
function captureVideoNeedsPriming(
  video: HTMLVideoElement,
  primedVideos: WeakSet<HTMLVideoElement>,
): boolean {
  // An Opus-only WebM authored as <video> keeps duration=Infinity for its whole
  // lifetime and has no frame to index, seek, or capture. Loading another src
  // resets readyState, so this stays accurate across replacements.
  if (
    video.readyState >= HTMLMediaElement.HAVE_METADATA &&
    video.videoWidth <= 0 &&
    video.videoHeight <= 0
  ) {
    return false;
  }
  return !primedVideos.has(video) || !Number.isFinite(video.duration);
}

/**
 * Make capture video sources deterministic and fast to advance before
 * accelerated frame capture starts.
 *
 * Every visual source is marked for sequential capture. Assigning
 * `currentTime` for each output frame makes Chromium run a full pipeline
 * seek that decodes forward from the previous keyframe; screen recordings
 * keep keyframes seconds-to-minutes apart, so that per-frame cost grows with
 * the offset into the clip until a long export crawls. The sequential path
 * (see seekVideoToFrame) instead advances by short muted playback steps,
 * decoding each source frame exactly once.
 *
 * Indeterminate-duration sources additionally need an indexing probe.
 * MediaRecorder WebMs commonly omit a finite Duration/Cues index. Chromium
 * then exposes `duration === Infinity` and buffers only a short window ahead
 * of a paused video. An export that advances faster than realtime eventually
 * catches that frontier and every subsequent frame waits for another tiny
 * buffer extension. A single end probe makes Chromium scan the local/blob
 * resource, establishes its finite duration and seek index, and avoids that
 * timestamp-specific collapse. The original frame is restored before return.
 *
 * The returned count includes only probed sources: indexing moves a video's
 * position, so the caller must re-run its seek barrier, while flagging a
 * finite source leaves its position untouched.
 */
export async function primeIndeterminateCaptureVideos(
  captureRoot: HTMLElement,
  primedVideos: WeakSet<HTMLVideoElement> = new WeakSet(),
): Promise<number> {
  const videos = Array.from(captureRoot.querySelectorAll('video')).filter((video) =>
    captureVideoNeedsPriming(video, primedVideos),
  );
  let primedCount = 0;

  await Promise.all(
    videos.map(async (video) => {
      const source = video.currentSrc || video.src;
      if (!source) {
        // A scheduled clip is mounted before MediaProvider resolves its blob
        // URL. Recording this empty element as primed would permanently hide
        // the real recorder WebM that lands on it moments later, so leave it
        // for the next capture instead.
        return;
      }

      await waitForCaptureVideoState(
        video,
        'loading capture metadata',
        () => video.readyState >= HTMLMediaElement.HAVE_METADATA,
      );
      if (video.videoWidth <= 0 && video.videoHeight <= 0) {
        // Legacy narration saves could author an Opus-only WebM as <video>.
        // Audio is mixed by the export timeline; there is no visual frame to
        // index, seek, clone, or include in the render-readiness barrier.
        primedVideos.add(video);
        return;
      }
      if (Number.isFinite(video.duration)) {
        // Already indexed — no probe needed, but sequential capture matters
        // just as much here: an uploaded screen recording with sparse
        // keyframes degrades progressively under per-frame currentTime seeks.
        video.dataset.captureSequential = 'true';
        primedVideos.add(video);
        return;
      }

      const restoreTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
      video.pause();
      await waitForCaptureVideoState(
        video,
        'indexing an indeterminate-duration capture source',
        () =>
          Number.isFinite(video.duration) &&
          video.duration > 0 &&
          !video.seeking &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
        () => {
          video.currentTime = CAPTURE_VIDEO_END_PROBE_TIME;
        },
      );

      const reachableRestoreTime = Math.min(restoreTime, video.duration);
      await waitForCaptureVideoState(
        video,
        'restoring the capture source after indexing',
        () =>
          !video.seeking &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          Math.abs(video.currentTime - reachableRestoreTime) <= 0.01,
        () => {
          video.currentTime = reachableRestoreTime;
        },
      );
      video.dataset.captureSequential = 'true';
      primedVideos.add(video);
      primedCount += 1;
    }),
  );

  return primedCount;
}

/**
 * Create a temporary MediaProvider backed by blob URLs. This avoids retaining
 * a second, base64-expanded copy of every export asset in JavaScript strings.
 */
export function createInlineProvider(images: Map<string, ArrayBuffer>): MediaProvider {
  const blobUrls = new Map<string, string>();
  const mimeTypes = new Map<string, string>();
  const sizes = new Map<string, number>();
  for (const [path, buffer] of images) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME_MAP[ext] ?? 'application/octet-stream';
    blobUrls.set(path, URL.createObjectURL(new Blob([buffer], { type: mime })));
    mimeTypes.set(path, mime);
    sizes.set(path, buffer.byteLength);
  }

  return {
    async resolveUrl(relativePath: string): Promise<string> {
      return blobUrls.get(relativePath) ?? relativePath;
    },
    async listMedia() {
      return [...blobUrls.keys()].map((name) => ({
        name,
        mimeType: mimeTypes.get(name) ?? 'application/octet-stream',
        size: sizes.get(name) ?? 0,
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
      sizes.clear();
    },
  };
}

/**
 * Track provider-backed URL resolution without taking ownership of the caller's
 * provider. Image layers first render their relative fallback and replace it
 * from a React effect; frame capture must not decode that fallback while the
 * provider operation is still in flight.
 */
export function createCaptureMediaResolutionTracker(
  provider: MediaProvider,
): CaptureMediaResolutionTracker {
  const pending = new Set<Promise<void>>();
  let resolutionGeneration = 0;
  let observedGeneration = 0;
  const trackedProvider: MediaProvider = {
    resolveUrl(relativePath) {
      resolutionGeneration += 1;
      const resolution = provider.resolveUrl(relativePath);
      const completion = resolution.then(
        () => {
          pending.delete(completion);
        },
        () => {
          pending.delete(completion);
        },
      );
      pending.add(completion);
      return resolution;
    },
    listMedia: () => provider.listMedia(),
    addMedia: (name, data, mimeType) => provider.addMedia(name, data, mimeType),
    removeMedia: (relativePath) => provider.removeMedia(relativePath),
    // The frame-capture hook retains ownership of inline providers and callers
    // retain ownership of supplied providers. Context consumers must never
    // dispose the wrapper and accidentally revoke the caller's live URLs.
    dispose: () => undefined,
  };

  return {
    provider: trackedProvider,
    async waitForSettled() {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
      const changed = resolutionGeneration !== observedGeneration;
      observedGeneration = resolutionGeneration;
      return changed;
    },
  };
}

/** Wait for provider URLs to reach the DOM before asking Chromium to decode images. */
export async function waitForCaptureMediaResolutions(
  tracker: CaptureMediaResolutionTracker | null,
): Promise<void> {
  while (await tracker?.waitForSettled()) {
    await waitForVisualUpdate();
  }
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

export interface CoverSourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface VideoFrameRect extends CoverSourceRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Source rectangle that implements CSS `object-fit: cover` for canvas drawImage. */
export function coverSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
): CoverSourceRect {
  const sourceRatio = sourceWidth / sourceHeight;
  const destinationRatio = destinationWidth / destinationHeight;
  if (sourceRatio > destinationRatio) {
    const sw = sourceHeight * destinationRatio;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / destinationRatio;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

/** Canvas source/destination rectangles matching the video's CSS object-fit. */
function videoFrameRect(
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
  objectFit: string,
): VideoFrameRect {
  if (objectFit === 'cover') {
    return {
      ...coverSourceRect(sourceWidth, sourceHeight, destinationWidth, destinationHeight),
      dx: 0,
      dy: 0,
      dw: destinationWidth,
      dh: destinationHeight,
    };
  }

  if (objectFit === 'contain' || objectFit === 'scale-down') {
    const containScale = Math.min(destinationWidth / sourceWidth, destinationHeight / sourceHeight);
    const scale = objectFit === 'scale-down' ? Math.min(1, containScale) : containScale;
    const dw = sourceWidth * scale;
    const dh = sourceHeight * scale;
    return {
      sx: 0,
      sy: 0,
      sw: sourceWidth,
      sh: sourceHeight,
      dx: (destinationWidth - dw) / 2,
      dy: (destinationHeight - dh) / 2,
      dw,
      dh,
    };
  }

  if (objectFit === 'none') {
    return {
      sx: 0,
      sy: 0,
      sw: sourceWidth,
      sh: sourceHeight,
      dx: (destinationWidth - sourceWidth) / 2,
      dy: (destinationHeight - sourceHeight) / 2,
      dw: sourceWidth,
      dh: sourceHeight,
    };
  }

  // CSS defaults replaced content to `fill`.
  return {
    sx: 0,
    sy: 0,
    sw: sourceWidth,
    sh: sourceHeight,
    dx: 0,
    dy: 0,
    dw: destinationWidth,
    dh: destinationHeight,
  };
}

/**
 * html2canvas replaces `<video>` with a bare `<canvas>` before rendering. Its
 * replacement does not retain the video's class or inline/computed styles and
 * draws the source stretched to the element box. Re-associate scheduled and
 * block-layer video clones with their originals, restore capture-critical
 * presentation, and redraw the current frame with its authored CSS
 * `object-fit` semantics.
 */
export function prepareScheduledVideoClones(
  originalRoot: HTMLElement,
  clonedRoot: HTMLElement,
): HTMLCanvasElement[] {
  const captureFamilies = [
    {
      original: '.doc-player__media-clips video[data-clip-id]',
      clone: '.doc-player__media-clips canvas',
    },
    {
      original: '.block-layer--video video[data-clip-start]',
      clone: '.block-layer--video canvas',
    },
  ] as const;

  const pairs = captureFamilies.flatMap(({ original, clone }) => {
    const videos = Array.from(originalRoot.querySelectorAll<HTMLVideoElement>(original));
    const canvases = Array.from(clonedRoot.querySelectorAll<HTMLCanvasElement>(clone));
    return videos.flatMap((video, index) => {
      const canvas = canvases[index];
      return canvas ? [{ video, canvas }] : [];
    });
  });
  const preparedCanvases = pairs.map(({ canvas }) => canvas);

  pairs.forEach(({ video, canvas }) => {
    canvas.className = video.className;
    canvas.style.cssText = video.style.cssText;
    for (const attribute of Array.from(video.attributes)) {
      if (attribute.name.startsWith('data-')) {
        canvas.setAttribute(attribute.name, attribute.value);
      }
    }
    canvas.dataset.videoCaptureClone = 'true';

    const destinationWidth = Math.round(video.clientWidth || video.offsetWidth);
    const destinationHeight = Math.round(video.clientHeight || video.offsetHeight);
    if (
      video.videoWidth <= 0 ||
      video.videoHeight <= 0 ||
      destinationWidth <= 0 ||
      destinationHeight <= 0
    ) {
      return;
    }

    try {
      const view = video.ownerDocument.defaultView;
      const objectFit = video.style.objectFit || view?.getComputedStyle(video).objectFit || 'fill';
      const frame = videoFrameRect(
        video.videoWidth,
        video.videoHeight,
        destinationWidth,
        destinationHeight,
        objectFit,
      );
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = destinationWidth;
      canvas.height = destinationHeight;
      context.drawImage(
        video,
        frame.sx,
        frame.sy,
        frame.sw,
        frame.sh,
        frame.dx,
        frame.dy,
        frame.dw,
        frame.dh,
      );

      // html2canvas treats the DocPlayer's outer <svg> as one replaced image
      // and serializes its subtree. Canvas bitmap pixels are not part of DOM
      // serialization, and nested data-backed images are intentionally not
      // loaded when Chromium paints an SVG as an image. Lift only an embedded
      // VideoLayer frame into the cloned slide's HTML stacking context so its
      // bitmap remains directly paintable. Scheduled/PIP canvases already live
      // outside SVG and stay in place.
      const foreignObject = canvas.closest('foreignObject');
      const svg = canvas.closest('svg');
      if (foreignObject && svg) {
        const originalHost = video.closest<HTMLElement>('.doc-player__block') ?? originalRoot;
        const clonedHost = svg.closest<HTMLElement>('.doc-player__block') ?? clonedRoot;
        const videoRect = video.getBoundingClientRect();
        const hostRect = originalHost.getBoundingClientRect();
        const renderedWidth = videoRect.width || destinationWidth;
        const renderedHeight = videoRect.height || destinationHeight;
        const fallbackX = Number.parseFloat(foreignObject.getAttribute('x') ?? '0') || 0;
        const fallbackY = Number.parseFloat(foreignObject.getAttribute('y') ?? '0') || 0;
        const left = videoRect.width ? videoRect.left - hostRect.left : fallbackX;
        const top = videoRect.height ? videoRect.top - hostRect.top : fallbackY;

        foreignObject.remove();
        if (clonedHost === clonedRoot && !clonedHost.style.position) {
          clonedHost.style.position = 'relative';
        }
        canvas.style.position = 'absolute';
        canvas.style.left = `${left}px`;
        canvas.style.top = `${top}px`;
        canvas.style.width = `${renderedWidth}px`;
        canvas.style.height = `${renderedHeight}px`;
        canvas.style.zIndex = '3';
        canvas.style.margin = '0';
        canvas.style.transform = 'none';
        clonedHost.appendChild(canvas);
      }
    } catch {
      // Keep html2canvas's original clone if this browser cannot redraw the
      // current video frame (for example, a not-yet-decodable media source).
    }
  });

  return preparedCanvases;
}

interface CaptureRasterSize {
  width: number;
  height: number;
}

type CaptureImageDataUrlCache = Map<string, Promise<string>>;

interface CaptureSvgRasterCacheEntry {
  serializedSvg: string;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

export type CaptureSvgRasterCache = Map<string, CaptureSvgRasterCacheEntry>;

export function createCaptureSvgRasterCache(): CaptureSvgRasterCache {
  return new Map();
}

function releaseCaptureSvgRasterEntry(entry: CaptureSvgRasterCacheEntry): void {
  entry.canvas.width = 0;
  entry.canvas.height = 0;
}

/** Release persistent slide rasters retained for a frame-capture session. */
export function releaseCaptureSvgRasterCache(cache: CaptureSvgRasterCache): void {
  cache.forEach(releaseCaptureSvgRasterEntry);
  cache.clear();
}

function parseAbsoluteSvgLength(value: string | null): number {
  if (!value) return 0;
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)(?:px)?\s*$/i.exec(value);
  return match ? Number.parseFloat(match[1]) : 0;
}

function svgViewBoxSize(svg: SVGSVGElement): CaptureRasterSize {
  const values = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values.length === 4 && values.every(Number.isFinite)) {
    return { width: Math.max(0, values[2]), height: Math.max(0, values[3]) };
  }
  return { width: 0, height: 0 };
}

function captureSvgRasterSize(
  clonedSvg: SVGSVGElement,
  originalSvg?: SVGSVGElement,
): CaptureRasterSize {
  const clonedRect = clonedSvg.getBoundingClientRect();
  const originalRect = originalSvg?.getBoundingClientRect();
  const clonedViewBox = svgViewBoxSize(clonedSvg);
  const originalViewBox = originalSvg ? svgViewBoxSize(originalSvg) : { width: 0, height: 0 };
  const width =
    clonedRect.width ||
    originalRect?.width ||
    parseAbsoluteSvgLength(clonedSvg.getAttribute('width')) ||
    (originalSvg ? parseAbsoluteSvgLength(originalSvg.getAttribute('width')) : 0) ||
    clonedViewBox.width ||
    originalViewBox.width;
  const height =
    clonedRect.height ||
    originalRect?.height ||
    parseAbsoluteSvgLength(clonedSvg.getAttribute('height')) ||
    (originalSvg ? parseAbsoluteSvgLength(originalSvg.getAttribute('height')) : 0) ||
    clonedViewBox.height ||
    originalViewBox.height;
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function copyCaptureSvgPresentation(svg: SVGSVGElement, canvas: HTMLCanvasElement): void {
  for (const attribute of Array.from(svg.attributes)) {
    if (
      attribute.name === 'id' ||
      attribute.name === 'class' ||
      attribute.name === 'style' ||
      attribute.name.startsWith('data-') ||
      attribute.name.startsWith('aria-')
    ) {
      canvas.setAttribute(attribute.name, attribute.value);
    }
  }
  canvas.dataset.svgCaptureClone = 'true';
}

function captureImageMimeType(source: string, blob: Blob): string {
  if (blob.type) return blob.type;
  const path = source.split(/[?#]/, 1)[0];
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

function blobToDataUrl(blob: Blob, source: string): Promise<string> {
  const typedBlob = blob.type ? blob : blob.slice(0, blob.size, captureImageMimeType(source, blob));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      'load',
      () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error(`Image could not be embedded for SVG capture: ${source}`));
      },
      { once: true },
    );
    reader.addEventListener(
      'error',
      () => reject(reader.error ?? new Error(`Image could not be read for SVG capture: ${source}`)),
      { once: true },
    );
    reader.readAsDataURL(typedBlob);
  });
}

function resolveCaptureImageDataUrl(
  source: string,
  cache: CaptureImageDataUrlCache,
): Promise<string> {
  const cached = cache.get(source);
  if (cached) return cached;

  const pending = fetch(source).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Image could not be loaded for SVG capture: ${source}`);
    }
    return blobToDataUrl(await response.blob(), source);
  });
  cache.set(source, pending);
  return pending;
}

function captureImageReference(element: Element): {
  source: string;
  replace: (dataUrl: string) => void;
} | null {
  if (element.localName === 'img') {
    const source = element.getAttribute('src') ?? '';
    return source
      ? {
          source,
          replace: (dataUrl) => element.setAttribute('src', dataUrl),
        }
      : null;
  }

  const xlinkNamespace = 'http://www.w3.org/1999/xlink';
  const source =
    element.getAttribute('href') ?? element.getAttributeNS(xlinkNamespace, 'href') ?? '';
  return source
    ? {
        source,
        replace: (dataUrl) => {
          if (element.hasAttribute('href')) element.setAttribute('href', dataUrl);
          if (element.hasAttributeNS(xlinkNamespace, 'href')) {
            element.setAttributeNS(xlinkNamespace, 'href', dataUrl);
          }
        },
      }
    : null;
}

/**
 * A serialized SVG is a new, standalone image document. Convert its external
 * image references to data URLs so provider-backed blob URLs (including pasted
 * screen clips) remain available while Chromium decodes that document.
 */
async function embedCaptureSvgImages(
  svg: SVGSVGElement,
  cache: CaptureImageDataUrlCache,
): Promise<void> {
  const references = Array.from(svg.querySelectorAll('image, img'))
    .map(captureImageReference)
    .filter((reference): reference is NonNullable<typeof reference> => reference !== null);

  for (const reference of references) {
    if (/^data:/i.test(reference.source) || reference.source.startsWith('#')) continue;
    const dataUrl = await resolveCaptureImageDataUrl(reference.source, cache);
    reference.replace(dataUrl);
  }
}

function captureSvgRasterCacheKey(svg: SVGSVGElement, index: number): string {
  const blockId = svg.dataset.blockId;
  return blockId ? `block:${blockId}` : `index:${index}`;
}

/**
 * Replace full-slide SVGs in html2canvas's disposable document clone with
 * ordinary canvases decoded through short-lived HTMLImageElements.
 *
 * Without this step html2canvas serializes every SVG to a unique data URL and
 * asks Chromium to decode it as a new full-resolution image on every frame.
 * Chromium can retain those decoded native surfaces long after the clone iframe
 * is removed, so long exports grow by several megabytes per frame. Chromium
 * cannot decode serialized SVG Blobs directly with createImageBitmap, so the
 * browser-compatible image decoder must run first.
 *
 * The slide raster cache is load-bearing for video exports: a moving PiP video
 * invalidates the complete frame on every tick, but the underlying slide SVG is
 * usually unchanged. Decode that 1080p surface once and reuse its canvas.
 */
export async function rasterizeCaptureSvgClones(
  originalRoot: HTMLElement,
  clonedRoot: HTMLElement,
  transientCanvases: HTMLCanvasElement[] = [],
  imageDataUrls: CaptureImageDataUrlCache = new Map(),
  rasterCache?: CaptureSvgRasterCache,
): Promise<HTMLCanvasElement[]> {
  const cache = rasterCache ?? createCaptureSvgRasterCache();
  const ownsRasterCache = rasterCache === undefined;
  const originalSvgs = Array.from(
    originalRoot.querySelectorAll<SVGSVGElement>(CAPTURE_SVG_SELECTOR),
  );
  const clonedSvgs = Array.from(clonedRoot.querySelectorAll<SVGSVGElement>(CAPTURE_SVG_SELECTOR));
  const activeCacheKeys = new Set<string>();

  try {
    for (const [index, svg] of clonedSvgs.entries()) {
      const originalSvg = originalSvgs[index];
      const { width, height } = captureSvgRasterSize(svg, originalSvg);
      const cacheKey = captureSvgRasterCacheKey(originalSvg ?? svg, index);
      activeCacheKeys.add(cacheKey);
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));

      let bitmap: ImageBitmap | null = null;
      let replacement: HTMLCanvasElement | null = null;
      let image: HTMLImageElement | null = null;
      let rasterCanvas: HTMLCanvasElement | null = null;
      try {
        await embedCaptureSvgImages(svg, imageDataUrls);
        const serializedSvg = new XMLSerializer().serializeToString(svg);
        let entry = cache.get(cacheKey);

        if (
          !entry ||
          entry.serializedSvg !== serializedSvg ||
          entry.width !== width ||
          entry.height !== height
        ) {
          const containsForeignObject = svg.querySelector('foreignObject') !== null;
          image = svg.ownerDocument.createElement('img');
          image.decoding = 'sync';
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializedSvg)}`;
          await waitForImageDecode(image);

          // A closeable bitmap gives Chromium an explicit lifetime for its native
          // decoded surface. Drawing the already-decoded image remains a bounded
          // fallback for browsers that cannot create a bitmap from it.
          //
          // Chromium taints ImageBitmaps created from SVGs containing foreignObject,
          // even though drawing the decoded HTMLImageElement directly remains
          // origin-clean.
          if (!containsForeignObject && typeof createImageBitmap === 'function') {
            try {
              bitmap = await createImageBitmap(image);
            } catch {
              bitmap = null;
            }
          }

          rasterCanvas = entry?.canvas ?? originalRoot.ownerDocument.createElement('canvas');
          if (rasterCanvas.width !== width || rasterCanvas.height !== height) {
            rasterCanvas.width = width;
            rasterCanvas.height = height;
          }
          const rasterContext = rasterCanvas.getContext('2d');
          if (!rasterContext) {
            throw new Error('Could not create the cached SVG raster canvas context');
          }
          rasterContext.clearRect(0, 0, width, height);
          rasterContext.drawImage(bitmap ?? image, 0, 0, width, height);
          entry = { serializedSvg, width, height, canvas: rasterCanvas };
          cache.set(cacheKey, entry);
        }

        replacement = svg.ownerDocument.createElement('canvas');
        replacement.width = width;
        replacement.height = height;
        copyCaptureSvgPresentation(svg, replacement);
        const context = replacement.getContext('2d');
        if (!context) {
          throw new Error('Could not create the SVG capture canvas context');
        }
        context.drawImage(entry.canvas, 0, 0, width, height);
        svg.replaceWith(replacement);
        transientCanvases.push(replacement);
      } catch (error) {
        if (replacement && !replacement.isConnected) {
          replacement.width = 0;
          replacement.height = 0;
        }
        if (rasterCanvas && cache.get(cacheKey)?.canvas !== rasterCanvas) {
          rasterCanvas.width = 0;
          rasterCanvas.height = 0;
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not rasterize a full-slide SVG for frame capture: ${detail}`);
      } finally {
        bitmap?.close();
        image?.removeAttribute('src');
      }
    }

    for (const [cacheKey, entry] of cache) {
      if (activeCacheKeys.has(cacheKey)) continue;
      releaseCaptureSvgRasterEntry(entry);
      cache.delete(cacheKey);
    }

    return transientCanvases;
  } finally {
    if (ownsRasterCache) releaseCaptureSvgRasterCache(cache);
  }
}

/** Release backing stores retained by canvases in html2canvas's clone iframe. */
export function releaseCaptureCloneCanvases(canvases: HTMLCanvasElement[]): void {
  canvases.forEach((canvas) => {
    canvas.width = 0;
    canvas.height = 0;
  });
}

function scheduledVideoIsVisual(video: HTMLVideoElement): boolean {
  return video.videoWidth > 0 && video.videoHeight > 0 && video.dataset.active === 'true';
}

function scheduledVideoPresentation(video: HTMLVideoElement): string | undefined {
  return video.closest<HTMLElement>(SCHEDULED_MEDIA_SELECTOR)?.dataset.presentation;
}

/**
 * Whether changing scheduled-video pixels can be drawn after the static player
 * raster without changing stacking order.
 */
export function canCompositeScheduledPipVideos(captureRoot: HTMLElement): boolean {
  const activeVisualVideos = Array.from(
    captureRoot.querySelectorAll<HTMLVideoElement>(SCHEDULED_VIDEO_SELECTOR),
  ).filter(scheduledVideoIsVisual);
  return (
    activeVisualVideos.length > 0 &&
    activeVisualVideos.every((video) => scheduledVideoPresentation(video) === 'picture-in-picture')
  );
}

export interface ScheduledVideoCompositePlan {
  /** Full-bleed background clips drawn beneath the cached base raster. */
  underlays: HTMLVideoElement[];
  /** PiP / full-frame clips drawn over the cached base raster. */
  overlays: HTMLVideoElement[];
}

export interface ScheduledVideoCompositeOptions {
  /**
   * Composite `full-frame` overlay clips after the base raster too. The
   * caller must then keep captions out of the base and draw them above the
   * overlays: full-frame clips sit above blocks but BELOW captions (z 10 vs
   * z 50). captureCanvasFrame does exactly that with its cached caption
   * layer; a caller that bakes captions into the base must leave this off.
   */
  includeFullFrameOverlays?: boolean;
}

/**
 * Decide whether every active visual scheduled clip can be composited around a
 * cached base raster instead of re-running html2canvas for each frame.
 *
 * This decision is load-bearing for long exports: the inline path clones the
 * whole capture document through html2canvas for EVERY frame, and Chromium
 * retains each detached clone document (layout, style, canvas stores) far
 * longer than one frame under a busy main thread — several MB per frame until
 * the renderer hits OOM. The composite path rasterizes the base only when it
 * visually changes and draws video frames directly, allocating nothing per
 * steady-state frame.
 *
 * `background` clips sit at the bottom of the player stack (z 0 — below blocks
 * and captions), so they draw first with the base over them, provided the base
 * was rasterized with a transparent backdrop (see
 * {@link clearScheduledUnderlayBackdrops}). PiP clips sit above everything the
 * base contains and draw last — the original fast path. `full-frame` overlay
 * clips join the overlay list when the caller opts in (see
 * {@link ScheduledVideoCompositeOptions.includeFullFrameOverlays}); both
 * groups render at z 10, so document order — which querySelectorAll already
 * yields — decides their stacking exactly like the live player.
 */
export function planScheduledVideoComposite(
  captureRoot: HTMLElement,
  options: ScheduledVideoCompositeOptions = {},
): ScheduledVideoCompositePlan | null {
  const activeVideos = Array.from(
    captureRoot.querySelectorAll<HTMLVideoElement>(SCHEDULED_VIDEO_SELECTOR),
  ).filter(scheduledVideoIsVisual);
  if (activeVideos.length === 0) return null;
  const underlays: HTMLVideoElement[] = [];
  const overlays: HTMLVideoElement[] = [];
  for (const video of activeVideos) {
    const presentation = scheduledVideoPresentation(video);
    if (presentation === 'background') underlays.push(video);
    else if (presentation === 'picture-in-picture') overlays.push(video);
    else if (presentation === 'full-frame' && options.includeFullFrameOverlays) {
      overlays.push(video);
    } else return null;
  }
  return { underlays, overlays };
}

/**
 * Cover-aware composite plan for one captured frame.
 *
 * While the managed cover block is mounted it is the document's face — the
 * thumbnail surface the author previews when configuring it — so scheduled
 * clips must not paint over it. Returning an empty plan keeps the composite
 * machinery (scheduled media and captions stay out of the base raster, which
 * therefore shows the cover, and captions still draw above it) while drawing
 * no video at all. Cover frames then reuse the cached base with zero
 * per-frame clone documents, and the plan returns to normal the moment the
 * cover unmounts.
 */
export function resolveScheduledVideoCompositePlan(
  captureRoot: HTMLElement,
  options: ScheduledVideoCompositeOptions = {},
): ScheduledVideoCompositePlan | null {
  const plan = planScheduledVideoComposite(captureRoot, options);
  if (!plan) return null;
  if (captureRoot.querySelector(COVER_BLOCK_SELECTOR)) {
    return { underlays: [], overlays: [] };
  }
  return plan;
}

/** Strip ancestor backgrounds (up to and including the cloned root) above targets. */
function clearAncestorBackdropsFor(clonedRoot: HTMLElement, targets: Iterable<HTMLElement>): void {
  for (const target of targets) {
    for (
      let element: HTMLElement | null = target.parentElement;
      element;
      element = element === clonedRoot ? null : element.parentElement
    ) {
      element.style.backgroundColor = 'transparent';
      element.style.backgroundImage = 'none';
    }
  }
}

/**
 * In html2canvas's disposable clone, strip backgrounds from every ancestor of
 * a background-presented media group. Those backgrounds paint beneath the
 * (removed) video in the live stacking order; left in the base they would end
 * up ON TOP of the composited underlay. The black engine backdrop the
 * compositor fills first stands in for them, exactly like html2canvas's own
 * opaque backdrop does on the inline path.
 */
export function clearScheduledUnderlayBackdrops(clonedRoot: HTMLElement): void {
  clearAncestorBackdropsFor(
    clonedRoot,
    Array.from(
      clonedRoot.querySelectorAll<HTMLElement>(
        `${SCHEDULED_MEDIA_SELECTOR}[data-presentation="background"]`,
      ),
    ),
  );
}

/** Caption overlays rendered by the player inside the capture root. */
export function getCaptureCaptionOverlays(captureRoot: HTMLElement): HTMLElement[] {
  return Array.from(captureRoot.querySelectorAll<HTMLElement>(CAPTION_OVERLAY_SELECTOR));
}

/**
 * In the caption layer's disposable clone, strip backgrounds from caption
 * ancestors. The layer must contain nothing but caption pixels over
 * transparency — an ancestor background (e.g. the themed player surface)
 * would otherwise blanket the composited videos beneath it.
 */
export function clearCaptionOverlayBackdrops(clonedRoot: HTMLElement): void {
  clearAncestorBackdropsFor(clonedRoot, getCaptureCaptionOverlays(clonedRoot));
}

/**
 * Prune the caption layer's clone down to caption overlays, their ancestors,
 * and their contents (plus the document head, whose styles captions inherit).
 * Everything else — blocks, SVG slides, scheduled videos — is already in the
 * base raster or composited separately.
 */
export function shouldIgnoreCaptureCaptionSibling(
  element: Element,
  captureRoot: HTMLElement,
  captionOverlays: readonly HTMLElement[],
): boolean {
  if (shouldIgnoreCaptureSibling(element, captureRoot)) return true;
  if (element === captureRoot || element.contains(captureRoot)) return false;
  if (!captureRoot.contains(element)) return false;
  return !captionOverlays.some(
    (overlay) => overlay === element || overlay.contains(element) || element.contains(overlay),
  );
}

/**
 * Conservative visual key for the caption layer. Caption text and inline
 * styles live in the overlay markup, so equal keys mean the cached caption
 * raster is still exact. Fonts participate because a late-loading caption
 * font changes glyph rendering without changing markup.
 */
export function getCaptionLayerStateKey(
  captionOverlays: readonly HTMLElement[],
  ownerDocument: Document,
  width: number,
  height: number,
): string {
  return JSON.stringify({
    markup: captionOverlays.map((overlay) => overlay.outerHTML),
    fontStatus: ownerDocument.fonts?.status ?? 'unsupported',
    width,
    height,
  });
}

function cssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cssRadius(value: string, width: number, height: number): number {
  if (value.trim().endsWith('%')) {
    return (cssPixelValue(value) / 100) * Math.min(width, height);
  }
  return cssPixelValue(value);
}

function applyFirstBoxShadow(
  context: CanvasRenderingContext2D,
  boxShadow: string,
  scaleX: number,
  scaleY: number,
): void {
  if (!boxShadow || boxShadow === 'none') return;
  const color = boxShadow.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/i)?.[0];
  if (!color) return;
  const lengths = Array.from(
    boxShadow.replace(color, '').matchAll(/(-?\d+(?:\.\d+)?)px/g),
    (match) => Number.parseFloat(match[1]),
  );
  context.shadowColor = color;
  context.shadowOffsetX = (lengths[0] ?? 0) * scaleX;
  context.shadowOffsetY = (lengths[1] ?? 0) * scaleY;
  context.shadowBlur = (lengths[2] ?? 0) * Math.max(scaleX, scaleY);
}

function addRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, Math.max(0, radius));
  } else {
    context.rect(x, y, width, height);
  }
}

/**
 * Draw active scheduled PiP frames over an already-rasterized player.
 *
 * The destination is reused for the export session, so both the background
 * and live overlay keep bounded native canvas storage.
 */
export function compositeScheduledPipVideos(
  captureRoot: HTMLElement,
  destination: HTMLCanvasElement,
): number {
  const videos = Array.from(
    captureRoot.querySelectorAll<HTMLVideoElement>(SCHEDULED_VIDEO_SELECTOR),
  ).filter(
    (video) =>
      scheduledVideoIsVisual(video) && scheduledVideoPresentation(video) === 'picture-in-picture',
  );
  return drawScheduledVideosOnto(destination, captureRoot, videos);
}

/**
 * Draw scheduled video frames onto the reusable output canvas with their
 * authored CSS geometry (box, borders, radius, shadow, object-fit). Works for
 * corner PiP boxes and full-bleed background clips alike — the caller decides
 * stacking by when it invokes this relative to drawing the base raster.
 */
export function drawScheduledVideosOnto(
  destination: HTMLCanvasElement,
  captureRoot: HTMLElement,
  videos: readonly HTMLVideoElement[],
): number {
  const context = destination.getContext('2d');
  if (!context) throw new Error('Could not create the scheduled-video compositor canvas context');
  const rootRect = captureRoot.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return 0;
  const scaleX = destination.width / rootRect.width;
  const scaleY = destination.height / rootRect.height;

  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = video.ownerDocument.defaultView?.getComputedStyle(video);
    if (
      !style ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      continue;
    }
    const opacity = Number.parseFloat(style.opacity || '1');
    if (opacity <= 0) continue;

    const borderLeft = cssPixelValue(style.borderLeftWidth);
    const borderRight = cssPixelValue(style.borderRightWidth);
    const borderTop = cssPixelValue(style.borderTopWidth);
    const borderBottom = cssPixelValue(style.borderBottomWidth);
    const contentWidth = Math.max(1, rect.width - borderLeft - borderRight);
    const contentHeight = Math.max(1, rect.height - borderTop - borderBottom);
    const outerX = (rect.left - rootRect.left) * scaleX;
    const outerY = (rect.top - rootRect.top) * scaleY;
    const outerWidth = rect.width * scaleX;
    const outerHeight = rect.height * scaleY;
    const innerX = outerX + borderLeft * scaleX;
    const innerY = outerY + borderTop * scaleY;
    const innerWidth = contentWidth * scaleX;
    const innerHeight = contentHeight * scaleY;
    const outerRadius =
      cssRadius(style.borderTopLeftRadius, rect.width, rect.height) * Math.max(scaleX, scaleY);
    const innerRadius = Math.max(
      0,
      outerRadius - Math.max(borderLeft * scaleX, borderTop * scaleY),
    );
    const source = videoFrameRect(
      video.videoWidth,
      video.videoHeight,
      contentWidth,
      contentHeight,
      style.objectFit || 'fill',
    );

    context.save();
    context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
    applyFirstBoxShadow(context, style.boxShadow, scaleX, scaleY);
    addRoundedRect(context, outerX, outerY, outerWidth, outerHeight, outerRadius);
    context.fillStyle =
      style.borderTopStyle === 'none' || borderTop <= 0
        ? 'rgba(0, 0, 0, 0.001)'
        : style.borderTopColor;
    context.fill();
    context.shadowColor = 'rgba(0, 0, 0, 0)';
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    addRoundedRect(context, innerX, innerY, innerWidth, innerHeight, innerRadius);
    context.clip();
    context.drawImage(
      video,
      source.sx,
      source.sy,
      source.sw,
      source.sh,
      innerX,
      innerY,
      innerWidth,
      innerHeight,
    );
    context.restore();
  }

  return videos.length;
}

export interface FrameVisualStateKeyOptions {
  /** Ignore player-level scheduled video clocks composited after the base raster. */
  ignoreScheduledVideoFrames?: boolean;
}

/**
 * Describe everything in the capture subtree that can affect its pixels at a
 * point on the document timeline. Equal keys mean the previous raster can be
 * reused safely. This is deliberately conservative for visual sources whose
 * internal state cannot be inspected (animated images, canvas, embeds, SMIL).
 */
export function getFrameVisualStateKey(
  captureRoot: HTMLElement,
  timelineTime: number,
  options: FrameVisualStateKeyOptions = {},
): string {
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

  const videoStates = Array.from(captureRoot.querySelectorAll('video'))
    .filter(
      (video) =>
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        (!options.ignoreScheduledVideoFrames || !video.closest(SCHEDULED_MEDIA_SELECTOR)),
    )
    .map(
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
  const mediaResolutionTrackerRef = useRef<CaptureMediaResolutionTracker | null>(null);
  const ownsMediaProviderRef = useRef(false);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureBaseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastVisualStateKeyRef = useRef<string | null>(null);
  const hasCapturedFrameRef = useRef(false);
  const decodedImagesRef = useRef(new WeakSet<HTMLImageElement>());
  const captureImageDataUrlsRef = useRef<CaptureImageDataUrlCache>(new Map());
  const captureSvgRasterCacheRef = useRef<CaptureSvgRasterCache>(createCaptureSvgRasterCache());
  const primedCaptureVideosRef = useRef(new WeakSet<HTMLVideoElement>());
  const dimensionsRef = useRef<{ width: number; height: number }>({ width: 1920, height: 1080 });
  /**
   * Cached caption layer for the composite fast path. Captions sit above
   * every scheduled clip (z 50), so composite mode lifts them out of the base
   * raster and draws this transparent layer last. Re-rasterized only when the
   * caption markup changes (cue cadence — seconds), never per frame.
   */
  const captionLayerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captionLayerKeyRef = useRef<string | null>(null);
  const captionLayerHasContentRef = useRef(false);

  const init = useCallback(
    async (
      doc: Doc,
      renderOptions: FrameCaptureRenderOptions,
      captionMode?: CaptionMode,
    ): Promise<number> => {
      // Clean up any existing container.
      // Defer unmount to avoid "synchronously unmount a root while React
      // was already rendering" when init() is called from a React handler.
      if (
        rootRef.current ||
        containerRef.current ||
        mediaProviderRef.current ||
        captureCanvasRef.current ||
        captureBaseCanvasRef.current
      ) {
        const oldRoot = rootRef.current;
        const oldContainer = containerRef.current;
        const oldMediaProvider = mediaProviderRef.current;
        const oldOwnsMediaProvider = ownsMediaProviderRef.current;
        const oldCaptureCanvas = captureCanvasRef.current;
        const oldCaptureBaseCanvas = captureBaseCanvasRef.current;
        const oldCaptionLayerCanvas = captionLayerCanvasRef.current;
        rootRef.current = null;
        containerRef.current = null;
        renderAPIRef.current = null;
        mediaProviderRef.current = null;
        mediaResolutionTrackerRef.current = null;
        ownsMediaProviderRef.current = false;
        captureCanvasRef.current = null;
        captureBaseCanvasRef.current = null;
        captionLayerCanvasRef.current = null;
        captionLayerKeyRef.current = null;
        captionLayerHasContentRef.current = false;
        lastVisualStateKeyRef.current = null;
        hasCapturedFrameRef.current = false;
        decodedImagesRef.current = new WeakSet<HTMLImageElement>();
        captureImageDataUrlsRef.current.clear();
        releaseCaptureSvgRasterCache(captureSvgRasterCacheRef.current);
        captureSvgRasterCacheRef.current = createCaptureSvgRasterCache();
        primedCaptureVideosRef.current = new WeakSet<HTMLVideoElement>();
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            if (oldRoot) oldRoot.unmount();
            if (oldContainer) oldContainer.remove();
            if (oldOwnsMediaProvider) oldMediaProvider?.dispose();
            if (oldCaptureCanvas) {
              oldCaptureCanvas.width = 0;
              oldCaptureCanvas.height = 0;
            }
            if (oldCaptureBaseCanvas) {
              oldCaptureBaseCanvas.width = 0;
              oldCaptureBaseCanvas.height = 0;
            }
            if (oldCaptionLayerCanvas) {
              oldCaptionLayerCanvas.width = 0;
              oldCaptionLayerCanvas.height = 0;
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
      const captureBaseCanvas = document.createElement('canvas');
      captureBaseCanvas.width = width;
      captureBaseCanvas.height = height;
      captureBaseCanvas.style.width = `${width}px`;
      captureBaseCanvas.style.height = `${height}px`;
      captureBaseCanvasRef.current = captureBaseCanvas;
      captionLayerKeyRef.current = null;
      captionLayerHasContentRef.current = false;
      lastVisualStateKeyRef.current = null;
      hasCapturedFrameRef.current = false;
      decodedImagesRef.current = new WeakSet<HTMLImageElement>();
      captureImageDataUrlsRef.current.clear();
      releaseCaptureSvgRasterCache(captureSvgRasterCacheRef.current);
      captureSvgRasterCacheRef.current = createCaptureSvgRasterCache();
      primedCaptureVideosRef.current = new WeakSet<HTMLVideoElement>();

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
        : (renderOptions.mediaProvider ?? null);
      mediaProviderRef.current = mediaProvider;
      const mediaResolutionTracker = mediaProvider
        ? createCaptureMediaResolutionTracker(mediaProvider)
        : null;
      mediaResolutionTrackerRef.current = mediaResolutionTracker;
      ownsMediaProviderRef.current = !!renderOptions.images;

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
        theme: renderOptions.theme,
        videoPresentation: renderOptions.videoPresentation,
        pipSize: renderOptions.pipSize,
        pipShape: renderOptions.pipShape,
        pipPosition: renderOptions.pipPosition,
        showCoverSlide: renderOptions.showCoverSlide,
        coverSlideTemplate: renderOptions.coverSlideTemplate,
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
        root.render(
          createElement(
            MediaContext.Provider,
            { value: mediaResolutionTracker!.provider },
            playerElement,
          ),
        );
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

        void renderAPIReady.then(async (api) => {
          try {
            const captureRoot = container.querySelector('#squisq-capture-root');
            if (!(captureRoot instanceof HTMLElement)) {
              throw new Error('Capture root element not found after player initialization.');
            }
            await waitForCaptureMediaResolutions(mediaResolutionTrackerRef.current);
            await waitForCaptureAssets(captureRoot, decodedImagesRef.current);
            await primeIndeterminateCaptureVideos(captureRoot, primedCaptureVideosRef.current);
            clearTimeout(timeout);
            resolve(api.getDuration());
          } catch (assetError) {
            clearTimeout(timeout);
            reject(assetError);
          }
        });
      });
    },
    [],
  );

  const setCoverVisible = useCallback(async (visible: boolean): Promise<void> => {
    const api = renderAPIRef.current;
    if (!api) throw new Error('Frame capture not initialized â€” call init() first');
    if (visible) await api.showCover();
    else await api.hideCover();
    // Cover visibility is outside the document clock, so invalidate the
    // repeated-frame cache even when the next capture seeks to the same time.
    lastVisualStateKeyRef.current = null;
  }, []);

  const captureCanvasFrame = useCallback(
    async (time: number, options: FrameCaptureOptions = {}): Promise<HTMLCanvasElement> => {
      const container = containerRef.current;
      const api = renderAPIRef.current;
      const captureCanvas = captureCanvasRef.current;
      const captureBaseCanvas = captureBaseCanvasRef.current;
      if (!container || !api || !captureCanvas || !captureBaseCanvas) {
        throw new Error('Frame capture not initialized — call init() first');
      }

      const { width, height } = dimensionsRef.current;

      const root = container.querySelector('#squisq-capture-root') as HTMLElement;
      if (!root) {
        throw new Error('Capture root element not found');
      }

      // Prime before seeking. Media URL resolution and cover transitions can
      // mount or reload a recorder WebM after init(); seeking that unindexed
      // duration=Infinity source first fails before the old post-seek repair
      // ever gets a chance to run.
      await primeIndeterminateCaptureVideos(root, primedCaptureVideosRef.current);
      try {
        await api.seekTo(time);
      } catch (seekError) {
        // A clip whose source resolved during this seek is still unindexed:
        // Chromium clamps every seek on a duration=Infinity WebM back to zero,
        // so the frame barrier times out. Index whatever arrived late and retry
        // once rather than failing the whole export on a mount race.
        if (!(await primeIndeterminateCaptureVideos(root, primedCaptureVideosRef.current))) {
          throw seekError;
        }
        await api.seekTo(time);
      }

      if (await primeIndeterminateCaptureVideos(root, primedCaptureVideosRef.current)) {
        // A video mounted during the seek was restored to its prior frame.
        // Run the barrier again so it reaches the requested document time.
        await api.seekTo(time);
      }

      const renderedTime = api.getRenderedTime();
      if (Math.abs(renderedTime - time) > RENDER_TIME_EPSILON_SECONDS) {
        throw new Error(
          `Player committed ${renderedTime.toFixed(6)}s while capture requested ${time.toFixed(6)}s.`,
        );
      }
      await waitForCaptureMediaResolutions(mediaResolutionTrackerRef.current);
      await waitForCaptureAssets(root, decodedImagesRef.current);

      // Full-frame clips are always composited: captions are lifted into
      // their own cached top layer below, and a mounted cover suppresses
      // video drawing entirely (see resolveScheduledVideoCompositePlan).
      const compositePlan = resolveScheduledVideoCompositePlan(root, {
        includeFullFrameOverlays: true,
      });
      const hasUnderlays = compositePlan !== null && compositePlan.underlays.length > 0;
      // Distinct cache namespaces: an underlay base is rasterized transparent
      // with ancestor backdrops stripped and must never be reused as an opaque
      // base (or vice versa) across a presentation change.
      const rasterMode = compositePlan ? (hasUnderlays ? 'base-underlay' : 'base') : 'full';
      const visualStateKey = options.reuseIfUnchanged
        ? `${rasterMode}:${getFrameVisualStateKey(root, time, {
            ignoreScheduledVideoFrames: compositePlan !== null,
          })}`
        : null;
      const shouldRasterize =
        visualStateKey === null ||
        !hasCapturedFrameRef.current ||
        lastVisualStateKeyRef.current !== visualStateKey;
      if (!shouldRasterize && !compositePlan) return captureCanvas;
      const rasterCanvas = compositePlan ? captureBaseCanvas : captureCanvas;

      // html2canvas scales/translates a supplied context but does not reset it
      // between calls. Restore the reusable surface to its initial state and
      // clear the previous frame before rendering the next one.
      const captureContext = rasterCanvas.getContext('2d');
      if (!captureContext) throw new Error('Could not create the frame capture canvas context');
      if (shouldRasterize) {
        captureContext.setTransform(1, 0, 0, 1, 0, 0);
        captureContext.clearRect(0, 0, width, height);
      }

      // Render the DOM to the bounded, reusable canvas via html2canvas.
      // We're in the same document (no iframe), so COEP doesn't block cloning.
      const transientCloneCanvases: HTMLCanvasElement[] = [];
      if (shouldRasterize) {
        try {
          await html2canvas(root, {
            canvas: rasterCanvas,
            width,
            height,
            scale: 1,
            useCORS: true,
            allowTaint: true,
            // An underlay base must stay transparent so the background video
            // composited beneath it shows through everything the player does
            // not paint. The compositor restores the opaque black backdrop.
            backgroundColor: hasUnderlays ? null : '#000000',
            logging: false,
            onclone: async (_clonedDocument, clonedRoot) => {
              if (compositePlan) {
                if (hasUnderlays) clearScheduledUnderlayBackdrops(clonedRoot);
                clonedRoot
                  .querySelectorAll(SCHEDULED_MEDIA_SELECTOR)
                  .forEach((element) => element.remove());
                // Captions draw above every composited clip, so they leave
                // the base and return as the separately cached top layer.
                clonedRoot
                  .querySelectorAll(CAPTION_OVERLAY_SELECTOR)
                  .forEach((element) => element.remove());
              }
              transientCloneCanvases.push(...prepareScheduledVideoClones(root, clonedRoot));
              await rasterizeCaptureSvgClones(
                root,
                clonedRoot,
                transientCloneCanvases,
                captureImageDataUrlsRef.current,
                captureSvgRasterCacheRef.current,
              );
            },
            // html2canvas starts cloning at documentElement. Do not clone the rest
            // of the editor/site UI on every frame; only the capture root, its
            // ancestors, descendants, and document styles can affect this render.
            ignoreElements: (element) => shouldIgnoreCaptureSibling(element, root),
          });
        } finally {
          releaseCaptureCloneCanvases(transientCloneCanvases);
        }

        hasCapturedFrameRef.current = true;
        lastVisualStateKeyRef.current = visualStateKey;
      }

      if (compositePlan) {
        const outputContext = captureCanvas.getContext('2d');
        if (!outputContext) throw new Error('Could not create the frame output canvas context');
        outputContext.setTransform(1, 0, 0, 1, 0, 0);
        outputContext.clearRect(0, 0, width, height);
        // Engine backdrop → background clips → base (blocks, with alpha where
        // underlays exist) → PiP / full-frame clips → captions. This matches
        // live stacking exactly: media z 0 under blocks, scheduled clips at
        // z 10 in document order, captions at z 50 above everything.
        outputContext.fillStyle = '#000000';
        outputContext.fillRect(0, 0, width, height);
        drawScheduledVideosOnto(captureCanvas, root, compositePlan.underlays);
        outputContext.drawImage(captureBaseCanvas, 0, 0);
        drawScheduledVideosOnto(captureCanvas, root, compositePlan.overlays);

        // ── Caption layer ─────────────────────────────────────────────
        // Rasterized in isolation (blocks, slides, and scheduled media are
        // pruned from its clone) and cached until the caption markup changes
        // — cue cadence, not frame cadence. Between cue changes a composite
        // frame allocates no clone document at all.
        const captionOverlays = getCaptureCaptionOverlays(root);
        if (captionOverlays.length > 0) {
          const hasCaptionText = captionOverlays.some(
            (overlay) => (overlay.textContent ?? '').trim().length > 0,
          );
          const captionKey = getCaptionLayerStateKey(
            captionOverlays,
            root.ownerDocument,
            width,
            height,
          );
          if (captionLayerKeyRef.current !== captionKey) {
            if (hasCaptionText) {
              let captionCanvas = captionLayerCanvasRef.current;
              if (!captionCanvas) {
                captionCanvas = document.createElement('canvas');
                captionLayerCanvasRef.current = captionCanvas;
              }
              if (captionCanvas.width !== width || captionCanvas.height !== height) {
                captionCanvas.width = width;
                captionCanvas.height = height;
              }
              const captionContext = captionCanvas.getContext('2d');
              if (!captionContext) {
                throw new Error('Could not create the caption layer canvas context');
              }
              captionContext.setTransform(1, 0, 0, 1, 0, 0);
              captionContext.clearRect(0, 0, width, height);
              await html2canvas(root, {
                canvas: captionCanvas,
                width,
                height,
                scale: 1,
                useCORS: true,
                allowTaint: true,
                backgroundColor: null,
                logging: false,
                onclone: (_clonedDocument, clonedRoot) => {
                  clearCaptionOverlayBackdrops(clonedRoot);
                },
                ignoreElements: (element) =>
                  shouldIgnoreCaptureCaptionSibling(element, root, captionOverlays),
              });
            }
            captionLayerKeyRef.current = captionKey;
            captionLayerHasContentRef.current = hasCaptionText;
          }
          if (captionLayerHasContentRef.current && captionLayerCanvasRef.current) {
            // Honor a mid-fade computed opacity so cue transitions keep their
            // authored ease instead of popping.
            const overlayOpacity = Number.parseFloat(
              root.ownerDocument.defaultView?.getComputedStyle(captionOverlays[0]).opacity ?? '1',
            );
            if (!Number.isFinite(overlayOpacity) || overlayOpacity > 0) {
              outputContext.save();
              outputContext.globalAlpha = Number.isFinite(overlayOpacity) ? overlayOpacity : 1;
              outputContext.drawImage(captionLayerCanvasRef.current, 0, 0);
              outputContext.restore();
            }
          }
        }
      }

      // The reusable canvas is returned directly for the main-thread encoder.
      return captureCanvas;
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
    if (ownsMediaProviderRef.current) mediaProviderRef.current?.dispose();
    mediaProviderRef.current = null;
    mediaResolutionTrackerRef.current = null;
    ownsMediaProviderRef.current = false;
    if (captureCanvasRef.current) {
      captureCanvasRef.current.width = 0;
      captureCanvasRef.current.height = 0;
      captureCanvasRef.current = null;
    }
    if (captureBaseCanvasRef.current) {
      captureBaseCanvasRef.current.width = 0;
      captureBaseCanvasRef.current.height = 0;
      captureBaseCanvasRef.current = null;
    }
    if (captionLayerCanvasRef.current) {
      captionLayerCanvasRef.current.width = 0;
      captionLayerCanvasRef.current.height = 0;
      captionLayerCanvasRef.current = null;
    }
    captionLayerKeyRef.current = null;
    captionLayerHasContentRef.current = false;
    lastVisualStateKeyRef.current = null;
    hasCapturedFrameRef.current = false;
    decodedImagesRef.current = new WeakSet<HTMLImageElement>();
    captureImageDataUrlsRef.current.clear();
    releaseCaptureSvgRasterCache(captureSvgRasterCacheRef.current);
    captureSvgRasterCacheRef.current = createCaptureSvgRasterCache();
    primedCaptureVideosRef.current = new WeakSet<HTMLVideoElement>();
    renderAPIRef.current = null;
  }, []);

  // Return a stable object to prevent useEffect cleanup loops
  // in consumers that depend on the handle reference.
  return useMemo(
    () => ({ init, setCoverVisible, captureFrame, captureCanvasFrame, destroy }),
    [init, setCoverVisible, captureFrame, captureCanvasFrame, destroy],
  );
}

import { renderHook } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearScheduledUnderlayBackdrops,
  coverSourceRect,
  createCaptureSvgRasterCache,
  createInlineProvider,
  canCompositeScheduledPipVideos,
  compositeScheduledPipVideos,
  drawScheduledVideosOnto,
  getFrameVisualStateKey,
  planScheduledVideoComposite,
  prepareScheduledVideoClones,
  primeIndeterminateCaptureVideos,
  rasterizeCaptureSvgClones,
  releaseCaptureCloneCanvases,
  releaseCaptureSvgRasterCache,
  useFrameCapture,
  waitForCaptureAssets,
  waitForVisualUpdate,
} from '../hooks/useFrameCapture';

const frameCaptureMocks = vi.hoisted(() => {
  const render = vi.fn();
  const unmount = vi.fn();
  return {
    render,
    unmount,
    createRoot: vi.fn(() => ({ render, unmount })),
    html2canvas: vi.fn(),
  };
});

vi.mock('react-dom/client', () => ({ createRoot: frameCaptureMocks.createRoot }));
vi.mock('@bendyline/squisq-react', () => ({
  DocPlayer: 'mock-doc-player',
  MediaContext: { Provider: 'mock-media-provider' },
}));
vi.mock('html2canvas', () => ({ default: frameCaptureMocks.html2canvas }));

const originalImageDecodeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  'decode',
);

function stubImageDecode(implementation: (image: HTMLImageElement) => Promise<void>) {
  const decode = vi.fn(function (this: HTMLImageElement) {
    return implementation(this);
  });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: decode,
  });
  return decode;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalImageDecodeDescriptor) {
    Object.defineProperty(HTMLImageElement.prototype, 'decode', originalImageDecodeDescriptor);
  } else {
    Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
  }
});

describe('waitForVisualUpdate', () => {
  it('settles through its timeout when Chromium suspends animation frames', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const pending = waitForVisualUpdate(2);
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toBeUndefined();
    expect(requestFrame).toHaveBeenCalledOnce();
  });

  it('uses an immediate task when the document is already hidden', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);

    const pending = waitForVisualUpdate(2);
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toBeUndefined();
    expect(requestFrame).not.toHaveBeenCalled();
  });
});

describe('createInlineProvider', () => {
  it('reports media metadata, MIME types, and revokes every generated URL', async () => {
    const blobs: Blob[] = [];
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return `blob:${blobs.length}`;
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const provider = createInlineProvider(
      new Map([
        ['photo.JPG', new Uint8Array([1, 2, 3]).buffer],
        ['drawing.svg', new Uint8Array([4, 5]).buffer],
        ['recording.webm', new Uint8Array([6]).buffer],
        ['unknown.bin', new Uint8Array([7]).buffer],
      ]),
    );

    expect(create).toHaveBeenCalledTimes(4);
    expect(blobs.map((blob) => blob.type)).toEqual([
      'image/jpeg',
      'image/svg+xml',
      'video/webm',
      'application/octet-stream',
    ]);
    expect(await provider.resolveUrl('photo.JPG')).toBe('blob:1');
    expect(await provider.resolveUrl('not-present.png')).toBe('not-present.png');
    expect(await provider.listMedia()).toEqual([
      { name: 'photo.JPG', mimeType: 'image/jpeg', size: 3 },
      { name: 'drawing.svg', mimeType: 'image/svg+xml', size: 2 },
      { name: 'recording.webm', mimeType: 'video/webm', size: 1 },
      { name: 'unknown.bin', mimeType: 'application/octet-stream', size: 1 },
    ]);
    await expect(provider.addMedia('new.png', new ArrayBuffer(0), 'image/png')).rejects.toThrow(
      'Read-only',
    );
    await expect(provider.removeMedia('photo.JPG')).rejects.toThrow('Read-only');

    provider.dispose();

    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:1', 'blob:2', 'blob:3', 'blob:4']);
    expect(await provider.resolveUrl('photo.JPG')).toBe('photo.JPG');
  });
});

describe('waitForCaptureAssets', () => {
  it('decodes each newly mounted image once', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<img src="frame.png">';
    const image = root.querySelector('img')!;
    const decode = vi.fn(async () => undefined);
    Object.defineProperty(image, 'decode', { configurable: true, value: decode });
    const decoded = new WeakSet<HTMLImageElement>();

    await waitForCaptureAssets(root, decoded);
    await waitForCaptureAssets(root, decoded);

    expect(decode).toHaveBeenCalledOnce();
  });

  it('surfaces image decode failures instead of capturing a blank asset', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<img src="broken.png">';
    const image = root.querySelector('img')!;
    Object.defineProperty(image, 'decode', {
      configurable: true,
      value: vi.fn(async () => {
        throw new Error('decode failed');
      }),
    });

    await expect(waitForCaptureAssets(root)).rejects.toThrow('decode failed');
  });
});

describe('primeIndeterminateCaptureVideos', () => {
  it('indexes a recorder WebM once and restores its current frame', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<video src="camera.webm"></video>';
    const video = root.querySelector('video')!;
    let duration = Number.POSITIVE_INFINITY;
    let currentTime = 12.5;
    let seeking = false;
    const assignments: number[] = [];
    Object.defineProperties(video, {
      currentSrc: { configurable: true, get: () => 'blob:camera-webm' },
      duration: { configurable: true, get: () => duration },
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          assignments.push(value);
          seeking = true;
          queueMicrotask(() => {
            if (value > 1e100) {
              duration = 304.534;
              currentTime = duration;
              video.dispatchEvent(new Event('durationchange'));
            } else {
              currentTime = value;
            }
            seeking = false;
            video.dispatchEvent(new Event('seeked'));
          });
        },
      },
      readyState: { configurable: true, get: () => HTMLMediaElement.HAVE_ENOUGH_DATA },
      seeking: { configurable: true, get: () => seeking },
      pause: { configurable: true, value: vi.fn() },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    });
    const primed = new WeakSet<HTMLVideoElement>();

    expect(await primeIndeterminateCaptureVideos(root, primed)).toBe(1);
    expect(assignments).toEqual([1e101, 12.5]);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(currentTime).toBe(12.5);
    expect(video.dataset.captureSequential).toBe('true');

    // An unchanged primed element remains a no-op.
    expect(await primeIndeterminateCaptureVideos(root, primed)).toBe(0);
    expect(assignments).toEqual([1e101, 12.5]);

    // React may keep this element while its src reloads. The new resource
    // starts indeterminate again and must not be skipped because of WeakSet.
    duration = Number.POSITIVE_INFINITY;
    expect(await primeIndeterminateCaptureVideos(root, primed)).toBe(1);
    expect(assignments).toEqual([1e101, 12.5, 1e101, 12.5]);
  });

  it('indexes a scheduled clip whose provider URL resolves after the first pass', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<video></video>';
    const video = root.querySelector('video')!;
    let source = '';
    let duration = Number.NaN;
    let currentTime = 0;
    let seeking = false;
    const assignments: number[] = [];
    Object.defineProperties(video, {
      currentSrc: { configurable: true, get: () => source },
      duration: { configurable: true, get: () => duration },
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          assignments.push(value);
          seeking = true;
          queueMicrotask(() => {
            if (value > 1e100) {
              duration = 304.534;
              currentTime = duration;
              video.dispatchEvent(new Event('durationchange'));
            } else {
              currentTime = value;
            }
            seeking = false;
            video.dispatchEvent(new Event('seeked'));
          });
        },
      },
      readyState: {
        configurable: true,
        get: () => (source ? HTMLMediaElement.HAVE_ENOUGH_DATA : HTMLMediaElement.HAVE_NOTHING),
      },
      seeking: { configurable: true, get: () => seeking },
      pause: { configurable: true, value: vi.fn() },
      videoWidth: { configurable: true, get: () => (source ? 640 : 0) },
      videoHeight: { configurable: true, get: () => (source ? 480 : 0) },
    });
    const primed = new WeakSet<HTMLVideoElement>();

    // MediaClipLayer mounts the element before MediaProvider resolves its URL.
    expect(await primeIndeterminateCaptureVideos(root, primed)).toBe(0);
    expect(assignments).toEqual([]);

    // The recorder WebM lands moments later. Remembering the empty element as
    // primed would leave duration=Infinity, and Chromium clamps every seek on
    // such a source back to zero.
    source = 'blob:camera-webm';
    duration = Number.POSITIVE_INFINITY;

    expect(await primeIndeterminateCaptureVideos(root, primed)).toBe(1);
    expect(assignments).toEqual([1e101, 0]);
    expect(video.dataset.captureSequential).toBe('true');
    expect(await primeIndeterminateCaptureVideos(root, primed)).toBe(0);
  });

  it('skips an Opus-only source authored with a video element', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<video src="audio/narration.webm"></video>';
    const video = root.querySelector('video')!;
    const setCurrentTime = vi.fn();
    Object.defineProperties(video, {
      currentSrc: { configurable: true, get: () => 'blob:narration-webm' },
      duration: { configurable: true, value: Number.POSITIVE_INFINITY },
      currentTime: { configurable: true, get: () => 66, set: setCurrentTime },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_METADATA },
      videoWidth: { configurable: true, value: 0 },
      videoHeight: { configurable: true, value: 0 },
      pause: { configurable: true, value: vi.fn() },
    });
    const primed = new WeakSet<HTMLVideoElement>();

    expect(await primeIndeterminateCaptureVideos(root, primed)).toBe(0);
    expect(await primeIndeterminateCaptureVideos(root, primed)).toBe(0);
    expect(setCurrentTime).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.dataset.captureSequential).toBeUndefined();
  });

  it('leaves ordinary finite-duration video at its current frame', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<video src="indexed.mp4"></video>';
    const video = root.querySelector('video')!;
    const setCurrentTime = vi.fn();
    Object.defineProperties(video, {
      currentSrc: { configurable: true, get: () => 'blob:indexed-mp4' },
      duration: { configurable: true, value: 30 },
      currentTime: { configurable: true, get: () => 4, set: setCurrentTime },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_METADATA },
      pause: { configurable: true, value: vi.fn() },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    });

    expect(await primeIndeterminateCaptureVideos(root)).toBe(0);
    expect(setCurrentTime).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
  });
});

describe('getFrameVisualStateKey', () => {
  it('reuses static DOM but invalidates for DOM changes and opaque animated media', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div>Static hold</div>';

    expect(getFrameVisualStateKey(root, 0)).toBe(getFrameVisualStateKey(root, 3));

    const beforeChange = getFrameVisualStateKey(root, 0);
    root.innerHTML = '<div>Next slide</div>';
    expect(getFrameVisualStateKey(root, 0)).not.toBe(beforeChange);

    root.innerHTML = '<img src="loop.gif" alt="Animated">';
    expect(getFrameVisualStateKey(root, 0)).not.toBe(getFrameVisualStateKey(root, 0.1));
  });

  it('tracks animation progress but reuses a settled animation hold', () => {
    const root = document.createElement('div');
    let progress = 0.25;
    Object.defineProperty(root, 'getAnimations', {
      configurable: true,
      value: () => [
        {
          playState: 'paused',
          effect: { getComputedTiming: () => ({ progress, currentIteration: 0 }) },
        },
      ],
    });

    const quarterFrame = getFrameVisualStateKey(root, 0.25);
    progress = 0.5;
    expect(getFrameVisualStateKey(root, 0.5)).not.toBe(quarterFrame);

    progress = 1;
    expect(getFrameVisualStateKey(root, 1)).toBe(getFrameVisualStateKey(root, 3));
  });

  it('can exclude scheduled video clocks from a separately-composited base raster', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="doc-player__media-clips" data-presentation="picture-in-picture">' +
      '<video data-clip-id="camera" data-active="true"></video></div>';
    const video = root.querySelector('video')!;
    let currentTime = 1;
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => currentTime },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    });

    const fullAtOne = getFrameVisualStateKey(root, 1);
    const baseAtOne = getFrameVisualStateKey(root, 1, {
      ignoreScheduledVideoFrames: true,
    });
    currentTime = 2;

    expect(getFrameVisualStateKey(root, 2)).not.toBe(fullAtOne);
    expect(getFrameVisualStateKey(root, 2, { ignoreScheduledVideoFrames: true })).toBe(baseAtOne);
  });
});

describe('capture clone raster lifetime', () => {
  it('replaces full-slide SVGs with closeable bitmaps and releases their canvas stores', async () => {
    const originalRoot = document.createElement('div');
    originalRoot.innerHTML =
      '<svg class="block-svg" viewBox="0 0 1920 1080" data-block-id="intro"></svg>';
    const clonedRoot = document.createElement('div');
    clonedRoot.innerHTML =
      '<svg class="block-svg" viewBox="0 0 1920 1080" data-block-id="intro" ' +
      'style="display:block;opacity:0.75"></svg>';
    const originalSvg = originalRoot.querySelector<SVGSVGElement>('svg')!;
    vi.spyOn(originalSvg, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 800,
      bottom: 450,
      left: 0,
      width: 800,
      height: 450,
      toJSON: () => ({}),
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const decode = stubImageDecode(async () => undefined);
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    let decodedSvgSource = '';
    const createBitmap = vi.fn(async (source: HTMLImageElement) => {
      decodedSvgSource = source.src;
      return bitmap;
    });
    vi.stubGlobal('createImageBitmap', createBitmap);

    const transientCanvases = await rasterizeCaptureSvgClones(originalRoot, clonedRoot);

    const replacement = clonedRoot.querySelector<HTMLCanvasElement>('canvas')!;
    expect(clonedRoot.querySelector('svg.block-svg')).toBeNull();
    expect(replacement.className).toBe('block-svg');
    expect(replacement.dataset.blockId).toBe('intro');
    expect(replacement.dataset.svgCaptureClone).toBe('true');
    expect(replacement.style.opacity).toBe('0.75');
    expect(replacement.width).toBe(800);
    expect(replacement.height).toBe(450);
    expect(decode).toHaveBeenCalledOnce();
    expect(decodedSvgSource).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(createBitmap).toHaveBeenCalledWith(expect.any(HTMLImageElement));
    expect(drawImage).toHaveBeenNthCalledWith(1, bitmap, 0, 0, 800, 450);
    expect(drawImage).toHaveBeenNthCalledWith(2, expect.any(HTMLCanvasElement), 0, 0, 800, 450);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect((createBitmap.mock.calls[0][0] as HTMLImageElement).getAttribute('src')).toBeNull();
    expect(transientCanvases).toEqual([replacement]);

    releaseCaptureCloneCanvases(transientCanvases);

    expect(replacement.width).toBe(0);
    expect(replacement.height).toBe(0);
  });

  it('reuses an unchanged slide raster while per-frame overlays advance', async () => {
    const originalRoot = document.createElement('div');
    originalRoot.innerHTML =
      '<svg class="block-svg" viewBox="0 0 640 360" data-block-id="intro">' +
      '<text x="20" y="40">Static slide</text></svg>';
    const firstClone = originalRoot.cloneNode(true) as HTMLElement;
    const secondClone = originalRoot.cloneNode(true) as HTMLElement;
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const decode = stubImageDecode(async () => undefined);
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const createBitmap = vi.fn(async (_source: HTMLImageElement) => bitmap);
    vi.stubGlobal('createImageBitmap', createBitmap);
    const rasterCache = createCaptureSvgRasterCache();

    const firstTransient = await rasterizeCaptureSvgClones(
      originalRoot,
      firstClone,
      [],
      new Map(),
      rasterCache,
    );
    releaseCaptureCloneCanvases(firstTransient);
    const secondTransient = await rasterizeCaptureSvgClones(
      originalRoot,
      secondClone,
      [],
      new Map(),
      rasterCache,
    );

    expect(decode).toHaveBeenCalledOnce();
    expect(createBitmap).toHaveBeenCalledOnce();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledTimes(3);
    expect(rasterCache.size).toBe(1);
    const cachedCanvas = [...rasterCache.values()][0].canvas;
    expect(cachedCanvas.width).toBe(640);
    expect(cachedCanvas.height).toBe(360);

    releaseCaptureCloneCanvases(secondTransient);
    releaseCaptureSvgRasterCache(rasterCache);

    expect(rasterCache.size).toBe(0);
    expect(cachedCanvas.width).toBe(0);
    expect(cachedCanvas.height).toBe(0);
  });

  it('embeds blob-backed image layers before decoding the standalone SVG', async () => {
    const originalRoot = document.createElement('div');
    originalRoot.innerHTML =
      '<svg class="block-svg" viewBox="0 0 640 360">' +
      '<image href="blob:pasted-screen-clip" width="320" height="180"></image>' +
      '<foreignObject x="320" width="320" height="180">' +
      '<img xmlns="http://www.w3.org/1999/xhtml" src="blob:pasted-screen-clip">' +
      '</foreignObject>' +
      '</svg>';
    const clonedRoot = originalRoot.cloneNode(true) as HTMLElement;
    const png = new window.Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => png,
    } as Response);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    let serializedSvg = '';
    stubImageDecode(async (image) => {
      const separator = image.src.indexOf(',');
      serializedSvg = decodeURIComponent(image.src.slice(separator + 1));
    });
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);

    await rasterizeCaptureSvgClones(originalRoot, clonedRoot);

    expect(createBitmap).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('blob:pasted-screen-clip');
    expect(serializedSvg).toContain('data:image/png;base64,AQID');
    expect(serializedSvg).not.toContain('blob:pasted-screen-clip');
    expect(clonedRoot.querySelector('canvas[data-svg-capture-clone="true"]')).not.toBeNull();
  });

  it('draws the decoded image when the browser cannot create an ImageBitmap from it', async () => {
    const originalRoot = document.createElement('div');
    originalRoot.innerHTML = '<svg class="block-svg" viewBox="0 0 640 360"></svg>';
    const clonedRoot = originalRoot.cloneNode(true) as HTMLElement;
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    stubImageDecode(async () => undefined);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('SVG bitmap decode unavailable');
      }),
    );

    const transientCanvases = await rasterizeCaptureSvgClones(originalRoot, clonedRoot);

    expect(clonedRoot.querySelector('svg.block-svg')).toBeNull();
    expect(transientCanvases).toHaveLength(1);
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 640, 360);
  });

  it('rejects instead of returning to html2canvas when an SVG image cannot be embedded', async () => {
    const originalRoot = document.createElement('div');
    originalRoot.innerHTML =
      '<svg class="block-svg" viewBox="0 0 640 360">' +
      '<image href="blob:missing-screen-clip"></image></svg>';
    const clonedRoot = originalRoot.cloneNode(true) as HTMLElement;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
    } as Response);
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);

    await expect(rasterizeCaptureSvgClones(originalRoot, clonedRoot)).rejects.toThrow(
      'Could not rasterize a full-slide SVG for frame capture: ' +
        'Image could not be loaded for SVG capture: blob:missing-screen-clip',
    );

    expect(createBitmap).not.toHaveBeenCalled();
    expect(clonedRoot.querySelector('svg.block-svg')).not.toBeNull();
  });

  it('rejects instead of returning to html2canvas when the standalone SVG cannot decode', async () => {
    const originalRoot = document.createElement('div');
    originalRoot.innerHTML = '<svg class="block-svg" viewBox="0 0 640 360"></svg>';
    const clonedRoot = originalRoot.cloneNode(true) as HTMLElement;
    stubImageDecode(async () => {
      throw new Error('SVG image decode unavailable');
    });
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);

    await expect(rasterizeCaptureSvgClones(originalRoot, clonedRoot)).rejects.toThrow(
      'Could not rasterize a full-slide SVG for frame capture: SVG image decode unavailable',
    );

    expect(createBitmap).not.toHaveBeenCalled();
    expect(clonedRoot.querySelector('svg.block-svg')).not.toBeNull();
  });
});

describe('scheduled video capture clones', () => {
  it('calculates a centered cover crop without stretching', () => {
    expect(coverSourceRect(1920, 1080, 200, 200)).toEqual({
      sx: 420,
      sy: 0,
      sw: 1080,
      sh: 1080,
    });
    expect(coverSourceRect(1080, 1920, 320, 180)).toEqual({
      sx: 0,
      sy: 656.25,
      sw: 1080,
      sh: 607.5,
    });
  });

  it('uses the bounded compositor only when every active visual scheduled video is PIP', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="doc-player__media-clips" data-presentation="picture-in-picture">' +
      '<video data-clip-id="camera" data-active="true"></video></div>' +
      '<div class="doc-player__media-clips" data-presentation="background">' +
      '<video data-clip-id="audio-only" data-active="true"></video></div>';
    const [camera, audioOnly] = Array.from(root.querySelectorAll('video'));
    Object.defineProperties(camera, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    });
    Object.defineProperties(audioOnly, {
      videoWidth: { configurable: true, value: 0 },
      videoHeight: { configurable: true, value: 0 },
    });

    expect(canCompositeScheduledPipVideos(root)).toBe(true);
    Object.defineProperties(audioOnly, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    expect(canCompositeScheduledPipVideos(root)).toBe(false);
  });

  it('draws a cropped scheduled PIP frame over the cached base raster', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="doc-player__media-clips" data-presentation="picture-in-picture">' +
      '<video data-clip-id="camera" data-active="true"></video></div>';
    const video = root.querySelector<HTMLVideoElement>('video')!;
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          x: 480,
          y: 260,
          left: 480,
          top: 260,
          right: 630,
          bottom: 350,
          width: 150,
          height: 90,
          toJSON: () => ({}),
        }),
      },
    });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 640,
        bottom: 360,
        width: 640,
        height: 360,
        toJSON: () => ({}),
      }),
    });
    const destination = document.createElement('canvas');
    destination.width = 640;
    destination.height = 360;
    const drawImage = vi.fn();
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      objectFit: 'cover',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      borderTopLeftRadius: '0px',
      borderTopStyle: 'none',
      borderTopColor: 'rgba(0, 0, 0, 0)',
      boxShadow: 'none',
    } as CSSStyleDeclaration);
    vi.spyOn(destination, 'getContext').mockReturnValue({
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      clip: vi.fn(),
      drawImage,
      shadowColor: '',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowBlur: 0,
      globalAlpha: 1,
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);

    expect(compositeScheduledPipVideos(root, destination)).toBe(1);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 48, 640, 384, 480, 260, 150, 90);
  });

  it('plans background clips as underlays and PIP clips as overlays', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="doc-player__media-clips" data-presentation="background">' +
      '<video data-clip-id="camera" data-active="true"></video></div>' +
      '<div class="doc-player__media-clips" data-presentation="picture-in-picture">' +
      '<video data-clip-id="screen" data-active="true"></video></div>';
    const [camera, screen] = Array.from(root.querySelectorAll('video'));
    for (const video of [camera, screen]) {
      Object.defineProperties(video, {
        videoWidth: { configurable: true, value: 640 },
        videoHeight: { configurable: true, value: 480 },
      });
    }

    const plan = planScheduledVideoComposite(root);
    expect(plan).not.toBeNull();
    expect(plan!.underlays).toEqual([camera]);
    expect(plan!.overlays).toEqual([screen]);
  });

  it('declines a composite plan for full-frame overlay clips (they sit under captions)', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="doc-player__media-clips" data-presentation="full-frame">' +
      '<video data-clip-id="camera" data-active="true"></video></div>';
    const video = root.querySelector('video')!;
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    });

    expect(planScheduledVideoComposite(root)).toBeNull();
  });

  it('plans nothing when no scheduled clip is visually active', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="doc-player__media-clips" data-presentation="background">' +
      '<video data-clip-id="camera" data-active="false"></video></div>';
    const video = root.querySelector('video')!;
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    });

    expect(planScheduledVideoComposite(root)).toBeNull();
  });

  it('draws a full-bleed background clip with cover cropping beneath the base', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="doc-player__media-clips" data-presentation="background">' +
      '<video data-clip-id="camera" data-active="true"></video></div>';
    const video = root.querySelector<HTMLVideoElement>('video')!;
    const fullBleed = {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360,
      toJSON: () => ({}),
    };
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
      getBoundingClientRect: { configurable: true, value: () => fullBleed },
    });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => fullBleed,
    });
    const destination = document.createElement('canvas');
    destination.width = 640;
    destination.height = 360;
    const drawImage = vi.fn();
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      objectFit: 'cover',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      borderTopLeftRadius: '0px',
      borderTopStyle: 'none',
      borderTopColor: 'rgba(0, 0, 0, 0)',
      boxShadow: 'none',
    } as CSSStyleDeclaration);
    vi.spyOn(destination, 'getContext').mockReturnValue({
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      clip: vi.fn(),
      drawImage,
      shadowColor: '',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowBlur: 0,
      globalAlpha: 1,
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);

    expect(drawScheduledVideosOnto(destination, root, [video])).toBe(1);
    // 640×480 source cover-cropped into 640×360: crop 60px top and bottom.
    expect(drawImage).toHaveBeenCalledWith(video, 0, 60, 640, 360, 0, 0, 640, 360);
  });

  it('strips backdrops only from ancestors of background media groups in the clone', () => {
    const clonedRoot = document.createElement('div');
    clonedRoot.style.backgroundColor = 'rgb(20, 20, 20)';
    clonedRoot.innerHTML =
      '<div class="doc-player" style="background-color: rgb(10, 10, 40)">' +
      '<div class="doc-player__media-clips" data-presentation="background"></div>' +
      '<div class="doc-player__block" style="background-color: rgb(200, 0, 0)"></div>' +
      '</div>';

    clearScheduledUnderlayBackdrops(clonedRoot);

    const player = clonedRoot.querySelector<HTMLElement>('.doc-player')!;
    const block = clonedRoot.querySelector<HTMLElement>('.doc-player__block')!;
    expect(player.style.backgroundColor).toBe('transparent');
    expect(clonedRoot.style.backgroundColor).toBe('transparent');
    // A block is not an ancestor of the media group — its slide background
    // must keep painting over the composited underlay.
    expect(block.style.backgroundColor).toBe('rgb(200, 0, 0)');
  });

  it('restores PIP presentation on html2canvas video replacements', () => {
    const originalRoot = document.createElement('div');
    originalRoot.innerHTML =
      '<div class="doc-player__media-clips"><video data-clip-id="presenter"></video></div>';
    const clonedRoot = document.createElement('div');
    clonedRoot.innerHTML = '<div class="doc-player__media-clips"><canvas></canvas></div>';
    const video = originalRoot.querySelector<HTMLVideoElement>('video')!;
    video.className = 'doc-player__media-video doc-player__media-video--active';
    video.dataset.active = 'true';
    video.style.cssText =
      'position:absolute;width:15%;aspect-ratio:1;right:3%;bottom:6%;' +
      'object-fit:cover;border:3px solid rgb(255, 0, 170);border-radius:18%;';
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      clientWidth: { configurable: true, value: 200 },
      clientHeight: { configurable: true, value: 200 },
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);

    const preparedCanvases = prepareScheduledVideoClones(originalRoot, clonedRoot);

    const canvas = clonedRoot.querySelector<HTMLCanvasElement>('canvas')!;
    expect(canvas.className).toBe('doc-player__media-video doc-player__media-video--active');
    expect(canvas.dataset.clipId).toBe('presenter');
    expect(canvas.dataset.active).toBe('true');
    expect(canvas.dataset.videoCaptureClone).toBe('true');
    expect(canvas.style.right).toBe('3%');
    expect(canvas.style.bottom).toBe('6%');
    expect(canvas.style.borderRadius).toBe('18%');
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
    expect(drawImage).toHaveBeenNthCalledWith(1, video, 420, 0, 1080, 1080, 0, 0, 200, 200);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(preparedCanvases).toEqual([canvas]);
  });

  it('serializes an embedded block frame alongside a scheduled PIP video', () => {
    const originalRoot = document.createElement('div');
    originalRoot.innerHTML =
      '<div class="doc-player__block"><svg><g class="block-layer block-layer--video">' +
      '<foreignObject x="12" y="34" width="640" height="180">' +
      '<video data-clip-start="0" data-clip-end="12"></video></foreignObject>' +
      '</g></svg></div>' +
      '<div class="doc-player__media-clips">' +
      '<video data-clip-id="camera" data-active="true"></video>' +
      '</div>';
    const clonedRoot = document.createElement('div');
    clonedRoot.innerHTML =
      '<div class="doc-player__block"><svg><g class="block-layer block-layer--video">' +
      '<foreignObject x="12" y="34" width="640" height="180"><canvas></canvas></foreignObject>' +
      '</g></svg></div>' +
      '<div class="doc-player__media-clips"><canvas></canvas></div>';
    const embeddedVideo = originalRoot.querySelector<HTMLVideoElement>(
      '.block-layer--video video',
    )!;
    const pipVideo = originalRoot.querySelector<HTMLVideoElement>(
      '.doc-player__media-clips video',
    )!;
    embeddedVideo.style.objectFit = 'contain';
    pipVideo.style.objectFit = 'cover';
    Object.defineProperties(embeddedVideo, {
      videoWidth: { configurable: true, value: 320 },
      videoHeight: { configurable: true, value: 180 },
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 180 },
    });
    Object.defineProperties(pipVideo, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
      clientWidth: { configurable: true, value: 160 },
      clientHeight: { configurable: true, value: 160 },
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    prepareScheduledVideoClones(originalRoot, clonedRoot);

    const embeddedCanvasInSvg = clonedRoot.querySelector<HTMLCanvasElement>(
      '.block-layer--video canvas',
    );
    const embeddedForeignObject = clonedRoot.querySelector('.block-layer--video foreignObject');
    const embeddedFrame = clonedRoot.querySelector<HTMLCanvasElement>(
      '.doc-player__block > canvas[data-video-capture-clone]',
    )!;
    const pipCanvas = clonedRoot.querySelector<HTMLCanvasElement>(
      '.doc-player__media-clips canvas',
    )!;
    expect(embeddedCanvasInSvg).toBeNull();
    expect(embeddedForeignObject).toBeNull();
    expect(embeddedFrame.dataset.videoCaptureClone).toBe('true');
    expect(embeddedFrame.dataset.clipStart).toBe('0');
    expect(embeddedFrame.width).toBe(640);
    expect(embeddedFrame.height).toBe(180);
    expect(embeddedFrame.style.left).toBe('12px');
    expect(embeddedFrame.style.top).toBe('34px');
    expect(embeddedFrame.style.width).toBe('640px');
    expect(embeddedFrame.style.height).toBe('180px');
    expect(embeddedFrame.style.zIndex).toBe('3');
    expect(pipCanvas.dataset.videoCaptureClone).toBe('true');
    expect(pipCanvas.dataset.clipId).toBe('camera');
    expect(pipCanvas.width).toBe(160);
    expect(pipCanvas.height).toBe(160);
    expect(drawImage).toHaveBeenCalledWith(embeddedVideo, 0, 0, 320, 180, 160, 0, 320, 180);
    expect(drawImage).toHaveBeenCalledWith(pipVideo, 80, 0, 480, 480, 0, 0, 160, 160);
  });
});

describe('useFrameCapture', () => {
  it('returns a stable handle and rejects capture before initialization', async () => {
    const { result, rerender } = renderHook(() => useFrameCapture());
    const firstHandle = result.current;

    rerender();

    expect(result.current).toBe(firstHandle);
    await expect(result.current.captureFrame(0)).rejects.toThrow(/not initialized/i);
    await expect(result.current.setCoverVisible(true)).rejects.toThrow(/not initialized/i);
    expect(() => result.current.destroy()).not.toThrow();
  });

  it('primes a recorder WebM mounted after initialization before its first seek', async () => {
    let renderedTime = 0;
    let video: HTMLVideoElement | null = null;
    const api = {
      getDuration: vi.fn(() => 4.5),
      getRenderedTime: vi.fn(() => renderedTime),
      seekTo: vi.fn(async (time: number) => {
        expect(video?.dataset.captureSequential).toBe('true');
        expect(Number.isFinite(video?.duration)).toBe(true);
        renderedTime = time;
      }),
      showCover: vi.fn(async () => {}),
      hideCover: vi.fn(async () => {}),
    };
    frameCaptureMocks.render.mockImplementation((node: unknown) => {
      const element = node as { props: Record<string, unknown> };
      const ready = element.props.onRenderAPIReady as (value: typeof api) => void;
      ready(api);
    });
    frameCaptureMocks.html2canvas.mockImplementation(
      async (_root: HTMLElement, options: { canvas: HTMLCanvasElement }) => options.canvas,
    );
    const captureContext = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(captureContext);
    const doc = {
      articleId: 'late-recorder-test',
      duration: 4.5,
      blocks: [],
      audio: { segments: [] },
    } as Doc;
    const { result } = renderHook(() => useFrameCapture());

    expect(await result.current.init(doc, { width: 640, height: 360 })).toBe(4.5);
    const root = document.querySelector<HTMLElement>('#squisq-capture-root')!;
    video = document.createElement('video');
    root.appendChild(video);

    let duration = Number.POSITIVE_INFINITY;
    let currentTime = 0;
    let seeking = false;
    const assignments: number[] = [];
    Object.defineProperties(video, {
      currentSrc: { configurable: true, get: () => 'blob:late-recorder-webm' },
      duration: { configurable: true, get: () => duration },
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          assignments.push(value);
          seeking = true;
          queueMicrotask(() => {
            if (value > 1e100) {
              duration = 304.534;
              currentTime = duration;
              video?.dispatchEvent(new Event('durationchange'));
            } else {
              currentTime = value;
            }
            seeking = false;
            video?.dispatchEvent(new Event('seeked'));
          });
        },
      },
      readyState: { configurable: true, get: () => HTMLMediaElement.HAVE_ENOUGH_DATA },
      seeking: { configurable: true, get: () => seeking },
      pause: { configurable: true, value: vi.fn() },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    });

    await expect(result.current.captureCanvasFrame(0.03)).resolves.toBeInstanceOf(
      HTMLCanvasElement,
    );

    expect(assignments).toEqual([1e101, 0]);
    expect(api.seekTo).toHaveBeenCalledOnce();
    expect(api.seekTo).toHaveBeenCalledWith(0.03);
    expect(video.dataset.captureSequential).toBe('true');

    result.current.destroy();
  });

  it('recovers a refused seek by indexing a clip that resolved mid-seek', async () => {
    let renderedTime = 0;
    let source = '';
    let duration = Number.NaN;
    let seekAttempts = 0;
    const api = {
      getDuration: vi.fn(() => 4.5),
      getRenderedTime: vi.fn(() => renderedTime),
      seekTo: vi.fn(async (time: number) => {
        seekAttempts += 1;
        if (seekAttempts === 1) {
          // The clip's provider URL lands while the player is seeking. Its
          // unindexed recorder WebM reports duration=Infinity, so Chromium
          // clamps the requested frame away and the barrier times out.
          source = 'blob:late-clip-webm';
          duration = Number.POSITIVE_INFINITY;
          throw new Error(
            'Video frame did not become ready at 0.030s within 2000ms ' +
              '(currentTime=0.000s, duration=Infinity).',
          );
        }
        renderedTime = time;
      }),
      showCover: vi.fn(async () => {}),
      hideCover: vi.fn(async () => {}),
    };
    frameCaptureMocks.render.mockImplementation((node: unknown) => {
      const element = node as { props: Record<string, unknown> };
      const ready = element.props.onRenderAPIReady as (value: typeof api) => void;
      ready(api);
    });
    frameCaptureMocks.html2canvas.mockImplementation(
      async (_root: HTMLElement, options: { canvas: HTMLCanvasElement }) => options.canvas,
    );
    const captureContext = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(captureContext);
    const doc = {
      articleId: 'refused-seek-test',
      duration: 4.5,
      blocks: [],
      audio: { segments: [] },
    } as Doc;
    const { result } = renderHook(() => useFrameCapture());

    expect(await result.current.init(doc, { width: 640, height: 360 })).toBe(4.5);
    const root = document.querySelector<HTMLElement>('#squisq-capture-root')!;
    const video = document.createElement('video');
    root.appendChild(video);

    let currentTime = 0;
    let seeking = false;
    const assignments: number[] = [];
    Object.defineProperties(video, {
      currentSrc: { configurable: true, get: () => source },
      duration: { configurable: true, get: () => duration },
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          assignments.push(value);
          seeking = true;
          queueMicrotask(() => {
            if (value > 1e100) {
              duration = 304.534;
              currentTime = duration;
              video.dispatchEvent(new Event('durationchange'));
            } else {
              currentTime = value;
            }
            seeking = false;
            video.dispatchEvent(new Event('seeked'));
          });
        },
      },
      readyState: {
        configurable: true,
        get: () => (source ? HTMLMediaElement.HAVE_ENOUGH_DATA : HTMLMediaElement.HAVE_NOTHING),
      },
      seeking: { configurable: true, get: () => seeking },
      pause: { configurable: true, value: vi.fn() },
      videoWidth: { configurable: true, get: () => (source ? 640 : 0) },
      videoHeight: { configurable: true, get: () => (source ? 480 : 0) },
    });

    await expect(result.current.captureCanvasFrame(0.03)).resolves.toBeInstanceOf(
      HTMLCanvasElement,
    );

    expect(assignments).toEqual([1e101, 0]);
    expect(api.seekTo).toHaveBeenCalledTimes(2);
    expect(api.seekTo).toHaveBeenNthCalledWith(2, 0.03);
    expect(video.dataset.captureSequential).toBe('true');

    result.current.destroy();
  });

  it('surfaces a seek failure that indexing cannot explain', async () => {
    const seekFailure = new Error('Player committed 0.000000s while capture requested 0.030000s.');
    const api = {
      getDuration: vi.fn(() => 4.5),
      getRenderedTime: vi.fn(() => 0),
      seekTo: vi.fn(async () => {
        throw seekFailure;
      }),
      showCover: vi.fn(async () => {}),
      hideCover: vi.fn(async () => {}),
    };
    frameCaptureMocks.render.mockImplementation((node: unknown) => {
      const element = node as { props: Record<string, unknown> };
      const ready = element.props.onRenderAPIReady as (value: typeof api) => void;
      ready(api);
    });
    const doc = {
      articleId: 'unrecoverable-seek-test',
      duration: 4.5,
      blocks: [],
      audio: { segments: [] },
    } as Doc;
    const { result } = renderHook(() => useFrameCapture());

    expect(await result.current.init(doc, { width: 640, height: 360 })).toBe(4.5);

    await expect(result.current.captureCanvasFrame(0.03)).rejects.toThrow(seekFailure.message);
    expect(api.seekTo).toHaveBeenCalledOnce();

    result.current.destroy();
  });

  it('initializes, replaces an existing player, captures a frame, and destroys resources', async () => {
    let renderedTime = 0;
    const api = {
      getDuration: vi.fn(() => 4.5),
      getRenderedTime: vi.fn(() => renderedTime),
      seekTo: vi.fn(async (time: number) => {
        renderedTime = time;
      }),
      showCover: vi.fn(async () => {}),
      hideCover: vi.fn(async () => {}),
    };
    const renderedProps: Array<Record<string, unknown>> = [];
    frameCaptureMocks.render.mockImplementation((node: unknown) => {
      const element = node as { props: Record<string, unknown> };
      renderedProps.push(element.props);
      const ready = element.props.onRenderAPIReady as (value: typeof api) => void;
      ready(api);
    });
    frameCaptureMocks.html2canvas.mockImplementation(
      async (_root: HTMLElement, options: { canvas: HTMLCanvasElement }) => options.canvas,
    );
    const captureContext = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(captureContext);
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const createBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createBitmap);
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const doc = {
      articleId: 'frame-capture-test',
      duration: 4.5,
      blocks: [],
      audio: { segments: [] },
    } as Doc;
    const { result } = renderHook(() => useFrameCapture());
    const theme = resolveTheme('tech-dark');

    expect(
      await result.current.init(
        doc,
        {
          width: 640,
          height: 360,
          animationsEnabled: false,
          theme,
          videoPresentation: 'picture-in-picture',
          pipSize: 'large',
          pipShape: 'wide',
          pipPosition: 'bottom-right',
          showCoverSlide: true,
        },
        'social',
      ),
    ).toBe(4.5);
    expect(renderedProps[0]).toMatchObject({
      doc,
      captionsEnabled: true,
      captionStyle: 'social',
      animationsEnabled: false,
      forceViewport: { width: 640, height: 360, name: 'export' },
      theme,
      videoPresentation: 'picture-in-picture',
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'bottom-right',
      showCoverSlide: true,
    });

    // Reinitializing must dispose the old hidden React root before replacing it.
    expect(await result.current.init(doc, { width: 800, height: 450 })).toBe(4.5);
    expect(frameCaptureMocks.unmount).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('#squisq-capture-root')).toHaveLength(1);

    await result.current.setCoverVisible(true);
    await result.current.setCoverVisible(false);
    expect(api.showCover).toHaveBeenCalledOnce();
    expect(api.hideCover).toHaveBeenCalledOnce();

    expect(await result.current.captureFrame(2.25)).toBe(bitmap);
    const canvasFrame = await result.current.captureCanvasFrame(2.35, {
      reuseIfUnchanged: true,
    });
    const reusedCanvasFrame = await result.current.captureCanvasFrame(2.45, {
      reuseIfUnchanged: true,
    });
    expect(api.seekTo).toHaveBeenNthCalledWith(1, 2.25);
    expect(api.seekTo).toHaveBeenNthCalledWith(2, 2.35);
    expect(api.seekTo).toHaveBeenNthCalledWith(3, 2.45);
    const root = document.querySelector<HTMLElement>('#squisq-capture-root');
    expect(frameCaptureMocks.html2canvas).toHaveBeenNthCalledWith(
      1,
      root,
      expect.objectContaining({
        canvas: expect.any(HTMLCanvasElement),
        width: 800,
        height: 450,
        backgroundColor: '#000000',
      }),
    );
    const captureOptions = frameCaptureMocks.html2canvas.mock.calls[0][1];
    expect(captureOptions.onclone).toEqual(expect.any(Function));
    const ignoreElements = captureOptions.ignoreElements as (element: Element) => boolean;
    const captureDescendant = document.createElement('span');
    root!.appendChild(captureDescendant);
    const unrelatedSibling = document.createElement('div');
    document.body.appendChild(unrelatedSibling);
    expect(ignoreElements(document.documentElement)).toBe(false);
    expect(ignoreElements(document.head)).toBe(false);
    expect(ignoreElements(root!)).toBe(false);
    expect(ignoreElements(captureDescendant)).toBe(false);
    expect(ignoreElements(unrelatedSibling)).toBe(true);
    captureDescendant.remove();
    unrelatedSibling.remove();
    const firstCanvas = frameCaptureMocks.html2canvas.mock.calls[0][1].canvas as HTMLCanvasElement;
    const secondCanvas = frameCaptureMocks.html2canvas.mock.calls[1][1].canvas as HTMLCanvasElement;
    expect(canvasFrame).toBe(firstCanvas);
    expect(reusedCanvasFrame).toBe(firstCanvas);
    expect(secondCanvas).toBe(firstCanvas);
    expect(frameCaptureMocks.html2canvas).toHaveBeenCalledTimes(2);
    expect(captureContext.setTransform).toHaveBeenCalledTimes(2);
    expect(captureContext.clearRect).toHaveBeenNthCalledWith(1, 0, 0, 800, 450);
    expect(captureContext.clearRect).toHaveBeenNthCalledWith(2, 0, 0, 800, 450);
    expect(createBitmap).toHaveBeenNthCalledWith(1, firstCanvas);
    expect(createBitmap).toHaveBeenCalledOnce();
    expect(requestFrame).not.toHaveBeenCalled();
    expect(firstCanvas.width).toBe(800);
    expect(firstCanvas.height).toBe(450);

    result.current.destroy();
    expect(firstCanvas.width).toBe(0);
    expect(firstCanvas.height).toBe(0);
    expect(frameCaptureMocks.unmount).toHaveBeenCalledTimes(2);
    expect(document.querySelector('#squisq-capture-root')).toBeNull();
  });
});

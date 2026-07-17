import { renderHook } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInlineProvider,
  getFrameVisualStateKey,
  useFrameCapture,
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

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
        ['unknown.bin', new Uint8Array([6]).buffer],
      ]),
    );

    expect(create).toHaveBeenCalledTimes(3);
    expect(blobs.map((blob) => blob.type)).toEqual([
      'image/jpeg',
      'image/svg+xml',
      'application/octet-stream',
    ]);
    expect(await provider.resolveUrl('photo.JPG')).toBe('blob:1');
    expect(await provider.resolveUrl('not-present.png')).toBe('not-present.png');
    expect(await provider.listMedia()).toEqual([
      { name: 'photo.JPG', mimeType: 'image/jpeg', size: 3 },
      { name: 'drawing.svg', mimeType: 'image/svg+xml', size: 2 },
      { name: 'unknown.bin', mimeType: 'application/octet-stream', size: 1 },
    ]);
    await expect(provider.addMedia('new.png', new ArrayBuffer(0), 'image/png')).rejects.toThrow(
      'Read-only',
    );
    await expect(provider.removeMedia('photo.JPG')).rejects.toThrow('Read-only');

    provider.dispose();

    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:1', 'blob:2', 'blob:3']);
    expect(await provider.resolveUrl('photo.JPG')).toBe('photo.JPG');
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
});

describe('useFrameCapture', () => {
  it('returns a stable handle and rejects capture before initialization', async () => {
    const { result, rerender } = renderHook(() => useFrameCapture());
    const firstHandle = result.current;

    rerender();

    expect(result.current).toBe(firstHandle);
    await expect(result.current.captureFrame(0)).rejects.toThrow(/not initialized/i);
    expect(() => result.current.destroy()).not.toThrow();
  });

  it('initializes, replaces an existing player, captures a frame, and destroys resources', async () => {
    const api = {
      getDuration: vi.fn(() => 4.5),
      seekTo: vi.fn(async () => undefined),
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
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const doc = {
      articleId: 'frame-capture-test',
      duration: 4.5,
      blocks: [],
      audio: { segments: [] },
    } as Doc;
    const { result } = renderHook(() => useFrameCapture());

    expect(
      await result.current.init(
        doc,
        { width: 640, height: 360, animationsEnabled: false },
        'social',
      ),
    ).toBe(4.5);
    expect(renderedProps[0]).toMatchObject({
      doc,
      captionsEnabled: true,
      captionStyle: 'social',
      animationsEnabled: false,
      forceViewport: { width: 640, height: 360, name: 'export' },
    });

    // Reinitializing must dispose the old hidden React root before replacing it.
    expect(await result.current.init(doc, { width: 800, height: 450 })).toBe(4.5);
    expect(frameCaptureMocks.unmount).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('#squisq-capture-root')).toHaveLength(1);

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
    expect(firstCanvas.width).toBe(800);
    expect(firstCanvas.height).toBe(450);

    result.current.destroy();
    expect(firstCanvas.width).toBe(0);
    expect(firstCanvas.height).toBe(0);
    expect(frameCaptureMocks.unmount).toHaveBeenCalledTimes(2);
    expect(document.querySelector('#squisq-capture-root')).toBeNull();
  });
});

import { renderHook } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInlineProvider, useFrameCapture } from '../hooks/useFrameCapture';

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    const canvas = document.createElement('canvas');
    frameCaptureMocks.html2canvas.mockResolvedValue(canvas);
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
    expect(api.seekTo).toHaveBeenCalledWith(2.25);
    const root = document.querySelector<HTMLElement>('#squisq-capture-root');
    expect(frameCaptureMocks.html2canvas).toHaveBeenCalledWith(
      root,
      expect.objectContaining({ width: 800, height: 450, backgroundColor: '#000000' }),
    );
    expect(createBitmap).toHaveBeenCalledWith(canvas);

    result.current.destroy();
    expect(frameCaptureMocks.unmount).toHaveBeenCalledTimes(2);
    expect(document.querySelector('#squisq-capture-root')).toBeNull();
  });
});

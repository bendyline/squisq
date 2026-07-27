import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';

const mocks = vi.hoisted(() => {
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  return {
    bitmap,
    frameInit: vi.fn(async () => 0.1),
    captureFrame: vi.fn(async () => bitmap),
    captureCanvasFrame: vi.fn(async () => ({}) as HTMLCanvasElement),
    setCoverVisible: vi.fn(async () => {}),
    destroy: vi.fn(),
    supportsH264: vi.fn(async () => true),
    createWorkerEncoder: vi.fn(),
    encodeFrame: vi.fn(async (frame: ImageBitmap | HTMLCanvasElement) => {
      if ('close' in frame) frame.close();
    }),
    finalize: vi.fn(async () => new Uint8Array([0, 0, 0, 1]).buffer),
    closeEncoder: vi.fn(),
    computeAudioTimeline: vi.fn(() => []),
    supportsAac: vi.fn(async () => true),
    gifTranscode: vi.fn(
      async (_video: Uint8Array, _options: unknown, _loadConfig?: unknown, _signal?: AbortSignal) =>
        new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
    ),
  };
});

vi.mock('../hooks/useFrameCapture.js', () => {
  const frameCaptureHandle = {
    init: mocks.frameInit,
    captureFrame: mocks.captureFrame,
    captureCanvasFrame: mocks.captureCanvasFrame,
    setCoverVisible: mocks.setCoverVisible,
    destroy: mocks.destroy,
  };
  return { useFrameCapture: () => frameCaptureHandle };
});

vi.mock('../mainThreadEncoder.js', () => ({
  supportsWebCodecs: () => true,
  supportsWebCodecsH264: mocks.supportsH264,
  createEncoder: () => ({
    encodeFrame: mocks.encodeFrame,
    finalize: mocks.finalize,
    close: mocks.closeEncoder,
  }),
}));

vi.mock('../workerEncoder.js', () => ({
  createWorkerEncoder: mocks.createWorkerEncoder,
}));

vi.mock('../gifTranscode.js', () => ({
  transcodeMp4ToGifWithFfmpegWasm: mocks.gifTranscode,
}));

vi.mock('../audioTrack.js', () => ({
  supportsWebCodecsAac: mocks.supportsAac,
  selectAudioTier: () => ({ tier: 3, reason: null }),
  renderAudioTimeline: vi.fn(),
  encodeAacTrack: vi.fn(),
  audioBufferToWav: vi.fn(),
  muxAudioWithFfmpegWasm: vi.fn(),
  EXPORT_AUDIO_SAMPLE_RATE: 48_000,
  EXPORT_AUDIO_CHANNELS: 2,
}));

vi.mock('@bendyline/squisq-video', async () => {
  const actual =
    await vi.importActual<typeof import('@bendyline/squisq-video')>('@bendyline/squisq-video');
  return { ...actual, computeAudioTimeline: mocks.computeAudioTimeline };
});

import {
  calculateRollingFramesPerSecond,
  DEFAULT_VIDEO_COVER_PRE_ROLL_SECONDS,
  resolveVideoCoverFramePlan,
  resolveVideoExportCover,
  settleWithin,
  useVideoExport,
} from '../hooks/useVideoExport.js';

const doc: Doc = {
  articleId: 'gif-hook-test',
  duration: 0.1,
  blocks: [{ id: 'b1', startTime: 0, duration: 0.1, audioSegment: 0, layers: [] }],
  audio: {
    segments: [{ name: 'narration', src: 'narration.mp3', startTime: 0, duration: 0.1 }],
  },
};

describe('useVideoExport GIF flow', () => {
  /**
   * GIF always finishes with an ffmpeg.wasm palette pass, so the host must
   * supply self-hosted core assets. Omitting this used to silently fetch
   * @ffmpeg/ffmpeg's unpkg CDN default — see the regression test below.
   */
  const CORE = { coreURL: '/vendor/core.js', wasmURL: '/vendor/core.wasm' };

  let createObjectUrl: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrl: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.frameInit.mockReset().mockResolvedValue(0.1);
    mocks.captureFrame.mockReset().mockResolvedValue(mocks.bitmap);
    mocks.captureCanvasFrame.mockReset().mockResolvedValue({} as HTMLCanvasElement);
    mocks.setCoverVisible.mockReset().mockResolvedValue(undefined);
    mocks.encodeFrame
      .mockReset()
      .mockImplementation(async (frame: ImageBitmap | HTMLCanvasElement) => {
        if ('close' in frame) frame.close();
      });
    mocks.finalize.mockReset().mockResolvedValue(new Uint8Array([0, 0, 0, 1]).buffer);
    mocks.supportsH264.mockResolvedValue(true);
    mocks.createWorkerEncoder.mockReset();
    mocks.gifTranscode.mockResolvedValue(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
    createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gif-output');
    revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    if (typeof SharedArrayBuffer === 'undefined') {
      vi.stubGlobal('SharedArrayBuffer', ArrayBuffer);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    vi.unstubAllGlobals();
  });

  it('calculates throughput over no more than the latest 30 frames', () => {
    const boundaries = [0];
    for (let index = 0; index < 10; index++) boundaries.push(boundaries.at(-1)! + 1_000);
    for (let index = 0; index < 30; index++) boundaries.push(boundaries.at(-1)! + 100);

    expect(calculateRollingFramesPerSecond(boundaries)).toBe(10);
    expect(calculateRollingFramesPerSecond([0])).toBeNull();
    expect(calculateRollingFramesPerSecond([100, 100])).toBeNull();
  });

  it('resolves the managed-cover flag and default pre-roll from the document', () => {
    const coveredDoc: Doc = {
      ...doc,
      startBlock: { title: 'Managed cover' },
    };
    expect(resolveVideoExportCover(coveredDoc)).toEqual({
      showCoverSlide: true,
      coverDuration: DEFAULT_VIDEO_COVER_PRE_ROLL_SECONDS,
      coverPlayback: 'preroll',
      coverPreRoll: DEFAULT_VIDEO_COVER_PRE_ROLL_SECONDS,
    });
    expect(
      resolveVideoExportCover({
        ...coveredDoc,
        frontmatter: { 'squisq-cover-slide': false },
      }),
    ).toEqual({
      showCoverSlide: false,
      coverDuration: 0,
      coverPlayback: 'preroll',
      coverPreRoll: 0,
    });
  });

  it('builds distinct overlay and preroll frame plans', () => {
    const overlay = resolveVideoCoverFramePlan(5, 10, {
      showCoverSlide: true,
      coverDuration: 2,
      coverPlayback: 'overlay',
      coverPreRoll: 0,
    });
    expect(overlay.coverFrameCount).toBe(20);
    expect(overlay.storyFrameCount).toBe(50);
    expect(overlay.totalFrames).toBe(50);
    expect(overlay.totalDuration).toBe(5);
    expect(overlay.audioOffset).toBe(0);
    expect(overlay.captureTimeForFrame(19)).toBe(1.9);
    expect(overlay.captureTimeForFrame(20)).toBe(2);

    const preroll = resolveVideoCoverFramePlan(5, 10, {
      showCoverSlide: true,
      coverDuration: 2,
      coverPlayback: 'preroll',
      coverPreRoll: 2,
    });
    expect(preroll.totalFrames).toBe(70);
    expect(preroll.totalDuration).toBe(7);
    expect(preroll.audioOffset).toBe(2);
    expect(preroll.captureTimeForFrame(19)).toBe(0);
    expect(preroll.captureTimeForFrame(20)).toBe(0);
  });

  it('bounds a hung browser operation and disposes its late result', async () => {
    vi.useFakeTimers();
    let resolveOperation!: (value: ImageBitmap) => void;
    const lateBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const operation = new Promise<ImageBitmap>((resolve) => {
      resolveOperation = resolve;
    });
    const bounded = settleWithin(operation, 60_000, 'Frame timed out', (bitmap) => bitmap.close());
    const rejection = expect(bounded).rejects.toThrow('Frame timed out');

    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    resolveOperation(lateBitmap);
    await Promise.resolve();

    expect(lateBitmap.close).toHaveBeenCalledOnce();
  });

  it('continues a browser-operation deadline while its visible window is unfocused', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const operation = new Promise<ImageBitmap>(() => undefined);
    const bounded = settleWithin(operation, 1_000, 'Frame timed out', undefined, document);
    let settled = false;
    void bounded.then(
      () => {},
      () => {
        settled = true;
      },
    );
    const rejection = expect(bounded).rejects.toThrow('Frame timed out');

    await vi.advanceTimersByTimeAsync(500);
    window.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
  });

  it('does not spend a browser-operation deadline while its document is hidden', async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    const operation = new Promise<ImageBitmap>(() => undefined);
    const bounded = settleWithin(operation, 1_000, 'Frame timed out', undefined, document);
    let settled = false;
    void bounded.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const rejection = expect(bounded).rejects.toThrow('Frame timed out');

    visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);

    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });

  it('uses compact/static defaults, skips audio, and emits an image/gif Blob', async () => {
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(doc, { outputFormat: 'gif', ffmpegWasm: CORE });
    });

    expect(mocks.frameInit).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({ width: 960, height: 540, animationsEnabled: false }),
      'standard',
    );
    expect(mocks.captureCanvasFrame).toHaveBeenCalledTimes(1);
    expect(mocks.captureCanvasFrame).toHaveBeenCalledWith(0, { reuseIfUnchanged: true });
    expect(mocks.captureFrame).not.toHaveBeenCalled();
    expect(mocks.computeAudioTimeline).not.toHaveBeenCalled();
    expect(mocks.supportsAac).not.toHaveBeenCalled();
    expect(mocks.gifTranscode).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      { width: 960, height: 540, loop: 0 },
      CORE,
      expect.any(AbortSignal),
    );

    const blob = createObjectUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/gif');
    expect(result.current.state).toBe('complete');
    expect(result.current.outputFormat).toBe('gif');
    expect(result.current.audioIncluded).toBe(false);
    expect(result.current.audioSkippedReason).toBeNull();

    unmount();
  });

  it('captures an enabled managed cover before story frame zero', async () => {
    const coveredDoc: Doc = {
      ...doc,
      startBlock: { title: 'Managed cover' },
    };
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(coveredDoc, {
        outputFormat: 'gif',
        coverPreRoll: 0.2,
        ffmpegWasm: CORE,
      });
    });

    expect(mocks.frameInit).toHaveBeenCalledWith(
      coveredDoc,
      expect.objectContaining({ showCoverSlide: true }),
      'standard',
    );
    expect(mocks.setCoverVisible.mock.calls).toEqual([[true], [false]]);
    expect(mocks.captureCanvasFrame).toHaveBeenNthCalledWith(1, 0, { reuseIfUnchanged: true });
    expect(mocks.captureCanvasFrame).toHaveBeenNthCalledWith(2, 0, { reuseIfUnchanged: true });
    expect(mocks.captureCanvasFrame).toHaveBeenNthCalledWith(3, 0, { reuseIfUnchanged: true });
    expect(result.current.duration).toBe(0.3);
    unmount();
  });

  it('shifts MP4 audio by the rendered cover-frame duration', async () => {
    const coveredDoc: Doc = {
      ...doc,
      startBlock: { title: 'Managed cover' },
    };
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(coveredDoc, {
        outputFormat: 'mp4',
        fps: 10,
        coverPreRoll: 0.2,
      });
    });

    expect(mocks.computeAudioTimeline).toHaveBeenCalledWith(coveredDoc, 0.2);
    expect(result.current.duration).toBe(0.3);
    unmount();
  });

  it('lets story video and audio advance underneath an overlay cover', async () => {
    const coveredDoc: Doc = {
      ...doc,
      duration: 0.3,
      blocks: [{ ...doc.blocks[0], duration: 0.3 }],
      startBlock: { title: 'Managed cover' },
      frontmatter: {
        'squisq-cover-duration': 0.2,
        'squisq-cover-playback': 'overlay',
      },
    };
    mocks.frameInit.mockResolvedValueOnce(0.3);
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(coveredDoc, {
        outputFormat: 'mp4',
        fps: 10,
      });
    });

    expect(mocks.computeAudioTimeline).toHaveBeenCalledWith(coveredDoc, 0);
    expect(mocks.setCoverVisible.mock.calls).toEqual([[true], [false]]);
    expect(mocks.captureCanvasFrame).toHaveBeenNthCalledWith(1, 0, {
      reuseIfUnchanged: true,
    });
    expect(mocks.captureCanvasFrame).toHaveBeenNthCalledWith(2, 0.1, {
      reuseIfUnchanged: true,
    });
    expect(mocks.captureCanvasFrame).toHaveBeenNthCalledWith(3, 0.2, {
      reuseIfUnchanged: true,
    });
    expect(result.current.duration).toBe(0.3);
    unmount();
  });

  it('suppresses cover frames when document frontmatter disables the cover', async () => {
    const coveredDoc: Doc = {
      ...doc,
      startBlock: { title: 'Managed cover' },
      frontmatter: { 'squisq-cover-slide': false },
    };
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(coveredDoc, {
        outputFormat: 'gif',
        coverPreRoll: 0.2,
        ffmpegWasm: CORE,
      });
    });

    expect(mocks.frameInit).toHaveBeenCalledWith(
      coveredDoc,
      expect.objectContaining({ showCoverSlide: false }),
      'standard',
    );
    expect(mocks.setCoverVisible).not.toHaveBeenCalled();
    expect(mocks.captureCanvasFrame).toHaveBeenCalledTimes(1);
    expect(result.current.duration).toBe(0.1);
    unmount();
  });

  it('samples the existing capture raster for previews without changing the export', async () => {
    const preview = vi.fn();
    const previewDoc: Doc = {
      ...doc,
      duration: 0.5,
      blocks: [{ ...doc.blocks[0], duration: 0.5 }],
    };
    mocks.frameInit.mockResolvedValue(0.5);
    const { result, unmount } = renderHook(() =>
      useVideoExport({ onFramePreview: preview, previewEveryNFrames: 2 }),
    );

    await act(async () => {
      await result.current.startExport(previewDoc, { outputFormat: 'gif', ffmpegWasm: CORE });
    });

    expect(preview.mock.calls.map(([frame]) => frame.frameIndex)).toEqual([0, 2, 4]);
    expect(preview).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ source: expect.any(Object), totalFrames: 5, time: 0.2 }),
    );
    expect(mocks.captureCanvasFrame).toHaveBeenCalledTimes(5);
    expect(result.current.state).toBe('complete');
    unmount();
  });

  it('does not fail the export when a preview observer throws', async () => {
    const { result, unmount } = renderHook(() =>
      useVideoExport({
        onFramePreview: () => {
          throw new Error('preview surface disappeared');
        },
      }),
    );

    await act(async () => {
      await result.current.startExport(doc, { outputFormat: 'gif', ffmpegWasm: CORE });
    });

    expect(result.current.state).toBe('complete');
    unmount();
  });

  it('enables repeated-frame reuse for MP4 exports too', async () => {
    const { result, unmount } = renderHook(() => useVideoExport());
    const theme = resolveTheme('tech-dark');

    await act(async () => {
      await result.current.startExport(doc, {
        outputFormat: 'mp4',
        animationsEnabled: false,
        audioPolicy: 'omit',
        theme,
        videoPresentation: 'picture-in-picture',
        pipSize: 'large',
        pipShape: 'wide',
        pipPosition: 'bottom-right',
      });
    });

    expect(mocks.frameInit).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({
        animationsEnabled: false,
        theme,
        videoPresentation: 'picture-in-picture',
        pipSize: 'large',
        pipShape: 'wide',
        pipPosition: 'bottom-right',
      }),
      'off',
    );
    expect(mocks.captureCanvasFrame).toHaveBeenCalledWith(0, { reuseIfUnchanged: true });
    expect(mocks.captureFrame).not.toHaveBeenCalled();
    expect(mocks.gifTranscode).not.toHaveBeenCalled();
    expect((createObjectUrl.mock.calls[0][0] as Blob).type).toBe('video/mp4');

    unmount();
  });

  it('preserves an explicit captions-off override for GIF exports', async () => {
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(doc, {
        outputFormat: 'gif',
        captionMode: 'off',
        ffmpegWasm: CORE,
      });
    });

    expect(mocks.frameInit).toHaveBeenCalledWith(doc, expect.any(Object), 'off');

    unmount();
  });

  it('reports the current frame and progress from frames that actually completed', async () => {
    const progressDoc: Doc = {
      ...doc,
      duration: 0.3,
      blocks: [{ ...doc.blocks[0], duration: 0.3 }],
    };
    let resolveSecondFrame!: (canvas: HTMLCanvasElement) => void;
    mocks.frameInit.mockResolvedValue(0.3);
    mocks.captureCanvasFrame.mockResolvedValueOnce({} as HTMLCanvasElement).mockImplementationOnce(
      () =>
        new Promise<HTMLCanvasElement>((resolve) => {
          resolveSecondFrame = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useVideoExport());

    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = result.current.startExport(progressDoc, {
        outputFormat: 'gif',
        ffmpegWasm: CORE,
      });
      await vi.waitFor(() => expect(mocks.captureCanvasFrame).toHaveBeenCalledTimes(2));
    });

    expect(result.current.phase).toBe('Capturing frame 2/3');
    expect(result.current.currentFrameTime).toBe(0.1);
    expect(result.current.progress).toBe(36.3);

    await act(async () => {
      resolveSecondFrame({} as HTMLCanvasElement);
      await exportPromise;
    });
    expect(result.current.state).toBe('complete');
    unmount();
  });

  it('identifies encoder backpressure separately from frame capture', async () => {
    let finishEncoding!: () => void;
    mocks.encodeFrame.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishEncoding = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useVideoExport());

    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = result.current.startExport(doc, {
        outputFormat: 'gif',
        ffmpegWasm: CORE,
      });
      await vi.waitFor(() => expect(mocks.encodeFrame).toHaveBeenCalledOnce());
    });

    expect(result.current.phase).toBe('Encoding frame 1/1');
    expect(result.current.currentFrameTime).toBe(0);

    await act(async () => {
      finishEncoding();
      await exportPromise;
    });
    expect(result.current.state).toBe('complete');
    unmount();
  });

  /**
   * Regression (silent CDN fetch + late failure): a GIF export with no
   * `ffmpegWasm` used to capture every frame, then reach the palette pass and
   * quietly fetch @ffmpeg/core from unpkg. It must instead fail immediately,
   * before any capture work, with setup instructions.
   */
  it('fails before capturing a single frame when no ffmpeg core is configured', async () => {
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(doc, { outputFormat: 'gif' });
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(/needs an ffmpeg\.wasm core URL/);
    expect(result.current.error).toContain('Animated GIF export');
    // The whole point: no capture, no encode, no palette pass.
    expect(mocks.frameInit).not.toHaveBeenCalled();
    expect(mocks.captureFrame).not.toHaveBeenCalled();
    expect(mocks.captureCanvasFrame).not.toHaveBeenCalled();
    expect(mocks.gifTranscode).not.toHaveBeenCalled();

    unmount();
  });

  it('aborts the palette worker when the export is cancelled', async () => {
    mocks.gifTranscode.mockImplementationOnce(
      async (_video: Uint8Array, _options: unknown, _loadConfig: unknown, signal?: AbortSignal) =>
        new Promise<Uint8Array<ArrayBuffer>>((_resolve, reject) => {
          if (!signal) throw new Error('Expected an AbortSignal');
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const { result, unmount } = renderHook(() => useVideoExport());

    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = result.current.startExport(doc, { outputFormat: 'gif', ffmpegWasm: CORE });
      await vi.waitFor(() => expect(mocks.gifTranscode).toHaveBeenCalledOnce());
    });
    const signal = mocks.gifTranscode.mock.calls[0][3] as AbortSignal;

    act(() => result.current.cancel());
    await act(async () => exportPromise);

    expect(signal.aborted).toBe(true);
    expect(result.current.state).toBe('idle');
    expect(result.current.phase).toBe('Cancelled');
    unmount();
  });

  it('cancels a fallback encoder while it is still starting', async () => {
    mocks.supportsH264.mockResolvedValue(false);
    let rejectReady!: (reason: Error) => void;
    const ready = new Promise<'webcodecs' | 'ffmpeg-wasm'>((_resolve, reject) => {
      rejectReady = reject;
    });
    const close = vi.fn(() => rejectReady(new Error('Encoder closed')));
    mocks.createWorkerEncoder.mockReturnValue({
      ready,
      encodeFrame: mocks.encodeFrame,
      finalize: mocks.finalize,
      close,
    });
    const { result, unmount } = renderHook(() => useVideoExport());

    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = result.current.startExport(doc, { outputFormat: 'gif', ffmpegWasm: CORE });
      await vi.waitFor(() => expect(mocks.createWorkerEncoder).toHaveBeenCalledOnce());
    });

    act(() => result.current.cancel());
    await act(async () => exportPromise);

    expect(close).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('idle');
    expect(result.current.phase).toBe('Cancelled');
    unmount();
  });
});

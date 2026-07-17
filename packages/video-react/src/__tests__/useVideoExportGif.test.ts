import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';

const mocks = vi.hoisted(() => {
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  return {
    bitmap,
    frameInit: vi.fn(async () => 0.1),
    captureFrame: vi.fn(async () => bitmap),
    captureCanvasFrame: vi.fn(async () => ({}) as HTMLCanvasElement),
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

import { settleWithin, useVideoExport } from '../hooks/useVideoExport.js';

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

  it('enables repeated-frame reuse for MP4 exports too', async () => {
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(doc, {
        outputFormat: 'mp4',
        animationsEnabled: false,
        audioPolicy: 'omit',
      });
    });

    expect(mocks.frameInit).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({ animationsEnabled: false }),
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

    expect(result.current.phase).toBe('Capturing frame 2/3 (0.1s)');
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

    expect(result.current.phase).toBe('Encoding frame 1/1 (0.0s)');

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

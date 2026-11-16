/**
 * Phone export across app switches.
 *
 * Switching apps suspends the web view, and iOS also invalidates the hardware
 * encoder session: pending WebCodecs work never settles, so an export used to
 * fail with "Video encoding stopped responding" shortly after the user came
 * back. Export now pauses while hidden and, on return, re-encodes only the
 * frames the lost codec never delivered.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';

const mocks = vi.hoisted(() => ({
  frameInit: vi.fn(async () => 0.5),
  captureCanvasFrame: vi.fn(async () => ({}) as HTMLCanvasElement),
  setCoverVisible: vi.fn(async () => {}),
  discardCachedFrames: vi.fn(),
  destroy: vi.fn(),
  encodeFrame: vi.fn(async (_frame: unknown, _index: number) => {}),
  drain: vi.fn(async () => {}),
  restartCodec: vi.fn(() => 0),
  finalizeBlob: vi.fn(async () => new Blob(['mp4'], { type: 'video/mp4' })),
  finalize: vi.fn(async () => new ArrayBuffer(4)),
  closeEncoder: vi.fn(),
}));

vi.mock('../hooks/useFrameCapture.js', () => {
  const handle = {
    init: mocks.frameInit,
    captureFrame: vi.fn(),
    captureCanvasFrame: mocks.captureCanvasFrame,
    setCoverVisible: mocks.setCoverVisible,
    discardCachedFrames: mocks.discardCachedFrames,
    destroy: mocks.destroy,
  };
  return { useFrameCapture: () => handle };
});

vi.mock('../mainThreadEncoder.js', () => ({
  supportsWebCodecs: () => true,
  probeWebCodecsH264: async () => ({ profile: 'baseline' }),
  H264_PROBE_FLUSH_TIMEOUT_MS: 3_000,
  createEncoder: () => ({
    encodeFrame: mocks.encodeFrame,
    drain: mocks.drain,
    restartCodec: mocks.restartCodec,
    finalize: mocks.finalize,
    finalizeBlob: mocks.finalizeBlob,
    close: mocks.closeEncoder,
  }),
}));

vi.mock('../workerEncoder.js', () => ({ createWorkerEncoder: vi.fn() }));
vi.mock('../gifTranscode.js', () => ({ transcodeMp4ToGifWithFfmpegWasm: vi.fn() }));
vi.mock('../audioTrack.js', () => ({
  supportsWebCodecsAac: async () => false,
  selectAudioTier: () => ({ tier: 3, reason: null }),
  encodeAacTrack: vi.fn(),
  audioBufferToWav: vi.fn(),
  muxAudioWithFfmpegWasm: vi.fn(),
  EXPORT_AUDIO_SAMPLE_RATE: 48_000,
  EXPORT_AUDIO_CHANNELS: 2,
}));

import {
  holdScreenWakeLock,
  settleWithin,
  useVideoExport,
  watchBackgroundInterruptions,
} from '../hooks/useVideoExport.js';
import { VideoEncodingInterruptedError } from '../encodingInterruption.js';

/** Five frames at 10 fps. */
const doc: Doc = {
  articleId: 'resume-test',
  duration: 0.5,
  blocks: [{ id: 'b1', startTime: 0, duration: 0.5, audioSegment: 0, layers: [] }],
  audio: { segments: [] },
};
const CONFIG = { fps: 10, audioPolicy: 'omit' as const };

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function encodedFrames(): number[] {
  return mocks.encodeFrame.mock.calls.map(([, index]) => index);
}

describe('video export across app switches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.encodeFrame.mockReset().mockResolvedValue(undefined);
    mocks.drain.mockReset().mockResolvedValue(undefined);
    mocks.restartCodec.mockReset().mockReturnValue(0);
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  it('replaces a codec that stalled while the app was in the background and re-encodes only the lost frames', async () => {
    vi.useFakeTimers();
    let stalled = false;
    mocks.encodeFrame.mockImplementation((_frame, index) => {
      if (index === 2 && !stalled) {
        stalled = true;
        setTimeout(() => setVisibility('hidden'), 0);
        setTimeout(() => setVisibility('visible'), 5_000);
        // The invalidated iOS encoder never settles.
        return new Promise<void>(() => {});
      }
      return Promise.resolve();
    });
    // Frame 0 reached the MP4 before the app was backgrounded.
    mocks.restartCodec.mockReturnValue(1);
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      const exporting = result.current.startExport(doc, CONFIG);
      // Back in the foreground at 5s; the stall is recognized 10s later, not 60s.
      await vi.advanceTimersByTimeAsync(5_000 + 10_000);
      await exporting;
    });

    expect(encodedFrames()).toEqual([0, 1, 2, 1, 2, 3, 4]);
    expect(mocks.restartCodec).toHaveBeenCalledOnce();
    expect(mocks.discardCachedFrames).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe('complete');
    unmount();
  });

  it('pauses capture while hidden and continues without re-encoding when the codec drained', async () => {
    let backgrounded = false;
    mocks.encodeFrame.mockImplementation(async (_frame, index) => {
      if (index === 1 && !backgrounded) {
        backgrounded = true;
        setVisibility('hidden');
      }
    });
    const { result, unmount } = renderHook(() => useVideoExport());

    let exporting!: Promise<void>;
    await act(async () => {
      exporting = result.current.startExport(doc, CONFIG);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current.phase).toBe('Paused while in the background');
    expect(mocks.captureCanvasFrame).toHaveBeenCalledTimes(2);
    expect(mocks.drain).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility('visible');
      await exporting;
    });

    expect(encodedFrames()).toEqual([0, 1, 2, 3, 4]);
    // Once to check the codec on return, once before finalizing.
    expect(mocks.drain).toHaveBeenCalledTimes(2);
    expect(mocks.restartCodec).not.toHaveBeenCalled();
    expect(mocks.discardCachedFrames).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('complete');
    unmount();
  });

  it('captures a frame again when the app was backgrounded mid-capture', async () => {
    let backgrounded = false;
    mocks.captureCanvasFrame.mockImplementation(async () => {
      if (mocks.captureCanvasFrame.mock.calls.length === 3 && !backgrounded) {
        backgrounded = true;
        setVisibility('hidden');
        setVisibility('visible');
      }
      return {} as HTMLCanvasElement;
    });
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(doc, CONFIG);
    });

    expect(mocks.captureCanvasFrame).toHaveBeenCalledTimes(6);
    expect(encodedFrames()).toEqual([0, 1, 2, 3, 4]);
    expect(mocks.discardCachedFrames).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('complete');
    unmount();
  });

  it('re-encodes frames a reclaimed codec lost without any background signal', async () => {
    let reclaimed = false;
    mocks.encodeFrame.mockImplementation(async (_frame, index) => {
      if (index === 3 && !reclaimed) {
        reclaimed = true;
        throw new VideoEncodingInterruptedError(2);
      }
    });
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      await result.current.startExport(doc, CONFIG);
    });

    expect(encodedFrames()).toEqual([0, 1, 2, 3, 2, 3, 4]);
    expect(mocks.restartCodec).not.toHaveBeenCalled();
    expect(result.current.state).toBe('complete');
    unmount();
  });

  it('resumes when the app is backgrounded while the video is finalizing', async () => {
    vi.useFakeTimers();
    let stalled = false;
    mocks.drain.mockImplementation(() => {
      if (!stalled) {
        stalled = true;
        setTimeout(() => setVisibility('hidden'), 0);
        setTimeout(() => setVisibility('visible'), 1_000);
        return new Promise<void>(() => {});
      }
      return Promise.resolve();
    });
    mocks.restartCodec.mockReturnValue(4);
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      const exporting = result.current.startExport(doc, CONFIG);
      await vi.advanceTimersByTimeAsync(1_000 + 10_000);
      await exporting;
    });

    expect(encodedFrames()).toEqual([0, 1, 2, 3, 4, 4]);
    expect(mocks.restartCodec).toHaveBeenCalledOnce();
    expect(mocks.finalizeBlob).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('complete');
    unmount();
  });

  it('still fails a stall that no background interruption explains', async () => {
    vi.useFakeTimers();
    mocks.encodeFrame.mockImplementation((_frame, index) =>
      index === 2 ? new Promise<void>(() => {}) : Promise.resolve(),
    );
    const { result, unmount } = renderHook(() => useVideoExport());

    await act(async () => {
      const exporting = result.current.startExport(doc, CONFIG);
      await vi.advanceTimersByTimeAsync(60_000);
      await exporting;
    });

    expect(mocks.restartCodec).not.toHaveBeenCalled();
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('Video encoding stopped responding at frame 3/5.');
    unmount();
  });
});

describe('settleWithin resumed deadline', () => {
  let state: DocumentVisibilityState = 'visible';
  const activity = {
    get visibilityState() {
      return state;
    },
    listeners: new Set<() => void>(),
    addEventListener(_type: string, listener: () => void) {
      this.listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      this.listeners.delete(listener);
    },
  };
  const change = (next: DocumentVisibilityState): void => {
    state = next;
    activity.listeners.forEach((listener) => listener());
  };

  beforeEach(() => {
    vi.useFakeTimers();
    state = 'visible';
    activity.listeners.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('allows only the resumed budget once a hidden document returns', async () => {
    const bounded = settleWithin(
      new Promise(() => {}),
      60_000,
      'stalled',
      undefined,
      activity as unknown as Document,
      10_000,
    );
    const rejection = expect(bounded).rejects.toThrow('stalled');

    change('hidden');
    await vi.advanceTimersByTimeAsync(120_000);
    change('visible');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it('applies the resumed budget when the document was hidden before the wait began', async () => {
    state = 'hidden';
    const bounded = settleWithin(
      new Promise(() => {}),
      60_000,
      'stalled',
      undefined,
      activity as unknown as Document,
      10_000,
    );
    const rejection = expect(bounded).rejects.toThrow('stalled');

    change('visible');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it('keeps the full budget when the document never left', async () => {
    let settled = false;
    void settleWithin(
      new Promise(() => {}),
      60_000,
      'stalled',
      undefined,
      activity as unknown as Document,
      10_000,
    ).catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(true);
  });
});

describe('watchBackgroundInterruptions', () => {
  beforeEach(() => {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
  });
  afterEach(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  it('reports each trip to the background once', () => {
    const monitor = watchBackgroundInterruptions(document);
    expect(monitor.takeInterruption()).toBe(false);

    setVisibility('hidden');
    setVisibility('visible');

    expect(monitor.takeInterruption()).toBe(true);
    expect(monitor.takeInterruption()).toBe(false);
    monitor.dispose();
  });

  it('counts a Capacitor pause and a Page Lifecycle freeze as interruptions', () => {
    const monitor = watchBackgroundInterruptions(document);

    document.dispatchEvent(new Event('pause'));
    expect(monitor.takeInterruption()).toBe(true);
    document.dispatchEvent(new Event('freeze'));
    expect(monitor.takeInterruption()).toBe(true);
    monitor.dispose();
  });

  it('waits for the page to be visible again, or for cancellation', async () => {
    const monitor = watchBackgroundInterruptions(document);
    setVisibility('hidden');
    let resumed = false;
    const waiting = monitor.waitUntilVisible().then(() => {
      resumed = true;
    });
    await Promise.resolve();
    expect(resumed).toBe(false);

    setVisibility('visible');
    await waiting;
    expect(resumed).toBe(true);

    setVisibility('hidden');
    const abort = new AbortController();
    const cancelled = monitor.waitUntilVisible(abort.signal);
    abort.abort();
    await expect(cancelled).resolves.toBeUndefined();
    monitor.dispose();
  });
});

describe('holdScreenWakeLock', () => {
  type FakeSentinel = EventTarget & { release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
  });
  afterEach(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  function installWakeLock(): { request: ReturnType<typeof vi.fn>; sentinels: FakeSentinel[] } {
    const sentinels: FakeSentinel[] = [];
    const request = vi.fn(async () => {
      const sentinel = new EventTarget() as FakeSentinel;
      sentinel.release = vi.fn(async () => {
        sentinel.dispatchEvent(new Event('release'));
      });
      sentinels.push(sentinel);
      return sentinel;
    });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    return { request, sentinels };
  }

  it('keeps the screen on and takes the lock again when the page returns', async () => {
    const { request, sentinels } = installWakeLock();

    const release = holdScreenWakeLock(document);
    await vi.waitFor(() => expect(sentinels).toHaveLength(1));
    expect(request).toHaveBeenCalledWith('screen');

    // The platform drops the lock whenever the page is hidden.
    setVisibility('hidden');
    sentinels[0].dispatchEvent(new Event('release'));
    setVisibility('visible');
    await vi.waitFor(() => expect(sentinels).toHaveLength(2));

    release();
    expect(sentinels[1].release).toHaveBeenCalledOnce();
  });

  it('releases a lock granted after the export already ended', async () => {
    const { sentinels } = installWakeLock();

    const release = holdScreenWakeLock(document);
    release();
    await vi.waitFor(() => expect(sentinels).toHaveLength(1));
    await vi.waitFor(() => expect(sentinels[0].release).toHaveBeenCalledOnce());
  });

  it('does nothing where the Screen Wake Lock API is missing', () => {
    expect(() => holdScreenWakeLock(document)()).not.toThrow();
  });
});

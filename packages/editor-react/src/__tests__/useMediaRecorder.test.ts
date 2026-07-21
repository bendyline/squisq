import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaRecorder } from '../recorder/hooks/useMediaRecorder.js';

/**
 * Lifecycle test for the recorder hook with stubbed browser APIs.
 * Drives request → start → stop and verifies the surface contract:
 * state transitions, blob production, and cleanup on cancel.
 */

class FakeMediaStreamTrack {
  readyState: 'live' | 'ended' = 'live';
  kind: 'audio' | 'video';
  onended: (() => void) | null = null;
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  constructor(kind: 'audio' | 'video') {
    this.kind = kind;
  }
  /** Simulate the browser ending the track (e.g. the "Stop sharing" button). */
  end(): void {
    this.readyState = 'ended';
    this.onended?.();
  }
}

class FakeMediaStream {
  tracks: FakeMediaStreamTrack[];
  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = tracks;
  }
  get active() {
    return this.tracks.some((t) => t.readyState === 'live');
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

interface FakeRecorderHandle {
  state: 'recording' | 'inactive';
  mimeType: string;
  stream: FakeMediaStream;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstart: (() => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(): void;
  stop(): void;
}

let lastRecorder: FakeRecorderHandle | null = null;
let lastStream: FakeMediaStream | null = null;
/** Every FakeMediaRecorder constructed this test, in order (0 = primary lane). */
let recorders: FakeRecorderHandle[] = [];

class FakeMediaRecorder implements FakeRecorderHandle {
  state: 'recording' | 'inactive' = 'inactive';
  mimeType: string;
  stream: FakeMediaStream;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(stream: FakeMediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? 'audio/webm';
    // Expose the most recent instance to the test body so assertions can
    // poke at its state/event handlers. Not a `const self = this` alias
    // pattern — `lastRecorder` is a module-level slot, not a workaround
    // for arrow-function-vs-method `this` confusion.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastRecorder = this;
    recorders.push(this);
  }
  static isTypeSupported(mime: string): boolean {
    return mime.startsWith('audio/webm') || mime.startsWith('video/webm');
  }
  start() {
    this.state = 'recording';
    this.onstart?.();
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    // Emit a fake data chunk then resolve.
    this.ondataavailable?.({ data: new Blob(['hello'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const originalMediaRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
const originalNavigator = globalThis.navigator;

beforeEach(() => {
  lastRecorder = null;
  recorders = [];
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeMediaRecorder;
  const fakeStream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
  lastStream = fakeStream;
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(fakeStream),
        getDisplayMedia: vi
          .fn()
          .mockResolvedValue(new FakeMediaStream([new FakeMediaStreamTrack('video')])),
      },
    },
    configurable: true,
  });
});

afterEach(() => {
  if (originalMediaRecorder === undefined) {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  } else {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalMediaRecorder;
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
  });
});

describe('useMediaRecorder lifecycle', () => {
  it('walks idle → ready → recording → stopped and produces a blob', async () => {
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));

    expect(result.current.state).toBe('idle');

    await act(async () => {
      await result.current.request();
    });
    expect(result.current.state).toBe('ready');
    expect(result.current.stream).not.toBeNull();
    expect(result.current.mimeType).toMatch(/^audio\/webm/);
    expect(result.current.extension).toBe('.webm');
    expect(result.current.directory).toBe('audio');

    act(() => {
      result.current.start();
    });
    expect(result.current.state).toBe('recording');
    expect(lastRecorder?.state).toBe('recording');

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });
    expect(result.current.state).toBe('stopped');
    expect(blob).toBeInstanceOf(Blob);
    expect(result.current.blob).toBeInstanceOf(Blob);
  });

  it('reset() returns to ready when the underlying stream is still live (discard & re-record)', async () => {
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));

    await act(async () => {
      await result.current.request();
    });
    act(() => {
      result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.state).toBe('stopped');

    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toBe('ready');
    expect(result.current.blob).toBeNull();
    expect(result.current.stream).not.toBeNull();
  });

  it('defaults to the mic source when called with no options', async () => {
    const { result } = renderHook(() => useMediaRecorder());

    expect(result.current.state).toBe('idle');

    await act(async () => {
      await result.current.request();
    });

    // Mic path: audio-only capture via getUserMedia, lands in `audio/`.
    expect(result.current.state).toBe('ready');
    expect(result.current.mimeType).toMatch(/^audio\/webm/);
    expect(result.current.directory).toBe('audio');
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    expect(getUserMedia).toHaveBeenCalled();
  });

  it('camera includes the mic by default', async () => {
    const { result } = renderHook(() => useMediaRecorder({ source: 'camera' }));
    await act(async () => {
      await result.current.request();
    });
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: true, audio: true }),
    );
  });

  it('camera omits the mic when includeMicrophone is false', async () => {
    const { result } = renderHook(() =>
      useMediaRecorder({ source: 'camera', includeMicrophone: false }),
    );
    await act(async () => {
      await result.current.request();
    });
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: true, audio: false }),
    );
  });

  it('cancel() tears down state and stops the stream tracks', async () => {
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));

    await act(async () => {
      await result.current.request();
    });
    const stream = result.current.stream as unknown as FakeMediaStream;
    expect(stream).not.toBeNull();
    const tracks = stream.getTracks();

    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.stream).toBeNull();
    expect(tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
  });

  it('deduplicates concurrent permission requests', async () => {
    let resolve!: (stream: FakeMediaStream) => void;
    const pending = new Promise<FakeMediaStream>((res) => {
      resolve = res;
    });
    const getUserMedia = vi.fn().mockReturnValue(pending);
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia } },
    });
    const stream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.request();
      second = result.current.request();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    resolve(stream);
    await act(async () => Promise.all([first, second]));
    expect(result.current.state).toBe('ready');
  });

  it('releases an acquired stream when recorder construction fails', async () => {
    class ThrowingRecorder {
      static isTypeSupported() {
        return true;
      }
      constructor() {
        throw new Error('construction failed');
      }
    }
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = ThrowingRecorder;
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));
    await act(async () => {
      await expect(result.current.request()).rejects.toThrow('construction failed');
    });
    expect(lastStream?.getTracks().every((track) => track.stop.mock.calls.length > 0)).toBe(true);
  });

  it('ignores a late onstop event after cancel', async () => {
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));
    await act(async () => result.current.request());
    act(() => result.current.start());
    const lateOnStop = lastRecorder?.onstop;
    act(() => result.current.cancel());
    act(() => lateOnStop?.());
    expect(result.current.state).toBe('idle');
    expect(result.current.blob).toBeNull();
  });

  it('returns the same in-flight stop promise to repeated callers', async () => {
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));
    await act(async () => result.current.request());
    act(() => result.current.start());
    const recorder = lastRecorder!;
    const complete = recorder.onstop!;
    recorder.stop = vi.fn(() => {
      recorder.state = 'inactive';
    });
    let first!: Promise<Blob | null>;
    let second!: Promise<Blob | null>;
    act(() => {
      first = result.current.stop();
      second = result.current.stop();
    });
    expect(second).toBe(first);
    act(() => complete());
    await first;
    expect(result.current.state).toBe('stopped');
  });

  it('leaves the camera lane null for a single-stream source', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: vi
            .fn()
            .mockResolvedValue(
              new FakeMediaStream([new FakeMediaStreamTrack('video'), new FakeMediaStreamTrack('audio')]),
            ),
          getDisplayMedia: vi.fn(),
        },
      },
    });
    const { result } = renderHook(() => useMediaRecorder({ source: 'camera' }));
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.camera).toBeNull();
    expect(result.current.cameraOffsetSec).toBeNull();
    expect(recorders).toHaveLength(1);
  });
});

/** Wire the navigator so screen (getDisplayMedia) and camera (getUserMedia)
 * resolve to specific streams for the dual `'screen+camera'` path. */
function stubDualStreams(screen: FakeMediaStream, camera: FakeMediaStream) {
  const getDisplayMedia = vi.fn().mockResolvedValue(screen);
  const getUserMedia = vi.fn().mockResolvedValue(camera);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia, getDisplayMedia } },
  });
  return { getDisplayMedia, getUserMedia };
}

describe('useMediaRecorder — screen + camera (dual lane)', () => {
  it('acquires the screen before the camera and exposes a camera lane', async () => {
    const screen = new FakeMediaStream([new FakeMediaStreamTrack('video')]);
    const camera = new FakeMediaStream([
      new FakeMediaStreamTrack('video'),
      new FakeMediaStreamTrack('audio'),
    ]);
    const { getDisplayMedia, getUserMedia } = stubDualStreams(screen, camera);

    const { result } = renderHook(() => useMediaRecorder({ source: 'screen+camera' }));
    await act(async () => {
      await result.current.request();
    });

    expect(result.current.state).toBe('ready');
    expect(result.current.directory).toBe('video');
    expect(result.current.stream).toBe(screen as unknown as MediaStream);
    expect(result.current.camera?.stream).toBe(camera as unknown as MediaStream);
    expect(recorders).toHaveLength(2);
    // Screen must be requested first (it consumes the click's transient activation).
    expect(getDisplayMedia.mock.invocationCallOrder[0]).toBeLessThan(
      getUserMedia.mock.invocationCallOrder[0],
    );
  });

  it('errors and releases the screen when the camera is denied', async () => {
    const screenTrack = new FakeMediaStreamTrack('video');
    const screen = new FakeMediaStream([screenTrack]);
    const getDisplayMedia = vi.fn().mockResolvedValue(screen);
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia, getDisplayMedia } },
    });

    const { result } = renderHook(() => useMediaRecorder({ source: 'screen+camera' }));
    await act(async () => {
      // getUserMedia rejects with a DOMException; the hook normalizes it, so
      // assert the rejection propagates rather than pinning its message.
      await expect(result.current.request()).rejects.toThrow();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.camera).toBeNull();
    // The screen capture acquired first must be released, not left stranded.
    expect(screenTrack.stop).toHaveBeenCalled();
  });

  it('starts both lanes and resolves stop only after both flush, with a measured offset', async () => {
    const screen = new FakeMediaStream([new FakeMediaStreamTrack('video')]);
    const camera = new FakeMediaStream([
      new FakeMediaStreamTrack('video'),
      new FakeMediaStreamTrack('audio'),
    ]);
    stubDualStreams(screen, camera);

    const { result } = renderHook(() => useMediaRecorder({ source: 'screen+camera' }));
    await act(async () => {
      await result.current.request();
    });
    act(() => {
      result.current.start();
    });
    expect(recorders[0].state).toBe('recording');
    expect(recorders[1].state).toBe('recording');

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });
    expect(result.current.state).toBe('stopped');
    expect(blob).toBeInstanceOf(Blob);
    expect(result.current.blob).toBeInstanceOf(Blob);
    expect(result.current.camera?.blob).toBeInstanceOf(Blob);
    expect(result.current.cameraOffsetSec).not.toBeNull();
  });

  it('cancel() stops the tracks of both the screen and camera streams', async () => {
    const screenTrack = new FakeMediaStreamTrack('video');
    const camVideo = new FakeMediaStreamTrack('video');
    const camAudio = new FakeMediaStreamTrack('audio');
    stubDualStreams(new FakeMediaStream([screenTrack]), new FakeMediaStream([camVideo, camAudio]));

    const { result } = renderHook(() => useMediaRecorder({ source: 'screen+camera' }));
    await act(async () => {
      await result.current.request();
    });
    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.camera).toBeNull();
    expect(screenTrack.stop).toHaveBeenCalled();
    expect(camVideo.stop).toHaveBeenCalled();
    expect(camAudio.stop).toHaveBeenCalled();
  });

  it('auto-stops the whole take when the screen share ends mid-recording', async () => {
    const screenTrack = new FakeMediaStreamTrack('video');
    stubDualStreams(
      new FakeMediaStream([screenTrack]),
      new FakeMediaStream([new FakeMediaStreamTrack('video')]),
    );

    const { result } = renderHook(() => useMediaRecorder({ source: 'screen+camera' }));
    await act(async () => {
      await result.current.request();
    });
    act(() => {
      result.current.start();
    });
    expect(result.current.state).toBe('recording');

    await act(async () => {
      screenTrack.end(); // browser "Stop sharing"
    });

    expect(result.current.state).toBe('stopped');
    expect(result.current.blob).toBeInstanceOf(Blob);
    expect(result.current.camera?.blob).toBeInstanceOf(Blob);
  });

  it('cancels the take (releasing the camera) when the screen share ends before recording', async () => {
    const screenTrack = new FakeMediaStreamTrack('video');
    const camVideo = new FakeMediaStreamTrack('video');
    stubDualStreams(new FakeMediaStream([screenTrack]), new FakeMediaStream([camVideo]));

    const { result } = renderHook(() => useMediaRecorder({ source: 'screen+camera' }));
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.state).toBe('ready');

    await act(async () => {
      screenTrack.end();
    });

    expect(result.current.state).toBe('idle');
    expect(camVideo.stop).toHaveBeenCalled();
  });
});

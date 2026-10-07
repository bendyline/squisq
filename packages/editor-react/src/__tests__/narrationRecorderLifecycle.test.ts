/**
 * @vitest-environment jsdom
 *
 * Regression coverage for two media-lifecycle holes in the narration
 * recorder's startup path.
 *
 * 1. Camera leak on a setup error. Between `requestCameraStream()` resolving
 *    and `captureRef.current = capture` — the window containing the camera
 *    `MediaRecorder` construction and both `.start()` calls — any throw ran a
 *    `teardownCapture()` that reads `captureRef.current`. That ref is still
 *    null there, so the freshly acquired camera tracks were never stopped and
 *    the camera indicator stayed lit until the tab closed.
 *
 * 2. Stop swallowed during 'starting'. The Stop button renders in 'starting'
 *    (`busyRecording` in TeleprompterView), but `stop()` returned immediately
 *    while `captureRef.current` was null. The in-flight `start()` then ran to
 *    completion and transitioned to 'recording' anyway — the prompter began
 *    rolling despite the user asking it not to, and only a SECOND Stop press
 *    ended it.
 *
 * Both are asserted through the hook's public surface plus the tracks it
 * acquired: state alone can't tell you a camera is still live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { NarrationScript } from '@bendyline/squisq/narration';
import { useNarrationRecorder } from '../teleprompter/recording/useNarrationRecorder';
import type { MicAnalysisHandle } from '../teleprompter/useMicAnalysis';

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  constructor(public kind: 'audio' | 'video') {}
  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeStream {
  constructor(public tracks: FakeTrack[]) {}
  get active() {
    return this.tracks.some((t) => t.readyState === 'live');
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

/** Every camera stream handed out by the mocked getUserMedia. */
let cameraStreams: FakeStream[] = [];
/** Resolver for the pending camera acquisition, so tests can time the race. */
let releaseCamera: (() => void) | null = null;
/** When set, the NEXT MediaRecorder construction throws — models a codec fault. */
let recorderConstructorThrowsOn: 'video' | null = null;

class FakeMediaRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstart: (() => void) | null = null;
  mimeType: string;
  constructor(
    public stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    if (recorderConstructorThrowsOn && this.mimeType.startsWith(recorderConstructorThrowsOn)) {
      throw new Error('MediaRecorder: unsupported configuration');
    }
  }
  static isTypeSupported() {
    return true;
  }
  start() {
    this.state = 'recording';
    this.onstart?.();
  }
  stop() {
    this.state = 'inactive';
  }
  addEventListener() {}
  removeEventListener() {}
}

const script: NarrationScript = {
  sourceText: 'hello there',
  tokens: [],
  blocks: [],
  totalSyllables: 0,
  cumulativeSyllables: [0],
};

function micHandle(): MicAnalysisHandle {
  const stream = new FakeStream([new FakeTrack('audio')]);
  return {
    status: 'live',
    stream: stream as unknown as MediaStream,
    error: null,
    start: vi.fn(async () => stream as unknown as MediaStream),
    stop: vi.fn(),
  } as unknown as MicAnalysisHandle;
}

function renderRecorder() {
  return renderHook(() =>
    useNarrationRecorder({
      mic: micHandle(),
      getScript: () => script,
      getWordPos: () => 0,
      getMicDeviceId: () => null,
    }),
  );
}

/** Every camera track this test acquired, across all streams. */
const cameraTracks = () => cameraStreams.flatMap((s) => s.getTracks());
const liveCameraTracks = () => cameraTracks().filter((t) => t.readyState === 'live');

describe('useNarrationRecorder — startup media lifecycle', () => {
  beforeEach(() => {
    cameraStreams = [];
    releaseCamera = null;
    recorderConstructorThrowsOn = null;
    vi.stubGlobal('MediaStream', FakeStream);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          const stream = new FakeStream([new FakeTrack('video')]);
          cameraStreams.push(stream);
          // Hold the acquisition open when a test wants to race it.
          if (releaseCamera === null) return stream;
          await new Promise<void>((resolve) => {
            releaseCamera = resolve;
          });
          return stream;
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('releases the camera when the camera recorder throws mid-start', async () => {
    const { result } = renderRecorder();
    act(() => result.current.setWithCamera(true));

    // The camera MediaRecorder blows up AFTER getUserMedia handed us tracks —
    // the exact window where teardownCapture() could not see them.
    recorderConstructorThrowsOn = 'video';
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error?.message).toContain('unsupported configuration');
    // The whole point: no stuck camera indicator.
    expect(cameraTracks().length).toBeGreaterThan(0);
    expect(liveCameraTracks()).toEqual([]);
  });

  it('cancels a pending start when stop() is pressed during startup', async () => {
    // Park getUserMedia so `start()` is provably mid-flight.
    releaseCamera = () => {};
    const { result } = renderRecorder();
    act(() => result.current.setWithCamera(true));

    let started: Promise<void>;
    act(() => {
      started = result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe('starting'));

    // Stop while the permission prompt is still up (the Stop button is live
    // in 'starting', so this is a real user action, not a synthetic race).
    await act(async () => {
      await result.current.stop();
      releaseCamera?.();
      await started;
    });

    // The pending start must NOT have completed into a recording...
    expect(result.current.state).not.toBe('recording');
    expect(result.current.state).toBe('idle');
    expect(result.current.take).toBeNull();
    // ...and it must not have left the camera running.
    expect(liveCameraTracks()).toEqual([]);
  });

  it('does not fire onRecordingStart for a start cancelled during startup', async () => {
    releaseCamera = () => {};
    const onRecordingStart = vi.fn();
    const { result } = renderHook(() =>
      useNarrationRecorder({
        mic: micHandle(),
        getScript: () => script,
        getWordPos: () => 0,
        getMicDeviceId: () => null,
        onRecordingStart,
      }),
    );
    act(() => result.current.setWithCamera(true));

    let started: Promise<void>;
    act(() => {
      started = result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe('starting'));
    await act(async () => {
      await result.current.stop();
      releaseCamera?.();
      await started;
    });

    expect(onRecordingStart).not.toHaveBeenCalled();
  });

  it('releases the camera when the hook unmounts mid-start', async () => {
    releaseCamera = () => {};
    const { result, unmount } = renderRecorder();
    act(() => result.current.setWithCamera(true));

    let started: Promise<void>;
    act(() => {
      started = result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe('starting'));

    // Mode switch / shell teardown while the camera prompt is pending.
    unmount();
    await act(async () => {
      releaseCamera?.();
      await started;
    });

    expect(liveCameraTracks()).toEqual([]);
  });

  /** A recorder whose count-in the test finishes by hand. */
  function renderCountingIn() {
    let finish: (rolled: boolean) => void = () => {};
    const countIn = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const onRecordingStop = vi.fn();
    const hook = renderHook(() =>
      useNarrationRecorder({
        mic: micHandle(),
        getScript: () => script,
        getWordPos: () => 0,
        getMicDeviceId: () => null,
        countIn,
        onRecordingStop,
      }),
    );
    act(() => hook.result.current.setWithCamera(true));
    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = hook.result.current.start();
    });
    return {
      ...hook,
      countIn,
      onRecordingStop,
      finishCountIn: (rolled: boolean) => finish(rolled),
      started: () => started,
    };
  }

  it('captures nothing until the count-in ends', async () => {
    const recorderStart = vi.spyOn(FakeMediaRecorder.prototype, 'start');
    const { result, countIn, finishCountIn, started } = renderCountingIn();
    await waitFor(() => expect(countIn).toHaveBeenCalledTimes(1));

    // Devices are live and the self-view has the camera, but no bytes yet.
    expect(result.current.state).toBe('starting');
    expect(result.current.cameraStream).not.toBeNull();
    expect(recorderStart).not.toHaveBeenCalled();

    await act(async () => {
      finishCountIn(true);
      await started();
    });
    expect(result.current.state).toBe('recording');
    expect(recorderStart).toHaveBeenCalledTimes(2);
  });

  it('records nothing and releases the camera when the count-in is cancelled', async () => {
    const recorderStart = vi.spyOn(FakeMediaRecorder.prototype, 'start');
    const { result, countIn, finishCountIn, started } = renderCountingIn();
    await waitFor(() => expect(countIn).toHaveBeenCalledTimes(1));

    await act(async () => {
      finishCountIn(false);
      await started();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.cameraStream).toBeNull();
    expect(recorderStart).not.toHaveBeenCalled();
    expect(liveCameraTracks()).toEqual([]);
  });

  it('stop() during the count-in halts the prompter and records nothing', async () => {
    const recorderStart = vi.spyOn(FakeMediaRecorder.prototype, 'start');
    const { result, countIn, onRecordingStop, finishCountIn, started } = renderCountingIn();
    await waitFor(() => expect(countIn).toHaveBeenCalledTimes(1));
    // Like the prompter: pausing mid-countdown cancels the count-in.
    onRecordingStop.mockImplementation(() => finishCountIn(false));

    await act(async () => {
      await result.current.stop();
      await started();
    });
    expect(onRecordingStop).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('idle');
    expect(recorderStart).not.toHaveBeenCalled();
    expect(liveCameraTracks()).toEqual([]);
  });

  it('still reaches recording on an uninterrupted start', async () => {
    const { result } = renderRecorder();
    act(() => result.current.setWithCamera(true));

    await act(async () => {
      await result.current.start();
    });

    // The guards must not break the happy path they wrap.
    expect(result.current.state).toBe('recording');
    expect(liveCameraTracks().length).toBeGreaterThan(0);
  });
});

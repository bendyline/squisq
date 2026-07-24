import { afterEach, describe, expect, it, vi } from 'vitest';
import { seekVideoToFrame } from '../docPlayer/renderReadiness';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function controllableVideo(options: { duration?: number; clampToDuration?: boolean } = {}): {
  video: HTMLVideoElement;
  setSeeking: (value: boolean) => void;
  setReadyState: (value: number) => void;
  advanceTime: (value: number) => void;
  assignedTimes: number[];
} {
  const video = document.createElement('video');
  const duration = options.duration ?? Number.NaN;
  let currentTime = 0;
  let seeking = false;
  let readyState: number = HTMLMediaElement.HAVE_NOTHING;
  const assignedTimes: number[] = [];
  Object.defineProperties(video, {
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        assignedTimes.push(value);
        currentTime =
          options.clampToDuration && Number.isFinite(duration) ? Math.min(value, duration) : value;
        seeking = true;
      },
    },
    duration: { configurable: true, get: () => duration },
    seeking: { configurable: true, get: () => seeking },
    readyState: { configurable: true, get: () => readyState },
  });
  vi.spyOn(video, 'pause').mockImplementation(() => undefined);
  return {
    video,
    setSeeking: (value) => {
      seeking = value;
    },
    setReadyState: (value) => {
      readyState = value;
    },
    advanceTime: (value) => {
      currentTime = value;
    },
    assignedTimes,
  };
}

describe('seekVideoToFrame', () => {
  it('waits for the requested decoded frame instead of trusting currentTime assignment', async () => {
    const { video, setSeeking, setReadyState } = controllableVideo();
    let presentFrame: VideoFrameRequestCallback | null = null;
    const requestFrame = vi.fn((callback: VideoFrameRequestCallback) => {
      presentFrame = callback;
      return 7;
    });
    const cancelFrame = vi.fn();
    Object.defineProperties(video, {
      requestVideoFrameCallback: { configurable: true, value: requestFrame },
      cancelVideoFrameCallback: { configurable: true, value: cancelFrame },
    });
    document.body.appendChild(video);

    const pending = seekVideoToFrame(video, 2.5);
    await Promise.resolve();
    expect(video.currentTime).toBe(2.5);
    expect(requestFrame).not.toHaveBeenCalled();

    setReadyState(HTMLMediaElement.HAVE_CURRENT_DATA);
    setSeeking(false);
    video.dispatchEvent(new Event('seeked'));
    expect(requestFrame).toHaveBeenCalledOnce();

    presentFrame!(0, { mediaTime: 2.5 } as VideoFrameCallbackMetadata);
    await expect(pending).resolves.toBeUndefined();
    expect(cancelFrame).not.toHaveBeenCalled();
    video.remove();
  });

  it('does not await a compositor callback for an invisible capture surface', async () => {
    const { video, setSeeking, setReadyState } = controllableVideo();
    const requestFrame = vi.fn(() => 7);
    Object.defineProperty(video, 'requestVideoFrameCallback', {
      configurable: true,
      value: requestFrame,
    });
    const captureSurface = document.createElement('div');
    captureSurface.style.opacity = '0';
    captureSurface.appendChild(video);
    document.body.appendChild(captureSurface);

    const pending = seekVideoToFrame(video, 0);
    setReadyState(HTMLMediaElement.HAVE_CURRENT_DATA);
    setSeeking(false);
    video.dispatchEvent(new Event('seeked'));

    await expect(pending).resolves.toBeUndefined();
    expect(requestFrame).not.toHaveBeenCalled();
    captureSurface.remove();
  });

  it('uses seeked plus readyState when presented-frame callbacks are unavailable', async () => {
    const { video, setSeeking, setReadyState } = controllableVideo();
    const pending = seekVideoToFrame(video, 1.25);

    setReadyState(HTMLMediaElement.HAVE_CURRENT_DATA);
    setSeeking(false);
    video.dispatchEvent(new Event('seeked'));

    await expect(pending).resolves.toBeUndefined();
  });

  it('observes a completed hidden seek when the browser omits readiness events', async () => {
    vi.useFakeTimers();
    const { video, setSeeking, setReadyState } = controllableVideo();
    const captureSurface = document.createElement('div');
    captureSurface.style.opacity = '0';
    captureSurface.appendChild(video);
    document.body.appendChild(captureSurface);

    const pending = seekVideoToFrame(video, 3, 250);
    setReadyState(HTMLMediaElement.HAVE_ENOUGH_DATA);
    setSeeking(false);

    await vi.advanceTimersByTimeAsync(16);
    await expect(pending).resolves.toBeUndefined();
    captureSurface.remove();
  });

  it('advances a capture-marked recorder WebM without assigning currentTime', async () => {
    vi.useFakeTimers();
    const { video, setReadyState, advanceTime, assignedTimes } = controllableVideo({
      duration: 304.534,
    });
    // Chromium can leave play() pending after playback has already advanced.
    // The frame monitor must not await this promise before it starts polling.
    const play = vi.spyOn(video, 'play').mockImplementation(() => new Promise<void>(() => {}));
    video.dataset.captureSequential = 'true';
    setReadyState(HTMLMediaElement.HAVE_ENOUGH_DATA);

    const pending = seekVideoToFrame(video, 1 / 30, 250);
    await Promise.resolve();
    expect(play).toHaveBeenCalledOnce();
    expect(assignedTimes).toEqual([]);

    advanceTime(0.034);
    await vi.advanceTimersByTimeAsync(16);
    await expect(pending).resolves.toBeUndefined();
    expect(assignedTimes).toEqual([]);
    expect(video.playbackRate).toBe(0.2);
  });

  it('keeps advancing recorder video while hidden when background playback is permitted', async () => {
    vi.useFakeTimers();
    const visibilityState: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    const { video, setReadyState, advanceTime, assignedTimes } = controllableVideo({
      duration: 304.534,
    });
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);
    video.dataset.captureSequential = 'true';
    setReadyState(HTMLMediaElement.HAVE_ENOUGH_DATA);

    const pending = seekVideoToFrame(video, 1 / 30, 250);
    await Promise.resolve();
    expect(play).toHaveBeenCalledOnce();
    expect(assignedTimes).toEqual([]);

    advanceTime(0.034);
    video.dispatchEvent(new Event('timeupdate'));
    await expect(pending).resolves.toBeUndefined();
    expect(visibilityState).toBe('hidden');
  });

  it('waits for visibility when Chromium rejects background playback', async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    const { video, setReadyState, advanceTime } = controllableVideo({
      duration: 304.534,
    });
    const play = vi
      .spyOn(video, 'play')
      .mockRejectedValueOnce(new Error('Background playback suspended'))
      .mockResolvedValue(undefined);
    video.dataset.captureSequential = 'true';
    setReadyState(HTMLMediaElement.HAVE_ENOUGH_DATA);
    let settled = false;

    const pending = seekVideoToFrame(video, 1 / 30, 250);
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(play).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(false);

    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(2);
    advanceTime(0.034);
    video.dispatchEvent(new Event('timeupdate'));
    await expect(pending).resolves.toBeUndefined();
  });

  it('pauses an ahead recorder WebM instead of seeking it backward', async () => {
    const { video, setReadyState, advanceTime, assignedTimes } = controllableVideo({
      duration: 304.534,
    });
    video.dataset.captureSequential = 'true';
    setReadyState(HTMLMediaElement.HAVE_ENOUGH_DATA);
    advanceTime(2.2);

    await expect(seekVideoToFrame(video, 2)).resolves.toBeUndefined();

    expect(video.pause).toHaveBeenCalledOnce();
    expect(assignedTimes).toEqual([]);
  });

  it('pauses its watchdog while the capture document is hidden and resumes visibly', async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    const { video, setReadyState, advanceTime } = controllableVideo({
      duration: 304.534,
    });
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);
    video.dataset.captureSequential = 'true';
    setReadyState(HTMLMediaElement.HAVE_ENOUGH_DATA);
    let settled = false;

    const pending = seekVideoToFrame(video, 1 / 30, 250);
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(play).toHaveBeenCalledOnce();

    visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(false);

    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(play).toHaveBeenCalledTimes(2);
    advanceTime(0.034);
    video.dispatchEvent(new Event('timeupdate'));
    await expect(pending).resolves.toBeUndefined();
  });

  it('accepts the terminal frame when the requested time exceeds the exact media duration', async () => {
    vi.useFakeTimers();
    const { video, setSeeking, setReadyState } = controllableVideo({
      duration: 10.608,
      clampToDuration: true,
    });
    const captureSurface = document.createElement('div');
    captureSurface.style.opacity = '0';
    captureSurface.appendChild(video);
    document.body.appendChild(captureSurface);

    const pending = seekVideoToFrame(video, 10.625, 250);
    expect(video.currentTime).toBe(10.608);
    setReadyState(HTMLMediaElement.HAVE_ENOUGH_DATA);
    setSeeking(false);

    await vi.advanceTimersByTimeAsync(16);
    await expect(pending).resolves.toBeUndefined();
    captureSurface.remove();
  });

  it('reports a video that never produces the requested frame', async () => {
    vi.useFakeTimers();
    const { video } = controllableVideo();
    const pending = seekVideoToFrame(video, 3, 250);
    const rejection = expect(pending).rejects.toThrow(
      'Video frame did not become ready at 3.000s within 250ms',
    );

    await vi.advanceTimersByTimeAsync(250);
    await rejection;
  });
});

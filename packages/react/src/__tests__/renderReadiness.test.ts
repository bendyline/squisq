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
} {
  const video = document.createElement('video');
  const duration = options.duration ?? Number.NaN;
  let currentTime = 0;
  let seeking = false;
  let readyState: number = HTMLMediaElement.HAVE_NOTHING;
  Object.defineProperties(video, {
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
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

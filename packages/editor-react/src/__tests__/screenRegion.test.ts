/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cropScreenStream, validateScreenCaptureRegion } from '../recorder/sources/screenRegion';
import { requestScreenStream } from '../recorder/sources/screenStream';

class Track extends EventTarget {
  readyState = 'live';
  constructor(public kind: string) {
    super();
  }
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}
class Stream {
  constructor(private tracks: Track[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}
const region = { x: 100, y: 50, width: 640, height: 480 };

function setup(width = 1920, height = 1080) {
  vi.useFakeTimers();
  vi.stubGlobal('MediaStream', Stream);
  const sourceVideo = new Track('video');
  const sourceAudio = new Track('audio');
  const outputVideo = new Track('video');
  const source = new Stream([sourceVideo, sourceAudio]) as unknown as MediaStream;
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    value: vi.fn(() => new Stream([outputVideo])),
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLVideoElement,
  ) {
    Object.defineProperty(this, 'videoWidth', { configurable: true, value: width });
    Object.defineProperty(this, 'videoHeight', { configurable: true, value: height });
    this.dispatchEvent(new Event('loadeddata'));
    return Promise.resolve();
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: vi.fn(async () => source) },
  });
  return { source, sourceVideo, sourceAudio, outputVideo, drawImage };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'captureStream');
});

describe('screen recording region', () => {
  it('rejects invalid, excessive and out-of-bounds regions', () => {
    for (const invalid of [
      { ...region, x: -1 },
      { ...region, y: NaN },
      { ...region, width: 0 },
      { ...region, width: 1.5 },
      { ...region, width: 16384, height: 16384 },
    ]) {
      expect(() => validateScreenCaptureRegion(invalid)).toThrow('valid recording region');
    }
    expect(() => validateScreenCaptureRegion(region, 700, 1080)).toThrow('outside');
    expect(() => validateScreenCaptureRegion(region, 1920, 500)).toThrow('outside');
  });

  it('records the requested rectangle, preserves audio, and releases every track', async () => {
    const f = setup();
    const handle = await cropScreenStream(f.source, region);
    expect(f.drawImage).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      100,
      50,
      640,
      480,
      0,
      0,
      640,
      480,
    );
    expect(handle.stream.getVideoTracks()).toEqual([f.outputVideo]);
    expect(handle.stream.getAudioTracks()).toEqual([f.sourceAudio]);
    vi.advanceTimersByTime(100);
    expect(f.drawImage.mock.calls.length).toBeGreaterThan(1);
    handle.dispose();
    handle.dispose();
    expect(f.sourceVideo.stop).toHaveBeenCalledTimes(1);
    expect(f.sourceAudio.stop).toHaveBeenCalledTimes(1);
    expect(f.outputVideo.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards Stop sharing and stops drawing', async () => {
    const f = setup();
    const handle = await cropScreenStream(f.source, region);
    const ended = vi.fn();
    handle.stream.getVideoTracks()[0]!.addEventListener('ended', ended);
    f.sourceVideo.dispatchEvent(new Event('ended'));
    expect(ended).toHaveBeenCalledTimes(1);
    expect(f.outputVideo.readyState).toBe('ended');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases granted capture if the selected surface is smaller than the region', async () => {
    const f = setup(640, 480);
    await expect(requestScreenStream({ crop: region })).rejects.toThrow('outside');
    expect(f.sourceVideo.readyState).toBe('ended');
    expect(f.sourceAudio.readyState).toBe('ended');
    expect(vi.getTimerCount()).toBe(0);
  });
});

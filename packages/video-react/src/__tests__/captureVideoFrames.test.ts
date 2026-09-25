import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CaptureVideoFrameRegistry,
  DecodedVideoCursor,
  getDecodedCaptureFrame,
  resolveCaptureVideoImage,
  type DecodedFrameSample,
  type DecodedFrameSampleSource,
} from '../hooks/captureVideoFrames';

class FakeSample implements DecodedFrameSample {
  closed = false;
  draws = 0;

  constructor(
    readonly timestamp: number,
    readonly displayWidth = 4,
    readonly displayHeight = 2,
  ) {}

  draw(): void {
    this.draws += 1;
  }

  close(): void {
    this.closed = true;
  }
}

/**
 * Mirrors mediabunny's `samples(start)`: the first yield is the frame shown
 * at `start` (the last one at or before it, else the track's first frame).
 */
function fakeTrack(
  timestamps: readonly number[],
  size: (index: number) => [number, number] = () => [4, 2],
) {
  const created: FakeSample[] = [];
  let starts = 0;
  const source: DecodedFrameSampleSource = {
    async *samples(start: number) {
      starts += 1;
      let first = 0;
      timestamps.forEach((timestamp, index) => {
        if (timestamp <= start) first = index;
      });
      for (let index = first; index < timestamps.length; index += 1) {
        const [width, height] = size(index);
        const sample = new FakeSample(timestamps[index], width, height);
        created.push(sample);
        yield sample;
      }
    },
  };
  return { source, created, starts: () => starts };
}

function framesAt(fps: number, seconds: number, offset = 0): number[] {
  return Array.from({ length: Math.round(fps * seconds) }, (_, index) => offset + index / fps);
}

function cursorFor(track: ReturnType<typeof fakeTrack>, release = vi.fn()) {
  return new DecodedVideoCursor(track.source, release, document.createElement('canvas'), 4, 2);
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DecodedVideoCursor', () => {
  it('steps a 60 fps source at 30 fps with one decode pass, drawing only selected frames', async () => {
    const track = fakeTrack(framesAt(60, 2));
    const cursor = cursorFor(track);

    for (let index = 0; index < 60; index += 1) {
      await cursor.selectFrame(index / 30);
      expect(cursor.frame.timestamp).toBeCloseTo(index / 30, 9);
    }

    expect(track.starts()).toBe(1);
    // Every source frame decoded at most once (plus the pending lookahead).
    expect(track.created.length).toBeLessThanOrEqual(120);
    expect(track.created.filter((sample) => sample.draws > 0)).toHaveLength(60);
    // Everything but the lookahead has been released back to the decoder.
    expect(track.created.filter((sample) => !sample.closed)).toHaveLength(1);
  });

  it('selects the frame on screen at the target despite floating-point drift', async () => {
    const cursor = cursorFor(fakeTrack(framesAt(30, 1)));

    // sourceIn + (time - absStart) rarely lands exactly on a frame boundary.
    await cursor.selectFrame(0.4 + (0.1 - 0.4) + 0.2 - 1e-9);

    expect(cursor.frame.timestamp).toBeCloseTo(9 / 30, 9);
  });

  it('holds a frame across output frames that land inside it', async () => {
    const track = fakeTrack(framesAt(10, 1));
    const cursor = cursorFor(track);

    await cursor.selectFrame(0.2);
    await cursor.selectFrame(0.23);
    await cursor.selectFrame(0.26);

    expect(cursor.frame.timestamp).toBeCloseTo(0.2, 9);
    expect(track.created.filter((sample) => sample.draws > 0)).toHaveLength(1);
  });

  it('restarts for backward and long forward jumps but not for sequential steps', async () => {
    const track = fakeTrack(framesAt(30, 20));
    const cursor = cursorFor(track);

    await cursor.selectFrame(1);
    await cursor.selectFrame(1 + 1 / 30);
    expect(track.starts()).toBe(1);

    await cursor.selectFrame(0.5);
    expect(track.starts()).toBe(2);
    expect(cursor.frame.timestamp).toBeCloseTo(0.5, 9);

    await cursor.selectFrame(10);
    expect(track.starts()).toBe(3);
    expect(cursor.frame.timestamp).toBeCloseTo(10, 9);
  });

  it('shows the first frame for targets before it without restarting each time', async () => {
    const track = fakeTrack(framesAt(30, 1, 0.5));
    const cursor = cursorFor(track);

    await cursor.selectFrame(0);
    await cursor.selectFrame(0.1);
    await cursor.selectFrame(0.2);

    expect(track.starts()).toBe(1);
    expect(cursor.frame.timestamp).toBeCloseTo(0.5, 9);

    await cursor.selectFrame(0.55);
    expect(track.starts()).toBe(1);
    expect(cursor.frame.timestamp).toBeCloseTo(0.5 + 1 / 30, 9);
  });

  it('holds the last frame past the end of the source', async () => {
    const cursor = cursorFor(fakeTrack(framesAt(30, 1)));

    await cursor.selectFrame(0.9);
    await cursor.selectFrame(1.2);
    await cursor.selectFrame(1.5);

    expect(cursor.frame.timestamp).toBeCloseTo(29 / 30, 9);
  });

  it('follows mid-stream resolution changes like an element intrinsic size', async () => {
    const track = fakeTrack(framesAt(30, 1), (index) => (index < 15 ? [4, 2] : [8, 6]));
    const cursor = cursorFor(track);

    await cursor.selectFrame(0.2);
    expect([cursor.frame.canvas.width, cursor.frame.canvas.height]).toEqual([4, 2]);

    await cursor.selectFrame(0.6);
    expect([cursor.frame.width, cursor.frame.height]).toEqual([8, 6]);
    expect([cursor.frame.canvas.width, cursor.frame.canvas.height]).toEqual([8, 6]);
  });

  it('releases the demuxer, pending samples, and canvas on dispose', async () => {
    const track = fakeTrack(framesAt(30, 1));
    const release = vi.fn();
    const cursor = cursorFor(track, release);
    await cursor.selectFrame(0.3);

    cursor.dispose();

    expect(release).toHaveBeenCalledOnce();
    expect(track.created.every((sample) => sample.closed)).toBe(true);
    expect(cursor.frame.canvas.width).toBe(0);
    await expect(cursor.selectFrame(0.4)).rejects.toThrow(/released/);
  });
});

describe('CaptureVideoFrameRegistry', () => {
  function mountVideo(src: string): HTMLVideoElement {
    const video = document.createElement('video');
    video.src = src;
    vi.spyOn(video, 'pause').mockImplementation(() => {});
    document.body.appendChild(video);
    return video;
  }

  function stubLocalSources(open = vi.spyOn(DecodedVideoCursor, 'open')) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['media']))),
    );
    return open;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('binds local sources and serves their decoded frames in place of the element', async () => {
    const track = fakeTrack(framesAt(30, 2));
    stubLocalSources().mockImplementation(async () => cursorFor(track));
    const video = mountVideo('blob:capture/camera');
    const registry = new CaptureVideoFrameRegistry();

    expect(await registry.attach(document.body)).toBe(1);
    expect(video.dataset.captureDecoded).toBe('true');
    // No frame drawn yet: compositors still see the element.
    expect(resolveCaptureVideoImage(video).source).toBe(video);

    await expect(registry.selectFrame(video, 1)).resolves.toBe(true);
    const decoded = getDecodedCaptureFrame(video);
    expect(decoded?.timestamp).toBeCloseTo(1, 9);
    expect(resolveCaptureVideoImage(video)).toEqual({
      source: decoded!.canvas,
      width: 4,
      height: 2,
    });

    // Already bound: nothing new on the next pass.
    expect(await registry.attach(document.body)).toBe(0);
    registry.dispose();
    expect(video.dataset.captureDecoded).toBeUndefined();
    expect(getDecodedCaptureFrame(video)).toBeNull();
  });

  it('leaves remote and undecodable sources on the element path', async () => {
    const open = stubLocalSources().mockResolvedValue(null);
    const remote = mountVideo('https://example.test/remote.mp4');
    const unsupported = mountVideo('blob:capture/unsupported');
    const registry = new CaptureVideoFrameRegistry();

    expect(await registry.attach(document.body)).toBe(0);
    expect(await registry.attach(document.body)).toBe(0);

    // Only the local source was probed, and only once.
    expect(open).toHaveBeenCalledOnce();
    expect(remote.dataset.captureDecoded).toBeUndefined();
    expect(unsupported.dataset.captureDecoded).toBeUndefined();
    await expect(registry.selectFrame(unsupported, 0)).resolves.toBe(false);
  });

  it('hands a source back to the element after a decode failure', async () => {
    const failing: DecodedFrameSampleSource = {
      // eslint-disable-next-line require-yield
      async *samples() {
        throw new Error('decoder error');
      },
    };
    const open = stubLocalSources().mockImplementation(
      async () =>
        new DecodedVideoCursor(failing, () => undefined, document.createElement('canvas'), 4, 2),
    );
    const video = mountVideo('blob:capture/corrupt');
    const registry = new CaptureVideoFrameRegistry();
    await registry.attach(document.body);

    await expect(registry.selectFrame(video, 0)).resolves.toBe(false);

    expect(video.dataset.captureDecoded).toBeUndefined();
    expect(await registry.attach(document.body)).toBe(0);
    expect(open).toHaveBeenCalledOnce();
  });

  it('rebinds an element whose source changed and releases detached ones', async () => {
    const open = stubLocalSources().mockImplementation(async () =>
      cursorFor(fakeTrack(framesAt(30, 1))),
    );
    const video = mountVideo('blob:capture/first');
    const registry = new CaptureVideoFrameRegistry();
    await registry.attach(document.body);
    await registry.selectFrame(video, 0.5);

    video.src = 'blob:capture/second';
    // The binding was for the old source: decline until re-attached.
    await expect(registry.selectFrame(video, 0.5)).resolves.toBe(false);
    expect(await registry.attach(document.body)).toBe(1);
    expect(open).toHaveBeenCalledTimes(2);

    video.remove();
    await registry.attach(document.body);
    expect(video.dataset.captureDecoded).toBeUndefined();
  });
});

/**
 * Regression: the main-thread WebCodecs encoder used to swallow encoder errors.
 *
 * `VideoEncoder` reports failures out-of-band through its `error` callback. The
 * old implementation only `console.error`'d there, so:
 *   - if the encoder entered a closed state, the export failed later with an
 *     opaque `InvalidStateError` from the next `encode()`/`flush()`; and
 *   - if it dropped frames non-fatally, the failure never surfaced at all and
 *     `finalize()` happily returned a TRUNCATED MP4 reported as "Export
 *     complete".
 *
 * The worker path always did this correctly (`postError`); these tests pin the
 * main-thread path to the same contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const muxerState = vi.hoisted(() => ({
  finalize: vi.fn(() => new ArrayBuffer(8)),
  addVideoChunk: vi.fn(),
}));

vi.mock('../mp4Mux.js', () => ({
  createMp4Muxer: () => ({
    addVideoChunk: muxerState.addVideoChunk,
    addAudioChunk: vi.fn(),
    hasAudioTrack: false,
    finalize: muxerState.finalize,
  }),
}));

import { createEncoder } from '../mainThreadEncoder.js';

/** Captured constructor callbacks for the most recently created encoder. */
let errorCallback: ((err: DOMException) => void) | null = null;
let flushBehavior: () => Promise<void> = async () => {};
let encoderState: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
let encodeQueueSize = 0;
let flushCount = 0;

class FakeVideoEncoder {
  state = 'unconfigured';
  get encodeQueueSize() {
    return encodeQueueSize;
  }
  constructor(init: { output: (chunk: unknown) => void; error: (err: DOMException) => void }) {
    errorCallback = init.error;
  }
  configure() {
    this.state = 'configured';
    encoderState = 'configured';
  }
  encode() {
    encodeQueueSize++;
  }
  async flush() {
    flushCount++;
    await flushBehavior();
    encodeQueueSize = 0;
  }
  close() {
    this.state = 'closed';
    encoderState = 'closed';
  }
}

class FakeVideoFrame {
  constructor(
    public bitmap: unknown,
    public init: unknown,
  ) {}
  close() {}
}

function fakeBitmap(): ImageBitmap {
  return { close: vi.fn(), width: 640, height: 480 } as unknown as ImageBitmap;
}

const CONFIG = { width: 640, height: 480, fps: 30, quality: 'normal' as const };

describe('mainThreadEncoder error propagation', () => {
  beforeEach(() => {
    errorCallback = null;
    encoderState = 'unconfigured';
    encodeQueueSize = 0;
    flushCount = 0;
    flushBehavior = async () => {};
    muxerState.finalize.mockClear();
    muxerState.addVideoChunk.mockClear();
    vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
    vi.stubGlobal('VideoFrame', FakeVideoFrame);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces an encoder error from the next encodeFrame instead of logging it', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallback!(new DOMException('Encoding failed', 'EncodingError'));

    await expect(encoder.encodeFrame(fakeBitmap(), 1)).rejects.toThrow(
      'WebCodecs encoder error: Encoding failed',
    );
  });

  it('closes the bitmap it was handed even when it rejects', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallback!(new DOMException('Encoding failed', 'EncodingError'));

    const bitmap = fakeBitmap();
    await expect(encoder.encodeFrame(bitmap, 1)).rejects.toThrow();
    expect(bitmap.close).toHaveBeenCalled();
  });

  /**
   * The dangerous case: a non-fatal error means flush() resolves and the muxer
   * would happily emit a short file. finalize() must refuse.
   */
  it('fails finalize — never returns a truncated MP4 — after a non-fatal error', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallback!(new DOMException('Frame dropped', 'EncodingError'));

    await expect(encoder.finalize()).rejects.toThrow('WebCodecs encoder error: Frame dropped');
    expect(muxerState.finalize).not.toHaveBeenCalled();
  });

  it('fails finalize when the error arrives during flush', async () => {
    const encoder = createEncoder(CONFIG);
    flushBehavior = async () => {
      errorCallback!(new DOMException('Died mid-flush', 'EncodingError'));
    };

    await expect(encoder.finalize()).rejects.toThrow('WebCodecs encoder error: Died mid-flush');
    expect(muxerState.finalize).not.toHaveBeenCalled();
  });

  it('prefers the latched encoder error over a generic flush rejection', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallback!(new DOMException('Real cause', 'EncodingError'));
    flushBehavior = async () => {
      throw new DOMException('Cannot call flush on a closed codec', 'InvalidStateError');
    };

    // The InvalidStateError is a symptom; the export must report the cause.
    await expect(encoder.finalize()).rejects.toThrow('WebCodecs encoder error: Real cause');
  });

  it('tears the encoder down when it fails', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallback!(new DOMException('Encoding failed', 'EncodingError'));

    await expect(encoder.finalize()).rejects.toThrow();
    expect(encoderState).toBe('closed');
  });

  it('reports the first error when several arrive', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallback!(new DOMException('First failure', 'EncodingError'));
    errorCallback!(new DOMException('Cascading follow-up', 'InvalidStateError'));

    await expect(encoder.finalize()).rejects.toThrow('First failure');
  });

  it('still finalizes normally when no error occurs', async () => {
    const encoder = createEncoder(CONFIG);
    await encoder.encodeFrame(fakeBitmap(), 0);
    await expect(encoder.finalize()).resolves.toBeInstanceOf(ArrayBuffer);
    expect(muxerState.finalize).toHaveBeenCalledOnce();
  });

  it('encodes a reusable canvas without treating it as a disposable bitmap', async () => {
    const encoder = createEncoder(CONFIG);
    const canvas = document.createElement('canvas');

    await encoder.encodeFrame(canvas, 0);

    expect(encodeQueueSize).toBe(1);
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
  });

  it('drains a saturated WebCodecs queue before accepting more raw frames', async () => {
    const encoder = createEncoder({ ...CONFIG, width: 1920, height: 1080 });

    // 1080p RGBA frames are bounded by the 64 MiB limit at eight queued
    // frames. The ninth submission must wait for a flush before encoding.
    for (let i = 0; i < 9; i++) await encoder.encodeFrame(fakeBitmap(), i);

    expect(flushCount).toBe(1);
    expect(encodeQueueSize).toBe(1);
  });

  it('flushes periodically when Chromium drains the visible queue early', async () => {
    const encoder = createEncoder({ ...CONFIG, width: 960, height: 540, fps: 10 });

    for (let i = 0; i < 10; i++) {
      await encoder.encodeFrame(fakeBitmap(), i);
      // Model Chromium accepting each request immediately while retaining its
      // native input surface until flush().
      encodeQueueSize = 0;
    }
    await encoder.encodeFrame(fakeBitmap(), 10);

    expect(flushCount).toBe(1);
  });
});

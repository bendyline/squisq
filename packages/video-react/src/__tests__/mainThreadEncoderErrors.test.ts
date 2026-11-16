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
  finalizeBlob: vi.fn(() => new Blob(['video'], { type: 'video/mp4' })),
  addVideoChunk: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../mp4Mux.js', () => ({
  createMp4Muxer: () => {
    muxerState.create();
    return {
      addVideoChunk: muxerState.addVideoChunk,
      addAudioChunk: vi.fn(),
      hasAudioTrack: false,
      finalize: muxerState.finalize,
      finalizeBlob: muxerState.finalizeBlob,
    };
  },
}));

import { createEncoder, VideoEncodingInterruptedError } from '../mainThreadEncoder.js';

type EncoderErrorCallback = (err: DOMException) => void;
type EncoderOutputCallback = (chunk: unknown, meta?: unknown) => void;

/** Captured constructor callbacks, including replaced encoder generations. */
let errorCallbacks: EncoderErrorCallback[] = [];
let outputCallbacks: EncoderOutputCallback[] = [];
let configuredWith: VideoEncoderConfig[] = [];
let frameInits: VideoFrameInit[] = [];
let flushBehavior: () => Promise<void> = async () => {};
let encoderState: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
let encodeQueueSize = 0;
let flushCount = 0;
let encodeOptions: VideoEncoderEncodeOptions[] = [];
let encoderCount = 0;
/** Emit one chunk per encode, as hardware codecs do. Off models a codec that stops delivering. */
let emitOutputs = true;
let encoders: FakeVideoEncoder[] = [];

class FakeVideoEncoder {
  state = 'unconfigured';
  get encodeQueueSize() {
    return encodeQueueSize;
  }
  private readonly output: EncoderOutputCallback;
  constructor(init: { output: EncoderOutputCallback; error: (err: DOMException) => void }) {
    errorCallbacks.push(init.error);
    outputCallbacks.push(init.output);
    this.output = init.output;
    encoders.push(this);
    encoderCount++;
  }
  configure(config: VideoEncoderConfig) {
    configuredWith.push(config);
    this.state = 'configured';
    encoderState = 'configured';
  }
  encode(frame: FakeVideoFrame, options?: VideoEncoderEncodeOptions) {
    encodeQueueSize++;
    encodeOptions.push(options ?? {});
    if (emitOutputs) this.output({ timestamp: frame.init.timestamp });
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
    public init: VideoFrameInit,
  ) {
    frameInits.push(init);
  }
  close() {}
}

function fakeBitmap(): ImageBitmap {
  return { close: vi.fn(), width: 640, height: 480 } as unknown as ImageBitmap;
}

const CONFIG = { width: 640, height: 480, fps: 30, quality: 'normal' as const };

describe('mainThreadEncoder error propagation', () => {
  beforeEach(() => {
    errorCallbacks = [];
    outputCallbacks = [];
    configuredWith = [];
    frameInits = [];
    encoderState = 'unconfigured';
    encodeQueueSize = 0;
    flushCount = 0;
    encodeOptions = [];
    encoderCount = 0;
    emitOutputs = true;
    encoders = [];
    flushBehavior = async () => {};
    muxerState.create.mockClear();
    muxerState.finalize.mockClear();
    muxerState.finalizeBlob.mockClear();
    muxerState.addVideoChunk.mockClear();
    vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
    vi.stubGlobal('VideoFrame', FakeVideoFrame);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces an encoder error from the next encodeFrame instead of logging it', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallbacks[0](new DOMException('Encoding failed', 'EncodingError'));

    await expect(encoder.encodeFrame(fakeBitmap(), 1)).rejects.toThrow(
      'WebCodecs encoder error: Encoding failed',
    );
  });

  it('closes the bitmap it was handed even when it rejects', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallbacks[0](new DOMException('Encoding failed', 'EncodingError'));

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
    errorCallbacks[0](new DOMException('Frame dropped', 'EncodingError'));

    await expect(encoder.finalize()).rejects.toThrow('WebCodecs encoder error: Frame dropped');
    expect(muxerState.finalize).not.toHaveBeenCalled();
  });

  it('fails finalize when the error arrives during flush', async () => {
    const encoder = createEncoder(CONFIG);
    flushBehavior = async () => {
      errorCallbacks[0](new DOMException('Died mid-flush', 'EncodingError'));
    };

    await expect(encoder.finalize()).rejects.toThrow('WebCodecs encoder error: Died mid-flush');
    expect(muxerState.finalize).not.toHaveBeenCalled();
  });

  it('prefers the latched encoder error over a generic flush rejection', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallbacks[0](new DOMException('Real cause', 'EncodingError'));
    flushBehavior = async () => {
      throw new DOMException('Cannot call flush on a closed codec', 'InvalidStateError');
    };

    // The InvalidStateError is a symptom; the export must report the cause.
    await expect(encoder.finalize()).rejects.toThrow('WebCodecs encoder error: Real cause');
  });

  it('tears the encoder down when it fails', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallbacks[0](new DOMException('Encoding failed', 'EncodingError'));

    await expect(encoder.finalize()).rejects.toThrow();
    expect(encoderState).toBe('closed');
  });

  it('reports the first error when several arrive', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallbacks[0](new DOMException('First failure', 'EncodingError'));
    errorCallbacks[0](new DOMException('Cascading follow-up', 'InvalidStateError'));

    await expect(encoder.finalize()).rejects.toThrow('First failure');
  });

  it('recreates a codec reclaimed during inactivity and forces a keyframe', async () => {
    const encoder = createEncoder(CONFIG);
    await encoder.encodeFrame(fakeBitmap(), 1);
    errorCallbacks[0](new DOMException('Codec reclaimed due to inactivity.', 'EncodingError'));

    await expect(encoder.encodeFrame(fakeBitmap(), 2)).resolves.toBeUndefined();

    expect(encoderCount).toBe(2);
    expect(muxerState.create).toHaveBeenCalledOnce();
    expect(encodeOptions).toEqual([{ keyFrame: false }, { keyFrame: true }]);
    await expect(encoder.finalize()).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('recovers when reclamation interrupts a backpressure flush', async () => {
    const encoder = createEncoder({ ...CONFIG, width: 1920, height: 1080 });
    for (let i = 0; i < 8; i++) await encoder.encodeFrame(fakeBitmap(), i);

    let interrupted = false;
    flushBehavior = async () => {
      if (interrupted) return;
      interrupted = true;
      errorCallbacks[0](new DOMException('Codec reclaimed due to inactivity.', 'EncodingError'));
      throw new DOMException('Cannot flush a closed codec', 'InvalidStateError');
    };

    await expect(encoder.encodeFrame(fakeBitmap(), 8)).resolves.toBeUndefined();

    expect(encoderCount).toBe(2);
    expect(encodeOptions.at(-1)).toEqual({ keyFrame: true });
  });

  it('recovers an idle reclaimed codec before finalizing existing muxed chunks', async () => {
    const encoder = createEncoder(CONFIG);
    await encoder.encodeFrame(fakeBitmap(), 0);
    errorCallbacks[0](new DOMException('Codec reclaimed due to inactivity.', 'EncodingError'));

    await expect(encoder.finalize()).resolves.toBeInstanceOf(ArrayBuffer);

    expect(encoderCount).toBe(2);
    expect(muxerState.create).toHaveBeenCalledOnce();
    expect(muxerState.finalize).toHaveBeenCalledOnce();
  });

  it('ignores a stale callback from a replaced codec generation', async () => {
    const encoder = createEncoder(CONFIG);
    errorCallbacks[0](new DOMException('Codec reclaimed due to inactivity.', 'EncodingError'));
    await encoder.encodeFrame(fakeBitmap(), 1);

    errorCallbacks[0](new DOMException('Stale failure', 'EncodingError'));

    await expect(encoder.encodeFrame(fakeBitmap(), 2)).resolves.toBeUndefined();
    expect(encoderCount).toBe(2);
  });

  it('still finalizes normally when no error occurs', async () => {
    const encoder = createEncoder(CONFIG);
    await encoder.encodeFrame(fakeBitmap(), 0);
    await expect(encoder.finalize()).resolves.toBeInstanceOf(ArrayBuffer);
    expect(muxerState.finalize).toHaveBeenCalledOnce();
  });

  it('finalizes directly to a Blob without requesting an ArrayBuffer copy', async () => {
    const encoder = createEncoder(CONFIG);
    await encoder.encodeFrame(fakeBitmap(), 0);

    await expect(encoder.finalizeBlob?.()).resolves.toBeInstanceOf(Blob);

    expect(muxerState.finalizeBlob).toHaveBeenCalledOnce();
    expect(muxerState.finalize).not.toHaveBeenCalled();
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

  // Chromium 151+ only reports an EncodedVideoChunk duration when the frame had one.
  it('gives every frame its duration so encoded chunks carry one', async () => {
    const encoder = createEncoder(CONFIG);

    await encoder.encodeFrame(fakeBitmap(), 0);
    await encoder.encodeFrame(fakeBitmap(), 1);

    expect(frameInits).toEqual([
      { timestamp: 0, duration: 33_333 },
      { timestamp: 33_333, duration: 33_333 },
    ]);
  });

  it('reports a muxer rejection instead of losing it in the output callback', async () => {
    const encoder = createEncoder(CONFIG);
    muxerState.addVideoChunk.mockImplementationOnce(() => {
      throw new TypeError('duration must be a non-negative real number.');
    });

    expect(() => outputCallbacks[0]({}, {})).not.toThrow();

    await expect(encoder.finalize()).rejects.toThrow(
      'MP4 muxing failed: duration must be a non-negative real number.',
    );
    expect(muxerState.finalize).not.toHaveBeenCalled();
  });

  it('encodes High profile unless the probe chose Baseline', () => {
    createEncoder(CONFIG);
    createEncoder({ ...CONFIG, h264Profile: 'baseline' });

    expect(configuredWith.map((config) => config.codec)).toEqual(['avc1.640028', 'avc1.42002a']);
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

  describe('resuming after the app was in the background', () => {
    const reclaimed = () => new DOMException('Codec reclaimed due to inactivity.', 'EncodingError');

    it('reports the first lost frame when a reclaimed codec took pending frames with it', async () => {
      const encoder = createEncoder(CONFIG);
      await encoder.encodeFrame(fakeBitmap(), 0);
      await encoder.encodeFrame(fakeBitmap(), 1);
      emitOutputs = false;
      await encoder.encodeFrame(fakeBitmap(), 2);
      await encoder.encodeFrame(fakeBitmap(), 3);
      emitOutputs = true;
      errorCallbacks[0](reclaimed());

      const error = await encoder.encodeFrame(fakeBitmap(), 4).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(VideoEncodingInterruptedError);
      expect((error as VideoEncodingInterruptedError).resumeFrom).toBe(2);

      // The replacement codec continues the same MP4 from the first lost frame.
      for (let i = 2; i < 5; i++) await encoder.encodeFrame(fakeBitmap(), i);
      expect(encoderCount).toBe(2);
      expect(encodeOptions.at(-3)).toEqual({ keyFrame: true });
      expect(frameInits.slice(-3).map((init) => init.timestamp)).toEqual([
        66_667, 100_000, 133_333,
      ]);
      await expect(encoder.finalize()).resolves.toBeInstanceOf(ArrayBuffer);
      expect(muxerState.create).toHaveBeenCalledOnce();
    });

    it('drain reports the frames a reclaimed codec lost', async () => {
      const encoder = createEncoder(CONFIG);
      emitOutputs = false;
      await encoder.encodeFrame(fakeBitmap(), 0);
      flushBehavior = async () => {
        errorCallbacks[0](reclaimed());
      };

      const error = await encoder.drain?.().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(VideoEncodingInterruptedError);
      expect((error as VideoEncodingInterruptedError).resumeFrom).toBe(0);
    });

    it('drains every submitted frame and stays usable', async () => {
      const encoder = createEncoder(CONFIG);
      await encoder.encodeFrame(fakeBitmap(), 0);

      await expect(encoder.drain?.()).resolves.toBeUndefined();

      expect(flushCount).toBe(1);
      await expect(encoder.encodeFrame(fakeBitmap(), 1)).resolves.toBeUndefined();
      expect(encoderCount).toBe(1);
    });

    // iOS invalidates a backgrounded app's hardware encoder without reporting
    // an error: pending frames never arrive and flush() never settles.
    it('abandons a stalled flush and resumes from the first frame missing from the MP4', async () => {
      const encoder = createEncoder({ ...CONFIG, width: 1920, height: 1080 });
      for (let i = 0; i < 5; i++) await encoder.encodeFrame(fakeBitmap(), i);
      emitOutputs = false;
      for (let i = 5; i < 8; i++) await encoder.encodeFrame(fakeBitmap(), i);
      let rejectStalledFlush!: (reason: unknown) => void;
      flushBehavior = () =>
        new Promise<void>((_resolve, reject) => {
          rejectStalledFlush = reject;
        });
      // The ninth 1080p frame waits on a backpressure flush that never ends.
      const stalled = encoder.encodeFrame(fakeBitmap(), 8);

      emitOutputs = true;
      flushBehavior = async () => {};
      expect(encoder.restartCodec?.()).toBe(5);
      // The abandoned codec's flush finally rejects; that must not disturb
      // the replacement.
      rejectStalledFlush(new DOMException('Aborted', 'AbortError'));
      await expect(stalled).rejects.toBeInstanceOf(VideoEncodingInterruptedError);
      expect(encoders[0].state).toBe('closed');
      expect(encoders[1].state).toBe('configured');

      for (let i = 5; i < 9; i++) await encoder.encodeFrame(fakeBitmap(), i);
      expect(encodeOptions.slice(-4)).toEqual([
        { keyFrame: true },
        { keyFrame: false },
        { keyFrame: false },
        { keyFrame: false },
      ]);
      await expect(encoder.finalize()).resolves.toBeInstanceOf(ArrayBuffer);
      expect(muxerState.create).toHaveBeenCalledOnce();
    });

    it('revives a codec that failed while the app was in the background', async () => {
      const encoder = createEncoder(CONFIG);
      await encoder.encodeFrame(fakeBitmap(), 0);
      errorCallbacks[0](new DOMException('Encoder session invalidated', 'EncodingError'));

      expect(encoder.restartCodec?.()).toBe(1);

      await expect(encoder.encodeFrame(fakeBitmap(), 1)).resolves.toBeUndefined();
      expect(encodeOptions.at(-1)).toEqual({ keyFrame: true });
      await expect(encoder.finalize()).resolves.toBeInstanceOf(ArrayBuffer);
    });

    it('cannot restart once the MP4 itself has failed', async () => {
      const encoder = createEncoder(CONFIG);
      muxerState.addVideoChunk.mockImplementationOnce(() => {
        throw new TypeError('bad chunk');
      });
      await encoder.encodeFrame(fakeBitmap(), 0);

      expect(() => encoder.restartCodec?.()).toThrow('MP4 muxing failed: bad chunk');
    });

    it('cannot restart a closed encoder', () => {
      const encoder = createEncoder(CONFIG);
      encoder.close();

      expect(() => encoder.restartCodec?.()).toThrow('Encoder already closed');
    });

    it('splices a replacement codec whose stream format matches', async () => {
      const encoder = createEncoder(CONFIG);
      const decoderConfig = (bytes: number[]) => ({
        decoderConfig: { codec: 'avc1.640028', description: new Uint8Array(bytes) },
      });
      outputCallbacks[0]({ timestamp: 0 }, decoderConfig([1, 2, 3]));
      encoder.restartCodec?.();
      outputCallbacks[1]({ timestamp: 33_333 }, decoderConfig([1, 2, 3]));

      await expect(encoder.finalize()).resolves.toBeInstanceOf(ArrayBuffer);
      expect(muxerState.addVideoChunk).toHaveBeenCalledTimes(2);
    });

    it('refuses to splice a replacement codec whose stream format differs', async () => {
      const encoder = createEncoder(CONFIG);
      const decoderConfig = (bytes: number[]) => ({
        decoderConfig: { codec: 'avc1.640028', description: new Uint8Array(bytes) },
      });
      outputCallbacks[0]({ timestamp: 0 }, decoderConfig([1, 2, 3]));
      encoder.restartCodec?.();
      outputCallbacks[1]({ timestamp: 33_333 }, decoderConfig([1, 2, 4]));

      await expect(encoder.finalize()).rejects.toThrow('incompatible H.264 stream');
      expect(muxerState.finalize).not.toHaveBeenCalled();
    });

    it('ignores output from an abandoned codec', async () => {
      const encoder = createEncoder(CONFIG);
      encoder.restartCodec?.();
      outputCallbacks[0]({ timestamp: 0 });

      expect(muxerState.addVideoChunk).not.toHaveBeenCalled();
      await expect(encoder.finalize()).resolves.toBeInstanceOf(ArrayBuffer);
    });
  });
});

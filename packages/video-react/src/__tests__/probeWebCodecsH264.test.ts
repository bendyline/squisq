/**
 * WebKit (Safari, every iOS WebView) reports H.264 High profile as supported,
 * but once five frames are pending it never emits a chunk and never settles
 * `flush()`: exports stalled at their first flush ("Video encoding stopped
 * responding at frame 9"). Baseline drains. `probeWebCodecsH264`
 * test-encodes to choose the profile that works.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeWebCodecsH264 } from '../mainThreadEncoder.js';

const HIGH = 'avc1.640028';
const BASELINE = 'avc1.42002a';

type Behavior = 'drains' | 'stalls' | 'silent';

let behaviorByCodec: Record<string, Behavior> = {};
let supportedCodecs = new Set([HIGH, BASELINE]);
let frameThrows = false;
let encoders: FakeVideoEncoder[] = [];

class FakeVideoEncoder {
  state: CodecState = 'unconfigured';
  codec = '';
  encoded = 0;
  private pendingFlush: { reject: (reason: unknown) => void } | null = null;

  static async isConfigSupported(config: VideoEncoderConfig) {
    return { supported: supportedCodecs.has(config.codec), config };
  }

  constructor(private readonly init: VideoEncoderInit) {
    encoders.push(this);
  }

  configure(config: VideoEncoderConfig) {
    this.state = 'configured';
    this.codec = config.codec;
  }

  encode() {
    this.encoded++;
    if (this.behavior() === 'drains') {
      this.init.output({} as EncodedVideoChunk, {});
    }
  }

  flush(): Promise<void> {
    if (this.behavior() === 'stalls') {
      return new Promise((_resolve, reject) => {
        this.pendingFlush = { reject };
      });
    }
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    this.pendingFlush?.reject(new DOMException('Aborted', 'AbortError'));
    this.pendingFlush = null;
  }

  private behavior(): Behavior {
    return behaviorByCodec[this.codec] ?? 'drains';
  }
}

class FakeVideoFrame {
  constructor() {
    if (frameThrows) throw new DOMException('Unsupported source', 'NotSupportedError');
  }
  close() {}
}

const CONFIG = { width: 1920, height: 1080, fps: 30, quality: 'normal' as const };
const FAST = { flushTimeoutMs: 20 };

describe('probeWebCodecsH264', () => {
  beforeEach(() => {
    behaviorByCodec = {};
    supportedCodecs = new Set([HIGH, BASELINE]);
    frameThrows = false;
    encoders = [];
    vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
    vi.stubGlobal('VideoFrame', FakeVideoFrame);
    // jsdom has no 2D canvas; the probe encodes the blank canvas regardless.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps High profile where it drains, as in Chromium', async () => {
    await expect(probeWebCodecsH264(CONFIG, FAST)).resolves.toEqual({ profile: 'high' });

    expect(encoders.map((encoder) => encoder.codec)).toEqual([HIGH]);
    expect(encoders[0].state).toBe('closed');
  });

  // WebKit drains four pending frames and stalls from five, so a short probe
  // would pass where the export's first flush (8 frames at 1080p) stalls.
  it('test-encodes the batch the export queues before each flush', async () => {
    await probeWebCodecsH264(CONFIG, FAST);
    await probeWebCodecsH264({ ...CONFIG, width: 640, height: 360 }, FAST);

    expect(encoders.map((encoder) => encoder.encoded)).toEqual([8, 30]);
  });

  it('falls back to Baseline where High stalls, as in WebKit', async () => {
    behaviorByCodec = { [HIGH]: 'stalls' };

    await expect(probeWebCodecsH264(CONFIG, FAST)).resolves.toEqual({ profile: 'baseline' });

    expect(encoders.map((encoder) => encoder.codec)).toEqual([HIGH, BASELINE]);
    expect(encoders.every((encoder) => encoder.state === 'closed')).toBe(true);
  });

  it('treats a flush that settles with no output as a stall', async () => {
    behaviorByCodec = { [HIGH]: 'silent' };

    await expect(probeWebCodecsH264(CONFIG, FAST)).resolves.toEqual({ profile: 'baseline' });
  });

  it('uses Baseline where only Baseline is reported as supported', async () => {
    supportedCodecs = new Set([BASELINE]);

    await expect(probeWebCodecsH264(CONFIG, FAST)).resolves.toEqual({ profile: 'baseline' });
    expect(encoders.map((encoder) => encoder.codec)).toEqual([BASELINE]);
  });

  it('reports no usable H.264 encoder when neither profile drains', async () => {
    behaviorByCodec = { [HIGH]: 'stalls', [BASELINE]: 'stalls' };

    await expect(probeWebCodecsH264(CONFIG, FAST)).resolves.toBeNull();
  });

  it('does not test-encode when the browser has no H.264 encoder', async () => {
    supportedCodecs = new Set();

    await expect(probeWebCodecsH264(CONFIG, FAST)).resolves.toBeNull();
    expect(encoders).toHaveLength(0);
  });

  it('keeps High profile when the probe cannot submit frames at all', async () => {
    frameThrows = true;

    await expect(probeWebCodecsH264(CONFIG, FAST)).resolves.toEqual({ profile: 'high' });
    expect(encoders).toHaveLength(1);
  });
});

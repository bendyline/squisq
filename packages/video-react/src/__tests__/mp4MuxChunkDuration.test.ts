/**
 * Regression: Chromium 151+ (Chrome and Android WebView 157 confirmed) returns
 * `EncodedVideoChunk.duration === null` when the encoded `VideoFrame` carried
 * no duration. mp4-muxer rejects such a chunk, and the encoder's output
 * callback swallowed the exception, so no chunk (and no decoder config) ever
 * reached the video track. Finalizing then failed with "Cannot read
 * properties of null (reading 'colorSpace')".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMp4Muxer } from '../mp4Mux.js';

const AVC_DESCRIPTION = new Uint8Array([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28, 0x01, 0x00, 0x04, 0x68,
  0xee, 0x3c, 0x80,
]);
const META: EncodedVideoChunkMetadata = {
  decoderConfig: { codec: 'avc1.640028', description: AVC_DESCRIPTION },
};
const PAYLOAD = new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x09, 0x10]);

/** Stands in for the browser's `EncodedVideoChunk`, which Node lacks. */
class FakeEncodedVideoChunk {
  readonly byteLength = PAYLOAD.byteLength;
  constructor(
    readonly type: 'key' | 'delta',
    readonly timestamp: number,
    readonly duration: number | null,
  ) {}
  copyTo(destination: Uint8Array): void {
    destination.set(PAYLOAD);
  }
}

function chunk(type: 'key' | 'delta', timestamp: number, duration: number | null) {
  return new FakeEncodedVideoChunk(type, timestamp, duration) as unknown as EncodedVideoChunk;
}

/** Read the first `name` box's payload offset (just past its 8-byte header). */
function boxPayload(bytes: Uint8Array, name: string): number {
  const pattern = Array.from(name, (c) => c.charCodeAt(0));
  for (let i = 4; i + 4 <= bytes.length; i++) {
    if (pattern.every((value, j) => bytes[i + j] === value)) return i + 4;
  }
  throw new Error(`No ${name} box`);
}

/** Total duration of the first track in seconds, from its mdhd timescale and stts table. */
function firstTrackSeconds(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // mdhd v0: version/flags(4) creation(4) modification(4) timescale(4).
  const timescale = view.getUint32(boxPayload(bytes, 'mdhd') + 12);
  // stts: version/flags(4) entryCount(4) then (sampleCount, sampleDelta) pairs.
  const stts = boxPayload(bytes, 'stts');
  const entries = view.getUint32(stts + 4);
  let ticks = 0;
  for (let i = 0; i < entries; i++) {
    ticks += view.getUint32(stts + 8 + i * 8) * view.getUint32(stts + 12 + i * 8);
  }
  return ticks / timescale;
}

describe('createMp4Muxer chunk durations', () => {
  beforeEach(() => {
    vi.stubGlobal('EncodedVideoChunk', FakeEncodedVideoChunk);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('muxes chunks whose duration the encoder left null', () => {
    const muxer = createMp4Muxer({ width: 320, height: 240, fps: 30 });

    expect(() => {
      muxer.addVideoChunk(chunk('key', 0, null), META);
      muxer.addVideoChunk(chunk('delta', 33_333, null), META);
    }).not.toThrow();

    const mp4 = muxer.finalize();
    // The decoder config reached the track, so finalize could write avcC.
    expect(boxPayload(new Uint8Array(mp4), 'avcC')).toBeGreaterThan(0);
    // Two frames at 30 fps, the last one timed by the nominal frame duration.
    expect(firstTrackSeconds(mp4)).toBeCloseTo(2 / 30, 3);
  });

  it('keeps an encoder-reported duration', () => {
    const muxer = createMp4Muxer({ width: 320, height: 240, fps: 30 });

    muxer.addVideoChunk(chunk('key', 0, 100_000), META);

    expect(firstTrackSeconds(muxer.finalize())).toBeCloseTo(0.1, 3);
  });
});

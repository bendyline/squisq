/**
 * mp4Mux audio track — verifies the additive AAC track wiring.
 *
 * mp4-muxer runs in Node, so we can add a raw audio sample and assert the
 * finalized MP4 actually carries an `mp4a` sample-description box (i.e. the
 * audio track made it into the container). We also assert the video-only
 * configuration produces no such box, guarding the "byte-identical when no
 * audio" contract.
 */

import { describe, it, expect } from 'vitest';
import { createMp4Muxer, type Mp4MuxerHandle } from '../mp4Mux.js';

/** Add one stub AVC keyframe so the always-present video track can finalize. */
function addStubVideoSample(muxer: Mp4MuxerHandle): void {
  const avcDescription = new Uint8Array([
    0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28, 0x01, 0x00, 0x04, 0x68,
    0xee, 0x3c, 0x80,
  ]);
  muxer.addVideoChunkRaw(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x09, 0x10]), 'key', 0, 33_333, {
    decoderConfig: { codec: 'avc1.640028', description: avcDescription },
  });
}

/** Find the ASCII 4CC `needle` anywhere in the MP4 bytes. */
function containsFourCC(buffer: ArrayBuffer, needle: string): boolean {
  const bytes = new Uint8Array(buffer);
  const pat = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + pat.length <= bytes.length; i++) {
    for (let j = 0; j < pat.length; j++) {
      if (bytes[i + j] !== pat[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe('createMp4Muxer audio track', () => {
  it('writes an mp4a sample entry when an audio track is configured', () => {
    const muxer = createMp4Muxer({
      width: 320,
      height: 240,
      fps: 30,
      audio: { numberOfChannels: 2, sampleRate: 48_000 },
    });

    expect(muxer.hasAudioTrack).toBe(true);

    // The video track needs at least one sample to finalize. Feed a raw AVC
    // sample with a stub decoderConfig (bytes don't need to be a valid stream
    // for the container-level box check).
    addStubVideoSample(muxer);

    // Feed one raw AAC sample (contents don't matter for the container check).
    const sample = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    // timestamp/duration are in microseconds.
    muxer.addAudioChunkRaw(sample, 'key', 0, 1_000_000);

    const mp4 = muxer.finalize();
    expect(mp4.byteLength).toBeGreaterThan(0);
    // The AAC audio sample entry box is named 'mp4a'.
    expect(containsFourCC(mp4, 'mp4a')).toBe(true);
  });

  it('produces no audio track (no mp4a box) when audio is omitted', () => {
    const muxer = createMp4Muxer({ width: 320, height: 240, fps: 30 });
    expect(muxer.hasAudioTrack).toBe(false);
    addStubVideoSample(muxer);
    const mp4 = muxer.finalize();
    expect(containsFourCC(mp4, 'mp4a')).toBe(false);
  });
});

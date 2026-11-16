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

/**
 * The AudioSpecificConfig in the MP4's `esds`: the payload of its
 * DecoderSpecificInfo (tag 5), which mp4-muxer writes with a 4-byte length.
 */
function esdsAudioSpecificConfig(buffer: ArrayBuffer): number[] {
  const bytes = Array.from(new Uint8Array(buffer));
  const esds = bytes.findIndex((_, i) => String.fromCharCode(...bytes.slice(i, i + 4)) === 'esds');
  expect(esds).toBeGreaterThan(0);
  const tag = bytes.findIndex(
    (byte, i) => i > esds && byte === 0x05 && bytes[i + 1] === 0x80 && bytes[i + 2] === 0x80,
  );
  const length = bytes[tag + 4];
  return bytes.slice(tag + 5, tag + 5 + length);
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

  it("keeps WebKit's AudioToolbox cookie out of the esds", () => {
    const muxer = createMp4Muxer({
      width: 320,
      height: 240,
      fps: 30,
      audio: { numberOfChannels: 2, sampleRate: 48_000 },
    });
    addStubVideoSample(muxer);
    // The DecoderSpecificInfo an iPhone export carried, byte for byte: a
    // whole ES_Descriptor wrapping the real config (`11 90`), which left the
    // track as AAC object type 0 and silent in every player.
    const webKitCookie = new Uint8Array([
      0x03, 0x80, 0x80, 0x80, 0x22, 0x00, 0x00, 0x00, 0x04, 0x80, 0x80, 0x80, 0x14, 0x40, 0x14,
      0x00, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x80, 0x80, 0x80,
      0x02, 0x11, 0x90, 0x06, 0x80, 0x80, 0x80, 0x01, 0x02,
    ]).buffer;

    muxer.addAudioChunkRaw(new Uint8Array([0x21, 0x10]), 'key', 0, 21_333, {
      decoderConfig: {
        codec: 'mp4a.40.2',
        sampleRate: 48_000,
        numberOfChannels: 2,
        description: webKitCookie,
      },
    });

    // AAC-LC (2), 48 kHz (index 3), stereo (2).
    expect(esdsAudioSpecificConfig(muxer.finalize())).toEqual([0x11, 0x90]);
  });

  it('keeps a valid AudioSpecificConfig the encoder reports', () => {
    const muxer = createMp4Muxer({
      width: 320,
      height: 240,
      fps: 30,
      audio: { numberOfChannels: 2, sampleRate: 48_000 },
    });
    addStubVideoSample(muxer);
    // 44.1 kHz rather than the derived 48 kHz `11 90`, so the test can tell
    // whose config landed.
    muxer.addAudioChunkRaw(new Uint8Array([0x21, 0x10]), 'key', 0, 21_333, {
      decoderConfig: {
        codec: 'mp4a.40.2',
        sampleRate: 48_000,
        numberOfChannels: 2,
        description: new Uint8Array([0x12, 0x10]),
      },
    });

    expect(esdsAudioSpecificConfig(muxer.finalize())).toEqual([0x12, 0x10]);
  });

  it('finalizes the streamed chunks directly into an MP4 Blob', () => {
    const muxer = createMp4Muxer({ width: 320, height: 240, fps: 30 });
    addStubVideoSample(muxer);

    const blob = muxer.finalizeBlob();

    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBeGreaterThan(0);
  });
});

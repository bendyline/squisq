/**
 * mp4Mux Blob spilling — bounded JS memory for long exports.
 *
 * The spilling sink may consolidate settled bytes into Blob parts only if the
 * final assembly is byte-identical to the in-memory sink, including the
 * header patches MP4 finalization writes back over earlier offsets. The
 * write-pattern probe documents mp4-muxer's actual behavior (append-only
 * while encoding, small early back-patches at finalize) that makes spilling
 * safe; the equality test then proves the sliced-Blob assembly reproduces the
 * exact bytes even when patches land on already-spilled regions.
 */

import { describe, it, expect } from 'vitest';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { createMp4Muxer, type Mp4MuxerHandle } from '../mp4Mux.js';

const AVC_DESCRIPTION = new Uint8Array([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x28, 0x01, 0x00, 0x04, 0x68,
  0xee, 0x3c, 0x80,
]);

/** Deterministic pseudo-random payload so both sinks see identical bytes. */
function payload(seed: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

/** Read a Blob's bytes via FileReader (jsdom's Blob lacks arrayBuffer()). */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(new Uint8Array(reader.result as ArrayBuffer)), {
      once: true,
    });
    reader.addEventListener('error', () => reject(reader.error), { once: true });
    reader.readAsArrayBuffer(blob);
  });
}

/** Feed the muxer an export-shaped sequence: all audio first, then video. */
function feed(muxer: Mp4MuxerHandle): void {
  for (let i = 0; i < 120; i++) {
    muxer.addAudioChunkRaw(payload(1000 + i, 256), 'key', i * 21_333, 21_333);
  }
  for (let i = 0; i < 90; i++) {
    muxer.addVideoChunkRaw(
      payload(i, 2_048),
      i % 30 === 0 ? 'key' : 'delta',
      i * 33_333,
      33_333,
      i === 0
        ? { decoderConfig: { codec: 'avc1.640028', description: AVC_DESCRIPTION } }
        : undefined,
    );
  }
}

describe('mp4-muxer write pattern (spill-safety evidence)', () => {
  it('appends while encoding and only back-patches early header bytes at finalize', () => {
    interface LoggedWrite {
      position: number;
      size: number;
      phase: 'encode' | 'finalize';
      /** Stream frontier before this write; a position below it is a patch. */
      frontierAtWrite: number;
    }
    const writes: LoggedWrite[] = [];
    let phase: 'encode' | 'finalize' = 'encode';
    let frontier = 0;
    const muxer = new Muxer({
      target: new StreamTarget({
        onData: (data, position) => {
          writes.push({ position, size: data.byteLength, phase, frontierAtWrite: frontier });
          frontier = Math.max(frontier, position + data.byteLength);
        },
      }),
      video: { codec: 'avc', width: 320, height: 240 },
      audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48_000 },
      fastStart: false,
    });

    // WebCodecs chunk classes are unavailable in the test environment; the
    // raw methods produce the same target writes.
    for (let i = 0; i < 120; i++) {
      muxer.addAudioChunkRaw(payload(1000 + i, 256), 'key', i * 21_333, 21_333);
    }
    for (let i = 0; i < 90; i++) {
      muxer.addVideoChunkRaw(
        payload(i, 2_048),
        i % 30 === 0 ? 'key' : 'delta',
        i * 33_333,
        33_333,
        i === 0
          ? { decoderConfig: { codec: 'avc1.640028', description: AVC_DESCRIPTION } }
          : undefined,
      );
    }

    const encodeWrites = writes.length;
    phase = 'finalize';
    muxer.finalize();

    const isPatch = (write: LoggedWrite): boolean => write.position < write.frontierAtWrite;
    const encodePatches = writes.filter((write) => write.phase === 'encode' && isPatch(write));
    const finalizePatches = writes.filter((write) => write.phase === 'finalize' && isPatch(write));

    expect(writes.length).toBeGreaterThan(encodeWrites);
    // While encoding, the stream is append-only. (Correctness of spilling does
    // not depend on this — patches over spilled bytes stay in memory and win
    // at assembly — but it is what keeps spilling effective.)
    expect(encodePatches).toEqual([]);
    // Finalization back-patches exist (mdat size) and stay within the early
    // header region, far below any sane spill threshold.
    expect(finalizePatches.length).toBeGreaterThan(0);
    for (const patch of finalizePatches) {
      expect(patch.position + patch.size).toBeLessThanOrEqual(64 * 1024);
    }
  });
});

describe('createMp4Muxer Blob spilling', () => {
  it('produces byte-identical output when spilling aggressively', async () => {
    const reference = createMp4Muxer({
      width: 320,
      height: 240,
      fps: 30,
      audio: { numberOfChannels: 2, sampleRate: 48_000 },
    });
    const spilling = createMp4Muxer({
      width: 320,
      height: 240,
      fps: 30,
      audio: { numberOfChannels: 2, sampleRate: 48_000 },
      // Far below any real threshold so every few writes force a spill and the
      // finalize patches land on long-spilled regions.
      spillToBlobThresholdBytes: 1_024,
    });
    feed(reference);
    feed(spilling);

    const referenceBytes = await blobBytes(reference.finalizeBlob());
    const spilledBytes = await blobBytes(spilling.finalizeBlob());

    expect(spilledBytes.byteLength).toBe(referenceBytes.byteLength);
    expect(spilledBytes).toEqual(referenceBytes);
  });

  it('refuses to assemble a contiguous ArrayBuffer once bytes have spilled', () => {
    const spilling = createMp4Muxer({
      width: 320,
      height: 240,
      fps: 30,
      audio: { numberOfChannels: 2, sampleRate: 48_000 },
      spillToBlobThresholdBytes: 64,
    });
    feed(spilling);
    expect(() => spilling.finalize()).toThrow('Spilled MP4 output can only finalize to a Blob');
  });

  it('keeps finalize() unchanged when spilling is off', () => {
    const muxer = createMp4Muxer({ width: 320, height: 240, fps: 30 });
    muxer.addVideoChunkRaw(payload(7, 512), 'key', 0, 33_333, {
      decoderConfig: { codec: 'avc1.640028', description: AVC_DESCRIPTION },
    });
    expect(muxer.finalize().byteLength).toBeGreaterThan(0);
  });
});

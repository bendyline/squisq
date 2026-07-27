/**
 * mp4Mux — Thin wrapper around mp4-muxer for WebCodecs encoding.
 *
 * Creates a Muxer instance configured for H.264 video (and, optionally, an
 * AAC audio track), accumulates encoded chunks, and produces a final MP4
 * ArrayBuffer. When no `audio` option is supplied the muxer configuration is
 * byte-identical to the video-only path.
 */

import { Muxer, StreamTarget } from 'mp4-muxer';

export interface Mp4MuxerOptions {
  width: number;
  height: number;
  fps: number;
  /**
   * When present, declares an AAC audio track alongside the video track.
   * Feed encoded audio via {@link Mp4MuxerHandle.addAudioChunk} (from a
   * WebCodecs `AudioEncoder`) or {@link Mp4MuxerHandle.addAudioChunkRaw}.
   */
  audio?: {
    numberOfChannels: number;
    sampleRate: number;
  };
  /**
   * Consolidate settled output regions into Blob parts once buffered bytes
   * exceed this threshold, bounding JS memory for long exports. Only valid
   * when the caller finalizes via {@link Mp4MuxerHandle.finalizeBlob};
   * {@link Mp4MuxerHandle.finalize} throws once bytes have spilled.
   */
  spillToBlobThresholdBytes?: number;
}

export interface Mp4MuxerHandle {
  /** Add an encoded video chunk to the muxer. */
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  /**
   * Add a raw video sample (bytes + timing) without an `EncodedVideoChunk`.
   * Useful where no `VideoEncoder` instance is available (e.g. Node tests).
   */
  addVideoChunkRaw(
    data: Uint8Array,
    type: 'key' | 'delta',
    timestampMicros: number,
    durationMicros: number,
    meta?: EncodedVideoChunkMetadata,
  ): void;
  /** Add an encoded audio chunk (from a WebCodecs `AudioEncoder`). */
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  /**
   * Add a raw audio sample (bytes + timing) without an `EncodedAudioChunk`.
   * Useful where no `AudioEncoder` instance is available (e.g. Node tests).
   */
  addAudioChunkRaw(
    data: Uint8Array,
    type: 'key' | 'delta',
    timestampMicros: number,
    durationMicros: number,
    meta?: EncodedAudioChunkMetadata,
  ): void;
  /** Whether this muxer was created with an audio track. */
  readonly hasAudioTrack: boolean;
  /** Finalize and return the MP4 as an ArrayBuffer. */
  finalize(): ArrayBuffer;
  /**
   * Finalize directly into a Blob without assembling another contiguous copy.
   * Prefer this for browser downloads; byte consumers can still use finalize().
   */
  finalizeBlob(): Blob;
}

interface BufferedWrite {
  position: number;
  data: Uint8Array<ArrayBuffer>;
}

interface SpilledPart {
  position: number;
  size: number;
  blob: Blob;
}

/**
 * In-memory bytes retained before settled regions are consolidated into Blob
 * parts (browsers page large Blobs out of the JS heap, typically to disk).
 */
export const DEFAULT_MP4_SPILL_THRESHOLD_BYTES = 32 * 1024 * 1024;

/**
 * Sparse stream sink for mp4-muxer.
 *
 * ArrayBufferTarget grows one contiguous buffer by powers of two. A long
 * export crossing 64 MiB therefore briefly needs the old 64 MiB allocation
 * and a new 128 MiB allocation at the same time. Keep exact-sized streaming
 * writes instead, while still supporting the small header patches that MP4
 * finalization writes back over earlier offsets.
 *
 * With a spill threshold, buffered writes are additionally consolidated into
 * Blob parts once they exceed it, so a long export's JS memory stays bounded
 * instead of holding the whole MP4 (~2 MB/s of 1080p output). Correctness
 * does not depend on where the muxer patches: a later write that overlaps a
 * spilled region is kept in memory and layered over the Blob at assembly via
 * cheap Blob.slice, so finalization's mdat-size patch works even after its
 * bytes were spilled. Spilled output must finalize through {@link toBlob}.
 */
class ChunkedMp4Output {
  private writes: BufferedWrite[] = [];
  private spilled: SpilledPart[] = [];
  private bufferedBytes = 0;
  private length = 0;

  constructor(private readonly spillThresholdBytes: number | null = null) {}

  write(data: Uint8Array, position: number): void {
    const owned = new Uint8Array(data);
    const end = position + owned.byteLength;

    if (position >= this.length) {
      this.writes.push({ position, data: owned });
      this.bufferedBytes += owned.byteLength;
      this.length = end;
      this.maybeSpill();
      return;
    }

    const updated: BufferedWrite[] = [];
    for (const existing of this.writes) {
      const existingEnd = existing.position + existing.data.byteLength;
      if (existingEnd <= position || existing.position >= end) {
        updated.push(existing);
        continue;
      }
      if (existing.position < position) {
        updated.push({
          position: existing.position,
          data: existing.data.subarray(0, position - existing.position),
        });
      }
      if (existingEnd > end) {
        updated.push({
          position: end,
          data: existing.data.subarray(end - existing.position),
        });
      }
    }
    updated.push({ position, data: owned });
    updated.sort((left, right) => left.position - right.position);
    this.writes = updated;
    this.bufferedBytes = updated.reduce((sum, write) => sum + write.data.byteLength, 0);
    this.length = Math.max(this.length, end);
    this.maybeSpill();
  }

  private overlapsSpilled(write: BufferedWrite): boolean {
    const end = write.position + write.data.byteLength;
    return this.spilled.some(
      (part) => part.position < end && part.position + part.size > write.position,
    );
  }

  /**
   * Consolidate buffered writes into Blob parts once they exceed the
   * threshold. Writes overlapping an already-spilled region are patches over
   * Blob bytes; they stay in memory (they are tiny) and win at assembly.
   */
  private maybeSpill(): void {
    if (this.spillThresholdBytes === null || this.bufferedBytes < this.spillThresholdBytes) return;

    const spillable = this.writes
      .filter((write) => !this.overlapsSpilled(write))
      .sort((left, right) => left.position - right.position);
    if (spillable.length === 0) return;

    const keep = new Set(spillable);
    let run: BufferedWrite[] = [];
    const flushRun = (): void => {
      if (run.length === 0) return;
      const position = run[0].position;
      const size = run.reduce((sum, write) => sum + write.data.byteLength, 0);
      this.spilled.push({
        position,
        size,
        blob: new Blob(run.map((write) => write.data)),
      });
      run = [];
    };
    for (const write of spillable) {
      const previous = run[run.length - 1];
      if (previous && previous.position + previous.data.byteLength !== write.position) flushRun();
      run.push(write);
    }
    flushRun();
    this.spilled.sort((left, right) => left.position - right.position);
    this.writes = this.writes.filter((write) => !keep.has(write));
    this.bufferedBytes = this.writes.reduce((sum, write) => sum + write.data.byteLength, 0);
  }

  /** Regions in position order; in-memory writes take precedence over Blobs. */
  private assembleParts(): BlobPart[] {
    const boundaries = new Set<number>([0, this.length]);
    for (const write of this.writes) {
      boundaries.add(write.position);
      boundaries.add(write.position + write.data.byteLength);
    }
    for (const part of this.spilled) {
      boundaries.add(part.position);
      boundaries.add(part.position + part.size);
    }
    const sorted = [...boundaries].sort((left, right) => left - right);

    const parts: BlobPart[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const start = sorted[i];
      const end = sorted[i + 1];
      if (end <= start) continue;
      const write = this.writes.find(
        (candidate) =>
          candidate.position <= start && candidate.position + candidate.data.byteLength >= end,
      );
      if (write) {
        parts.push(write.data.subarray(start - write.position, end - write.position));
        continue;
      }
      const part = this.spilled.find(
        (candidate) => candidate.position <= start && candidate.position + candidate.size >= end,
      );
      if (part) {
        parts.push(part.blob.slice(start - part.position, end - part.position));
        continue;
      }
      parts.push(new Uint8Array(end - start));
    }
    return parts;
  }

  toArrayBuffer(): ArrayBuffer {
    if (this.spilled.length > 0) {
      throw new Error('Spilled MP4 output can only finalize to a Blob');
    }
    const output = new Uint8Array(this.length);
    for (const write of this.writes) output.set(write.data, write.position);
    this.release();
    return output.buffer;
  }

  toBlob(): Blob {
    const blob = new Blob(this.assembleParts(), { type: 'video/mp4' });
    this.release();
    return blob;
  }

  private release(): void {
    this.writes = [];
    this.spilled = [];
    this.bufferedBytes = 0;
    this.length = 0;
  }
}

/**
 * Create an MP4 muxer configured for H.264 video, plus an optional AAC track.
 */
export function createMp4Muxer(options: Mp4MuxerOptions): Mp4MuxerHandle {
  const output = new ChunkedMp4Output(options.spillToBlobThresholdBytes ?? null);
  const target = new StreamTarget({
    onData: (data, position) => output.write(data, position),
  });

  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: options.width,
      height: options.height,
    },
    // Only declare the audio track when requested so the video-only
    // configuration stays byte-identical to the historical output.
    ...(options.audio
      ? {
          audio: {
            codec: 'aac' as const,
            numberOfChannels: options.audio.numberOfChannels,
            sampleRate: options.audio.sampleRate,
          },
        }
      : {}),
    // The result is already complete before it is downloaded or passed to the
    // GIF transcode, so browser-style fast start provides no benefit here.
    // `in-memory` retains every encoded sample until finalize; regular MP4
    // layout writes each compressed chunk into the output as it arrives and
    // releases the sample payload immediately.
    fastStart: false,
  });

  let finalized = false;
  const finalizeMuxer = (): void => {
    if (finalized) throw new Error('MP4 muxer already finalized');
    muxer.finalize();
    finalized = true;
  };

  return {
    hasAudioTrack: options.audio !== undefined,

    addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) {
      muxer.addVideoChunk(chunk, meta);
    },

    addVideoChunkRaw(
      data: Uint8Array,
      type: 'key' | 'delta',
      timestampMicros: number,
      durationMicros: number,
      meta?: EncodedVideoChunkMetadata,
    ) {
      muxer.addVideoChunkRaw(data, type, timestampMicros, durationMicros, meta);
    },

    addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) {
      muxer.addAudioChunk(chunk, meta);
    },

    addAudioChunkRaw(
      data: Uint8Array,
      type: 'key' | 'delta',
      timestampMicros: number,
      durationMicros: number,
      meta?: EncodedAudioChunkMetadata,
    ) {
      muxer.addAudioChunkRaw(data, type, timestampMicros, durationMicros, meta);
    },

    finalize(): ArrayBuffer {
      finalizeMuxer();
      return output.toArrayBuffer();
    },

    finalizeBlob(): Blob {
      finalizeMuxer();
      return output.toBlob();
    },
  };
}

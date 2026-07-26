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

/**
 * Sparse stream sink for mp4-muxer.
 *
 * ArrayBufferTarget grows one contiguous buffer by powers of two. A long
 * export crossing 64 MiB therefore briefly needs the old 64 MiB allocation
 * and a new 128 MiB allocation at the same time. Keep exact-sized streaming
 * writes instead, while still supporting the small header patches that MP4
 * finalization writes back over earlier offsets.
 */
class ChunkedMp4Output {
  private writes: BufferedWrite[] = [];
  private length = 0;

  write(data: Uint8Array, position: number): void {
    const owned = new Uint8Array(data);
    const end = position + owned.byteLength;

    if (position >= this.length) {
      this.writes.push({ position, data: owned });
      this.length = end;
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
    this.length = Math.max(this.length, end);
  }

  toArrayBuffer(): ArrayBuffer {
    const output = new Uint8Array(this.length);
    for (const write of this.writes) output.set(write.data, write.position);
    this.release();
    return output.buffer;
  }

  toBlob(): Blob {
    const parts: BlobPart[] = [];
    let position = 0;
    for (const write of this.writes) {
      if (write.position > position) parts.push(new Uint8Array(write.position - position));
      parts.push(write.data);
      position = write.position + write.data.byteLength;
    }
    if (position < this.length) parts.push(new Uint8Array(this.length - position));
    const blob = new Blob(parts, { type: 'video/mp4' });
    this.release();
    return blob;
  }

  private release(): void {
    this.writes = [];
    this.length = 0;
  }
}

/**
 * Create an MP4 muxer configured for H.264 video, plus an optional AAC track.
 */
export function createMp4Muxer(options: Mp4MuxerOptions): Mp4MuxerHandle {
  const output = new ChunkedMp4Output();
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

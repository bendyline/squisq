/**
 * mp4Mux — Thin wrapper around mp4-muxer for WebCodecs encoding.
 *
 * Creates a Muxer instance configured for H.264 video (and, optionally, an
 * AAC audio track), accumulates encoded chunks, and produces a final MP4
 * ArrayBuffer. When no `audio` option is supplied the muxer configuration is
 * byte-identical to the video-only path.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

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
}

/**
 * Create an MP4 muxer configured for H.264 video, plus an optional AAC track.
 */
export function createMp4Muxer(options: Mp4MuxerOptions): Mp4MuxerHandle {
  const target = new ArrayBufferTarget();

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
      muxer.finalize();
      return target.buffer;
    },
  };
}

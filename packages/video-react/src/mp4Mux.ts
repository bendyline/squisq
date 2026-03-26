/**
 * mp4Mux — Thin wrapper around mp4-muxer for WebCodecs encoding.
 *
 * Creates a Muxer instance configured for H.264 video, accumulates
 * encoded chunks, and produces a final MP4 ArrayBuffer.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface Mp4MuxerOptions {
  width: number;
  height: number;
  fps: number;
}

export interface Mp4MuxerHandle {
  /** Add an encoded video chunk to the muxer. */
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  /** Finalize and return the MP4 as an ArrayBuffer. */
  finalize(): ArrayBuffer;
}

/**
 * Create an MP4 muxer configured for H.264 video.
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
    fastStart: 'in-memory',
  });

  return {
    addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) {
      muxer.addVideoChunk(chunk, meta);
    },

    finalize(): ArrayBuffer {
      muxer.finalize();
      return target.buffer;
    },
  };
}

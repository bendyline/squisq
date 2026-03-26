/**
 * Main-thread WebCodecs encoder.
 *
 * Encodes video frames to MP4 using the WebCodecs API and mp4-muxer,
 * running directly on the main thread. This is simpler and avoids
 * worker module-resolution issues with bundlers. Since frame capture
 * via html2canvas (~100-200ms per frame) is the bottleneck — not
 * encoding (~1ms per frame with hardware-accelerated WebCodecs) —
 * worker offloading provides minimal benefit.
 *
 * Requirements: Chrome 94+ / Edge 94+ (WebCodecs support).
 */

import { createMp4Muxer, type Mp4MuxerHandle } from './mp4Mux.js';

export interface EncoderConfig {
  width: number;
  height: number;
  fps: number;
  quality: 'draft' | 'normal' | 'high';
}

export interface MainThreadEncoder {
  /** Encode a single frame. The bitmap is closed after encoding. */
  encodeFrame(bitmap: ImageBitmap, frameIndex: number): void;
  /** Flush pending frames and finalize the MP4. Returns the MP4 ArrayBuffer. */
  finalize(): Promise<ArrayBuffer>;
  /** Close the encoder without producing output (e.g., on cancel). */
  close(): void;
}

/**
 * Check whether the browser supports WebCodecs video encoding.
 */
export function supportsWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

function bitrateForQuality(quality: string, width: number, height: number): number {
  const pixels = width * height;
  const baseBitrate = pixels * 4; // ~4 bits per pixel baseline
  switch (quality) {
    case 'draft':
      return Math.round(baseBitrate * 0.5);
    case 'high':
      return Math.round(baseBitrate * 2);
    default: // normal
      return baseBitrate;
  }
}

/**
 * Create a main-thread WebCodecs encoder.
 *
 * Throws if WebCodecs is not available.
 */
export function createEncoder(config: EncoderConfig): MainThreadEncoder {
  if (!supportsWebCodecs()) {
    throw new Error(
      'WebCodecs is not available in this browser. ' +
        'Video export requires Chrome 94+, Edge 94+, or another Chromium-based browser.',
    );
  }

  const muxer: Mp4MuxerHandle = createMp4Muxer({
    width: config.width,
    height: config.height,
    fps: config.fps,
  });

  let closed = false;
  const frameDuration = 1_000_000 / config.fps; // microseconds per frame

  const encoder = new VideoEncoder({
    output(chunk, meta) {
      if (closed) return;
      muxer.addVideoChunk(chunk, meta ?? undefined);
    },
    error(err) {
      console.error('WebCodecs encoder error:', err.message);
    },
  });

  encoder.configure({
    codec: 'avc1.640028', // H.264 High profile, level 4.0 (supports up to 1080p)
    width: config.width,
    height: config.height,
    bitrate: bitrateForQuality(config.quality, config.width, config.height),
    framerate: config.fps,
  });

  return {
    encodeFrame(bitmap: ImageBitmap, frameIndex: number) {
      if (closed) {
        bitmap.close();
        return;
      }
      const timestamp = Math.round(frameIndex * frameDuration);
      const frame = new VideoFrame(bitmap, { timestamp });
      const keyFrame = frameIndex % 30 === 0;
      encoder.encode(frame, { keyFrame });
      frame.close();
      bitmap.close();
    },

    async finalize(): Promise<ArrayBuffer> {
      if (closed) throw new Error('Encoder already closed');
      await encoder.flush();
      encoder.close();
      closed = true;
      return muxer.finalize();
    },

    close() {
      if (closed) return;
      closed = true;
      if (encoder.state !== 'closed') {
        encoder.close();
      }
    },
  };
}

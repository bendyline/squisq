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

import { bitrateForQuality, validateVideoExportOptions } from '@bendyline/squisq-video';

import { createMp4Muxer, type Mp4MuxerHandle } from './mp4Mux.js';
import { applyWebCodecsBackpressure, resolveWebCodecsQueueLimit } from './encoderMemory.js';

export interface EncoderConfig {
  width: number;
  height: number;
  fps: number;
  quality: 'draft' | 'normal' | 'high';
  /**
   * Total frames the caller intends to submit, when known. Unused by the
   * main-thread encoder (the caller owns the progress bar) but forwarded by
   * {@link createWorkerEncoder} so the worker can report real progress instead
   * of guessing from the frames it happens to have seen.
   */
  totalFrames?: number;
  /**
   * When present, the underlying muxer is configured with an AAC audio track
   * and {@link MainThreadEncoder.addAudioChunk} becomes usable. Absent → the
   * encoder produces a video-only MP4 exactly as before.
   */
  audio?: {
    numberOfChannels: number;
    sampleRate: number;
  };
}

export interface MainThreadEncoder {
  /** Encode a single frame. The bitmap is closed after encoding. */
  encodeFrame(bitmap: ImageBitmap, frameIndex: number): Promise<void>;
  /**
   * Hand an encoded audio chunk (from a WebCodecs `AudioEncoder`) to the muxer.
   * Only valid when the encoder was created with an `audio` config; otherwise a
   * no-op. Must be called before {@link finalize}.
   */
  addAudioChunk?(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
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

/**
 * Probe whether the WebCodecs encoder actually supports the H.264 profile
 * we use. The `VideoEncoder` global can exist while the specific codec is
 * unavailable — this is the case on Linux Chromium, which ships without
 * the proprietary H.264 encoder.
 */
export async function supportsWebCodecsH264(config: EncoderConfig): Promise<boolean> {
  if (!supportsWebCodecs()) return false;
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640028',
      width: config.width,
      height: config.height,
      bitrate: bitrateForQuality(config.quality, config.width, config.height),
      framerate: config.fps,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

/**
 * Create a main-thread WebCodecs encoder.
 *
 * Throws if WebCodecs is not available.
 */
export function createEncoder(config: EncoderConfig): MainThreadEncoder {
  validateVideoExportOptions(config);
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
    ...(config.audio ? { audio: config.audio } : {}),
  });

  let closed = false;
  /**
   * First fatal error reported by the encoder's async error callback.
   *
   * `VideoEncoder` surfaces failures out-of-band, so this must be latched and
   * re-thrown from the next caller-facing operation. Previously it was only
   * logged: a failed encode either resurfaced later as an opaque
   * `InvalidStateError` from `encode()`/`flush()`, or — when the encoder dropped
   * frames without entering a closed state — never surfaced at all, and the
   * export reported "Export complete" over a truncated MP4.
   */
  let fatalError: Error | null = null;
  const frameDuration = 1_000_000 / config.fps; // microseconds per frame
  const queueLimit = resolveWebCodecsQueueLimit(config);

  /** Tear the encoder down and surface the latched (or supplied) failure. */
  function fail(err: Error): Error {
    closed = true;
    if (encoder.state !== 'closed') encoder.close();
    return fatalError ?? err;
  }

  const encoder = new VideoEncoder({
    output(chunk, meta) {
      if (closed) return;
      muxer.addVideoChunk(chunk, meta ?? undefined);
    },
    error(err) {
      fatalError ??= new Error(`WebCodecs encoder error: ${err.message}`);
    },
  });

  encoder.configure({
    // Deliberate profile split from the fallback worker (avc1.42001f, Baseline):
    // this primary WebCodecs path targets H.264 High@4.0 for better quality up
    // to 1080p; the wasm-fallback worker uses Baseline for max decoder compat.
    codec: 'avc1.640028', // H.264 High profile, level 4.0 (supports up to 1080p)
    width: config.width,
    height: config.height,
    bitrate: bitrateForQuality(config.quality, config.width, config.height),
    framerate: config.fps,
  });

  return {
    async encodeFrame(bitmap: ImageBitmap, frameIndex: number): Promise<void> {
      // Check the latched error first: once the encoder has failed, every
      // subsequent frame is wasted work and the export must stop here.
      if (fatalError) {
        bitmap.close();
        throw fail(fatalError);
      }
      if (closed) {
        bitmap.close();
        throw new Error('Encoder already closed');
      }
      try {
        // `encode()` is asynchronous and closing the VideoFrame does not mean
        // Chromium has released its pixels. A software encoder can otherwise
        // trail capture by hundreds of frames and eventually force the renderer
        // into memory-pressure thrashing.
        await applyWebCodecsBackpressure(encoder, queueLimit);
        if (fatalError) throw fail(fatalError);
        if (closed) throw new Error('Encoder already closed');

        const timestamp = Math.round(frameIndex * frameDuration);
        const frame = new VideoFrame(bitmap, { timestamp });
        try {
          const keyFrame = frameIndex % 30 === 0;
          encoder.encode(frame, { keyFrame });
        } finally {
          frame.close();
        }
      } catch (err: unknown) {
        throw fail(err instanceof Error ? err : new Error(String(err)));
      } finally {
        bitmap.close();
      }
    },

    addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) {
      if (closed || !muxer.hasAudioTrack) return;
      muxer.addAudioChunk(chunk, meta);
    },

    async finalize(): Promise<ArrayBuffer> {
      if (closed) throw new Error('Encoder already closed');
      if (fatalError) throw fail(fatalError);
      try {
        await encoder.flush();
      } catch (err: unknown) {
        // Prefer the latched encoder error: `flush()` typically rejects with a
        // generic InvalidStateError that hides the real cause.
        throw fail(err instanceof Error ? err : new Error(String(err)));
      }
      // The error callback can fire during flush, after in-flight frames drain.
      // Finalizing here would emit a silently truncated MP4.
      if (fatalError) throw fail(fatalError);
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

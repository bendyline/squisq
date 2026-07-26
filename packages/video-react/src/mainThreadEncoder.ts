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

export type EncoderFrameSource = ImageBitmap | HTMLCanvasElement;

export interface MainThreadEncoder {
  /** Encode a single frame. ImageBitmap sources are closed after encoding. */
  encodeFrame(frame: EncoderFrameSource, frameIndex: number): Promise<void>;
  /**
   * Hand an encoded audio chunk (from a WebCodecs `AudioEncoder`) to the muxer.
   * Only valid when the encoder was created with an `audio` config; otherwise a
   * no-op. Must be called before {@link finalize}.
   */
  addAudioChunk?(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  /** Flush pending frames and finalize the MP4. Returns the MP4 ArrayBuffer. */
  finalize(): Promise<ArrayBuffer>;
  /** Finalize directly into a Blob, avoiding a second full-file allocation. */
  finalizeBlob?(): Promise<Blob>;
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

const RECLAIMED_CODEC_ERROR = /codec reclaimed due to inactivity/i;
const MAX_CODEC_RECOVERY_ATTEMPTS = 2;

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}

function isReclaimedCodecError(error: Error): boolean {
  return RECLAIMED_CODEC_ERROR.test(error.message);
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
  /**
   * Chromium may reclaim an idle hardware codec while a tab is hidden. Unlike
   * other encoder errors, this is recoverable without replacing the muxer or
   * discarding chunks that have already been written to it.
   */
  let recoverableError: Error | null = null;
  const frameDuration = 1_000_000 / config.fps; // microseconds per frame
  const queueLimit = resolveWebCodecsQueueLimit(config);
  let framesSinceFlush = 0;
  let forceNextKeyFrame = false;
  let encoderGeneration = 0;
  let encoder: VideoEncoder;

  /** Tear the encoder down and surface the latched (or supplied) failure. */
  function fail(err: Error): Error {
    closed = true;
    if (encoder.state !== 'closed') encoder.close();
    return fatalError ?? err;
  }

  const videoEncoderConfig: VideoEncoderConfig = {
    // Deliberate profile split from the fallback worker (avc1.42001f,
    // Baseline): this primary WebCodecs path targets H.264 High@4.0 for
    // better quality up to 1080p; the wasm-fallback worker uses Baseline for
    // maximum decoder compatibility.
    codec: 'avc1.640028',
    width: config.width,
    height: config.height,
    bitrate: bitrateForQuality(config.quality, config.width, config.height),
    framerate: config.fps,
  };

  function createConfiguredVideoEncoder(): VideoEncoder {
    const generation = ++encoderGeneration;
    const nextEncoder = new VideoEncoder({
      output(chunk, meta) {
        if (closed || generation !== encoderGeneration) return;
        muxer.addVideoChunk(chunk, meta ?? undefined);
      },
      error(err) {
        if (closed || generation !== encoderGeneration || fatalError || recoverableError) return;
        const wrapped = new Error(`WebCodecs encoder error: ${err.message}`);
        if (isReclaimedCodecError(wrapped)) {
          recoverableError = wrapped;
        } else {
          fatalError = wrapped;
        }
      },
    });
    nextEncoder.configure(videoEncoderConfig);
    return nextEncoder;
  }

  function recoverCodec(): void {
    const previousEncoder = encoder;
    recoverableError = null;
    if (previousEncoder.state !== 'closed') previousEncoder.close();
    encoder = createConfiguredVideoEncoder();
    framesSinceFlush = 0;
    // A replacement H.264 encoder has no reference frames from its
    // predecessor. Start its segment with an independently decodable frame.
    forceNextKeyFrame = true;
  }

  encoder = createConfiguredVideoEncoder();

  async function finishVideoEncoding(): Promise<void> {
    if (closed) throw new Error('Encoder already closed');
    let recoveryAttempts = 0;
    while (true) {
      if (fatalError) throw fail(fatalError);
      if (recoverableError) {
        if (recoveryAttempts >= MAX_CODEC_RECOVERY_ATTEMPTS) {
          throw fail(recoverableError);
        }
        recoverCodec();
        recoveryAttempts++;
      }
      try {
        await encoder.flush();
      } catch (caught: unknown) {
        const error = toError(caught);
        if (!recoverableError && isReclaimedCodecError(error)) {
          recoverableError = error;
        }
        // `flush()` commonly rejects with a generic InvalidStateError after
        // the error callback reported the recoverable inactivity cause.
        if (recoverableError && recoveryAttempts < MAX_CODEC_RECOVERY_ATTEMPTS) continue;
        throw fail(fatalError ?? recoverableError ?? error);
      }
      // Either callback can fire while in-flight frames drain.
      if (fatalError) throw fail(fatalError);
      if (recoverableError) continue;
      break;
    }
    encoder.close();
    closed = true;
  }

  return {
    async encodeFrame(source: EncoderFrameSource, frameIndex: number): Promise<void> {
      try {
        try {
          let recoveryAttempts = 0;
          while (true) {
            if (fatalError) throw fail(fatalError);
            if (closed) throw new Error('Encoder already closed');
            if (recoverableError) {
              if (recoveryAttempts >= MAX_CODEC_RECOVERY_ATTEMPTS) {
                throw fail(recoverableError);
              }
              recoverCodec();
              recoveryAttempts++;
            }

            try {
              // `encode()` is asynchronous and closing the VideoFrame does not
              // mean Chromium has released its pixels. A software encoder can
              // otherwise trail capture by hundreds of frames and eventually
              // force the renderer into memory-pressure thrashing.
              const drained = await applyWebCodecsBackpressure(
                encoder,
                queueLimit,
                framesSinceFlush,
              );
              if (drained) framesSinceFlush = 0;
              if (fatalError) throw fail(fatalError);
              if (recoverableError) continue;
              if (closed) throw new Error('Encoder already closed');

              const timestamp = Math.round(frameIndex * frameDuration);
              const frame = new VideoFrame(source, { timestamp });
              try {
                const keyFrame = forceNextKeyFrame || frameIndex % 30 === 0;
                encoder.encode(frame, { keyFrame });
                framesSinceFlush++;
                forceNextKeyFrame = false;
              } finally {
                frame.close();
              }
              // A test double may report synchronously, and browsers may queue
              // the callback before this continuation. Retrying here keeps the
              // current raster available for the replacement codec.
              if (recoverableError) continue;
              return;
            } catch (caught: unknown) {
              const error = toError(caught);
              if (!recoverableError && isReclaimedCodecError(error)) {
                recoverableError = error;
              }
              if (recoverableError && recoveryAttempts < MAX_CODEC_RECOVERY_ATTEMPTS) continue;
              throw fail(fatalError ?? recoverableError ?? error);
            }
          }
        } catch (caught: unknown) {
          throw fail(toError(caught));
        }
      } finally {
        if ('close' in source) source.close();
      }
    },

    addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) {
      if (closed || !muxer.hasAudioTrack) return;
      muxer.addAudioChunk(chunk, meta);
    },

    async finalize(): Promise<ArrayBuffer> {
      await finishVideoEncoding();
      return muxer.finalize();
    },

    async finalizeBlob(): Promise<Blob> {
      await finishVideoEncoding();
      return muxer.finalizeBlob();
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

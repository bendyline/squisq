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

import {
  createMp4Muxer,
  DEFAULT_MP4_SPILL_THRESHOLD_BYTES,
  type Mp4MuxerHandle,
} from './mp4Mux.js';
import { applyWebCodecsBackpressure, resolveWebCodecsQueueLimit } from './encoderMemory.js';
import { VideoEncodingInterruptedError } from './encodingInterruption.js';

export { VideoEncodingInterruptedError };

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
  /**
   * Allow the muxer to spill settled output bytes into Blob storage so a long
   * export does not hold the whole MP4 in JS memory. Only valid when the
   * caller will finalize via {@link MainThreadEncoder.finalizeBlob} — byte
   * consumers (GIF transcode, ffmpeg audio muxing) must leave this off.
   */
  spillOutputToBlob?: boolean;
  /**
   * H.264 profile to encode with. Defaults to `'high'`. Pass the profile
   * {@link probeWebCodecsH264} chose: WebKit's High-profile encoder stalls.
   */
  h264Profile?: WebCodecsH264Profile;
}

/**
 * `'high'` is H.264 High@4.0 (`avc1.640028`), the better-compressing default.
 * `'baseline'` is Baseline@4.2 (`avc1.42002a`), for encoders that cannot
 * drain High.
 */
export type WebCodecsH264Profile = 'high' | 'baseline';

/** A WebCodecs H.264 configuration that {@link probeWebCodecsH264} saw drain. */
export interface WebCodecsH264Support {
  profile: WebCodecsH264Profile;
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
  /**
   * Wait until every submitted frame is in the MP4. Rejects with
   * {@link VideoEncodingInterruptedError} when the codec was lost with frames
   * still pending, after starting a replacement codec.
   */
  drain?(): Promise<void>;
  /**
   * Abandon the current codec and start a replacement, for a codec whose
   * pending work will never settle — iOS invalidates the hardware encoder
   * session of a backgrounded app without reporting an error. Returns the index
   * of the first frame whose output is not in the MP4; the caller submits
   * frames again from there. Throws when the MP4 itself cannot continue.
   */
  restartCodec?(): number;
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
 * Codec strings by profile. Both levels cover every export size up to 1080p
 * in either orientation. (The ffmpeg.wasm fallback worker has its own
 * Baseline configuration.)
 */
const H264_CODECS: Readonly<Record<WebCodecsH264Profile, string>> = {
  high: 'avc1.640028',
  baseline: 'avc1.42002a',
};

/** The H.264 configuration for the primary WebCodecs path. */
function h264EncoderConfig(config: EncoderConfig): VideoEncoderConfig {
  return {
    codec: H264_CODECS[config.h264Profile ?? 'high'],
    width: config.width,
    height: config.height,
    bitrate: bitrateForQuality(config.quality, config.width, config.height),
    framerate: config.fps,
  };
}

/** Microseconds per frame, rounded the way every frame timestamp is. */
function frameDurationMicros(fps: number): number {
  return Math.round(1_000_000 / fps);
}

/**
 * Whether the browser reports support for the H.264 profile we use (High,
 * unless `config.h264Profile` says otherwise). The `VideoEncoder` global can
 * exist while the specific codec is unavailable — this is the case on Linux
 * Chromium, which ships without the proprietary H.264 encoder.
 *
 * This is a capability check only. WebKit reports High as supported yet
 * never drains it; {@link probeWebCodecsH264} detects that and picks a
 * profile that works.
 */
export async function supportsWebCodecsH264(config: EncoderConfig): Promise<boolean> {
  if (!supportsWebCodecs()) return false;
  try {
    const support = await VideoEncoder.isConfigSupported(h264EncoderConfig(config));
    return support.supported === true;
  } catch {
    return false;
  }
}

/**
 * How long a probe attempt waits for its flush. Chromium drains a 1080p batch
 * in tens of milliseconds; the WebKit stall never ends. The margin is for a
 * slow device bringing up its hardware encoder.
 */
export const H264_PROBE_FLUSH_TIMEOUT_MS = 3_000;

type H264ProbeOutcome = 'drained' | 'stalled' | 'inconclusive';

function probeFrameSource(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof document !== 'undefined'
      ? Object.assign(document.createElement('canvas'), { width, height })
      : new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (context) {
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
  }
  return canvas;
}

/**
 * Encode one backpressure batch and report whether the encoder delivered
 * output and finished its flush in time.
 *
 * The batch is exactly what {@link createEncoder} queues before it flushes
 * (8 frames at 1080p, up to a second's worth at small sizes), so no flush
 * during the export has more frames pending than the probe did. That matters:
 * WebKit's High profile drains up to four pending frames and stalls from five.
 */
async function probeH264Drain(
  config: EncoderConfig,
  flushTimeoutMs: number,
): Promise<H264ProbeOutcome> {
  let outputs = 0;
  let errored = false;
  let encoder: VideoEncoder | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    encoder = new VideoEncoder({
      output: () => {
        outputs++;
      },
      error: () => {
        errored = true;
      },
    });
    encoder.configure(h264EncoderConfig(config));
    const source = probeFrameSource(config.width, config.height);
    const duration = frameDurationMicros(config.fps);
    const frames = resolveWebCodecsQueueLimit(config);
    for (let i = 0; i < frames; i++) {
      const frame = new VideoFrame(source, { timestamp: i * duration, duration });
      try {
        encoder.encode(frame, { keyFrame: i === 0 });
      } finally {
        frame.close();
      }
    }
  } catch {
    // The probe could not even submit frames (an unexpected frame source
    // restriction, say). That says nothing about the export's own frames.
    if (encoder && encoder.state !== 'closed') encoder.close();
    return 'inconclusive';
  }
  try {
    const flushed = await Promise.race([
      encoder.flush().then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), flushTimeoutMs);
      }),
    ]);
    return flushed && outputs > 0 && !errored ? 'drained' : 'stalled';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Closing also abandons a flush that never settled.
    if (encoder.state !== 'closed') encoder.close();
  }
}

/**
 * Choose an H.264 profile that WebCodecs can actually encode with, or null
 * when there is none.
 *
 * WebKit (Safari, and every iOS WebView) reports High profile as supported,
 * but once five frames are pending it stops emitting chunks and never
 * settles `flush()`, so an export stalled at its first flush. Realtime
 * latency mode avoids that in macOS WebKit but not in iOS WebKit, while
 * Baseline drains in both. Rather than sniff the user agent, encode one
 * export-sized batch with High and fall back to Baseline only when that
 * stalls, so browsers that drain High keep its better compression.
 */
export async function probeWebCodecsH264(
  config: EncoderConfig,
  options: { flushTimeoutMs?: number } = {},
): Promise<WebCodecsH264Support | null> {
  const flushTimeoutMs = options.flushTimeoutMs ?? H264_PROBE_FLUSH_TIMEOUT_MS;
  for (const profile of ['high', 'baseline'] as const) {
    const candidate: EncoderConfig = { ...config, h264Profile: profile };
    if (!(await supportsWebCodecsH264(candidate))) continue;
    // An inconclusive probe keeps the profile, as before this probe existed.
    if ((await probeH264Drain(candidate, flushTimeoutMs)) !== 'stalled') return { profile };
  }
  return null;
}

const RECLAIMED_CODEC_ERROR = /codec reclaimed due to inactivity/i;
const MAX_CODEC_RECOVERY_ATTEMPTS = 2;

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}

function isReclaimedCodecError(error: Error): boolean {
  return RECLAIMED_CODEC_ERROR.test(error.message);
}

function copyBytes(source: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice()
    : new Uint8Array(source).slice();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
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
    ...(config.spillOutputToBlob
      ? { spillToBlobThresholdBytes: DEFAULT_MP4_SPILL_THRESHOLD_BYTES }
      : {}),
  });

  /** Closed by the caller or finalized: nothing more may be encoded. */
  let disposed = false;
  /**
   * First fatal codec failure, reported by the encoder's async error callback
   * or thrown by one of its methods.
   *
   * `VideoEncoder` surfaces failures out-of-band, so this must be latched and
   * re-thrown from the next caller-facing operation. Previously it was only
   * logged: a failed encode either resurfaced later as an opaque
   * `InvalidStateError` from `encode()`/`flush()`, or — when the encoder dropped
   * frames without entering a closed state — never surfaced at all, and the
   * export reported "Export complete" over a truncated MP4.
   *
   * {@link MainThreadEncoder.restartCodec} clears it: the caller has decided
   * the codec was interrupted, and a replacement continues the same MP4.
   */
  let failure: Error | null = null;
  /** The MP4 itself cannot continue. Unlike {@link failure}, never cleared. */
  let muxError: Error | null = null;
  /**
   * Chromium may reclaim an idle hardware codec while a tab is hidden. Unlike
   * other encoder errors, this is recoverable without replacing the muxer or
   * discarding chunks that have already been written to it.
   */
  let recoverableError: Error | null = null;
  const frameDuration = 1_000_000 / config.fps; // microseconds per frame
  // Chromium 151+ leaves `EncodedVideoChunk.duration` null unless the frame
  // carried one, and the muxer rejects a chunk without a duration.
  const frameDurationRounded = frameDurationMicros(config.fps);
  const queueLimit = resolveWebCodecsQueueLimit(config);
  let framesSinceFlush = 0;
  let forceNextKeyFrame = false;
  /** Frames [0, nextFrameToMux) are in the MP4. */
  let nextFrameToMux = 0;
  /** One past the highest frame index handed to a codec. */
  let nextFrameToSubmit = 0;
  /**
   * The first codec's `avcC`. A replacement codec continues the same track, so
   * its stream must decode with the parameter sets already in the MP4.
   */
  let decoderDescription: Uint8Array | null = null;
  let encoderGeneration = 0;
  let encoder: VideoEncoder;

  /** Tear the codec down and surface the latched (or supplied) failure. */
  function fail(err: Error): Error {
    failure ??= err;
    closeCodec(encoder);
    return muxError ?? failure;
  }

  function closeCodec(codec: VideoEncoder): void {
    if (codec.state !== 'closed') codec.close();
  }

  /** Throw when no further work may be submitted. */
  function assertUsable(): void {
    if (muxError || failure) throw fail(muxError ?? failure ?? new Error('Encoder failed'));
    if (disposed) throw new Error('Encoder already closed');
  }

  const videoEncoderConfig = h264EncoderConfig(config);

  function createConfiguredVideoEncoder(generation: number): VideoEncoder {
    const nextEncoder = new VideoEncoder({
      output(chunk, meta) {
        if (disposed || generation !== encoderGeneration || failure || muxError) return;
        const description = meta?.decoderConfig?.description;
        if (description !== undefined) {
          const bytes = copyBytes(description);
          if (decoderDescription === null) {
            decoderDescription = bytes;
          } else if (!sameBytes(decoderDescription, bytes)) {
            muxError = new Error(
              'Video encoding could not resume: the restarted encoder produced an incompatible H.264 stream.',
            );
            return;
          }
        }
        try {
          muxer.addVideoChunk(chunk, meta ?? undefined);
        } catch (caught: unknown) {
          // Thrown from a browser callback, this would vanish as an uncaught
          // error, and finalize() would later fail on an empty track with an
          // unrelated message. Latch it so the export reports the cause.
          muxError = new Error(`MP4 muxing failed: ${toError(caught).message}`);
          return;
        }
        // H.264 from WebCodecs carries no B-frames, so chunks arrive in frame
        // order and the latest timestamp marks everything before it as muxed.
        if (Number.isFinite(chunk.timestamp)) {
          nextFrameToMux = Math.max(
            nextFrameToMux,
            Math.round(chunk.timestamp / frameDuration) + 1,
          );
        }
      },
      error(err) {
        if (disposed || generation !== encoderGeneration) return;
        if (failure || muxError || recoverableError) return;
        const wrapped = new Error(`WebCodecs encoder error: ${err.message}`);
        if (isReclaimedCodecError(wrapped)) {
          recoverableError = wrapped;
        } else {
          failure = wrapped;
        }
      },
    });
    nextEncoder.configure(videoEncoderConfig);
    return nextEncoder;
  }

  /**
   * Swap in a fresh codec. Bumping the generation first silences every
   * callback and settles every pending operation of the abandoned one.
   */
  function replaceCodec(): void {
    const previous = encoder;
    const generation = ++encoderGeneration;
    recoverableError = null;
    closeCodec(previous);
    encoder = createConfiguredVideoEncoder(generation);
    framesSinceFlush = 0;
    // A replacement H.264 encoder has no reference frames from its
    // predecessor. Start its segment with an independently decodable frame.
    forceNextKeyFrame = true;
  }

  /**
   * Replace a codec the browser reclaimed. A submitted frame that never
   * reached the MP4 is lost with it and has to be submitted again — unless it
   * is the frame the caller is about to resubmit anyway (`resubmitFrom`).
   */
  function recoverReclaimedCodec(resubmitFrom = Number.POSITIVE_INFINITY): void {
    replaceCodec();
    if (nextFrameToMux < Math.min(nextFrameToSubmit, resubmitFrom)) {
      nextFrameToSubmit = nextFrameToMux;
      throw new VideoEncodingInterruptedError(nextFrameToMux);
    }
  }

  encoder = createConfiguredVideoEncoder(encoderGeneration);

  /** Flush the codec until every submitted frame is in the MP4. */
  async function drainCodec(): Promise<void> {
    let recoveryAttempts = 0;
    while (true) {
      assertUsable();
      if (recoverableError) {
        if (recoveryAttempts >= MAX_CODEC_RECOVERY_ATTEMPTS) throw fail(recoverableError);
        recoveryAttempts++;
        recoverReclaimedCodec();
      }
      const generation = encoderGeneration;
      try {
        await encoder.flush();
      } catch (caught: unknown) {
        // restartCodec() abandoned this codec while it was flushing.
        if (generation !== encoderGeneration) {
          throw new VideoEncodingInterruptedError(nextFrameToMux);
        }
        const error = toError(caught);
        if (!recoverableError && isReclaimedCodecError(error)) {
          recoverableError = error;
        }
        // `flush()` commonly rejects with a generic InvalidStateError after
        // the error callback reported the recoverable inactivity cause.
        if (recoverableError && recoveryAttempts < MAX_CODEC_RECOVERY_ATTEMPTS) continue;
        throw fail(failure ?? recoverableError ?? error);
      }
      if (generation !== encoderGeneration) {
        throw new VideoEncodingInterruptedError(nextFrameToMux);
      }
      // Either callback can fire while in-flight frames drain.
      if (muxError || failure) throw fail(muxError ?? failure ?? new Error('Encoder failed'));
      if (recoverableError) continue;
      framesSinceFlush = 0;
      return;
    }
  }

  async function finishVideoEncoding(): Promise<void> {
    if (disposed) throw new Error('Encoder already closed');
    await drainCodec();
    closeCodec(encoder);
    disposed = true;
  }

  return {
    async encodeFrame(source: EncoderFrameSource, frameIndex: number): Promise<void> {
      try {
        let recoveryAttempts = 0;
        while (true) {
          assertUsable();
          if (recoverableError) {
            if (recoveryAttempts >= MAX_CODEC_RECOVERY_ATTEMPTS) {
              throw fail(recoverableError);
            }
            recoveryAttempts++;
            recoverReclaimedCodec(frameIndex);
          }

          const generation = encoderGeneration;
          try {
            // `encode()` is asynchronous and closing the VideoFrame does not
            // mean Chromium has released its pixels. A software encoder can
            // otherwise trail capture by hundreds of frames and eventually
            // force the renderer into memory-pressure thrashing.
            const drained = await applyWebCodecsBackpressure(encoder, queueLimit, framesSinceFlush);
            if (generation !== encoderGeneration) {
              throw new VideoEncodingInterruptedError(nextFrameToMux);
            }
            if (drained) framesSinceFlush = 0;
            if (recoverableError) continue;
            assertUsable();

            const timestamp = Math.round(frameIndex * frameDuration);
            const frame = new VideoFrame(source, { timestamp, duration: frameDurationRounded });
            try {
              const keyFrame = forceNextKeyFrame || frameIndex % 30 === 0;
              encoder.encode(frame, { keyFrame });
              framesSinceFlush++;
              forceNextKeyFrame = false;
              nextFrameToSubmit = frameIndex + 1;
            } finally {
              frame.close();
            }
            // A test double may report synchronously, and browsers may queue
            // the callback before this continuation. Retrying here keeps the
            // current raster available for the replacement codec.
            if (recoverableError) continue;
            return;
          } catch (caught: unknown) {
            if (caught instanceof VideoEncodingInterruptedError) throw caught;
            // restartCodec() abandoned this codec while it was flushing.
            if (generation !== encoderGeneration) {
              throw new VideoEncodingInterruptedError(nextFrameToMux);
            }
            const error = toError(caught);
            if (!recoverableError && isReclaimedCodecError(error)) {
              recoverableError = error;
            }
            if (recoverableError && recoveryAttempts < MAX_CODEC_RECOVERY_ATTEMPTS) continue;
            throw fail(failure ?? recoverableError ?? error);
          }
        }
      } catch (caught: unknown) {
        // An interruption leaves a working replacement codec behind.
        if (caught instanceof VideoEncodingInterruptedError) throw caught;
        throw fail(toError(caught));
      } finally {
        if ('close' in source) source.close();
      }
    },

    addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) {
      if (disposed || !muxer.hasAudioTrack) return;
      muxer.addAudioChunk(chunk, meta);
    },

    async drain(): Promise<void> {
      await drainCodec();
    },

    restartCodec(): number {
      if (muxError) throw muxError;
      if (disposed) throw new Error('Encoder already closed');
      failure = null;
      replaceCodec();
      // Whatever the abandoned codec held is gone; it is submitted again.
      nextFrameToSubmit = nextFrameToMux;
      return nextFrameToMux;
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
      if (disposed) return;
      disposed = true;
      closeCodec(encoder);
    },
  };
}

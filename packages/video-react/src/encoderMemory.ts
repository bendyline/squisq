/**
 * Memory bounds shared by the browser encoder implementations.
 *
 * `VideoEncoder.encode()` only queues work; closing the caller's `VideoFrame`
 * does not guarantee that Chromium has released the underlying pixels. Keep
 * that queue short enough that a slow/software encoder cannot turn a long
 * export into an ever-growing collection of full-resolution frames.
 */

/** Maximum estimated raw RGBA bytes waiting for WebCodecs. */
export const MAX_WEBCODECS_QUEUE_BYTES = 64 * 1024 * 1024;
/** Maximum timeline duration represented by queued WebCodecs frames. */
export const MAX_WEBCODECS_QUEUE_SECONDS = 1;

/** Maximum PNG bytes retained before the ffmpeg.wasm fallback encodes a batch. */
export const MAX_FFMPEG_FRAME_BATCH_BYTES = 64 * 1024 * 1024;
/** Maximum timeline duration represented by a fallback frame batch. */
export const MAX_FFMPEG_FRAME_BATCH_SECONDS = 6;

export interface FrameMemoryConfig {
  width: number;
  height: number;
  fps: number;
}

/**
 * Resolve a queue high-water mark from both time and estimated raw pixel size.
 * The limit is at least one frame so even unusually large valid dimensions can
 * make forward progress.
 */
export function resolveWebCodecsQueueLimit({ width, height, fps }: FrameMemoryConfig): number {
  const bytesPerFrame = Math.max(1, width * height * 4);
  const framesByBytes = Math.max(1, Math.floor(MAX_WEBCODECS_QUEUE_BYTES / bytesPerFrame));
  const framesByTime = Math.max(1, Math.ceil(fps * MAX_WEBCODECS_QUEUE_SECONDS));
  return Math.min(framesByBytes, framesByTime);
}

/** Drain a saturated WebCodecs queue before accepting another bitmap. */
export async function applyWebCodecsBackpressure(
  encoder: Pick<VideoEncoder, 'encodeQueueSize' | 'flush'>,
  queueLimit: number,
): Promise<boolean> {
  if (encoder.encodeQueueSize < queueLimit) return false;
  await encoder.flush();
  return true;
}

/** Whether the ffmpeg.wasm fallback should encode and release its PNG batch. */
export function shouldEncodeFfmpegBatch(
  frameCount: number,
  byteLength: number,
  fps: number,
): boolean {
  const framesByTime = Math.max(1, Math.ceil(fps * MAX_FFMPEG_FRAME_BATCH_SECONDS));
  return frameCount >= framesByTime || byteLength >= MAX_FFMPEG_FRAME_BATCH_BYTES;
}

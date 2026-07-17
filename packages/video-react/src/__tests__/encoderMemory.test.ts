import { describe, expect, it, vi } from 'vitest';

import {
  MAX_FFMPEG_FRAME_BATCH_BYTES,
  applyWebCodecsBackpressure,
  resolveWebCodecsQueueLimit,
  shouldEncodeFfmpegBatch,
} from '../encoderMemory.js';

describe('encoder memory bounds', () => {
  it('caps WebCodecs by one second at GIF resolution', () => {
    expect(resolveWebCodecsQueueLimit({ width: 960, height: 540, fps: 10 })).toBe(10);
  });

  it('uses the byte bound before one second at 1080p', () => {
    expect(resolveWebCodecsQueueLimit({ width: 1920, height: 1080, fps: 24 })).toBe(8);
  });

  it('flushes only after the WebCodecs high-water mark is reached', async () => {
    const flush = vi.fn(async () => undefined);

    await expect(applyWebCodecsBackpressure({ encodeQueueSize: 7, flush }, 8)).resolves.toBe(false);
    await expect(applyWebCodecsBackpressure({ encodeQueueSize: 8, flush }, 8)).resolves.toBe(true);
    expect(flush).toHaveBeenCalledOnce();
  });

  it('flushes retained native inputs even when the visible queue has drained', async () => {
    const flush = vi.fn(async () => undefined);

    await expect(applyWebCodecsBackpressure({ encodeQueueSize: 0, flush }, 10, 9)).resolves.toBe(
      false,
    );
    await expect(applyWebCodecsBackpressure({ encodeQueueSize: 0, flush }, 10, 10)).resolves.toBe(
      true,
    );
    expect(flush).toHaveBeenCalledOnce();
  });

  it('flushes fallback PNGs at six seconds or the byte limit', () => {
    expect(shouldEncodeFfmpegBatch(59, 1, 10)).toBe(false);
    expect(shouldEncodeFfmpegBatch(60, 1, 10)).toBe(true);
    expect(shouldEncodeFfmpegBatch(1, MAX_FFMPEG_FRAME_BATCH_BYTES - 1, 10)).toBe(false);
    expect(shouldEncodeFfmpegBatch(1, MAX_FFMPEG_FRAME_BATCH_BYTES, 10)).toBe(true);
  });
});

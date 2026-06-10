/**
 * Pure encoding-parameter helpers used by the encode worker.
 *
 * Kept separate from `encode.worker.ts` so they can be unit-tested directly —
 * importing the worker module wires up `self.onmessage` and pulls in the
 * WebCodecs / ffmpeg.wasm backends, none of which exist in a plain test runner.
 */

/**
 * Target H.264 bitrate (bits/sec) for a given quality at a given resolution.
 * Baseline is ~4 bits per pixel; `draft` halves it and `high` doubles it.
 */
export function bitrateForQuality(quality: string, width: number, height: number): number {
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

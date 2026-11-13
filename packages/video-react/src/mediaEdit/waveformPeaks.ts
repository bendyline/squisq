/**
 * Waveform peaks: the loudest sample in each fixed slice of a take, for
 * drawing it on a timeline. Streaming — blocks arrive as they decode, so a
 * long recording is never held as PCM.
 */

/** Slices per second. 10 ms resolves a word boundary at any useful zoom. */
export const WAVEFORM_PEAKS_PER_SEC = 100;

export interface PeakAccumulator {
  /** Add the next planar block (one Float32Array per channel). */
  push(block: readonly Float32Array[]): void;
  /** Peaks so far, one per slice, each 0…1. */
  finish(): Float32Array;
}

export function createPeakAccumulator(
  sampleRate: number,
  peaksPerSec = WAVEFORM_PEAKS_PER_SEC,
  expectedFrames = 0,
): PeakAccumulator {
  const framesPerPeak = sampleRate / peaksPerSec;
  let peaks = new Float32Array(Math.max(16, Math.ceil(expectedFrames / framesPerPeak)));
  let seen = 0;

  return {
    push(block) {
      const length = block[0]?.length ?? 0;
      if (length === 0) return;
      const last = Math.floor((seen + length - 1) / framesPerPeak);
      if (last >= peaks.length) {
        const grown = new Float32Array(Math.max(last + 1, peaks.length * 2));
        grown.set(peaks);
        peaks = grown;
      }
      for (const channel of block) {
        for (let i = 0; i < length; i++) {
          const magnitude = Math.abs(channel[i]);
          const slot = Math.floor((seen + i) / framesPerPeak);
          if (magnitude > peaks[slot]) peaks[slot] = magnitude;
        }
      }
      seen += length;
    },
    finish() {
      return peaks.slice(0, Math.ceil(seen / framesPerPeak));
    },
  };
}

/**
 * Live prompter trace: sparse `{ tMs, wordPos }` samples the UI records
 * while the reader records a take (~4 Hz plus one on every re-anchor).
 * The offline aligner uses it as a prior — a Sakoe-Chiba band around
 * the trace keeps the DTW honest and cheap.
 */

export interface TraceSample {
  tMs: number;
  wordPos: number;
}

export interface NarrationTrace {
  samples: TraceSample[];
}

/** Clamped linear interpolation of the trace at a time. */
export function traceWordPosAt(trace: NarrationTrace, tSec: number): number {
  const samples = trace.samples;
  if (samples.length === 0) return 0;
  const tMs = tSec * 1000;
  if (tMs <= samples[0].tMs) return samples[0].wordPos;
  const last = samples[samples.length - 1];
  if (tMs >= last.tMs) return last.wordPos;
  // Binary search: last sample with tMs <= target.
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].tMs <= tMs) lo = mid;
    else hi = mid - 1;
  }
  const a = samples[lo];
  const b = samples[lo + 1];
  const span = b.tMs - a.tMs;
  if (span <= 0) return a.wordPos;
  return a.wordPos + ((tMs - a.tMs) / span) * (b.wordPos - a.wordPos);
}

/** Downsample to at most `maxSamples`, always keeping both endpoints. */
export function downsampleTrace(trace: NarrationTrace, maxSamples: number): NarrationTrace {
  const samples = trace.samples;
  if (maxSamples < 2 || samples.length <= maxSamples) return { samples: samples.slice() };
  const out: TraceSample[] = [];
  const stride = (samples.length - 1) / (maxSamples - 1);
  for (let i = 0; i < maxSamples; i++) {
    out.push(samples[Math.round(i * stride)]);
  }
  return { samples: out };
}

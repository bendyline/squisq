/**
 * Integrated loudness per ITU-R BS.1770-4 (the measurement EBU R128 uses).
 *
 * Each channel is K-weighted (a +4 dB high shelf, then an RLB high-pass),
 * mean-square energy is taken over 400 ms blocks overlapping by 75 %, and
 * blocks are gated twice: absolutely at −70 LUFS, then relatively at 10 LU
 * below the absolute-gated loudness. Streaming: energy accumulates per 100 ms
 * step, so memory is ten numbers per second regardless of signal length.
 *
 * The K-weighting filters are derived per sample rate and reproduce the
 * standard's 48 kHz coefficients, so any sample rate measures correctly.
 */

import { createBiquadCascade, type BiquadCascade, type BiquadCoeffs } from './biquad.js';

/** Absolute gate, LUFS. */
const ABSOLUTE_GATE = -70;
/** Relative gate below the absolute-gated loudness, LU. */
const RELATIVE_GATE = -10;
/** Steps per gating block (400 ms block / 100 ms step). */
const STEPS_PER_BLOCK = 4;

/**
 * K-weighting as two biquads designed by bilinear transform at any rate
 * (the libebur128 derivation); at 48 kHz this reproduces the coefficients
 * tabulated in BS.1770-4 exactly.
 */
function kWeightingCoeffs(sampleRate: number): [BiquadCoeffs, BiquadCoeffs] {
  // Stage 1: pre-filter (head acoustics), a high shelf.
  let f0 = 1681.974450955533;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = Math.pow(10, 3.999843853973347 / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1 + k / q + k * k;
  const shelf: BiquadCoeffs = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  // Stage 2: RLB weighting, a high-pass with an unnormalized [1, -2, 1] numerator.
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + k / q + k * k;
  const rlb: BiquadCoeffs = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  return [shelf, rlb];
}

function kWeighting(sampleRate: number): BiquadCascade {
  return createBiquadCascade(kWeightingCoeffs(sampleRate));
}

function blockLoudness(meanSquareSum: number): number {
  return meanSquareSum > 0 ? -0.691 + 10 * Math.log10(meanSquareSum) : Number.NEGATIVE_INFINITY;
}

export interface LoudnessMeter {
  /** Feed one block of per-channel samples (equal lengths). */
  push(channels: readonly Float32Array[]): void;
  /**
   * Per-100 ms-step mean-square sums across channels (K-weighted), for
   * callers that re-weight steps (e.g. to predict the effect of a gain
   * envelope without re-running the signal). Complete steps only.
   */
  stepPowers(): readonly number[];
  /** Integrated loudness in LUFS so far; −Infinity for silence or too-short input. */
  integrated(): number;
}

export function createLoudnessMeter(sampleRate: number, channelCount: number): LoudnessMeter {
  const filters = Array.from({ length: channelCount }, () => kWeighting(sampleRate));
  const stepSamples = Math.round(sampleRate / 10);
  const steps: number[] = [];
  let stepSum = 0;
  let stepFill = 0;
  let scratch = new Float32Array(0);

  return {
    push(channels) {
      const length = channels[0]?.length ?? 0;
      if (length === 0) return;
      if (scratch.length < length * channelCount) scratch = new Float32Array(length * channelCount);
      const weighted: Float32Array[] = [];
      for (let c = 0; c < channelCount; c++) {
        const view = scratch.subarray(c * length, (c + 1) * length);
        view.set(channels[c] ?? channels[0]);
        filters[c].process(view);
        weighted.push(view);
      }
      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (let c = 0; c < channelCount; c++) sum += weighted[c][i] * weighted[c][i];
        stepSum += sum;
        stepFill++;
        if (stepFill === stepSamples) {
          steps.push(stepSum / stepSamples);
          stepSum = 0;
          stepFill = 0;
        }
      }
    },
    stepPowers: () => steps,
    integrated: () => integratedLoudnessFromSteps(steps),
  };
}

/**
 * Gated integrated loudness from per-100 ms-step mean-square sums (as
 * {@link LoudnessMeter.stepPowers} produces). Exposed so a caller can rescale
 * steps — e.g. by a gain envelope's mean square per step — and re-measure.
 */
export function integratedLoudnessFromSteps(steps: readonly number[]): number {
  const blocks: number[] = [];
  for (let i = 0; i + STEPS_PER_BLOCK <= steps.length; i++) {
    let sum = 0;
    for (let k = 0; k < STEPS_PER_BLOCK; k++) sum += steps[i + k];
    blocks.push(sum / STEPS_PER_BLOCK);
  }
  const absolute = blocks.filter((z) => blockLoudness(z) > ABSOLUTE_GATE);
  if (absolute.length === 0) return Number.NEGATIVE_INFINITY;
  const absoluteMean = absolute.reduce((a, b) => a + b, 0) / absolute.length;
  const threshold = blockLoudness(absoluteMean) + RELATIVE_GATE;
  const relative = absolute.filter((z) => blockLoudness(z) > threshold);
  if (relative.length === 0) return Number.NEGATIVE_INFINITY;
  return blockLoudness(relative.reduce((a, b) => a + b, 0) / relative.length);
}

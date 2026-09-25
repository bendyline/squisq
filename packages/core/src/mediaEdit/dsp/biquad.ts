/**
 * RBJ biquad filters (Audio-EQ-Cookbook closed forms), streaming.
 *
 * Shared by the narration feature extractor (speech-band energy) and the
 * media-edit signal chain (high-pass, breath features, K-weighting). State
 * is explicit so a filter can run block by block with no boundary artifacts.
 */

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface BiquadState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

/** Butterworth Q. */
export const BUTTERWORTH_Q = Math.SQRT1_2;

export function createBiquadState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

function omega(sampleRate: number, freqHz: number): { cosW0: number; sinW0: number } {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  return { cosW0: Math.cos(w0), sinW0: Math.sin(w0) };
}

export function highpassCoeffs(
  sampleRate: number,
  freqHz: number,
  q = BUTTERWORTH_Q,
): BiquadCoeffs {
  const { cosW0, sinW0 } = omega(sampleRate, freqHz);
  const alpha = sinW0 / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosW0) / 2 / a0,
    b1: -(1 + cosW0) / a0,
    b2: (1 + cosW0) / 2 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function lowpassCoeffs(sampleRate: number, freqHz: number, q = BUTTERWORTH_Q): BiquadCoeffs {
  const { cosW0, sinW0 } = omega(sampleRate, freqHz);
  const alpha = sinW0 / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosW0) / 2 / a0,
    b1: (1 - cosW0) / a0,
    b2: (1 - cosW0) / 2 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * Filter `input` into `output` (which may alias `input`). Returns the new
 * state; the passed state is not mutated.
 */
export function biquadRun(
  coeffs: BiquadCoeffs,
  state: BiquadState,
  input: Float32Array,
  output: Float32Array,
): BiquadState {
  let { x1, x2, y1, y2 } = state;
  const { b0, b1, b2, a1, a2 } = coeffs;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return { x1, x2, y1, y2 };
}

/** A stateful filter cascade for one channel; `process` filters in place. */
export interface BiquadCascade {
  process(block: Float32Array): void;
}

export function createBiquadCascade(stages: readonly BiquadCoeffs[]): BiquadCascade {
  const states = stages.map(() => createBiquadState());
  return {
    process(block) {
      for (let s = 0; s < stages.length; s++) {
        states[s] = biquadRun(stages[s], states[s], block, block);
      }
    },
  };
}

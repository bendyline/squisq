/**
 * Frame feature extraction: full-band RMS, speech-band energy, and
 * zero-crossing rate over hopped (possibly overlapping) frames.
 *
 * Band energy uses two cascaded RBJ biquads — a high-pass at
 * `bandLowHz` and a low-pass at `bandHighHz` (both Q = 1/√2,
 * Audio-EQ-Cookbook closed forms) — rather than an FFT or Goertzel
 * bins: a Butterworth-ish cascade gives a true maximally-flat band in
 * one O(N) pass, and the filter state persists across hops, which is
 * exactly right for streaming (no window-boundary energy jitter).
 * Goertzel measures single frequencies (DTMF-style) — wrong tool for
 * broadband speech energy.
 */

import type { FeatureConfig, FrameFeatures } from './types.js';
import { DEFAULT_FEATURE_CONFIG } from './types.js';

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface BiquadState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface BandpassState {
  coeffs: { hp: BiquadCoeffs; lp: BiquadCoeffs };
  hp: BiquadState;
  lp: BiquadState;
}

function highpassCoeffs(sampleRate: number, freqHz: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  // alpha = sin(w0) / (2Q) with Butterworth Q = 1/√2.
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosW0) / 2 / a0,
    b1: -(1 + cosW0) / a0,
    b2: (1 + cosW0) / 2 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

function lowpassCoeffs(sampleRate: number, freqHz: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosW0) / 2 / a0,
    b1: (1 - cosW0) / a0,
    b2: (1 - cosW0) / 2 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Create bandpass state for a sample rate (corners derived at init). */
export function createBandpass(
  sampleRate: number,
  lowHz = DEFAULT_FEATURE_CONFIG.bandLowHz,
  highHz = DEFAULT_FEATURE_CONFIG.bandHighHz,
): BandpassState {
  return {
    coeffs: { hp: highpassCoeffs(sampleRate, lowHz), lp: lowpassCoeffs(sampleRate, highHz) },
    hp: { x1: 0, x2: 0, y1: 0, y2: 0 },
    lp: { x1: 0, x2: 0, y1: 0, y2: 0 },
  };
}

function biquadRun(
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

/**
 * Run the bandpass over a chunk. Pure in the state: returns a NEW state,
 * writes filtered samples into `output` (may alias `input`).
 */
export function bandpassRun(
  state: BandpassState,
  input: Float32Array,
  output: Float32Array,
): BandpassState {
  const hp = biquadRun(state.coeffs.hp, state.hp, input, output);
  const lp = biquadRun(state.coeffs.lp, state.lp, output, output);
  return { coeffs: state.coeffs, hp, lp };
}

export interface FeatureState {
  sampleRate: number;
  config: FeatureConfig;
  /** Hop between frame starts, in samples. */
  hopSamples: number;
  bandpass: BandpassState;
  /** Unconsumed raw samples (the next frame's prefix). */
  rawCarry: Float32Array;
  /** Bandpassed twin of `rawCarry`. */
  bandCarry: Float32Array;
  /** Absolute sample index of `rawCarry[0]` from the start of the signal. */
  carryStartSample: number;
}

export function createFeatureState(
  sampleRate: number,
  config?: Partial<FeatureConfig>,
): FeatureState {
  const merged: FeatureConfig = { ...DEFAULT_FEATURE_CONFIG, ...config };
  return {
    sampleRate,
    config: merged,
    hopSamples: Math.max(1, Math.round(merged.hopSec * sampleRate)),
    bandpass: createBandpass(sampleRate, merged.bandLowHz, merged.bandHighHz),
    rawCarry: new Float32Array(0),
    bandCarry: new Float32Array(0),
    carryStartSample: 0,
  };
}

function concatF32(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function frameOf(
  raw: Float32Array,
  band: Float32Array,
  start: number,
  size: number,
  startSample: number,
  sampleRate: number,
): FrameFeatures {
  let sumSq = 0;
  let bandSumSq = 0;
  let crossings = 0;
  let prev = raw[start];
  for (let i = 0; i < size; i++) {
    const r = raw[start + i];
    const b = band[start + i];
    sumSq += r * r;
    bandSumSq += b * b;
    if (i > 0 && ((r >= 0 && prev < 0) || (r < 0 && prev >= 0))) crossings++;
    prev = r;
  }
  return {
    tSec: (startSample + size / 2) / sampleRate,
    rms: Math.sqrt(sumSq / size),
    bandEnergy: bandSumSq / size,
    zcr: size > 1 ? crossings / (size - 1) : 0,
  };
}

/**
 * Feed a hop of PCM. Returns a new state plus every complete frame the
 * buffered signal now covers (usually 0–1 for worklet-sized hops, more
 * for large chunks).
 */
export function featureStep(
  state: FeatureState,
  hop: Float32Array,
): { state: FeatureState; frames: FrameFeatures[] } {
  const banded = new Float32Array(hop.length);
  const bandpass = bandpassRun(state.bandpass, hop, banded);

  const raw = concatF32(state.rawCarry, hop);
  const band = concatF32(state.bandCarry, banded);
  const { frameSize } = state.config;
  const frames: FrameFeatures[] = [];

  let cursor = 0;
  while (raw.length - cursor >= frameSize) {
    frames.push(
      frameOf(raw, band, cursor, frameSize, state.carryStartSample + cursor, state.sampleRate),
    );
    cursor += state.hopSamples;
  }

  return {
    state: {
      ...state,
      bandpass,
      // slice(), not subarray(): the carry must OWN its memory. `raw` can
      // alias the caller's hop buffer, and callers may recycle those
      // (e.g. Chrome invalidates buffers transferred out of an
      // AudioWorklet after the message handler returns) — a retained
      // view would silently read zeros on the next step.
      rawCarry: raw.slice(cursor),
      bandCarry: band.slice(cursor),
      carryStartSample: state.carryStartSample + cursor,
    },
    frames,
  };
}

/** Batch feature extraction over a whole take (the aligner's entry point). */
export function extractFrameFeatures(
  pcm: Float32Array,
  sampleRate: number,
  config?: Partial<FeatureConfig>,
): FrameFeatures[] {
  const state = createFeatureState(sampleRate, config);
  return featureStep(state, pcm).frames;
}

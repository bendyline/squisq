/**
 * Breath detection for spoken-word recordings.
 *
 * A breath is unvoiced, noise-like energy that sits in a pause: quieter than
 * speech, louder than the room, lasting roughly 0.12–1 s, and — unlike an
 * unvoiced consonant (s, f, sh, h) — not wedged tightly between voiced frames.
 * Detection runs on 10 ms frames:
 *
 * - `rmsDb`     full-band level.
 * - `voicing`   peak normalized autocorrelation in the 70–400 Hz pitch range,
 *               on a low-passed, decimated copy (cheap enough for long takes).
 * - `zcr`       zero-crossing rate; sibilants cross far more often than breaths.
 *
 * Levels are relative to the take itself (a speech level from voiced frames
 * and a noise floor from the quietest frames), so the detector adapts to mic
 * gain. The result is attenuation regions — the chain turns them into a gain
 * envelope and never deletes audio, so timing is untouched.
 */

import {
  createBiquadCascade,
  highpassCoeffs,
  lowpassCoeffs,
  type BiquadCascade,
} from './biquad.js';

export interface BreathFrame {
  /** Frame center, seconds. */
  t: number;
  rmsDb: number;
  /** 0 (noise) … 1 (strongly periodic). */
  voicing: number;
  zcr: number;
}

export interface BreathRegion {
  start: number;
  end: number;
}

const HOP_SEC = 0.01;
const FRAME_SEC = 0.02;
const PITCH_WINDOW_SEC = 0.04;
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 400;
const DECIMATED_RATE = 6000;
const SILENT_DB = -120;

export interface BreathAnalyzer {
  /** Feed mono samples (any block size). */
  push(mono: Float32Array): void;
  /** Frames analyzed so far. */
  frames(): BreathFrame[];
}

export function createBreathAnalyzer(sampleRate: number): BreathAnalyzer {
  const hop = Math.round(HOP_SEC * sampleRate);
  const frameLen = Math.round(FRAME_SEC * sampleRate);
  const decimation = Math.max(1, Math.round(sampleRate / DECIMATED_RATE));
  const lowRate = sampleRate / decimation;
  const pitchLen = Math.round(PITCH_WINDOW_SEC * lowRate);
  const minLag = Math.max(1, Math.floor(lowRate / PITCH_MAX_HZ));
  const maxLag = Math.min(pitchLen - 1, Math.ceil(lowRate / PITCH_MIN_HZ));
  // Level and zero crossings ignore DC and rumble (a cheap mic's offset would
  // otherwise raise the floor and pin the crossing rate at zero).
  const levelBand: BiquadCascade = createBiquadCascade([highpassCoeffs(sampleRate, 60)]);
  // Pitch band only: DC offset or rumble would read as perfect periodicity at
  // every lag, and anything above ~900 Hz would alias after decimation.
  const pitchBand: BiquadCascade = createBiquadCascade([
    highpassCoeffs(sampleRate, 60),
    lowpassCoeffs(sampleRate, 900),
    lowpassCoeffs(sampleRate, 900),
  ]);

  // Rolling buffers: full-rate samples for rms/zcr, decimated for voicing.
  const keepFull = frameLen + hop;
  let full = new Float32Array(0);
  let fullStart = 0; // absolute index of full[0]
  let low: number[] = [];
  let lowStart = 0; // absolute (decimated) index of low[0]
  let decimPhase = 0;
  let nextFrameStart = 0; // absolute full-rate index of the next frame's start
  const out: BreathFrame[] = [];
  const window = new Float64Array(pitchLen);

  const voicingAt = (centerLow: number): number => {
    const begin = Math.round(centerLow - pitchLen / 2) - lowStart;
    if (begin < 0 || begin + pitchLen > low.length) return 0;
    let mean = 0;
    for (let i = 0; i < pitchLen; i++) mean += low[begin + i];
    mean /= pitchLen;
    for (let i = 0; i < pitchLen; i++) window[i] = low[begin + i] - mean;
    let energy = 0;
    for (let i = 0; i < pitchLen; i++) energy += window[i] * window[i];
    if (energy <= 1e-12) return 0;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let acc = 0;
      let e1 = 0;
      let e2 = 0;
      for (let i = 0; i + lag < pitchLen; i++) {
        const a = window[i];
        const b = window[i + lag];
        acc += a * b;
        e1 += a * a;
        e2 += b * b;
      }
      const norm = Math.sqrt(e1 * e2);
      if (norm > 0 && acc / norm > best) best = acc / norm;
    }
    return best;
  };

  return {
    push(mono) {
      // Decimated path.
      const filtered = mono.slice();
      pitchBand.process(filtered);
      for (let i = 0; i < filtered.length; i++) {
        if (decimPhase === 0) low.push(filtered[i]);
        decimPhase = (decimPhase + 1) % decimation;
      }
      // Full-rate path.
      const leveled = mono.slice();
      levelBand.process(leveled);
      const merged = new Float32Array(full.length + leveled.length);
      merged.set(full, 0);
      merged.set(leveled, full.length);
      full = merged;

      // Emit every frame whose pitch window is fully available.
      const lowEnd = lowStart + low.length;
      while (nextFrameStart + frameLen <= fullStart + full.length) {
        const centerFull = nextFrameStart + frameLen / 2;
        const centerLow = centerFull / decimation;
        if (centerLow + pitchLen / 2 > lowEnd) break;
        const s = nextFrameStart - fullStart;
        let sumSq = 0;
        let crossings = 0;
        for (let i = 0; i < frameLen; i++) {
          const v = full[s + i];
          sumSq += v * v;
          if (i > 0 && v >= 0 !== full[s + i - 1] >= 0) crossings++;
        }
        const rms = Math.sqrt(sumSq / frameLen);
        out.push({
          t: centerFull / sampleRate,
          rmsDb: rms > 0 ? 20 * Math.log10(rms) : SILENT_DB,
          voicing: voicingAt(centerLow),
          zcr: crossings / (frameLen - 1),
        });
        nextFrameStart += hop;
      }

      // Trim consumed history.
      const dropFull = Math.max(0, nextFrameStart - fullStart - keepFull);
      if (dropFull > 0) {
        full = full.slice(dropFull);
        fullStart += dropFull;
      }
      const neededLow = Math.floor(nextFrameStart / decimation - pitchLen) - lowStart;
      if (neededLow > 0) {
        low = low.slice(neededLow);
        lowStart += neededLow;
      }
    },
    frames: () => out,
  };
}

export interface BreathDetectOptions {
  /** 0 (only obvious breaths) … 1 (aggressive). Default 0.5. */
  sensitivity?: number;
  /** Shortest breath, seconds. Default 0.12. */
  minDurationSec?: number;
  /** Longest breath, seconds. Default 1.0. */
  maxDurationSec?: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return SILENT_DB;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/** Find breath regions in analyzed frames. */
export function detectBreaths(
  frames: readonly BreathFrame[],
  options: BreathDetectOptions = {},
): BreathRegion[] {
  if (frames.length === 0) return [];
  const sensitivity = Math.min(1, Math.max(0, options.sensitivity ?? 0.5));
  const minDur = options.minDurationSec ?? 0.12;
  const maxDur = options.maxDurationSec ?? 1.0;

  const voicedThreshold = 0.6;
  const levels = frames.map((f) => f.rmsDb);
  const floor = percentile(levels, 0.1);
  const voicedLevels = frames.filter((f) => f.voicing >= voicedThreshold).map((f) => f.rmsDb);
  const speech = percentile(voicedLevels.length > 0 ? voicedLevels : levels, 0.9);
  if (speech - floor < 12) return []; // No usable dynamic range: no speech/pause contrast.

  // Sensitivity widens the level window and relaxes the voicing gate.
  const aboveFloor = 6 - 3 * sensitivity;
  const belowSpeech = 10 - 6 * sensitivity;
  const maxVoicing = 0.35 + 0.15 * sensitivity;
  const maxZcr = 0.2 + 0.05 * sensitivity;

  const isCandidate = (f: BreathFrame) =>
    f.voicing < maxVoicing &&
    f.rmsDb > floor + aboveFloor &&
    f.rmsDb < speech - belowSpeech &&
    f.zcr < maxZcr;
  const isVoiced = (f: BreathFrame) => f.voicing >= voicedThreshold && f.rmsDb > floor + 10;

  // Group candidate frames into runs, bridging one-frame gaps.
  const runs: Array<{ first: number; last: number }> = [];
  let current: { first: number; last: number } | null = null;
  for (let i = 0; i < frames.length; i++) {
    if (isCandidate(frames[i])) {
      if (current && i - current.last <= 2) current.last = i;
      else {
        current = { first: i, last: i };
        runs.push(current);
      }
    }
  }

  const contextFrames = Math.round(0.06 / HOP_SEC);
  const voicedNear = (from: number, to: number) => {
    for (let i = Math.max(0, from); i <= Math.min(frames.length - 1, to); i++) {
      if (isVoiced(frames[i])) return true;
    }
    return false;
  };

  const regions: BreathRegion[] = [];
  for (const run of runs) {
    const start = frames[run.first].t - HOP_SEC / 2;
    const end = frames[run.last].t + HOP_SEC / 2;
    const duration = end - start;
    if (duration < minDur || duration > maxDur) continue;
    // Wedged between voiced frames on both sides and short: an unvoiced consonant.
    const voicedBefore = voicedNear(run.first - contextFrames, run.first - 1);
    const voicedAfter = voicedNear(run.last + 1, run.last + contextFrames);
    if (voicedBefore && voicedAfter && duration < 0.25) continue;
    regions.push({ start, end });
  }
  return regions;
}

/**
 * Gain at time `t` for attenuating `regions` by `reductionDb` (≤ 0), ramping
 * over `rampSec` INSIDE each region so surrounding speech is never touched.
 */
export function breathGainAt(
  regions: readonly BreathRegion[],
  reductionDb: number,
  t: number,
  rampSec = 0.015,
): number {
  const floorGain = Math.pow(10, Math.min(0, reductionDb) / 20);
  for (const r of regions) {
    if (t < r.start || t >= r.end) continue;
    const ramp = Math.min(rampSec, (r.end - r.start) / 2);
    const edge = Math.min(t - r.start, r.end - t);
    const depth = ramp > 0 ? Math.min(1, edge / ramp) : 1;
    return 1 - (1 - floorGain) * depth;
  }
  return 1;
}

/** Multiply a block starting at `startSec` by the breath envelope, in place. */
export function applyBreathEnvelope(
  channels: readonly Float32Array[],
  sampleRate: number,
  startSec: number,
  regions: readonly BreathRegion[],
  reductionDb: number,
): void {
  const length = channels[0]?.length ?? 0;
  if (length === 0 || regions.length === 0) return;
  const endSec = startSec + length / sampleRate;
  const touching = regions.filter((r) => r.end > startSec && r.start < endSec);
  if (touching.length === 0) return;
  for (let i = 0; i < length; i++) {
    const g = breathGainAt(touching, reductionDb, startSec + i / sampleRate);
    if (g === 1) continue;
    for (const ch of channels) ch[i] *= g;
  }
}

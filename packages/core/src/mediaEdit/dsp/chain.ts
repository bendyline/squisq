/**
 * The media-edit signal chain: high-pass → denoise → de-breath → loudness
 * (+ true-peak limiter), in that fixed order.
 *
 * Two passes over the source, so memory stays bounded for long takes:
 *
 * 1. **Analyze** — run high-pass + denoise, collect breath features and
 *    K-weighted loudness per 100 ms step. Breaths are detected over the whole
 *    take (levels are relative to it), and the loudness the output WILL have
 *    after breath attenuation is predicted by re-weighting each step by the
 *    envelope's mean square, so no second analysis pass is needed.
 * 2. **Render** — run high-pass + denoise again (deterministic), apply the
 *    breath envelope and the loudness gain, limit, write.
 *
 * Every stage's latency is compensated: output sample n is source sample n,
 * and the output is exactly as long as the input. That is the render
 * contract (renders are sample-aligned with the source), and it is what lets
 * cuts and trims apply identically to picture and processed sound.
 *
 * Pure: the source, the denoiser, and the sink are injected.
 */

import type { MediaFxChain, MediaFxOpId } from '../recipe.js';
import { createBiquadCascade, highpassCoeffs, type BiquadCascade } from './biquad.js';
import {
  applyBreathEnvelope,
  breathGainAt,
  createBreathAnalyzer,
  detectBreaths,
  type BreathRegion,
} from './breath.js';
import { createDenoiseStage, type DenoiseStage, type DenoiserFactory } from './denoiser.js';
import { createLimiter } from './limiter.js';
import { createLoudnessMeter, integratedLoudnessFromSteps } from './loudness.js';

/** The rate the chain runs at (RNNoise's native rate). Sources are resampled to it. */
export const MEDIA_FX_SAMPLE_RATE = 48_000;
/** Engine identifier recorded in render manifests. */
export const MEDIA_FX_ENGINE = 'squisq-media-edit/1';
/** Loudness-stage gain is clamped to this range (dB). */
const LOUDNESS_GAIN_RANGE = { min: -20, max: 24 };
/** True-peak ceiling after the loudness stage, dBTP. */
export const MEDIA_FX_TRUE_PEAK_CEILING_DB = -1;

export interface MediaFxSource {
  /** Must equal {@link MEDIA_FX_SAMPLE_RATE}; the engine resamples first. */
  sampleRate: number;
  channels: number;
  /** A fresh stream of the whole source, as per-channel blocks. Called once per pass. */
  open(): AsyncIterable<Float32Array[]>;
  /** Total frames, when known (for progress). */
  frames?: number;
}

export interface MediaFxAnalysis {
  /** Integrated loudness entering the loudness stage (after breath attenuation), LUFS. */
  integratedLufs: number | null;
  /** Gain the loudness stage applies, dB. */
  loudnessGainDb: number;
  /** Breath regions in take seconds. */
  breaths: BreathRegion[];
}

export interface MediaFxOptions {
  fx: MediaFxChain;
  source: MediaFxSource;
  /** Required for `denoise`; without it the op is skipped and reported in `ignoredOps`. */
  denoiser?: DenoiserFactory;
  /** Take time (s) of the source's first sample — nonzero for region previews. */
  startSec?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface MediaFxRenderOptions extends MediaFxOptions {
  write: (block: Float32Array[]) => void | Promise<void>;
  /** Whole-take analysis to reuse (region previews); skips the analysis pass. */
  analysis?: MediaFxAnalysis;
}

export interface MediaFxRenderResult {
  analysis: MediaFxAnalysis;
  /** Frames written (always the source length). */
  frames: number;
  /** Recipe tokens not applied (unknown ops, or denoise with no denoiser). */
  ignoredOps: string[];
  /** Smallest limiter gain (1 = the limiter never engaged). */
  limiterMinGain: number;
  /**
   * Integrated loudness of what was written, when the recipe has a loudness
   * target. Limiting can pull it below the target; callers may re-render with
   * a corrected gain (see {@link correctedLoudnessAnalysis}).
   */
  outputLufs: number | null;
}

function opValues(fx: MediaFxChain): Partial<Record<MediaFxOpId, number>> {
  const values: Partial<Record<MediaFxOpId, number>> = {};
  for (const op of fx.ops) values[op.id] = op.value;
  return values;
}

function ignoredOps(fx: MediaFxChain, hasDenoiser: boolean): string[] {
  const ignored = [...fx.unknown];
  const denoise = fx.ops.find((op) => op.id === 'denoise');
  if (denoise && !hasDenoiser) ignored.push(`denoise:${denoise.value}`);
  return ignored;
}

function assertRate(source: MediaFxSource): void {
  if (source.sampleRate !== MEDIA_FX_SAMPLE_RATE) {
    throw new Error(
      `Media-edit chain runs at ${MEDIA_FX_SAMPLE_RATE} Hz; resample the source first (got ${source.sampleRate}).`,
    );
  }
}

/**
 * High-pass + denoise, latency-compensated: yields per-channel blocks whose
 * concatenation is exactly the source length, sample-aligned with it.
 */
async function* frontStages(
  options: MediaFxOptions,
  onFrames: (count: number) => void,
): AsyncGenerator<Float32Array[]> {
  const { source, signal } = options;
  const ops = opValues(options.fx);
  const channels = source.channels;
  const highpass: BiquadCascade[] | null =
    ops.highpass != null
      ? Array.from({ length: channels }, () =>
          createBiquadCascade([highpassCoeffs(source.sampleRate, ops.highpass as number)]),
        )
      : null;
  let denoise: DenoiseStage[] | null = null;
  if (ops.denoise != null && options.denoiser) {
    const factory = options.denoiser;
    denoise = await Promise.all(
      Array.from({ length: channels }, async () =>
        createDenoiseStage(await factory(), ops.denoise as number),
      ),
    );
  }
  const latency = denoise?.[0]?.latency ?? 0;

  let inFrames = 0;
  let outFrames = 0;
  let toSkip = latency;
  const run = (block: Float32Array[]): Float32Array[] | null => {
    const copies = block.map((ch) => ch.slice());
    if (highpass) copies.forEach((ch, c) => highpass[c].process(ch));
    let processed = denoise
      ? copies.map((ch, c) => (denoise as DenoiseStage[])[c].process(ch))
      : copies;
    const length = processed[0]?.length ?? 0;
    const skip = Math.min(toSkip, length);
    toSkip -= skip;
    const room = inFrames - outFrames;
    const take = Math.min(length - skip, room);
    if (take <= 0) return null;
    processed = processed.map((ch) => ch.subarray(skip, skip + take));
    outFrames += take;
    return processed;
  };

  try {
    for await (const block of source.open()) {
      signal?.throwIfAborted();
      const length = block[0]?.length ?? 0;
      if (length === 0) continue;
      inFrames += length;
      onFrames(length);
      const out = run(block);
      if (out) yield out;
    }
    // Drain the stage latency with silence.
    if (latency > 0) {
      const out = run(Array.from({ length: channels }, () => new Float32Array(latency)));
      if (out) yield out;
    }
  } finally {
    denoise?.forEach((stage) => stage.dispose());
  }
}

function monoMix(block: readonly Float32Array[]): Float32Array {
  if (block.length === 1) return block[0];
  const mono = new Float32Array(block[0].length);
  for (const ch of block) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / block.length;
  return mono;
}

/** Analysis pass only: breaths and the loudness gain a render would apply. */
export async function analyzeMediaFx(options: MediaFxOptions): Promise<MediaFxAnalysis> {
  assertRate(options.source);
  const ops = opValues(options.fx);
  const { source } = options;
  const startSec = options.startSec ?? 0;
  const breath = ops.debreath != null ? createBreathAnalyzer(source.sampleRate) : null;
  const meter =
    ops.loudness != null ? createLoudnessMeter(source.sampleRate, source.channels) : null;
  let seen = 0;
  const total = source.frames ?? 0;

  for await (const block of frontStages(options, (n) => {
    seen += n;
    if (total > 0) options.onProgress?.(Math.min(1, seen / total));
  })) {
    breath?.push(monoMix(block));
    meter?.push(block);
  }

  const breaths = breath
    ? detectBreaths(breath.frames()).map((r) => ({
        start: r.start + startSec,
        end: r.end + startSec,
      }))
    : [];

  let integratedLufs: number | null = null;
  let loudnessGainDb = 0;
  if (meter && ops.loudness != null) {
    const reduction = ops.debreath ?? 0;
    const steps = meter.stepPowers().map((power, k) => {
      if (breaths.length === 0) return power;
      // Mean square of the breath envelope over this 100 ms step (1 ms resolution).
      let sum = 0;
      for (let i = 0; i < 100; i++) {
        const g = breathGainAt(breaths, reduction, startSec + k * 0.1 + (i + 0.5) * 0.001);
        sum += g * g;
      }
      return power * (sum / 100);
    });
    const measured = integratedLoudnessFromSteps(steps);
    if (Number.isFinite(measured)) {
      integratedLufs = measured;
      loudnessGainDb = Math.min(
        LOUDNESS_GAIN_RANGE.max,
        Math.max(LOUDNESS_GAIN_RANGE.min, ops.loudness - measured),
      );
    }
  }
  return { integratedLufs, loudnessGainDb, breaths };
}

/** Render the chain: analyze (unless given), then process and write the whole source. */
export async function renderMediaFx(options: MediaFxRenderOptions): Promise<MediaFxRenderResult> {
  assertRate(options.source);
  const ops = opValues(options.fx);
  const needsAnalysis = ops.debreath != null || ops.loudness != null;
  const analysisShare = needsAnalysis && !options.analysis ? 0.5 : 0;
  const analysis: MediaFxAnalysis =
    options.analysis ??
    (needsAnalysis
      ? await analyzeMediaFx({
          ...options,
          onProgress: (f) => options.onProgress?.(f * analysisShare),
        })
      : { integratedLufs: null, loudnessGainDb: 0, breaths: [] });

  const { source } = options;
  const startSec = options.startSec ?? 0;
  const gain = Math.pow(10, analysis.loudnessGainDb / 20);
  const limiter =
    ops.loudness != null
      ? createLimiter({
          sampleRate: source.sampleRate,
          channels: source.channels,
          ceilingDb: MEDIA_FX_TRUE_PEAK_CEILING_DB,
        })
      : null;
  let limiterSkip = limiter?.latency ?? 0;
  const outputMeter =
    ops.loudness != null ? createLoudnessMeter(source.sampleRate, source.channels) : null;
  let processed = 0; // frames that have entered the back stages
  let written = 0;
  let seen = 0;
  const total = source.frames ?? 0;

  const emit = async (block: Float32Array[]) => {
    const skip = Math.min(limiterSkip, block[0]?.length ?? 0);
    limiterSkip -= skip;
    const out = skip > 0 ? block.map((ch) => ch.subarray(skip)) : block;
    if ((out[0]?.length ?? 0) === 0) return;
    written += out[0].length;
    outputMeter?.push(out);
    await options.write(out);
  };

  for await (const block of frontStages(options, (n) => {
    seen += n;
    if (total > 0) {
      options.onProgress?.(analysisShare + (1 - analysisShare) * Math.min(1, seen / total));
    }
  })) {
    const blockStartSec = startSec + processed / source.sampleRate;
    processed += block[0].length;
    if (ops.debreath != null && analysis.breaths.length > 0) {
      applyBreathEnvelope(block, source.sampleRate, blockStartSec, analysis.breaths, ops.debreath);
    }
    if (gain !== 1) for (const ch of block) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
    await emit(limiter ? limiter.process(block) : block);
  }
  if (limiter) await emit(limiter.flush());

  return {
    analysis,
    frames: written,
    ignoredOps: ignoredOps(options.fx, options.denoiser != null),
    limiterMinGain: limiter?.minGain() ?? 1,
    outputLufs: outputMeter ? finiteOrNull(outputMeter.integrated()) : null,
  };
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Largest deviation from the loudness target accepted without a corrective pass, LU. */
export const MEDIA_FX_LOUDNESS_TOLERANCE = 0.5;

/**
 * When a render missed its loudness target by more than the tolerance (the
 * limiter shaved peaks after the gain was chosen), the analysis to re-render
 * with: the same breaths, gain nudged by the miss. Null when no correction is
 * needed or possible.
 */
export function correctedLoudnessAnalysis(
  fx: MediaFxChain,
  result: MediaFxRenderResult,
): MediaFxAnalysis | null {
  const target = opValues(fx).loudness;
  if (target == null || result.outputLufs == null) return null;
  const miss = target - result.outputLufs;
  if (Math.abs(miss) <= MEDIA_FX_LOUDNESS_TOLERANCE) return null;
  const loudnessGainDb = Math.min(
    LOUDNESS_GAIN_RANGE.max,
    Math.max(LOUDNESS_GAIN_RANGE.min, result.analysis.loudnessGainDb + miss),
  );
  if (loudnessGainDb === result.analysis.loudnessGainDb) return null;
  return { ...result.analysis, loudnessGainDb };
}

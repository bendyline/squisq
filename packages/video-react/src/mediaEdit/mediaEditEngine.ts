/**
 * Media-edit render engine (browser): decode → signal chain → encode.
 *
 * Realm-agnostic — runs in the media-edit worker, or on the main thread as a
 * fallback. Every input is a Blob plus a canonical `fx` string, so requests
 * cross a worker boundary without copying media bytes.
 */

import {
  MEDIA_FX_ENGINE,
  analyzeMediaFx,
  correctedLoudnessAnalysis,
  createBreathAnalyzer,
  detectPauseCuts,
  parseMediaFx,
  renderMediaFx,
  type MediaCut,
  type DenoiserFactory,
  type MediaFxAnalysis,
  type MediaFxChain,
  type PauseTightenOptions,
} from '@bendyline/squisq/mediaEdit';
import { createAudioRenderSink, type EncodedAudio } from './audioRenderSink.js';
import { openMediaAudio } from './mediaAudioSource.js';

export interface MediaEditJobOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** The denoiser the chain uses for `denoise`; without one the op is skipped. */
  denoiser?: DenoiserFactory;
}

export interface MediaEditRenderRequest {
  source: Blob;
  /** Canonical `fx` value. */
  fx: string;
}

export interface MediaEditRenderResult extends EncodedAudio {
  analysis: MediaFxAnalysis;
  ignoredOps: string[];
  /** Duration of the source's audio track, seconds. */
  sourceDuration: number;
  engine: string;
}

export interface MediaEditPreviewRequest extends MediaEditRenderRequest {
  /** Media-time window to preview. */
  startSec: number;
  endSec: number;
  /** Reusable whole-take analysis (breaths, loudness gain); computed locally when absent. */
  analysis?: MediaFxAnalysis;
}

export interface MediaEditPausesRequest {
  source: Blob;
  options?: PauseTightenOptions;
}

export interface MediaEditPausesResult {
  /** Proposed cuts in source seconds. */
  cuts: MediaCut[];
  /** Length of the audio track, seconds. */
  durationSec: number;
}

export interface MediaEditPreviewResult {
  sampleRate: number;
  startSec: number;
  original: Float32Array[];
  processed: Float32Array[];
}

/** Denoiser warm-up before a preview window, so its first frames are settled. */
const PREVIEW_PREROLL_SEC = 1;

/** Share of the progress bar the first pass takes; a loudness correction pass fills the rest. */
const FIRST_PASS_SHARE = 0.67;

function chainOf(fx: string): MediaFxChain {
  const chain = parseMediaFx(fx);
  if (!chain || chain.ops.length === 0) throw new Error(`Nothing to render in fx "${fx}".`);
  return chain;
}

function concatBlocks(blocks: Float32Array[][], channels: number): Float32Array[] {
  return Array.from({ length: channels }, (_, c) => {
    const total = blocks.reduce((n, b) => n + b[c].length, 0);
    const out = new Float32Array(total);
    let at = 0;
    for (const b of blocks) {
      out.set(b[c], at);
      at += b[c].length;
    }
    return out;
  });
}

/**
 * Render a whole source's audio through its recipe and encode it. When
 * limiting leaves the result more than the tolerance off its loudness target,
 * one corrective pass re-renders with the gain nudged by the miss.
 */
export async function renderMediaEditAudio(
  request: MediaEditRenderRequest,
  options: MediaEditJobOptions = {},
): Promise<MediaEditRenderResult> {
  const fx = chainOf(request.fx);
  const source = await openMediaAudio(request.source);
  if (!source) throw new Error('This media has no audio track to process.');
  try {
    let analysis: MediaFxAnalysis | undefined;
    for (let attempt = 0; ; attempt++) {
      const from = attempt === 0 ? 0 : FIRST_PASS_SHARE;
      const span = attempt === 0 ? FIRST_PASS_SHARE : 1 - FIRST_PASS_SHARE;
      const sink = await createAudioRenderSink(source.channels, source.sampleRate);
      try {
        const result = await renderMediaFx({
          fx,
          source,
          denoiser: options.denoiser,
          write: (block) => sink.write(block),
          onProgress: (f) => options.onProgress?.(from + f * span),
          signal: options.signal,
          ...(analysis ? { analysis } : {}),
        });
        const corrected = attempt === 0 ? correctedLoudnessAnalysis(fx, result) : null;
        if (corrected) {
          await sink.cancel();
          analysis = corrected;
          continue;
        }
        const encoded = await sink.finish();
        options.onProgress?.(1);
        return {
          ...encoded,
          analysis: result.analysis,
          ignoredOps: result.ignoredOps,
          sourceDuration: source.trackDurationSec,
          engine: MEDIA_FX_ENGINE,
        };
      } catch (err: unknown) {
        await sink.cancel().catch(() => {});
        throw err;
      }
    }
  } finally {
    source.dispose();
  }
}

/** Whole-take analysis (breath regions, loudness) for previews to reuse. */
export async function analyzeMediaEditAudio(
  request: MediaEditRenderRequest,
  options: MediaEditJobOptions = {},
): Promise<MediaFxAnalysis | null> {
  const fx = chainOf(request.fx);
  const source = await openMediaAudio(request.source);
  if (!source) return null;
  try {
    return await analyzeMediaFx({
      fx,
      source,
      denoiser: options.denoiser,
      onProgress: options.onProgress,
      signal: options.signal,
    });
  } finally {
    source.dispose();
  }
}

/**
 * Render a short window for A/B listening: returns the original and processed
 * PCM (48 kHz, not encoded) for the same media-time window.
 */
export async function previewMediaEditAudio(
  request: MediaEditPreviewRequest,
  options: MediaEditJobOptions = {},
): Promise<MediaEditPreviewResult> {
  const fx = chainOf(request.fx);
  const decodeFrom = Math.max(0, request.startSec - PREVIEW_PREROLL_SEC);
  const source = await openMediaAudio(request.source, {
    startSec: decodeFrom,
    endSec: request.endSec,
  });
  if (!source) throw new Error('This media has no audio track to process.');
  try {
    const originalBlocks: Float32Array[][] = [];
    for await (const block of source.open()) originalBlocks.push(block.map((ch) => ch.slice()));
    const processedBlocks: Float32Array[][] = [];
    await renderMediaFx({
      fx,
      source,
      startSec: decodeFrom,
      denoiser: options.denoiser,
      write: (block) => {
        processedBlocks.push(block.map((ch) => ch.slice()));
      },
      onProgress: options.onProgress,
      signal: options.signal,
      ...(request.analysis ? { analysis: request.analysis } : {}),
    });
    const skip = Math.round((request.startSec - decodeFrom) * source.sampleRate);
    const trim = (channels: Float32Array[]) => channels.map((ch) => ch.slice(skip));
    return {
      sampleRate: source.sampleRate,
      startSec: request.startSec,
      original: trim(concatBlocks(originalBlocks, source.channels)),
      processed: trim(concatBlocks(processedBlocks, source.channels)),
    };
  } finally {
    source.dispose();
  }
}

/** Propose cuts that shorten a take's long pauses (see `detectPauseCuts`). */
export async function analyzeMediaEditPauses(
  request: MediaEditPausesRequest,
  options: MediaEditJobOptions = {},
): Promise<MediaEditPausesResult> {
  const source = await openMediaAudio(request.source);
  if (!source) throw new Error('This media has no audio track to analyze.');
  try {
    const analyzer = createBreathAnalyzer(source.sampleRate);
    let seen = 0;
    for await (const block of source.open()) {
      options.signal?.throwIfAborted();
      const mono =
        block.length === 1
          ? block[0]
          : block[0].map((_, i) => block.reduce((sum, ch) => sum + ch[i], 0) / block.length);
      analyzer.push(mono);
      seen += block[0].length;
      options.onProgress?.(Math.min(1, seen / Math.max(1, source.frames)));
    }
    return {
      cuts: detectPauseCuts(analyzer.frames(), request.options),
      durationSec: source.trackDurationSec,
    };
  } finally {
    source.dispose();
  }
}

/**
 * Synthetic PCM builders for narration-engine tests (test-only, not
 * exported from the package). Everything is seeded via SeededRandom —
 * the same arguments always produce the same samples.
 */

import { SeededRandom } from '../random/SeededRandom.js';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { buildNarrationScript } from '../narration/script.js';
import type { NarrationScript } from '../narration/types.js';

export function silence(sec: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.max(0, Math.round(sec * sampleRate)));
}

/** Seeded white noise at a target RMS (uniform noise: rms = amp/√3). */
export function noise(sec: number, sampleRate: number, rms: number, seed: number): Float32Array {
  const rng = new SeededRandom(seed);
  const out = new Float32Array(Math.max(0, Math.round(sec * sampleRate)));
  const amp = rms * Math.sqrt(3);
  for (let i = 0; i < out.length; i++) {
    out[i] = (rng.next() * 2 - 1) * amp;
  }
  return out;
}

/** Pure tone (for band-response tests). */
export function tone(freqHz: number, sec: number, sampleRate: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(sec * sampleRate));
  const w = (2 * Math.PI * freqHz) / sampleRate;
  for (let i = 0; i < out.length; i++) {
    out[i] = amp * Math.sin(w * i);
  }
  return out;
}

/**
 * A voiced burst: harmonics at 220/700/1400/2200 Hz under a Hann
 * envelope plus 10% seeded noise — enough speech-band energy to trip
 * the VAD and produce one envelope peak (one syllable nucleus).
 */
export function speechBurst(
  sec: number,
  sampleRate: number,
  seed: number,
  amp = 0.35,
): Float32Array {
  const rng = new SeededRandom(seed);
  const n = Math.round(sec * sampleRate);
  const out = new Float32Array(n);
  const freqs = [220, 700, 1400, 2200];
  const gains = [0.5, 1, 0.6, 0.3];
  for (let i = 0; i < n; i++) {
    const env = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
    let s = 0;
    for (let f = 0; f < freqs.length; f++) {
      s += gains[f] * Math.sin((2 * Math.PI * freqs[f] * i) / sampleRate);
    }
    out[i] = amp * env * (s / 2.4 + 0.1 * (rng.next() * 2 - 1));
  }
  return out;
}

/** Overlay `piece` onto `target` starting at `atSec` (adds samples). */
export function overlay(
  target: Float32Array,
  piece: Float32Array,
  atSec: number,
  sampleRate: number,
): void {
  const start = Math.round(atSec * sampleRate);
  for (let i = 0; i < piece.length && start + i < target.length; i++) {
    target[start + i] += piece[i];
  }
}

export interface SyllableTrainOptions {
  burstSec?: number;
  noiseRms?: number;
  totalSec?: number;
  seed?: number;
}

/** Bursts at each onset time over a quiet noise floor (≈ −50 dB). */
export function syllableTrain(
  onsetsSec: number[],
  sampleRate: number,
  options?: SyllableTrainOptions,
): Float32Array {
  const burstSec = options?.burstSec ?? 0.16;
  const noiseRms = options?.noiseRms ?? 0.003;
  const seed = options?.seed ?? 1;
  const last = onsetsSec.length > 0 ? Math.max(...onsetsSec) : 0;
  const totalSec = options?.totalSec ?? last + burstSec + 0.5;
  const pcm = noise(totalSec, sampleRate, noiseRms, seed);
  onsetsSec.forEach((t, i) => {
    overlay(pcm, speechBurst(burstSec, sampleRate, seed + 100 + i), t, sampleRate);
  });
  return pcm;
}

/** Build a real NarrationScript through the production pipeline. */
export function scriptFromMarkdown(markdown: string): NarrationScript {
  return buildNarrationScript(markdownToDoc(parseMarkdown(markdown)));
}

export interface SyntheticTake {
  pcm: Float32Array;
  /** Burst start time of each token's first syllable. */
  trueWordTimes: number[];
  /** True block start times (first word of each script block). */
  trueBlockStarts: number[];
  durationSec: number;
}

/**
 * Synthesize a spoken take of a script: one burst per token syllable at
 * a steady rate, with pauses matching the token pause classes.
 */
export function takeFromScript(
  script: NarrationScript,
  wpm: number,
  sampleRate: number,
  seed: number,
  opts?: { leadInSec?: number; extraOnsets?: number[]; dropTokenSyllable?: number[] },
): SyntheticTake {
  const meanSylPerWord = Math.max(1, script.totalSyllables / Math.max(1, script.tokens.length));
  const sylPeriod = 60 / wpm / meanSylPerWord;
  const burstSec = Math.min(0.16, sylPeriod * 0.7);
  const leadIn = opts?.leadInSec ?? 0.6;
  const dropSet = new Set(opts?.dropTokenSyllable ?? []);

  const onsets: number[] = [];
  const trueWordTimes: number[] = [];
  let cursor = leadIn;
  for (let k = 0; k < script.tokens.length; k++) {
    const token = script.tokens[k];
    trueWordTimes.push(cursor);
    for (let s = 0; s < token.syllables; s++) {
      if (!dropSet.has(k * 1000 + s)) onsets.push(cursor);
      cursor += sylPeriod;
    }
    if (token.pauseAfter === 1) cursor += 0.35;
    else if (token.pauseAfter === 2) cursor += 0.9;
    else if (token.pauseAfter === 3) cursor += 1.2;
  }
  for (const extra of opts?.extraOnsets ?? []) onsets.push(extra);
  onsets.sort((a, b) => a - b);

  const durationSec = cursor + 0.6;
  const pcm = syllableTrain(onsets, sampleRate, { burstSec, totalSec: durationSec, seed });
  const trueBlockStarts = script.blocks.map((b) => trueWordTimes[b.tokenStart]);
  return { pcm, trueWordTimes, trueBlockStarts, durationSec };
}

export function concat(...segments: Float32Array[]): Float32Array {
  let total = 0;
  for (const s of segments) total += s.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const s of segments) {
    out.set(s, offset);
    offset += s.length;
  }
  return out;
}

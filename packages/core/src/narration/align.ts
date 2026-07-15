/**
 * Offline narration alignment: refine word/block timestamps from a
 * recorded take.
 *
 * Pipeline: fine-hop features → VAD flags → syllable onsets + silence
 * gaps (the DETECTED event sequence) vs. the script's expected
 * syllable/pause slots (the EXPECTED sequence), aligned with a banded
 * DTW. The band (Sakoe-Chiba style) follows the live prompter trace
 * when one exists — the trace is what the reader actually saw — and a
 * proportional prior otherwise. Matched slots yield word timestamps;
 * block starts snap to the end of the breath gap readers take before a
 * heading; block ranges are made CONTIGUOUS because downstream preview
 * building re-derives start times from durations.
 */

import { extractFrameFeatures } from './features.js';
import { detectSyllableOnsets } from './nuclei.js';
import { createVadState, vadStep } from './vad.js';
import type { NarrationTrace } from './trace.js';
import type {
  AlignConfig,
  FrameFeatures,
  NarrationAlignment,
  NarrationBlockRange,
  NarrationScript,
  WordTiming,
} from './types.js';
import { DEFAULT_ALIGN_CONFIG } from './types.js';

export interface AlignInput {
  /** Mono PCM of the whole take. */
  pcm: Float32Array;
  sampleRate: number;
  script: NarrationScript;
  /** Live prompter trace recorded during the take, if any. */
  trace?: NarrationTrace;
  /** Cancel before expensive alignment phases. */
  signal?: AbortSignal;
}

interface DetectedEvent {
  kind: 'syl' | 'gap';
  /** Representative time (onset peak, or gap midpoint). */
  tSec: number;
  startSec: number;
  endSec: number;
}

interface ExpectedSlot {
  kind: 'syl' | 'pause';
  tokenIndex: number;
  /** Syllable index within the token; -1 for pause slots. */
  slotIndex: number;
  /** Prior estimate of when this slot is spoken. */
  priorSec: number;
}

/** Hard cap keeping the banded DP tractable on very long no-trace takes. */
const MAX_BAND_RADIUS_SEC = 60;

export function alignNarration(
  input: AlignInput,
  config?: Partial<AlignConfig>,
): NarrationAlignment {
  const c = { ...DEFAULT_ALIGN_CONFIG, ...config };
  const { pcm, sampleRate, script } = input;
  input.signal?.throwIfAborted();
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be a positive finite number');
  }
  if (pcm.length > c.maxPcmSamples) {
    throw new RangeError(`Narration take exceeds the ${c.maxPcmSamples}-sample safety limit`);
  }
  if (script.tokens.length > c.maxScriptTokens) {
    throw new RangeError(`Narration script exceeds the ${c.maxScriptTokens}-token safety limit`);
  }
  const takeDuration = pcm.length / Math.max(1, sampleRate);
  if (takeDuration > c.maxDurationSec) {
    throw new RangeError(`Narration take exceeds the ${c.maxDurationSec}-second safety limit`);
  }

  if (script.tokens.length === 0 || takeDuration <= 0) {
    return { words: [], blocks: [], detectedSyllables: 0, cost: 0 };
  }

  // ── 1. Detected events over the whole take ─────────────────────────
  const frames = extractFrameFeatures(pcm, sampleRate, { hopSec: c.hopSec });
  input.signal?.throwIfAborted();
  const vadFlags = runVad(frames);
  const onsets = detectSyllableOnsets(frames, vadFlags);
  const gaps = findSilenceGaps(frames, vadFlags, c.gapMinSec);
  const lastSpeechEnd = findLastSpeechEnd(frames, vadFlags);

  if (onsets.length === 0) {
    return proportionalAlignment(
      script,
      lastSpeechEnd > 0 ? lastSpeechEnd : takeDuration,
      takeDuration,
      c,
      0,
    );
  }

  const events: DetectedEvent[] = [
    ...onsets.map((t): DetectedEvent => ({ kind: 'syl', tSec: t, startSec: t, endSec: t })),
    ...gaps,
  ].sort((a, b) => a.tSec - b.tSec);

  // ── 2. Expected slots with prior times ─────────────────────────────
  const bandRadius = Math.min(
    MAX_BAND_RADIUS_SEC,
    input.trace && input.trace.samples.length >= 2
      ? c.bandRadiusSec
      : Math.max(c.bandRadiusNoTraceSec, 0.1 * takeDuration),
  );
  const slots = buildExpectedSlots(script, takeDuration, input.trace);

  // ── 3. Banded DP ────────────────────────────────────────────────────
  const { matchedEventBySlot, cost } = bandedDtw(slots, events, bandRadius, c);

  // ── 4. Word timestamps ──────────────────────────────────────────────
  const words = deriveWordTimings(script, slots, events, matchedEventBySlot);

  // ── 5. Block ranges ─────────────────────────────────────────────────
  const blocks = deriveBlockRanges(script, words, gaps, takeDuration, lastSpeechEnd, c);

  return { words, blocks, detectedSyllables: onsets.length, cost };
}

// ── Detection helpers ─────────────────────────────────────────────────

function runVad(frames: FrameFeatures[]): boolean[] {
  let vad = createVadState();
  const flags = new Array<boolean>(frames.length);
  for (let i = 0; i < frames.length; i++) {
    vad = vadStep(vad, frames[i]);
    flags[i] = vad.speaking;
  }
  return flags;
}

function findSilenceGaps(
  frames: FrameFeatures[],
  vadFlags: boolean[],
  gapMinSec: number,
): DetectedEvent[] {
  const gaps: DetectedEvent[] = [];
  let runStart = -1;
  for (let i = 0; i <= frames.length; i++) {
    const silent = i < frames.length ? !vadFlags[i] : false;
    if (silent && runStart === -1) {
      runStart = i;
    } else if (!silent && runStart !== -1) {
      const startSec = frames[runStart].tSec;
      const endSec = frames[i - 1].tSec;
      if (endSec - startSec >= gapMinSec) {
        gaps.push({ kind: 'gap', tSec: (startSec + endSec) / 2, startSec, endSec });
      }
      runStart = -1;
    }
  }
  return gaps;
}

function findLastSpeechEnd(frames: FrameFeatures[], vadFlags: boolean[]): number {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (vadFlags[i]) return frames[i].tSec;
  }
  return 0;
}

// ── Expected slots + priors ───────────────────────────────────────────

function buildExpectedSlots(
  script: NarrationScript,
  takeDuration: number,
  trace: NarrationTrace | undefined,
): ExpectedSlot[] {
  const slots: ExpectedSlot[] = [];
  for (let k = 0; k < script.tokens.length; k++) {
    const token = script.tokens[k];
    for (let s = 0; s < token.syllables; s++) {
      slots.push({ kind: 'syl', tokenIndex: k, slotIndex: s, priorSec: 0 });
    }
    if (token.pauseAfter >= 2) {
      slots.push({ kind: 'pause', tokenIndex: k, slotIndex: -1, priorSec: 0 });
    }
  }

  const useTrace = trace !== undefined && trace.samples.length >= 2;
  if (useTrace) {
    assignTracePriors(slots, script, trace, takeDuration);
  } else {
    const total = Math.max(1, script.totalSyllables);
    for (const slot of slots) {
      const cumBefore =
        slot.kind === 'pause'
          ? script.cumulativeSyllables[slot.tokenIndex + 1]
          : script.cumulativeSyllables[slot.tokenIndex] + slot.slotIndex;
      slot.priorSec = (cumBefore / total) * takeDuration;
    }
  }

  // Priors must be monotone for the band windows to be monotone.
  let prev = 0;
  for (const slot of slots) {
    if (slot.priorSec < prev) slot.priorSec = prev;
    if (slot.priorSec > takeDuration) slot.priorSec = takeDuration;
    prev = slot.priorSec;
  }
  return slots;
}

/** Invert the (monotonicized) live trace: earliest time the prompter reached each slot's word position. */
function assignTracePriors(
  slots: ExpectedSlot[],
  script: NarrationScript,
  trace: NarrationTrace,
  takeDuration: number,
): void {
  // Monotonicize wordPos (manual back-nudges would break the sweep).
  const times: number[] = [];
  const positions: number[] = [];
  let runningMax = 0;
  for (const sample of trace.samples) {
    runningMax = Math.max(runningMax, sample.wordPos);
    times.push(sample.tMs / 1000);
    positions.push(runningMax);
  }

  let ptr = 0;
  for (const slot of slots) {
    const token = script.tokens[slot.tokenIndex];
    const target =
      slot.kind === 'pause'
        ? slot.tokenIndex + 1
        : slot.tokenIndex + slot.slotIndex / Math.max(1, token.syllables);
    while (ptr < positions.length - 1 && positions[ptr + 1] < target) ptr++;
    let t: number;
    if (positions[ptr] >= target) {
      t = times[ptr];
    } else if (ptr >= positions.length - 1) {
      t = times[times.length - 1];
    } else {
      const span = positions[ptr + 1] - positions[ptr];
      const frac = span > 0 ? (target - positions[ptr]) / span : 0;
      t = times[ptr] + frac * (times[ptr + 1] - times[ptr]);
    }
    slot.priorSec = Math.min(Math.max(0, t), takeDuration);
  }
}

// ── The banded DP ─────────────────────────────────────────────────────

function matchCost(
  slot: ExpectedSlot,
  event: DetectedEvent,
  bandRadius: number,
  c: AlignConfig,
): number {
  if (slot.kind === 'syl') {
    if (event.kind === 'syl') {
      return (
        (c.matchTimeWeight * Math.abs(event.tSec - slot.priorSec)) / Math.max(1e-6, bandRadius)
      );
    }
    return c.sylToGapCost;
  }
  return event.kind === 'gap' ? 0 : c.pauseToSylCost;
}

function bandedDtw(
  slots: ExpectedSlot[],
  events: DetectedEvent[],
  bandRadius: number,
  c: AlignConfig,
): { matchedEventBySlot: Int32Array; cost: number } {
  const N = slots.length;
  const M = events.length;
  const INF = Number.POSITIVE_INFINITY;
  const eventTimes = events.map((e) => e.tSec);

  // Column windows per DP row (row i consumed i slots; columns are consumed events).
  const lo = new Int32Array(N + 1);
  const hi = new Int32Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const prior = slots[i - 1].priorSec;
    lo[i] = lowerBound(eventTimes, prior - bandRadius);
    hi[i] = upperBound(eventTimes, prior + bandRadius);
  }
  lo[0] = 0;
  hi[0] = N >= 1 ? hi[1] : M;
  // Forward pass: monotone, connected, in-range.
  for (let i = 1; i <= N; i++) {
    if (lo[i] < lo[i - 1]) lo[i] = lo[i - 1];
    if (lo[i] > hi[i - 1] + 1) lo[i] = hi[i - 1] + 1;
    if (lo[i] > M) lo[i] = M;
    if (hi[i] < hi[i - 1]) hi[i] = hi[i - 1];
    if (hi[i] < lo[i]) hi[i] = lo[i];
    if (hi[i] > M) hi[i] = M;
  }
  hi[N] = M;
  if (lo[N] > M) lo[N] = M;

  // DP with per-row backpointers (0 = diag/match, 1 = up/delete-slot, 2 = left/insert-event).
  const ptrRows: Uint8Array[] = new Array(N + 1);
  let prevCost = new Float64Array(hi[0] - lo[0] + 1);
  {
    const row = new Uint8Array(hi[0] - lo[0] + 1);
    for (let j = lo[0]; j <= hi[0]; j++) {
      prevCost[j - lo[0]] = j * c.insertCost;
      row[j - lo[0]] = 2;
    }
    ptrRows[0] = row;
  }

  for (let i = 1; i <= N; i++) {
    const width = hi[i] - lo[i] + 1;
    const cost = new Float64Array(width).fill(INF);
    const ptr = new Uint8Array(width);
    const slot = slots[i - 1];
    for (let j = lo[i]; j <= hi[i]; j++) {
      const idx = j - lo[i];
      let best = INF;
      let bestPtr = 1;
      // Diagonal: match slot i-1 with event j-1.
      if (j >= 1 && j - 1 >= lo[i - 1] && j - 1 <= hi[i - 1]) {
        const v = prevCost[j - 1 - lo[i - 1]] + matchCost(slot, events[j - 1], bandRadius, c);
        if (v < best) {
          best = v;
          bestPtr = 0;
        }
      }
      // Up: delete the slot (unspoken/merged syllable).
      if (j >= lo[i - 1] && j <= hi[i - 1]) {
        const v = prevCost[j - lo[i - 1]] + c.deleteCost;
        if (v < best) {
          best = v;
          bestPtr = 1;
        }
      }
      // Left: insert the event (filler, breath, click).
      if (j - 1 >= lo[i]) {
        const v = cost[idx - 1] + c.insertCost;
        if (v < best) {
          best = v;
          bestPtr = 2;
        }
      }
      cost[idx] = best;
      ptr[idx] = bestPtr;
    }
    ptrRows[i] = ptr;
    prevCost = cost;
  }

  // Backtrack from (N, M).
  const matchedEventBySlot = new Int32Array(N).fill(-1);
  let i = N;
  let j = M;
  const finalCost = prevCost[M - lo[N]] ?? 0;
  while (i > 0 || j > 0) {
    const row = ptrRows[i];
    const idx = j - lo[i];
    const move = idx >= 0 && idx < row.length ? row[idx] : i > 0 ? 1 : 2;
    if (move === 0 && i > 0 && j > 0) {
      matchedEventBySlot[i - 1] = j - 1;
      i--;
      j--;
    } else if (move === 1 && i > 0) {
      i--;
    } else if (j > 0) {
      j--;
    } else if (i > 0) {
      i--;
    } else {
      break;
    }
  }

  return { matchedEventBySlot, cost: Number.isFinite(finalCost) ? finalCost : 0 };
}

/** First index with values[idx] >= target. */
function lowerBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Count of values <= target (i.e. exclusive upper index). */
function upperBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ── Outputs ───────────────────────────────────────────────────────────

function deriveWordTimings(
  script: NarrationScript,
  slots: ExpectedSlot[],
  events: DetectedEvent[],
  matchedEventBySlot: Int32Array,
): WordTiming[] {
  const n = script.tokens.length;
  const raw = new Array<number | undefined>(n);
  for (let s = 0; s < slots.length; s++) {
    const eventIdx = matchedEventBySlot[s];
    if (eventIdx < 0) continue;
    const slot = slots[s];
    if (slot.kind !== 'syl') continue;
    if (raw[slot.tokenIndex] !== undefined) continue; // first matched slot wins
    const event = events[eventIdx];
    // A word matched to a gap starts when speech resumes.
    raw[slot.tokenIndex] = event.kind === 'gap' ? event.endSec : event.tSec;
  }

  const words: WordTiming[] = new Array(n);
  let prevKnownIdx = -1;
  let prevKnownT = 0;
  for (let k = 0; k < n; k++) {
    if (raw[k] === undefined) continue;
    // Interpolate the run of unknowns between prevKnown and k.
    const t = raw[k]!;
    for (let u = prevKnownIdx + 1; u < k; u++) {
      const frac = (u - prevKnownIdx) / (k - prevKnownIdx);
      const base = prevKnownIdx >= 0 ? prevKnownT : t;
      words[u] = {
        tokenIndex: u,
        tSec: base + (t - base) * (prevKnownIdx >= 0 ? frac : 0),
        interpolated: true,
      };
    }
    words[k] = { tokenIndex: k, tSec: t, interpolated: false };
    prevKnownIdx = k;
    prevKnownT = t;
  }
  for (let u = prevKnownIdx + 1; u < n; u++) {
    words[u] = { tokenIndex: u, tSec: prevKnownT, interpolated: true };
  }
  if (prevKnownIdx === -1) {
    for (let u = 0; u < n; u++) words[u] = { tokenIndex: u, tSec: 0, interpolated: true };
  }
  // Monotonic.
  let running = 0;
  for (const w of words) {
    running = Math.max(running, w.tSec);
    w.tSec = running;
  }
  return words;
}

function deriveBlockRanges(
  script: NarrationScript,
  words: WordTiming[],
  gaps: DetectedEvent[],
  takeDuration: number,
  lastSpeechEnd: number,
  c: AlignConfig,
): NarrationBlockRange[] {
  const blocks: NarrationBlockRange[] = [];
  const gapEnds = gaps.map((g) => g.endSec);
  let prevStart = 0;
  for (let b = 0; b < script.blocks.length; b++) {
    const range = script.blocks[b];
    const firstWord = words[range.tokenStart];
    let startSec = b === 0 ? 0 : (firstWord?.tSec ?? prevStart);
    if (b > 0) {
      // Snap to the end of the breath gap just before the block, if close.
      const idx = upperBound(gapEnds, startSec) - 1;
      if (idx >= 0 && startSec - gapEnds[idx] <= c.blockSnapWindowSec && gapEnds[idx] > prevStart) {
        startSec = gapEnds[idx];
      }
      if (startSec < prevStart) startSec = prevStart;
    }
    blocks.push({
      blockId: range.blockId,
      ...(range.heading !== undefined ? { heading: range.heading } : {}),
      blockIndex: b,
      charStart: range.charStart,
      charEnd: range.charEnd,
      startSec,
      endSec: startSec,
    });
    prevStart = startSec;
  }
  // Contiguous ranges: endSec === next.startSec; final block covers the tail.
  for (let b = 0; b < blocks.length - 1; b++) {
    blocks[b].endSec = blocks[b + 1].startSec;
  }
  if (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    let end = Math.min(
      takeDuration,
      (lastSpeechEnd > 0 ? lastSpeechEnd : takeDuration) + c.tailPadSec,
    );
    if (takeDuration - end <= 1) end = takeDuration;
    last.endSec = Math.max(last.startSec, end);
  }
  return blocks;
}

/** Fallback when nothing was detected: proportional by expected syllables. */
function proportionalAlignment(
  script: NarrationScript,
  effectiveDuration: number,
  takeDuration: number,
  c: AlignConfig,
  detectedSyllables: number,
): NarrationAlignment {
  const total = Math.max(1, script.totalSyllables);
  const words: WordTiming[] = script.tokens.map((_, k) => ({
    tokenIndex: k,
    tSec: (script.cumulativeSyllables[k] / total) * effectiveDuration,
    interpolated: true,
  }));
  const blocks = deriveBlockRanges(script, words, [], takeDuration, effectiveDuration, c);
  return { words, blocks, detectedSyllables, cost: 0 };
}

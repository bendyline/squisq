/**
 * Transcript alignment: word/block timestamps for a recorded take from a
 * speech recognizer's timed transcript.
 *
 * `alignNarration` infers timing from the take's acoustics against the
 * script's expected syllables, so it needs a reader who follows the script
 * closely. This matches the WORDS a recognizer heard to the script's words
 * instead, so it tolerates paraphrase, ad-libs, skipped passages and long
 * silent demos.
 *
 * Pipeline: both sides become normalized word units → word trigrams that
 * occur exactly once on each side anchor a monotone chain (longest increasing
 * subsequence) → the short stretches between anchors are aligned with a small
 * global DP that also accepts near-miss spellings → script words left without
 * a match are placed on the unmatched words heard between their matched
 * neighbors, so a passage the speaker skipped collapses onto the next thing
 * they said, and a long pause or an off-script aside stays with the slide
 * already showing. Block
 * ranges come from the same contiguous-range builder the acoustic aligner
 * uses, with the silences between heard words as its breath gaps.
 *
 * Pure and deterministic, like the rest of the narration engine.
 */

import { deriveBlockRanges, type DetectedEvent } from './align.js';
import { estimateSyllables } from './syllables.js';
import type { AlignConfig, NarrationAlignment, NarrationScript, WordTiming } from './types.js';
import { DEFAULT_ALIGN_CONFIG } from './types.js';

/** One recognized word, in seconds on the take's timeline. */
export interface TranscriptWord {
  text: string;
  startSec: number;
  endSec: number;
}

/** One recognized phrase. Without `words`, its time is shared out by syllables. */
export interface TranscriptSegment {
  text: string;
  startSec: number;
  endSec: number;
  words?: readonly TranscriptWord[];
}

export interface TranscriptAlignInput {
  script: NarrationScript;
  /** Recognized segments on the take's timeline (seconds from its start). */
  segments: readonly TranscriptSegment[];
  /** Take length in seconds (decoded-PCM length). */
  durationSec: number;
}

export interface TranscriptAlignment extends NarrationAlignment {
  /** Spoken script words whose time came from a matched recognized word. */
  matchedWords: number;
  /** Spoken script words in total. */
  spokenWords: number;
}

/** A normalized word piece and the token (script) or heard word (transcript) it came from. */
interface Unit {
  key: string;
  index: number;
}

interface HeardWord {
  startSec: number;
  endSec: number;
}

/** Largest stretch between anchors handed to the DP (rows × columns). */
const MAX_DP_CELLS = 1_000_000;
const ANCHOR_GRAM = 3;
const EXACT_SCORE = 2;
const NEAR_SCORE = 1;
const MISMATCH_SCORE = -1;
const GAP_SCORE = -1;
/** Minimum normalized edit similarity for a near-miss spelling. */
const NEAR_SIMILARITY = 0.75;
/** Words this short count only when a neighboring word matches too. */
const ISOLATED_MATCH_MAX_LENGTH = 3;
/** Recognizer annotations such as `[BLANK_AUDIO]` or `(music)` are not speech. */
const NON_SPEECH = /^\s*[[(].*[\])]\s*$/u;

/** Lowercased letter/digit runs; apostrophes join ("you're" → "youre"). */
export function transcriptWordKeys(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’]/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function clampTime(value: number, durationSec: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(0, value), durationSec) : 0;
}

/** Heard words in time order, and their units. */
function heardFromSegments(
  segments: readonly TranscriptSegment[],
  durationSec: number,
): { heard: HeardWord[]; units: Unit[] } {
  const heard: HeardWord[] = [];
  const units: Unit[] = [];
  const add = (text: string, startSec: number, endSec: number) => {
    if (NON_SPEECH.test(text)) return;
    const keys = transcriptWordKeys(text);
    if (!keys.length) return;
    for (const key of keys) units.push({ key, index: heard.length });
    heard.push({ startSec, endSec: Math.max(startSec, endSec) });
  };
  const ordered = [...segments].sort((a, b) => a.startSec - b.startSec);
  for (const segment of ordered) {
    const start = clampTime(segment.startSec, durationSec);
    const end = Math.max(start, clampTime(segment.endSec, durationSec));
    if (segment.words?.length) {
      for (const word of segment.words) {
        const wordStart = clampTime(word.startSec, durationSec);
        add(word.text, wordStart, clampTime(word.endSec, durationSec));
      }
      continue;
    }
    const pieces = segment.text.split(/\s+/u).filter((piece) => piece && !NON_SPEECH.test(piece));
    const weights = pieces.map((piece) => estimateSyllables(piece));
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let before = 0;
    pieces.forEach((piece, i) => {
      const from = start + (before / total) * (end - start);
      before += weights[i];
      add(piece, from, start + (before / total) * (end - start));
    });
  }
  // Recognizers may overlap chunk edges; matching assumes time order.
  let running = 0;
  for (const word of heard) {
    word.startSec = Math.max(running, word.startSec);
    word.endSec = Math.max(word.startSec, word.endSec);
    running = word.startSec;
  }
  return { heard, units };
}

function scriptUnits(script: NarrationScript): Unit[] {
  const units: Unit[] = [];
  script.tokens.forEach((token, index) => {
    if (!token.spoken) return;
    for (const key of transcriptWordKeys(token.text)) units.push({ key, index });
  });
  return units;
}

/** Gram → its start position when it occurs exactly once, else -1. */
function uniqueGrams(units: Unit[]): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i + ANCHOR_GRAM <= units.length; i++) {
    const gram = units
      .slice(i, i + ANCHOR_GRAM)
      .map((unit) => unit.key)
      .join(' ');
    grams.set(gram, grams.has(gram) ? -1 : i);
  }
  return grams;
}

/** Monotone chain of unique shared trigrams, as (script unit, heard unit) start pairs. */
function anchorChain(script: Unit[], heard: Unit[]): Array<[number, number]> {
  const heardGrams = uniqueGrams(heard);
  const pairs: Array<[number, number]> = [];
  for (const [gram, s] of uniqueGrams(script)) {
    const t = heardGrams.get(gram);
    if (s >= 0 && t !== undefined && t >= 0) pairs.push([s, t]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  // Longest strictly increasing subsequence on the heard position.
  const tails: number[] = [];
  const previous = new Int32Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < pairs[i][1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const chain: Array<[number, number]> = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = previous[i]) {
    chain.push(pairs[i]);
  }
  return chain.reverse();
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length];
}

function createScorer(): (a: string, b: string) => number {
  const near = new Map<string, boolean>();
  return (a, b) => {
    if (a === b) return EXACT_SCORE;
    // Near misses ("workflow"/"workflows", "colour"/"color") share a first
    // letter and a similar length; short words must match exactly.
    if (a.length < 4 || b.length < 4 || a[0] !== b[0] || Math.abs(a.length - b.length) > 3)
      return MISMATCH_SCORE;
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    let similar = near.get(key);
    if (similar === undefined) {
      similar = 1 - editDistance(a, b) / Math.max(a.length, b.length) >= NEAR_SIMILARITY;
      near.set(key, similar);
    }
    return similar ? NEAR_SCORE : MISMATCH_SCORE;
  };
}

/** Global alignment of two short unit runs; returns the matched (script, heard) unit pairs. */
function alignStretch(
  script: Unit[],
  sFrom: number,
  sTo: number,
  heard: Unit[],
  tFrom: number,
  tTo: number,
  score: (a: string, b: string) => number,
): Array<[number, number]> {
  const rows = sTo - sFrom;
  const cols = tTo - tFrom;
  if (rows <= 0 || cols <= 0 || rows * cols > MAX_DP_CELLS) return [];
  const width = cols + 1;
  // 0 = diagonal, 1 = skip a script unit, 2 = skip a heard unit.
  const moves = new Uint8Array((rows + 1) * width);
  let prev = new Float64Array(width);
  for (let j = 1; j <= cols; j++) {
    prev[j] = j * GAP_SCORE;
    moves[j] = 2;
  }
  for (let i = 1; i <= rows; i++) {
    const row = new Float64Array(width);
    row[0] = i * GAP_SCORE;
    moves[i * width] = 1;
    const key = script[sFrom + i - 1].key;
    for (let j = 1; j <= cols; j++) {
      const diagonal = prev[j - 1] + score(key, heard[tFrom + j - 1].key);
      const up = prev[j] + GAP_SCORE;
      const left = row[j - 1] + GAP_SCORE;
      if (diagonal >= up && diagonal >= left) {
        row[j] = diagonal;
        moves[i * width + j] = 0;
      } else if (up >= left) {
        row[j] = up;
        moves[i * width + j] = 1;
      } else {
        row[j] = left;
        moves[i * width + j] = 2;
      }
    }
    prev = row;
  }
  const pairs: Array<[number, number]> = [];
  let i = rows;
  let j = cols;
  while (i > 0 || j > 0) {
    const move = moves[i * width + j];
    if (move === 0) {
      const s = sFrom + i - 1;
      const t = tFrom + j - 1;
      if (score(script[s].key, heard[t].key) > 0) pairs.push([s, t]);
      i--;
      j--;
    } else if (move === 1) i--;
    else j--;
  }
  return pairs.reverse();
}

/** Every matched (script unit, heard unit) pair, strictly increasing on both sides. */
function matchUnits(script: Unit[], heard: Unit[]): Array<[number, number]> {
  const anchored: Array<[number, number]> = [];
  let lastS = -1;
  let lastT = -1;
  for (const [s, t] of anchorChain(script, heard)) {
    for (let k = 0; k < ANCHOR_GRAM; k++) {
      if (s + k > lastS && t + k > lastT) {
        anchored.push([s + k, t + k]);
        lastS = s + k;
        lastT = t + k;
      }
    }
  }
  const score = createScorer();
  const pairs: Array<[number, number]> = [];
  let from: [number, number] = [-1, -1];
  for (const to of [...anchored, [script.length, heard.length] as [number, number]]) {
    pairs.push(...alignStretch(script, from[0] + 1, to[0], heard, from[1] + 1, to[1], score));
    if (to[0] < script.length) pairs.push(to);
    from = to;
  }
  // A lone short word matched between unmatched neighbors ("of", "the") is
  // nearly always coincidence; it would pin a block boundary to a stray word.
  return pairs.filter(([s, t], i) => {
    if (script[s].key.length > ISOLATED_MATCH_MAX_LENGTH) return true;
    const before = pairs[i - 1];
    const after = pairs[i + 1];
    return (
      (before !== undefined && before[0] === s - 1 && before[1] === t - 1) ||
      (after !== undefined && after[0] === s + 1 && after[1] === t + 1)
    );
  });
}

/**
 * Word times for every script token. Matched tokens take their heard word's
 * start. A run of unmatched tokens sits on the unmatched heard words between
 * its matched neighbors — never on silence, so a pause stays with the slide
 * already showing. When more was heard than written (a demo, an aside) each
 * token stays beside its own block's matched neighbor; when less, the run is
 * spread by syllables (paraphrase), collapsing onto the next heard word when
 * nothing was said in between (a skipped passage).
 */
function placeWords(
  script: NarrationScript,
  matched: Array<number | undefined>,
  heard: HeardWord[],
  speechEnd: number,
  durationSec: number,
  gapMinSec: number,
): WordTiming[] {
  const n = script.tokens.length;
  const cumulative = script.cumulativeSyllables;
  if (!heard.length) {
    const total = Math.max(1, script.totalSyllables);
    return script.tokens.map((_, k) => ({
      tokenIndex: k,
      tSec: (cumulative[k] / total) * durationSec,
      interpolated: true,
    }));
  }
  const startOf = (h: number) => (h < heard.length ? heard[h].startSec : speechEnd);
  const words: WordTiming[] = new Array(n);
  let leftToken = -1;
  let leftHeard = -1;
  const fill = (rightToken: number, rightHeard: number) => {
    const from = leftToken + 1;
    const between = rightHeard - leftHeard - 1;
    const leftBlock = leftToken >= 0 ? script.tokens[leftToken].blockIndex : -1;
    let leftCount = 0;
    let rightCount = 0;
    for (let u = from; u < rightToken; u++) {
      if (!script.tokens[u].spoken) continue;
      if (script.tokens[u].blockIndex === leftBlock) leftCount++;
      else rightCount++;
    }
    if (between > 0 && between >= leftCount + rightCount) {
      // More was said than written: off-script talk. Words stay beside their
      // own block's matched neighbor, and the surplus stays with the block
      // already showing instead of pulling the next one early — as does a
      // pause before the next block's first matched word.
      let rightFloor = rightHeard - rightCount;
      for (let h = rightHeard; h > rightFloor && h > 0; h--) {
        if (startOf(h) - heard[h - 1].endSec >= gapMinSec) {
          rightFloor = h;
          break;
        }
      }
      let leftRank = 0;
      let rightRank = 0;
      for (let u = from; u < rightToken; u++) {
        const token = script.tokens[u];
        const left = token.blockIndex === leftBlock;
        const position = left
          ? leftHeard + 1 + leftRank
          : Math.max(rightFloor, rightHeard - rightCount + rightRank);
        words[u] = { tokenIndex: u, tSec: startOf(position), interpolated: true };
        if (token.spoken && left) leftRank++;
        else if (token.spoken) rightRank++;
      }
      return;
    }
    const base = cumulative[from] ?? 0;
    const span = (rightToken < n ? cumulative[rightToken] : script.totalSyllables) - base;
    for (let u = from; u < rightToken; u++) {
      let tSec = startOf(rightHeard);
      if (between > 0) {
        const fraction =
          span > 0 ? (cumulative[u] - base) / span : (u - from) / (rightToken - from);
        const position = leftHeard + 1 + fraction * between;
        const index = Math.floor(position);
        tSec = startOf(index) + (position - index) * (startOf(index + 1) - startOf(index));
      }
      words[u] = { tokenIndex: u, tSec, interpolated: true };
    }
  };
  for (let k = 0; k < n; k++) {
    const h = matched[k];
    if (h === undefined) continue;
    fill(k, h);
    words[k] = { tokenIndex: k, tSec: heard[h].startSec, interpolated: false };
    leftToken = k;
    leftHeard = h;
  }
  fill(n, heard.length);
  let running = 0;
  for (const word of words) {
    running = Math.max(running, word.tSec);
    word.tSec = running;
  }
  return words;
}

export function alignTranscript(
  input: TranscriptAlignInput,
  config?: Partial<AlignConfig>,
): TranscriptAlignment {
  const c = { ...DEFAULT_ALIGN_CONFIG, ...config };
  const { script } = input;
  const durationSec =
    Number.isFinite(input.durationSec) && input.durationSec > 0 ? input.durationSec : 0;
  if (script.tokens.length > c.maxScriptTokens) {
    throw new RangeError(`Narration script exceeds the ${c.maxScriptTokens}-token safety limit`);
  }
  const spokenWords = script.tokens.filter((token) => token.spoken).length;
  const { heard, units: heardUnits } = heardFromSegments(input.segments, durationSec);
  if (script.tokens.length === 0 || durationSec === 0) {
    return { words: [], blocks: [], detectedSyllables: 0, cost: 0, matchedWords: 0, spokenWords };
  }

  const units = scriptUnits(script);
  const matched: Array<number | undefined> = new Array(script.tokens.length);
  for (const [s, t] of matchUnits(units, heardUnits)) {
    const token = units[s].index;
    // A token's first matched piece wins ("full-spectrum" heard as two words).
    matched[token] ??= heardUnits[t].index;
  }
  const matchedWords = matched.filter((heardIndex) => heardIndex !== undefined).length;

  const lastSpeechEnd = heard.reduce((end, word) => Math.max(end, word.endSec), 0);
  const words = placeWords(
    script,
    matched,
    heard,
    lastSpeechEnd || durationSec,
    durationSec,
    c.gapMinSec,
  );

  const gaps: DetectedEvent[] = [];
  for (let i = 1; i < heard.length; i++) {
    const startSec = heard[i - 1].endSec;
    const endSec = heard[i].startSec;
    if (endSec - startSec >= c.gapMinSec) {
      gaps.push({ kind: 'gap', tSec: (startSec + endSec) / 2, startSec, endSec });
    }
  }
  const blocks = deriveBlockRanges(script, words, gaps, durationSec, lastSpeechEnd, c);
  return {
    words,
    blocks,
    detectedSyllables: heard.length,
    cost: 0,
    matchedWords,
    spokenWords,
  };
}

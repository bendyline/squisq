/**
 * Teleprompter script model: a Doc flattened into an ordered word-token
 * stream with per-block ranges.
 *
 * `sourceText` is the canonical narration text — it is stored verbatim
 * in the timing sidecar, and every token/block `charOffset` indexes into
 * it. Determinism matters: the same Doc always builds a byte-identical
 * script, because sidecar↔doc matching later compares slices of this
 * exact string.
 */

import type { Block, Doc } from '../schemas/Doc.js';
import { flattenRenderableBlocks, getBlockBodyText } from '../doc/markdownToDoc.js';
import { estimateSpokenWordCount } from '../timing/narrationTiming.js';
import { estimateSyllables } from './syllables.js';
import type { NarrationScript, ScriptBlockRange, ScriptToken, WordTiming } from './types.js';

export interface BuildScriptOptions {
  /** Include block headings as spoken text (readers usually speak them). Default true. */
  includeTitles?: boolean;
  /** Separator joining block texts inside `sourceText`. Default '\n\n'. */
  blockSeparator?: string;
}

/** Spoken text of one block: optional title line + body plain text. */
function blockSpokenText(block: Block, includeTitles: boolean): string {
  const title = includeTitles && block.title ? block.title.trim() : '';
  const body = getBlockBodyText(block);
  if (title && body) return `${title}\n${body}`;
  return title || body;
}

/**
 * Build the narration script for a doc. Blocks with no spoken text
 * (pure-media sections, container-template children) contribute no
 * tokens and no block range.
 */
export function buildNarrationScript(doc: Doc, options?: BuildScriptOptions): NarrationScript {
  const includeTitles = options?.includeTitles ?? true;
  const separator = options?.blockSeparator ?? '\n\n';

  const pieces: Array<{ blockId: string; heading?: string; text: string }> = [];
  for (const block of flattenRenderableBlocks(doc.blocks)) {
    const text = blockSpokenText(block, includeTitles);
    if (!text) continue;
    pieces.push({
      blockId: block.id,
      heading: block.title || undefined,
      text,
    });
  }

  let sourceText = '';
  const blocks: ScriptBlockRange[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) sourceText += separator;
    const charStart = sourceText.length;
    sourceText += pieces[i].text;
    blocks.push({
      blockId: pieces[i].blockId,
      ...(pieces[i].heading !== undefined ? { heading: pieces[i].heading } : {}),
      tokenStart: 0,
      tokenEnd: 0,
      charStart,
      charEnd: sourceText.length,
    });
  }

  // Tokenize with a single left-to-right scan so charOffsets are exact.
  const tokens: ScriptToken[] = [];
  const tokenRe = /\S+/g;
  let blockIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(sourceText)) !== null) {
    const charOffset = match.index;
    const charEnd = charOffset + match[0].length;
    while (blockIndex < blocks.length - 1 && charOffset >= blocks[blockIndex].charEnd) {
      blockIndex++;
    }
    tokens.push({
      text: match[0],
      charOffset,
      charEnd,
      blockId: blocks[blockIndex]?.blockId ?? '',
      blockIndex,
      syllables: estimateSyllables(match[0]),
      spokenWordEquiv: estimateSpokenWordCount(stripBoundaryPunct(match[0])),
      pauseAfter: 0,
    });
  }

  // Token ranges per block.
  for (const range of blocks) {
    range.tokenStart = tokens.length;
    range.tokenEnd = 0;
  }
  for (let i = 0; i < tokens.length; i++) {
    const range = blocks[tokens[i].blockIndex];
    if (range) {
      if (i < range.tokenStart) range.tokenStart = i;
      range.tokenEnd = i + 1;
    }
  }
  for (const range of blocks) {
    if (range.tokenStart > range.tokenEnd) {
      // No tokens landed in this range (cannot happen for non-empty text,
      // but keep the invariant tokenStart ≤ tokenEnd).
      range.tokenStart = range.tokenEnd;
    }
  }

  // Pause classes: block boundary > paragraph break > clause punctuation.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (!next || next.blockIndex !== token.blockIndex) {
      token.pauseAfter = 3;
    } else if (sourceText.slice(token.charEnd, next.charOffset).includes('\n')) {
      // getBlockBodyText joins paragraphs/list items with a single '\n',
      // so ANY newline in the inter-token gap is a paragraph-class pause.
      token.pauseAfter = 2;
    } else if (endsWithClausePunctuation(token.text)) {
      token.pauseAfter = 1;
    }
  }

  const cumulativeSyllables = new Array<number>(tokens.length + 1);
  cumulativeSyllables[0] = 0;
  for (let i = 0; i < tokens.length; i++) {
    cumulativeSyllables[i + 1] = cumulativeSyllables[i] + tokens[i].syllables;
  }

  return {
    sourceText,
    tokens,
    blocks,
    totalSyllables: cumulativeSyllables[tokens.length],
    cumulativeSyllables,
  };
}

const TRAILING_CLOSERS = /["')\]}»”’]+$/;

function stripBoundaryPunct(token: string): string {
  return token.replace(/^[.,!?;:'"()[\]{}]+|[.,!?;:'"()[\]{}]+$/g, '');
}

/** Clause/sentence punctuation at the token's end (closing quotes/brackets tolerated). */
function endsWithClausePunctuation(token: string): boolean {
  const bare = token.replace(TRAILING_CLOSERS, '');
  const last = bare.charAt(bare.length - 1);
  if (!last) return false;
  if (last === ',') {
    // Digit-grouping commas never end a token (a trailing comma has no
    // following digit), so any terminal comma is a real pause.
    return true;
  }
  return last === '.' || last === ';' || last === ':' || last === '!' || last === '?';
}

/** Clamp helper shared by the query functions. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Expected cumulative syllables at a (fractional) word position —
 * linear interpolation over the prefix sums.
 */
export function expectedSyllablesAt(script: NarrationScript, wordPos: number): number {
  const n = script.tokens.length;
  if (n === 0) return 0;
  const pos = clamp(wordPos, 0, n);
  const idx = Math.floor(pos);
  if (idx >= n) return script.totalSyllables;
  return script.cumulativeSyllables[idx] + (pos - idx) * script.tokens[idx].syllables;
}

/**
 * Inverse of {@link expectedSyllablesAt}: the fractional word position at
 * which the script reaches `syllables` cumulative syllables. Used by the
 * pacing controller's hard resync.
 */
export function wordPosAtExpectedSyllables(script: NarrationScript, syllables: number): number {
  const n = script.tokens.length;
  if (n === 0) return 0;
  const target = clamp(syllables, 0, script.totalSyllables);
  // Binary search: last index with cumulativeSyllables[idx] <= target.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (script.cumulativeSyllables[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= n) return n;
  const within = target - script.cumulativeSyllables[lo];
  const sylls = script.tokens[lo].syllables;
  return lo + (sylls > 0 ? within / sylls : 0);
}

/** Index of the token containing (or following) a char offset into sourceText. */
export function wordIndexAtChar(script: NarrationScript, charOffset: number): number {
  const tokens = script.tokens;
  if (tokens.length === 0) return 0;
  let lo = 0;
  let hi = tokens.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].charEnd <= charOffset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Index of the active word at a playback time, given aligned word
 * timings — the last word whose `tSec` ≤ `tSec` (or 0 before the first).
 */
export function wordIndexAtTime(words: WordTiming[], tSec: number): number {
  if (words.length === 0) return 0;
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (words[mid].tSec <= tSec) lo = mid;
    else hi = mid - 1;
  }
  return words[lo].tSec <= tSec ? lo : 0;
}

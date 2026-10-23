/**
 * socialCaptionLayout
 *
 * How SocialCaptionOverlay groups narration into on-screen chunks: words are
 * gathered from every caption phrase into one timed stream and cut into
 * chunks of about four words (2-6) for even pacing. A chunk closes early at
 * the end of a sentence (once it holds two words) or of a paragraph (a spoken
 * title, which has no full stop), when its next word would
 * wrap it past SOCIAL_CAPTION_MAX_ROWS rows, or when the narration moves to
 * another audio segment, so a chunk never shows a word
 * before its segment starts (a Short's hook would otherwise flash the intro's
 * first word).
 *
 * Wrapping is predicted before layout from a per-character width table, so
 * the split is deterministic: the same in the browser and in a frame-by-frame
 * video render, before and after web fonts load. Captions are cased one of two
 * ways (`SocialCaptionCase`, from the theme's `typography.captionCase`):
 * `'upper'` (the default) measures capitals of PT Serif Bold and Georgia Bold;
 * `'as-written'` keeps the narration's own casing and measures both cases of
 * PT Sans, Helvetica Neue, Arial, PT Serif and Georgia (all Bold). Either way
 * the estimate takes the widest face plus headroom, so real layout never needs
 * more rows than it.
 *
 * Related files:
 * - SocialCaptionOverlay.tsx — renders the chunks with the layout constants below
 * - __tests__/captionOverlay.test.tsx — the row, segment and overflow guarantees
 */

import type { CaptionPhrase, CaptionTrack } from '@bendyline/squisq/schemas';

/** Target words per visible chunk. */
const TARGET_CHUNK_SIZE = 4;
const MIN_CHUNK_SIZE = 2;
const MAX_CHUNK_SIZE = 6;

/**
 * Rows a chunk may wrap onto. A third row climbs into the middle of a
 * portrait frame, where the picture's subject (and any text in it) sits.
 */
export const SOCIAL_CAPTION_MAX_ROWS = 2;

/** Layout constants shared by the overlay's styles and the width estimate (em of the caption font). */
export const SOCIAL_CAPTION_LAYOUT = {
  wordPadEm: 0.16,
  columnGapEm: 0.28,
  chunkPadXEm: 0.55,
  letterSpacingEm: 0.01,
} as const;

/** How caption words are cased on screen: all capitals, or as the narration text writes them. */
export type SocialCaptionCase = 'upper' | 'as-written';

export interface SocialCaptionLayout {
  wordPadEm: number;
  columnGapEm: number;
  chunkPadXEm: number;
  letterSpacingEm: number;
}

/** Layout constants for a case: mixed case reads as words, so it needs less air between them. */
export function socialCaptionLayout(textCase: SocialCaptionCase = 'upper'): SocialCaptionLayout {
  return textCase === 'upper'
    ? SOCIAL_CAPTION_LAYOUT
    : { ...SOCIAL_CAPTION_LAYOUT, columnGapEm: 0.16 };
}

/**
 * Advance widths in em of capitals, digits and common punctuation: the wider
 * of PT Serif Bold (the warm-earth title face) and Georgia Bold (its
 * fallback), measured in Chromium. Captions are set in uppercase, so this is
 * enough to predict where a chunk wraps.
 */
const CHAR_EM: Readonly<Record<string, number>> = {
  A: 0.76,
  B: 0.76,
  C: 0.72,
  D: 0.83,
  E: 0.72,
  F: 0.67,
  G: 0.81,
  H: 0.91,
  I: 0.45,
  J: 0.6,
  K: 0.82,
  L: 0.69,
  M: 1.02,
  N: 0.84,
  O: 0.82,
  P: 0.7,
  Q: 0.82,
  R: 0.8,
  S: 0.65,
  T: 0.68,
  U: 0.83,
  V: 0.76,
  W: 1.13,
  X: 0.81,
  Y: 0.73,
  Z: 0.69,
  '0': 0.7,
  '1': 0.5,
  '2': 0.63,
  '3': 0.62,
  '4': 0.65,
  '5': 0.6,
  '6': 0.65,
  '7': 0.55,
  '8': 0.68,
  '9': 0.65,
  "'": 0.28,
  '’': 0.33,
  '.': 0.33,
  ',': 0.33,
  ';': 0.37,
  ':': 0.37,
  '!': 0.38,
  '?': 0.55,
  '-': 0.38,
  '–': 0.7,
  '—': 1,
  '"': 0.56,
  '“': 0.52,
  '”': 0.52,
  '(': 0.45,
  ')': 0.45,
  '%': 1,
  '&': 0.83,
  '/': 0.47,
  '°': 0.42,
  $: 0.64,
};
/**
 * Advance widths in em for as-written (mixed-case) captions: the widest of PT Sans,
 * Helvetica Neue, Arial, PT Serif and Georgia, all Bold, measured in Chromium, so a
 * theme may pair `'as-written'` with a sans or a serif caption face.
 */
const AS_WRITTEN_CHAR_EM: Readonly<Record<string, number>> = {
  A: 0.76,
  B: 0.76,
  C: 0.74,
  D: 0.83,
  E: 0.72,
  F: 0.67,
  G: 0.81,
  H: 0.91,
  I: 0.45,
  J: 0.6,
  K: 0.82,
  L: 0.69,
  M: 1.02,
  N: 0.84,
  O: 0.82,
  P: 0.7,
  Q: 0.82,
  R: 0.8,
  S: 0.67,
  T: 0.68,
  U: 0.83,
  V: 0.76,
  W: 1.13,
  X: 0.81,
  Y: 0.73,
  Z: 0.69,
  a: 0.6,
  b: 0.65,
  c: 0.57,
  d: 0.66,
  e: 0.57,
  f: 0.39,
  g: 0.61,
  h: 0.68,
  i: 0.35,
  j: 0.35,
  k: 0.63,
  l: 0.34,
  m: 1.02,
  n: 0.69,
  o: 0.64,
  p: 0.66,
  q: 0.65,
  r: 0.52,
  s: 0.56,
  t: 0.4,
  u: 0.68,
  v: 0.57,
  w: 0.86,
  x: 0.59,
  y: 0.56,
  z: 0.53,
  '0': 0.7,
  '1': 0.57,
  '2': 0.63,
  '3': 0.62,
  '4': 0.65,
  '5': 0.6,
  '6': 0.65,
  '7': 0.57,
  '8': 0.68,
  '9': 0.65,
  "'": 0.28,
  '’': 0.31,
  '.': 0.33,
  ',': 0.33,
  ';': 0.37,
  ':': 0.37,
  '!': 0.38,
  '?': 0.61,
  '-': 0.41,
  '–': 0.7,
  '—': 1,
  '"': 0.51,
  '“': 0.52,
  '”': 0.52,
  '(': 0.45,
  ')': 0.45,
  '%': 1,
  '&': 0.9,
  '/': 0.47,
  '°': 0.44,
  $: 0.64,
};
/** Characters outside the table (other scripts, symbols): assumed wide, so estimates stay safe. */
const DEFAULT_CHAR_EM = 0.9;
/** Headroom for theme title faces somewhat wider than PT Serif and Georgia. */
const WIDTH_SAFETY = 1.06;

/** Estimated width of one caption word in em, padding included (accents ignored). */
export function estimateSocialWordEm(text: string, textCase: SocialCaptionCase = 'upper'): number {
  const upper = textCase === 'upper';
  const table = upper ? CHAR_EM : AS_WRITTEN_CHAR_EM;
  let em = 0;
  let count = 0;
  for (const ch of (upper ? text.toUpperCase() : text).normalize('NFD').replace(/\p{M}/gu, '')) {
    em += table[ch] ?? DEFAULT_CHAR_EM;
    count++;
  }
  const { letterSpacingEm, wordPadEm } = socialCaptionLayout(textCase);
  return (em + count * letterSpacingEm) * WIDTH_SAFETY + 2 * wordPadEm;
}

/** Rows `words` take in a row `rowEm` wide, filled the way flex-wrap fills them (greedily). */
export function estimateSocialRows(
  words: readonly string[],
  rowEm: number,
  textCase: SocialCaptionCase = 'upper',
): number {
  const { columnGapEm } = socialCaptionLayout(textCase);
  let rows = 0;
  let x = 0;
  for (const word of words) {
    const width = estimateSocialWordEm(word, textCase);
    if (rows === 0) {
      rows = 1;
      x = width;
    } else if (x + columnGapEm + width <= rowEm) {
      x += columnGapEm + width;
    } else {
      rows++;
      x = width;
    }
  }
  return rows;
}

/** A word that ends a sentence ("breath.", "home?”"): the next chunk starts the next sentence. */
function endsSentence(text: string): boolean {
  return /[.!?…]["'”’»)\]]*$/.test(text);
}

/** A timed word derived from phrase data. */
export interface TimedWord {
  text: string;
  startTime: number;
  endTime: number;
  /** The phrase's audio segment: a chunk never mixes two. */
  segment?: number;
  /** A paragraph break follows (a spoken title): the next word starts a new chunk. */
  paragraphEnd?: boolean;
}

/** A chunk of words displayed together. */
export interface WordChunk {
  words: TimedWord[];
  startTime: number;
  endTime: number;
}

/**
 * Resolve per-word timing for a single phrase.
 * Uses precise word timestamps when available, otherwise interpolates.
 */
function resolvePhraseTiming(phrase: CaptionPhrase): TimedWord[] {
  // Use precise timing when available
  if (phrase.words && phrase.words.length > 0) {
    return phrase.words.map((w) => ({
      text: w.text,
      startTime: w.startTime,
      endTime: w.endTime,
      ...(w.paragraphEnd ? { paragraphEnd: true } : {}),
    }));
  }

  // Interpolate: split text into words, distribute evenly
  const rawWords = phrase.text.split(/\s+/).filter((w) => w.length > 0);
  if (rawWords.length === 0) return [];

  const duration = phrase.endTime - phrase.startTime;
  const wordDuration = duration / rawWords.length;

  return rawWords.map((text, i) => ({
    text,
    startTime: phrase.startTime + i * wordDuration,
    endTime: phrase.startTime + (i + 1) * wordDuration,
  }));
}

/**
 * Build a continuous stream of timed words from ALL caption phrases,
 * then group into uniform display chunks. This eliminates the "pulsy"
 * feeling caused by per-phrase chunking with variable phrase lengths.
 * Chunks close early at a third row (in a row `rowEm` wide) and at an
 * audio-segment change; see the file header.
 */
export function buildWordStream(
  captions: CaptionTrack,
  rowEm = Number.POSITIVE_INFINITY,
  textCase: SocialCaptionCase = 'upper',
): { words: TimedWord[]; chunks: WordChunk[] } {
  // Gather all words across all phrases
  const allWords: TimedWord[] = [];
  for (const phrase of captions.phrases) {
    for (const word of resolvePhraseTiming(phrase))
      allWords.push({ ...word, segment: phrase.audioSegment });
  }

  if (allWords.length === 0) return { words: [], chunks: [] };

  // Determine uniform chunk size
  let chunkSize = TARGET_CHUNK_SIZE;
  if (allWords.length > chunkSize) {
    const numChunks = Math.ceil(allWords.length / chunkSize);
    chunkSize = Math.ceil(allWords.length / numChunks);
    chunkSize = Math.min(MAX_CHUNK_SIZE, Math.max(MIN_CHUNK_SIZE, chunkSize));
  } else {
    chunkSize = Math.max(MIN_CHUNK_SIZE, allWords.length);
  }

  // Build chunks
  const chunks: WordChunk[] = [];
  let current: TimedWord[] = [];
  const close = () => {
    if (current.length === 0) return;
    chunks.push({
      words: current,
      startTime: current[0].startTime,
      endTime: current[current.length - 1].endTime,
    });
    current = [];
  };
  for (const word of allWords) {
    if (
      current.length > 0 &&
      (current.length >= chunkSize ||
        word.segment !== current[0].segment ||
        current[current.length - 1].paragraphEnd ||
        (current.length >= MIN_CHUNK_SIZE && endsSentence(current[current.length - 1].text)) ||
        estimateSocialRows([...current.map((w) => w.text), word.text], rowEm, textCase) >
          SOCIAL_CAPTION_MAX_ROWS)
    ) {
      close();
    }
    current.push(word);
  }
  close();

  return { words: allWords, chunks };
}

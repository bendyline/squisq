/**
 * Word timings: when narration speaks a given place in its script.
 *
 * Narration that comes with word timings — TTS bookmarks, an aligned
 * recording (`NarrationTimingJsonV3`), any `{ sourceText, bookmarks }` pair —
 * lets a slide appear as its words are spoken instead of at an estimated
 * moment. These helpers answer the two questions every caller asks: what time
 * is it at this character of the script, and when does this phrase start?
 *
 * Two snapping rules, because callers place things differently:
 * - `containing` (default) — the word being spoken at that character: the last
 *   bookmark at or before it. A phrase that starts mid-word starts with that
 *   word.
 * - `next` — the first bookmark at or after it: the next word to be spoken.
 *   A span with no word of its own collapses onto what follows.
 * The two agree whenever a bookmark sits on the character, as word bookmarks
 * do at the start of each word.
 *
 * Related: `narration/sidecar.ts` (the v3 timing file), `doc/builds.ts`
 * (build steps timed to narration), `transform/conceptReveal.ts`.
 */

/** One timed place in a script: the word starting at `charOffset` is spoken at `time` seconds. */
export interface WordMark {
  charOffset: number;
  time: number;
}

/** A script and the times its words are spoken, bookmarks in script order. */
export interface WordTimeline {
  sourceText: string;
  bookmarks: readonly WordMark[];
}

export type WordSnap = 'containing' | 'next';

/**
 * Seconds at which the narration reaches `offset`, or `undefined` when no
 * bookmark answers (an empty timeline; with `next`, an offset past the last
 * word). With `containing`, an offset before the first bookmark takes the
 * first bookmark's time.
 */
export function wordTimeAt(
  bookmarks: readonly WordMark[],
  offset: number,
  snap: WordSnap = 'containing',
): number | undefined {
  if (snap === 'next') return bookmarks.find((word) => word.charOffset >= offset)?.time;
  let best = bookmarks[0];
  for (const bookmark of bookmarks) {
    if (bookmark.charOffset <= offset) best = bookmark;
    else break;
  }
  return best?.time;
}

export interface PhraseTimeOptions {
  /** Script offset to search from (default 0, the first occurrence). */
  from?: number;
  /** Seconds to start ahead of the word, so a visual lands with it (default 0). */
  lead?: number;
  /** How a phrase that starts between bookmarks is placed (default `containing`). */
  snap?: WordSnap;
}

/** Offset of `phrase` in the timeline's script at or after `from`, or -1. */
export function phraseOffset(timeline: WordTimeline, phrase: string, from = 0): number {
  return phrase ? timeline.sourceText.indexOf(phrase, from) : -1;
}

/**
 * Seconds at which `phrase` starts being spoken, `lead` seconds early and
 * never before 0; `null` when the phrase is not in the script or no bookmark
 * times it.
 */
export function phraseStartTime(
  timeline: WordTimeline,
  phrase: string,
  options: PhraseTimeOptions = {},
): number | null {
  const offset = phraseOffset(timeline, phrase, options.from ?? 0);
  if (offset < 0) return null;
  const time = wordTimeAt(timeline.bookmarks, offset, options.snap);
  if (time === undefined) return null;
  return Math.max(0, time - (options.lead ?? 0));
}

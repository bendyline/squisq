/**
 * Source time ↔ played time for a media clip with a trim window and cuts.
 *
 * A clip plays its source from `clipStart` to `clipEnd` (the trim window)
 * with every cut range skipped. "Played time" is seconds since the clip
 * started playing: 0 at `clipStart`, advancing through the kept ranges back
 * to back. Everything time-indexed against a source file (narration word
 * timings, block ranges, a companion clip's cuts) goes through this map, so
 * one function decides what a cut does to time.
 *
 * Pure and dependency-free.
 */

import { normalizeMediaCuts, type MediaCut } from './recipe.js';

export interface MediaTimeMapInput {
  /** Source in-point in seconds. Default 0. */
  clipStart?: number;
  /** Source out-point in seconds. Default: the source's end (unbounded). */
  clipEnd?: number;
  /** Removed source ranges (any order; normalized here). */
  cuts?: readonly MediaCut[];
  /** Known source length; caps an unbounded trim window. */
  sourceDuration?: number;
}

export interface MediaTimeMap {
  /** Trim window start (source seconds). */
  readonly windowStart: number;
  /** Trim window end (source seconds); `Infinity` when unknown. */
  readonly windowEnd: number;
  /** Cuts clamped into the window, normalized. */
  readonly cuts: readonly MediaCut[];
  /** True when at least one cut falls inside the window. */
  readonly hasCuts: boolean;
  /** Played length; `Infinity` when the window end is unknown. */
  readonly playedDuration: number;
  /** The kept source ranges, in order (the last may end at `Infinity`). */
  keptRanges(): MediaCut[];
  /** Played time of a source instant, or null outside the window or inside a cut. */
  sourceToPlayed(sourceSec: number): number | null;
  /**
   * Like {@link sourceToPlayed} but total: an instant inside a cut maps to the
   * cut's boundary, before the window to 0, after it to the played end. Use
   * for range endpoints (a block that ends inside a cut ends at the cut).
   */
  snapSourceToPlayed(sourceSec: number): number;
  /** Source instant at a played time (clamped into the played range). */
  playedToSource(playedSec: number): number;
}

export function createMediaTimeMap(input: MediaTimeMapInput): MediaTimeMap {
  const windowStart = Math.max(0, input.clipStart ?? 0);
  let windowEnd = input.clipEnd ?? Number.POSITIVE_INFINITY;
  if (input.sourceDuration != null && Number.isFinite(input.sourceDuration)) {
    windowEnd = Math.min(windowEnd, input.sourceDuration);
  }
  windowEnd = Math.max(windowStart, windowEnd);
  const cuts = normalizeMediaCuts(input.cuts ?? [], windowStart, windowEnd);

  const kept: MediaCut[] = [];
  let cursor = windowStart;
  for (const cut of cuts) {
    if (cut.start > cursor) kept.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (windowEnd > cursor) kept.push({ start: cursor, end: windowEnd });

  // Played offset at which each kept range begins.
  const offsets: number[] = [];
  let total = 0;
  for (const range of kept) {
    offsets.push(total);
    total += range.end - range.start;
  }
  const playedDuration = total;

  const sourceToPlayed = (t: number): number | null => {
    for (let i = 0; i < kept.length; i++) {
      const range = kept[i];
      if (t >= range.start && (t < range.end || (i === kept.length - 1 && t === range.end))) {
        return offsets[i] + (t - range.start);
      }
    }
    return null;
  };

  const snapSourceToPlayed = (t: number): number => {
    if (kept.length === 0 || t <= windowStart) return 0;
    for (let i = 0; i < kept.length; i++) {
      const range = kept[i];
      if (t < range.start) return offsets[i];
      if (t < range.end) return offsets[i] + (t - range.start);
    }
    return playedDuration;
  };

  const playedToSource = (p: number): number => {
    if (kept.length === 0) return windowStart;
    if (p <= 0) return kept[0].start;
    for (let i = 0; i < kept.length; i++) {
      const length = kept[i].end - kept[i].start;
      if (p < offsets[i] + length) return kept[i].start + (p - offsets[i]);
    }
    return kept[kept.length - 1].end;
  };

  return {
    windowStart,
    windowEnd,
    cuts,
    hasCuts: cuts.length > 0,
    playedDuration,
    keptRanges: () => kept.map((r) => ({ ...r })),
    sourceToPlayed,
    snapSourceToPlayed,
    playedToSource,
  };
}

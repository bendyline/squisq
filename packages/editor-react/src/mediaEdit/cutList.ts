/**
 * Cut-list arithmetic for the Cuts timeline. Every time here is SOURCE
 * seconds — the clock a recipe's `cuts` are written in — and every list is
 * normalized (sorted, merged, inside the clip's trim window).
 */

import { normalizeMediaCuts, type MediaCut } from '@bendyline/squisq/mediaEdit';

/** The part of the source a clip plays: its trim window. */
export interface TimeRange {
  start: number;
  end: number;
}

/** Shortest section worth removing; a narrower drag is a click. */
export const MIN_CUT_SEC = 0.05;

/**
 * Space kept between two cuts while an edge is dragged. Wider than the merge
 * tolerance, so neighbours never fuse mid-drag and renumber under the pointer.
 */
const NEIGHBOUR_GAP_SEC = 0.01;

const toMillis = (seconds: number) => Math.round(seconds * 1000) / 1000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The clip's cuts as the timeline shows them: normalized into the trim window. */
export function cutsInRange(cuts: readonly MediaCut[], range: TimeRange): MediaCut[] {
  return normalizeMediaCuts(cuts, range.start, range.end);
}

/** Remove a section. It merges with any cut it touches or overlaps. */
export function addCut(
  cuts: readonly MediaCut[],
  section: TimeRange,
  range: TimeRange,
): MediaCut[] {
  return cutsInRange(
    [...cuts, { start: toMillis(section.start), end: toMillis(section.end) }],
    range,
  );
}

/** Restore the section a cut removed. */
export function removeCut(cuts: readonly MediaCut[], index: number): MediaCut[] {
  return cuts.filter((_, i) => i !== index);
}

/**
 * Move one edge of a cut. The edge stops at the cut's own other edge (leaving
 * {@link MIN_CUT_SEC}), at its neighbour, and at the trim window.
 */
export function moveCutEdge(
  cuts: readonly MediaCut[],
  index: number,
  edge: 'start' | 'end',
  time: number,
  range: TimeRange,
): MediaCut[] {
  const cut = cuts[index];
  if (!cut) return [...cuts];
  const previous = cuts[index - 1];
  const next = cuts[index + 1];
  const moved =
    edge === 'start'
      ? {
          start: toMillis(
            clamp(
              time,
              previous ? previous.end + NEIGHBOUR_GAP_SEC : range.start,
              cut.end - MIN_CUT_SEC,
            ),
          ),
          end: cut.end,
        }
      : {
          start: cut.start,
          end: toMillis(
            clamp(time, cut.start + MIN_CUT_SEC, next ? next.start - NEIGHBOUR_GAP_SEC : range.end),
          ),
        };
  return cuts.map((c, i) => (i === index ? moved : { ...c }));
}

/** The cut removing `time`, if any (a cut owns its start, not its end). */
export function cutAt(cuts: readonly MediaCut[], time: number): MediaCut | null {
  return cuts.find((cut) => time >= cut.start && time < cut.end) ?? null;
}

/** `m:ss.d` — a position on the timeline, to a tenth of a second. */
export function formatTimecode(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`;
}

/** A length in words: `0.8 s`, `12.4 s`, `1:05`. */
export function formatLength(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const RULER_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** Seconds between ruler labels so they sit at least `minPx` apart. */
export function rulerStep(secondsPerPixel: number, minPx = 72): number {
  const wanted = secondsPerPixel * minPx;
  return RULER_STEPS.find((step) => step >= wanted) ?? RULER_STEPS[RULER_STEPS.length - 1];
}

/** A ruler label: tenths only when the ruler is that fine. */
export function formatRulerLabel(seconds: number, step: number): string {
  if (step < 1) return formatTimecode(seconds);
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Loudest peak across the slices `[from, to)` (fractional slice indexes). */
export function peakInRange(peaks: Float32Array, from: number, to: number): number {
  const first = Math.max(0, Math.floor(from));
  const last = Math.min(peaks.length, Math.max(first + 1, Math.ceil(to)));
  let peak = 0;
  for (let i = first; i < last; i++) {
    if (peaks[i] > peak) peak = peaks[i];
  }
  return peak;
}

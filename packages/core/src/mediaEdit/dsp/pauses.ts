/**
 * Pause tightening: find long silences in a take and propose cuts that shorten
 * each to a natural length.
 *
 * Works on the breath analyzer's 10 ms frames. A frame is quiet when it is
 * unvoiced and close to the take's noise floor; anything louder — speech,
 * consonants, and breaths — is activity and is never cut, so a cut never lands
 * in the middle of a sound. Each quiet run longer than `maxPauseSec` keeps
 * `keepSec` of silence, split evenly around the cut, and loses the middle.
 * Cuts are in source seconds, ready for a `cuts=` recipe.
 */

import type { MediaCut } from '../recipe.js';
import type { BreathFrame } from './breath.js';

export interface PauseTightenOptions {
  /** Pauses longer than this are shortened. Default 0.8 s. */
  maxPauseSec?: number;
  /** Silence left in place of a shortened pause. Default 0.4 s. */
  keepSec?: number;
  /** Shorter cuts are not worth a seam. Default 0.25 s. */
  minCutSec?: number;
}

export const PAUSE_TIGHTEN_DEFAULTS = Object.freeze({
  maxPauseSec: 0.8,
  keepSec: 0.4,
  minCutSec: 0.25,
});

const HOP_SEC = 0.01;
const SILENT_DB = -120;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return SILENT_DB;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

/** Cuts that shorten every long pause in the take. */
export function detectPauseCuts(
  frames: readonly BreathFrame[],
  options: PauseTightenOptions = {},
): MediaCut[] {
  if (frames.length === 0) return [];
  const maxPause = options.maxPauseSec ?? PAUSE_TIGHTEN_DEFAULTS.maxPauseSec;
  const keep = Math.min(options.keepSec ?? PAUSE_TIGHTEN_DEFAULTS.keepSec, maxPause);
  const minCut = options.minCutSec ?? PAUSE_TIGHTEN_DEFAULTS.minCutSec;

  const levels = frames.map((f) => f.rmsDb);
  const floor = percentile(levels, 0.1);
  const voiced = frames.filter((f) => f.voicing >= 0.6).map((f) => f.rmsDb);
  const speech = percentile(voiced.length > 0 ? voiced : levels, 0.9);
  if (speech - floor < 12) return []; // No speech/pause contrast to work with.
  const quietCeiling = Math.min(floor + 10, speech - 20);
  const isQuiet = (f: BreathFrame) => f.voicing < 0.5 && f.rmsDb < quietCeiling;

  const cuts: MediaCut[] = [];
  let runStart = -1;
  const closeRun = (endIndex: number) => {
    if (runStart < 0) return;
    const start = frames[runStart].t - HOP_SEC / 2;
    const end = frames[endIndex].t + HOP_SEC / 2;
    runStart = -1;
    if (end - start <= maxPause) return;
    const cutStart = start + keep / 2;
    const cutEnd = end - keep / 2;
    if (cutEnd - cutStart >= minCut) cuts.push({ start: cutStart, end: cutEnd });
  };
  for (let i = 0; i < frames.length; i++) {
    if (isQuiet(frames[i])) {
      if (runStart < 0) runStart = i;
    } else {
      closeRun(i - 1);
    }
  }
  // A trailing silence runs to the end of the take: shorten it too.
  closeRun(frames.length - 1);
  return cuts;
}

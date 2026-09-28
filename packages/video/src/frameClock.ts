/**
 * Frame clock — the one place that turns a frame index into a timeline time.
 *
 * Every offline capture path (CLI pipe/memory transports, browser export)
 * must agree on which instant a frame shows, otherwise a resumed or
 * deduplicated render drifts from a fresh one. `i / fps` in floating point is
 * not exactly reproducible across code paths, so the time is rounded to a
 * microsecond: `frameTimeSeconds(370, 30)` equals `frameTimeSeconds(37, 3)`.
 *
 * Contract: a frame's pixels are a function of its time only. Consumers seek
 * the player to this time and pause every animation before capturing.
 */

/** Timeline second shown by frame `index` at `fps`, rounded to a microsecond. */
export function frameTimeSeconds(index: number, fps: number): number {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError('Frame index must be a non-negative integer.');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError('Frames per second must be a positive number.');
  }
  return Math.round((index * 1_000_000) / fps) / 1_000_000;
}

/** Number of frames needed to cover `durationSeconds` at `fps` (partial frames round up). */
export function frameCountFor(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new RangeError('Duration must be a non-negative number of seconds.');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError('Frames per second must be a positive number.');
  }
  // `+ 0` normalises the -0 that Math.ceil yields for a zero duration.
  return Math.max(0, Math.ceil(durationSeconds * fps - 1e-9)) + 0;
}

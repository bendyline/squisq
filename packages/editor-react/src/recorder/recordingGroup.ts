/**
 * Group ids for clips captured together (a screen recording and its camera
 * bubble). The id links the clips' edit recipes: cuts, trims and `fx` applied
 * to one member are propagated to the others, so the pair stays in sync.
 *
 * Derived deterministically from the primary recording's file name, so a
 * re-inserted take gets the same id and tests can predict it.
 */

/** `video/screen-20260721-101500.webm` → `rec-screen-20260721-101500`. */
export function recordingGroupId(primaryPath: string): string {
  const base = primaryPath.split(/[?#]/, 1)[0].split('/').pop() ?? '';
  const stem = base.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-');
  return `rec-${stem || 'take'}`.slice(0, 64);
}

/**
 * Resolve the pre-roll that will actually be rendered.
 *
 * A requested pre-roll only has meaning when the document exposes a cover.
 * Keeping this decision explicit prevents frame counts, audio offsets, and
 * reported duration from drifting apart when a document has no cover block.
 */
export function resolveAppliedCoverPreRoll(requestedSeconds: number, hasCover: boolean): number {
  if (!Number.isFinite(requestedSeconds) || requestedSeconds < 0) {
    throw new Error('Cover pre-roll must be a finite number of seconds greater than or equal to 0');
  }
  return hasCover ? requestedSeconds : 0;
}

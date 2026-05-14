/**
 * Path conventions for image-editor version snapshots.
 *
 * Snapshots live inside the sidecar at
 * `.versions/<basename>.<timestamp>[<-suffix>].json`. The collision
 * suffix (`-2`, `-3`, ...) is appended only when two snapshots land on
 * the same UTC second.
 *
 * Mirrors `core/src/versions/paths.ts` but keyed on `.json` instead of
 * `.md` so the two histories live side-by-side without colliding.
 */

import { formatVersionTimestamp, parseVersionTimestamp } from '../versions/timestamp.js';

/** Subfolder (inside the sidecar) that holds image-editor snapshots. */
export const IMAGE_EDIT_VERSIONS_PREFIX = '.versions/';

/** Default basename when none is supplied. Matches `IMAGE_EDIT_STATE_FILENAME` stem. */
export const IMAGE_EDIT_DEFAULT_BASENAME = 'state';

/** Build a snapshot path. Optionally append a collision suffix. */
export function buildImageEditVersionPath(basename: string, date: Date, collision = 0): string {
  const stamp = formatVersionTimestamp(date);
  const suffix = collision > 0 ? `-${collision + 1}` : '';
  return `${IMAGE_EDIT_VERSIONS_PREFIX}${basename}.${stamp}${suffix}.json`;
}

/**
 * Parse a snapshot path. Returns `null` when the path doesn't match the
 * convention (so unrelated `.versions/*.json` files are ignored).
 */
export function parseImageEditVersionPath(
  path: string,
): { basename: string; timestamp: Date; collision: number } | null {
  if (!path.startsWith(IMAGE_EDIT_VERSIONS_PREFIX)) return null;
  const rest = path.slice(IMAGE_EDIT_VERSIONS_PREFIX.length);
  if (!rest.endsWith('.json')) return null;
  const stem = rest.slice(0, -'.json'.length);
  const lastDot = stem.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const basename = stem.slice(0, lastDot);
  const tail = stem.slice(lastDot + 1);
  const dash = tail.indexOf('-');
  let stamp: string;
  let collision = 0;
  if (dash >= 0) {
    stamp = tail.slice(0, dash);
    const n = Number(tail.slice(dash + 1));
    if (!Number.isInteger(n) || n < 2) return null;
    collision = n - 1;
  } else {
    stamp = tail;
  }
  const timestamp = parseVersionTimestamp(stamp);
  if (!timestamp) return null;
  return { basename, timestamp, collision };
}

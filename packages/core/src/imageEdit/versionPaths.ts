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

import {
  buildSnapshotPath,
  parseSnapshotPath,
  type SnapshotPathStrategy,
} from '../versions/snapshotStore.js';

/** Subfolder (inside the sidecar) that holds image-editor snapshots. */
export const IMAGE_EDIT_VERSIONS_PREFIX = '.versions/';

/** Default basename when none is supplied. Matches `IMAGE_EDIT_STATE_FILENAME` stem. */
export const IMAGE_EDIT_DEFAULT_BASENAME = 'state';

/** Internal strategy shared with the generic snapshot store. */
export const IMAGE_EDIT_VERSION_PATHS: SnapshotPathStrategy = Object.freeze({
  prefix: IMAGE_EDIT_VERSIONS_PREFIX,
  extension: 'json',
});

/** Build a snapshot path. Optionally append a collision suffix. */
export function buildImageEditVersionPath(basename: string, date: Date, collision = 0): string {
  return buildSnapshotPath(IMAGE_EDIT_VERSION_PATHS, basename, date, collision);
}

/**
 * Parse a snapshot path. Returns `null` when the path doesn't match the
 * convention (so unrelated `.versions/*.json` files are ignored).
 */
export function parseImageEditVersionPath(
  path: string,
): { basename: string; timestamp: Date; collision: number } | null {
  return parseSnapshotPath(IMAGE_EDIT_VERSION_PATHS, path);
}

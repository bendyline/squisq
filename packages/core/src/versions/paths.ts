/**
 * Path conventions for version snapshots.
 *
 * Snapshots live at `<VERSIONS_PREFIX><basename>.<timestamp>[<-suffix>].md`.
 * The optional numeric suffix (`-2`, `-3`, ...) is appended only when two
 * snapshots collide on the same UTC second.
 */

import {
  buildSnapshotPath,
  parseSnapshotPath,
  type SnapshotPathStrategy,
} from './snapshotStore.js';

/** Subfolder (inside the ContentContainer) that holds version snapshots. */
export const VERSIONS_PREFIX = '.versions/';

/** Internal strategy shared with the generic snapshot store. */
export const DOCUMENT_VERSION_PATHS: SnapshotPathStrategy = Object.freeze({
  prefix: VERSIONS_PREFIX,
  extension: 'md',
});

/**
 * Strip the directory and extension from a document path to produce the
 * basename used in version filenames. `subdir/index.md` -> `index`.
 */
export function getDocBasename(documentPath: string): string {
  const slash = documentPath.lastIndexOf('/');
  const file = slash >= 0 ? documentPath.slice(slash + 1) : documentPath;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * Build a version snapshot path. Optionally append a collision suffix
 * (e.g. `2`, `3`) when two saves land on the same UTC second.
 */
export function buildVersionPath(basename: string, date: Date, collision = 0): string {
  return buildSnapshotPath(DOCUMENT_VERSION_PATHS, basename, date, collision);
}

/**
 * Parse a version snapshot path. Returns null if it doesn't match the
 * convention (so unrelated files stored under `.versions/` are ignored).
 */
export function parseVersionPath(
  path: string,
): { basename: string; timestamp: Date; collision: number } | null {
  return parseSnapshotPath(DOCUMENT_VERSION_PATHS, path);
}

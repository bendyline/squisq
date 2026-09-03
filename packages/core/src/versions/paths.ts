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

/** Subfolder holding pre-save backups of DATA sidecar files. */
export const DATA_BACKUP_PREFIX = '.versions/data/';

/**
 * Build a pre-save backup path for a data sidecar file:
 * `.versions/data/<path with '/' → '__'>.<stamp>[-n].<ext>`.
 *
 * The grid's save flow writes the ORIGINAL bytes here before overwriting a
 * sidecar in place — the only cross-save undo the grid offers. Unlike
 * `buildVersionPath` (markdown-only, single-basename), the flattened full
 * path keeps same-named files in different folders distinct, and the
 * extension follows the sidecar. The flattened name goes through the same
 * safety rules as document snapshots (via a per-call strategy).
 */
export function buildDataBackupPath(sidecarPath: string, date: Date, collision = 0): string {
  const slash = sidecarPath.lastIndexOf('.');
  const extension = slash > 0 ? sidecarPath.slice(slash + 1).toLowerCase() : 'bin';
  const withoutExt = slash > 0 ? sidecarPath.slice(0, slash) : sidecarPath;
  const flattened = withoutExt.replace(/\//g, '__');
  const strategy: SnapshotPathStrategy = { prefix: DATA_BACKUP_PREFIX, extension };
  return buildSnapshotPath(strategy, flattened, date, collision);
}

/**
 * Public types for the document version-history feature.
 *
 * Versions are snapshots of the primary markdown document stored alongside
 * the document inside the same {@link ContentContainer}. They live under
 * `.versions/<docBasename>.<sortableTimestamp>.md`. The container is the
 * unit of persistence — when the host serializes the container to a ZIP,
 * a real folder, or anywhere else, the version snapshots ride along.
 */

/**
 * A single version snapshot record.
 */
export interface Version {
  /** Container-relative path, e.g. `.versions/index.20260430T152030Z.md`. */
  path: string;
  /** Document basename without extension, e.g. `index`. */
  basename: string;
  /** Parsed timestamp from the filename, in UTC. */
  timestamp: Date;
  /** Snapshot size in bytes. */
  size: number;
}

/**
 * Result of a {@link saveVersion} call.
 */
export interface SaveVersionResult {
  /** True when a new snapshot file was actually written. */
  saved: boolean;
  /** The newly stamped version (only when `saved` is true). */
  version: Version | null;
  /**
   * Why the save behaved the way it did:
   * - `'saved'`        — a new snapshot was written.
   * - `'unchanged'`    — current content matches the latest snapshot byte-for-byte.
   * - `'no-document'`  — the container has no primary markdown document.
   * - `'empty'`        — the resolved content was empty.
   */
  reason: 'saved' | 'unchanged' | 'no-document' | 'empty';
}

/**
 * Options for {@link saveVersion}.
 */
export interface SaveVersionOptions {
  /** Override the document content; otherwise the container's primary doc is read. */
  content?: string;
  /** Override the timestamp; defaults to `new Date()`. Useful for tests. */
  now?: Date;
  /** Skip the diff-vs-latest check and force a write. */
  force?: boolean;
  /** Override the document basename used to build the version filename. */
  basename?: string;
}

/**
 * Pruning policy passed to {@link pruneVersions}.
 */
export type PrunePolicy =
  | { type: 'keep-last-n'; n: number }
  | { type: 'older-than'; date: Date }
  | { type: 'predicate'; keep: (v: Version, all: Version[]) => boolean };

/**
 * Options for {@link revertToVersion}.
 */
export interface RevertOptions {
  /**
   * Whether to snapshot the current document content before replacing it.
   * Defaults to `true` so a revert is always recoverable.
   */
  snapshotCurrent?: boolean;
}

/**
 * Options for {@link coalesceVersions}.
 */
export interface CoalesceOptions {
  /**
   * Two adjacent snapshots whose timestamps are within `windowMs` collapse
   * to the newer one. Defaults to 60_000 (one minute).
   */
  windowMs?: number;
}

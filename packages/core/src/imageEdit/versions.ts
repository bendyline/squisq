/**
 * Image-editor version operations against a sidecar
 * {@link ContentContainer}.
 *
 * Mirrors `core/src/versions/operations.ts` but operates on
 * {@link ImageEditDoc} JSON state at `.versions/<basename>.<timestamp>.json`
 * instead of the markdown document. Reuses {@link PrunePolicy} so hosts
 * can share their pruning configuration between the two histories. The
 * sidecar root gets a `.gitignore` rule for `.versions/` when snapshots
 * are retained.
 */

import type { ContentContainer } from '../storage/ContentContainer.js';
import type { ImageEditDoc } from '../schemas/ImageEditDoc.js';
import type { CoalesceOptions, PrunePolicy, Version } from '../versions/types.js';
import {
  coalesceSnapshots,
  listSnapshots,
  pruneSnapshots,
  readTextSnapshot,
  saveTextSnapshot,
} from '../versions/snapshotStore.js';
import { assertImageEditDoc, readImageEditDoc, writeImageEditDoc } from './persistence.js';
import { IMAGE_EDIT_STATE_FILENAME } from './state.js';
import { IMAGE_EDIT_DEFAULT_BASENAME, IMAGE_EDIT_VERSION_PATHS } from './versionPaths.js';

/** Options for {@link saveImageEditVersion}. */
export interface SaveImageEditVersionOptions {
  /** Override the doc to snapshot; otherwise `state.json` is read from the sidecar. */
  doc?: ImageEditDoc;
  /** Override the snapshot timestamp. Defaults to `new Date()`. */
  now?: Date;
  /** Skip the diff-vs-latest check and force a write. */
  force?: boolean;
  /** Override the basename used in version filenames. Defaults to `'state'`. */
  basename?: string;
  /** Override the source filename inside the sidecar. Defaults to `state.json`. */
  stateFilename?: string;
}

/** Result of a {@link saveImageEditVersion} call. */
export interface SaveImageEditVersionResult {
  saved: boolean;
  version: Version | null;
  /** `'saved' | 'unchanged' | 'no-state'` — `'no-state'` means there was nothing to snapshot. */
  reason: 'saved' | 'unchanged' | 'no-state';
}

/** Options for {@link revertToImageEditVersion}. */
export interface RevertImageEditOptions {
  /**
   * Whether to snapshot the *current* state before replacing it. Defaults to `true`.
   */
  snapshotCurrent?: boolean;
  /** Override the source filename. Defaults to `state.json`. */
  stateFilename?: string;
  /**
   * State to capture as the pre-revert snapshot. Hosts holding unsaved
   * in-memory edits MUST pass it: without it the snapshot reads
   * `state.json` from the container, which is stale whenever the editor
   * has not flushed. Ignored when `snapshotCurrent` is `false`.
   */
  doc?: ImageEditDoc;
}

/**
 * Why a {@link revertToImageEditVersion} call declined to revert.
 *
 * - `'missing-snapshot'` — the requested version could not be read.
 * - `'snapshot-failed'`  — the pre-revert snapshot could not be written, so
 *   reverting would have destroyed the current state irrecoverably.
 */
export type RevertImageEditFailureReason = 'missing-snapshot' | 'snapshot-failed';

/** Result of a {@link revertToImageEditVersion} call. */
export interface RevertImageEditResult {
  reverted: boolean;
  snapshotted: Version | null;
  /** Present only when `reverted` is false. */
  reason?: RevertImageEditFailureReason;
}

/** List image-edit snapshots in the sidecar, newest-first. */
export async function listImageEditVersions(
  container: ContentContainer,
  basename?: string,
): Promise<Version[]> {
  return listSnapshots(container, IMAGE_EDIT_VERSION_PATHS, basename);
}

/** Read a snapshot's JSON text. Returns `null` if the snapshot is missing. */
export async function readImageEditVersionText(
  container: ContentContainer,
  version: Version | string,
): Promise<string | null> {
  return readTextSnapshot(container, version);
}

/**
 * Read and parse a snapshot. Returns `null` if missing.
 *
 * A snapshot that EXISTS but is malformed throws rather than returning null:
 * `null` means "no such version", and conflating the two let
 * {@link revertToImageEditVersion} write garbage into `state.json` — wedging
 * the editor on a file that loaded fine before the revert. Throwing here means
 * the revert aborts and the current state survives.
 */
export async function readImageEditVersion(
  container: ContentContainer,
  version: Version | string,
): Promise<ImageEditDoc | null> {
  const text = await readImageEditVersionText(container, version);
  if (text === null) return null;
  const path = typeof version === 'string' ? version : version.path;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`readImageEditVersion: ${path} is not valid JSON: ${msg}`);
  }
  assertImageEditDoc(parsed, path, 'readImageEditVersion');
  return parsed;
}

/**
 * Snapshot the current image-editor state if it differs from the latest
 * existing snapshot.
 *
 * Diff is computed on the *serialized* JSON (with stable 2-space
 * indentation) so semantically-equal states with different key order
 * still snapshot — accept the over-snapshot rather than running a deep
 * structural compare.
 */
export async function saveImageEditVersion(
  container: ContentContainer,
  options: SaveImageEditVersionOptions = {},
): Promise<SaveImageEditVersionResult> {
  const stateFilename = options.stateFilename ?? IMAGE_EDIT_STATE_FILENAME;
  const doc = options.doc ?? (await readImageEditDoc(container, stateFilename));
  if (!doc) {
    return { saved: false, version: null, reason: 'no-state' };
  }
  const basename = options.basename ?? IMAGE_EDIT_DEFAULT_BASENAME;
  const serialized = JSON.stringify(doc, null, 2);

  return saveTextSnapshot(container, IMAGE_EDIT_VERSION_PATHS, {
    content: serialized,
    basename,
    mimeType: 'application/json',
    now: options.now,
    force: options.force,
  });
}

/**
 * Revert `state.json` to a prior snapshot. Snapshots the current state first
 * by default.
 *
 * When that snapshot cannot be written, the revert is ABANDONED rather than
 * performed unrecoverably — losing the current state is a worse outcome than
 * a revert that didn't happen. Mirrors `revertToVersion` in `versions/`.
 */
export async function revertToImageEditVersion(
  container: ContentContainer,
  version: Version | string,
  options: RevertImageEditOptions = {},
): Promise<RevertImageEditResult> {
  const doc = await readImageEditVersion(container, version);
  if (!doc) {
    return { reverted: false, snapshotted: null, reason: 'missing-snapshot' };
  }

  let snapshotted: Version | null = null;
  if (options.snapshotCurrent !== false) {
    const saveOptions: SaveImageEditVersionOptions = { stateFilename: options.stateFilename };
    if (options.doc !== undefined) saveOptions.doc = options.doc;
    const result = await saveImageEditVersion(container, saveOptions);
    // `unchanged` means the current state already equals the newest
    // snapshot, so it remains recoverable — that counts as success.
    if (!result.saved && result.reason !== 'unchanged') {
      return { reverted: false, snapshotted: null, reason: 'snapshot-failed' };
    }
    snapshotted = result.version;
  }

  await writeImageEditDoc(container, doc, options.stateFilename);
  return { reverted: true, snapshotted };
}

/** Delete snapshots that don't satisfy the policy. */
export async function pruneImageEditVersions(
  container: ContentContainer,
  policy: PrunePolicy,
  basename?: string,
): Promise<Version[]> {
  return pruneSnapshots(container, IMAGE_EDIT_VERSION_PATHS, policy, basename);
}

/** Collapse adjacent snapshots within `windowMs`, keeping the newer of each pair. */
export async function coalesceImageEditVersions(
  container: ContentContainer,
  options: CoalesceOptions = {},
  basename?: string,
): Promise<Version[]> {
  return coalesceSnapshots(container, IMAGE_EDIT_VERSION_PATHS, options, basename);
}

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
import { readImageEditDoc, writeImageEditDoc } from './persistence.js';
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

/** Read and parse a snapshot. Returns `null` if missing. */
export async function readImageEditVersion(
  container: ContentContainer,
  version: Version | string,
): Promise<ImageEditDoc | null> {
  const text = await readImageEditVersionText(container, version);
  if (text === null) return null;
  return JSON.parse(text) as ImageEditDoc;
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

/** Revert `state.json` to a prior snapshot. Snapshots the current state first by default. */
export async function revertToImageEditVersion(
  container: ContentContainer,
  version: Version | string,
  options: RevertImageEditOptions = {},
): Promise<{ reverted: boolean; snapshotted: Version | null }> {
  const doc = await readImageEditVersion(container, version);
  if (!doc) {
    return { reverted: false, snapshotted: null };
  }

  let snapshotted: Version | null = null;
  if (options.snapshotCurrent !== false) {
    const result = await saveImageEditVersion(container, { stateFilename: options.stateFilename });
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

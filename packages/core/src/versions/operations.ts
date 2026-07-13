/**
 * Pure-ish version operations against a {@link ContentContainer}.
 *
 * These functions are the canonical implementation. {@link DocumentVersionManager}
 * is a thin wrapper that captures a container reference for ergonomics.
 */

import type { ContentContainer } from '../storage/ContentContainer.js';
import { DOCUMENT_VERSION_PATHS, getDocBasename } from './paths.js';
import {
  coalesceSnapshots,
  listSnapshots,
  pruneSnapshots,
  readTextSnapshot,
  saveTextSnapshot,
} from './snapshotStore.js';
import type {
  CoalesceOptions,
  PrunePolicy,
  RevertOptions,
  SaveVersionOptions,
  SaveVersionResult,
  Version,
} from './types.js';

async function resolveBasename(
  container: ContentContainer,
  override: string | undefined,
): Promise<string | null> {
  if (override) return override;
  const docPath = await container.getDocumentPath();
  if (!docPath) return null;
  return getDocBasename(docPath);
}

async function resolveDocPath(container: ContentContainer): Promise<string> {
  // Default to `index.md` when the container has no document yet — matches
  // `MemoryContentContainer.writeDocument`'s default.
  const docPath = await container.getDocumentPath();
  return docPath ?? 'index.md';
}

/**
 * List all snapshots in the container, newest-first.
 *
 * @param basename Optional filter: when set, only versions whose basename
 *   matches are returned.
 */
export async function listVersions(
  container: ContentContainer,
  basename?: string,
): Promise<Version[]> {
  return listSnapshots(container, DOCUMENT_VERSION_PATHS, basename);
}

/**
 * Read the markdown content of a snapshot. Returns null if the snapshot
 * doesn't exist.
 */
export async function readVersion(
  container: ContentContainer,
  version: Version | string,
): Promise<string | null> {
  return readTextSnapshot(container, version);
}

/**
 * Save a new snapshot of the document if its content differs from the
 * latest existing snapshot.
 */
export async function saveVersion(
  container: ContentContainer,
  options: SaveVersionOptions = {},
): Promise<SaveVersionResult> {
  const content = options.content ?? (await container.readDocument());
  if (content === null || content === undefined) {
    return { saved: false, version: null, reason: 'no-document' };
  }
  if (content.length === 0) {
    return { saved: false, version: null, reason: 'empty' };
  }

  const basename = await resolveBasename(container, options.basename);
  if (!basename) {
    return { saved: false, version: null, reason: 'no-document' };
  }

  return saveTextSnapshot(container, DOCUMENT_VERSION_PATHS, {
    content,
    basename,
    mimeType: 'text/markdown',
    now: options.now,
    force: options.force,
  });
}

/**
 * Revert the document to a prior snapshot. By default, the *current*
 * document is snapshotted first so the revert is itself recoverable.
 */
export async function revertToVersion(
  container: ContentContainer,
  version: Version | string,
  options: RevertOptions = {},
): Promise<{ reverted: boolean; snapshotted: Version | null }> {
  const content = await readVersion(container, version);
  if (content === null) {
    return { reverted: false, snapshotted: null };
  }

  let snapshotted: Version | null = null;
  if (options.snapshotCurrent !== false) {
    const result = await saveVersion(container);
    snapshotted = result.version;
  }

  const docPath = await resolveDocPath(container);
  await container.writeDocument(content, docPath);
  return { reverted: true, snapshotted };
}

/**
 * Delete snapshots that don't satisfy the policy. Returns the deleted
 * versions in their original (newest-first) order.
 */
export async function pruneVersions(
  container: ContentContainer,
  policy: PrunePolicy,
  basename?: string,
): Promise<Version[]> {
  return pruneSnapshots(container, DOCUMENT_VERSION_PATHS, policy, basename);
}

/**
 * Collapse adjacent snapshots that occurred close together — keeping the
 * newer one — to keep history readable across rapid edits.
 */
export async function coalesceVersions(
  container: ContentContainer,
  options: CoalesceOptions = {},
  basename?: string,
): Promise<Version[]> {
  return coalesceSnapshots(container, DOCUMENT_VERSION_PATHS, options, basename);
}

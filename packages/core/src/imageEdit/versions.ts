/**
 * Image-editor version operations against a sidecar
 * {@link ContentContainer}.
 *
 * Mirrors `core/src/versions/operations.ts` but operates on
 * {@link ImageEditDoc} JSON state at `.versions/<basename>.<timestamp>.json`
 * instead of the markdown document. Reuses {@link PrunePolicy} so hosts
 * can share their pruning configuration between the two histories.
 */

import type { ContentContainer } from '../storage/ContentContainer.js';
import type { ImageEditDoc } from '../schemas/ImageEditDoc.js';
import type { CoalesceOptions, PrunePolicy, Version } from '../versions/types.js';
import { readImageEditDoc, writeImageEditDoc } from './persistence.js';
import { IMAGE_EDIT_STATE_FILENAME } from './state.js';
import {
  IMAGE_EDIT_VERSIONS_PREFIX,
  IMAGE_EDIT_DEFAULT_BASENAME,
  buildImageEditVersionPath,
  parseImageEditVersionPath,
} from './versionPaths.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

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
  const entries = await container.listFiles(IMAGE_EDIT_VERSIONS_PREFIX);
  const versions: Version[] = [];
  for (const entry of entries) {
    const parsed = parseImageEditVersionPath(entry.path);
    if (!parsed) continue;
    if (basename !== undefined && parsed.basename !== basename) continue;
    versions.push({
      path: entry.path,
      basename: parsed.basename,
      timestamp: parsed.timestamp,
      size: entry.size,
      collision: parsed.collision,
    });
  }
  versions.sort((a, b) => {
    const dt = b.timestamp.getTime() - a.timestamp.getTime();
    if (dt !== 0) return dt;
    return b.collision - a.collision;
  });
  return versions;
}

/** Read a snapshot's JSON text. Returns `null` if the snapshot is missing. */
export async function readImageEditVersionText(
  container: ContentContainer,
  version: Version | string,
): Promise<string | null> {
  const path = typeof version === 'string' ? version : version.path;
  const data = await container.readFile(path);
  if (!data) return null;
  return decoder.decode(data);
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

  const versions = await listImageEditVersions(container, basename);
  if (!options.force && versions.length > 0) {
    const latest = versions[0]!;
    const existing = await readImageEditVersionText(container, latest);
    if (existing === serialized) {
      return { saved: false, version: null, reason: 'unchanged' };
    }
  }

  const now = options.now ?? new Date();
  let collision = 0;
  let path = buildImageEditVersionPath(basename, now, collision);
  while (await container.exists(path)) {
    collision += 1;
    path = buildImageEditVersionPath(basename, now, collision);
  }

  const data = encoder.encode(serialized);
  await container.writeFile(path, data, 'application/json');

  const version: Version = {
    path,
    basename,
    timestamp: now,
    size: data.byteLength,
    collision,
  };
  return { saved: true, version, reason: 'saved' };
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
  const versions = await listImageEditVersions(container, basename);
  const toDelete: Version[] = [];

  if (policy.type === 'keep-last-n') {
    const n = Math.max(0, Math.floor(policy.n));
    toDelete.push(...versions.slice(n));
  } else if (policy.type === 'older-than') {
    const cutoff = policy.date.getTime();
    for (const v of versions) {
      if (v.timestamp.getTime() < cutoff) toDelete.push(v);
    }
  } else {
    for (const v of versions) {
      if (!policy.keep(v, versions)) toDelete.push(v);
    }
  }

  for (const v of toDelete) {
    await container.removeFile(v.path);
  }
  return toDelete;
}

/** Collapse adjacent snapshots within `windowMs`, keeping the newer of each pair. */
export async function coalesceImageEditVersions(
  container: ContentContainer,
  options: CoalesceOptions = {},
  basename?: string,
): Promise<Version[]> {
  const windowMs = options.windowMs ?? 60_000;
  const versions = await listImageEditVersions(container, basename);
  const toDelete: Version[] = [];
  if (versions.length > 0) {
    let anchor = versions[0]!;
    for (let i = 1; i < versions.length; i++) {
      const candidate = versions[i]!;
      if (anchor.timestamp.getTime() - candidate.timestamp.getTime() <= windowMs) {
        toDelete.push(candidate);
      } else {
        anchor = candidate;
      }
    }
  }
  for (const v of toDelete) {
    await container.removeFile(v.path);
  }
  return toDelete;
}

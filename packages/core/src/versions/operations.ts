/**
 * Pure-ish version operations against a {@link ContentContainer}.
 *
 * These functions are the canonical implementation. {@link DocumentVersionManager}
 * is a thin wrapper that captures a container reference for ergonomics.
 */

import type { ContentContainer } from '../storage/ContentContainer.js';
import { buildVersionPath, getDocBasename, parseVersionPath, VERSIONS_PREFIX } from './paths.js';
import type {
  CoalesceOptions,
  PrunePolicy,
  RevertOptions,
  SaveVersionOptions,
  SaveVersionResult,
  Version,
} from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

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
  const entries = await container.listFiles(VERSIONS_PREFIX);
  const versions: Version[] = [];
  for (const entry of entries) {
    const parsed = parseVersionPath(entry.path);
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
  // Newest first. Tie-break on collision (higher = newer). Compare the
  // numeric collision rather than the path string: lexicographically a path
  // with no suffix sorts *after* one with `-N`, because `.` (0x2E) is
  // greater than `-` (0x2D), which would invert the order.
  versions.sort((a, b) => {
    const dt = b.timestamp.getTime() - a.timestamp.getTime();
    if (dt !== 0) return dt;
    return b.collision - a.collision;
  });
  return versions;
}

/**
 * Read the markdown content of a snapshot. Returns null if the snapshot
 * doesn't exist.
 */
export async function readVersion(
  container: ContentContainer,
  version: Version | string,
): Promise<string | null> {
  const path = typeof version === 'string' ? version : version.path;
  const data = await container.readFile(path);
  if (!data) return null;
  return decoder.decode(data);
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

  const versions = await listVersions(container, basename);
  if (!options.force && versions.length > 0) {
    const latest = versions[0]!;
    const existing = await readVersion(container, latest);
    if (existing === content) {
      return { saved: false, version: null, reason: 'unchanged' };
    }
  }

  const now = options.now ?? new Date();
  let collision = 0;
  let path = buildVersionPath(basename, now, collision);
  while (await container.exists(path)) {
    collision += 1;
    path = buildVersionPath(basename, now, collision);
  }

  const data = encoder.encode(content);
  await container.writeFile(path, data, 'text/markdown');

  const version: Version = {
    path,
    basename,
    timestamp: now,
    size: data.byteLength,
    collision,
  };
  return { saved: true, version, reason: 'saved' };
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
  const versions = await listVersions(container, basename);
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

/**
 * Collapse adjacent snapshots that occurred close together — keeping the
 * newer one — to keep history readable across rapid edits.
 */
export async function coalesceVersions(
  container: ContentContainer,
  options: CoalesceOptions = {},
  basename?: string,
): Promise<Version[]> {
  const windowMs = options.windowMs ?? 60_000;
  const versions = await listVersions(container, basename);
  const toDelete: Version[] = [];
  // Walk newest -> oldest, anchored to the last *kept* snapshot. Any
  // candidate within `windowMs` of the anchor is dropped; the first one
  // outside the window becomes the new anchor. Comparing each pair against
  // its previous neighbor instead would chain through deleted snapshots
  // and over-prune any tightly-clustered run (e.g. 30s apart with a 60s
  // window collapses to a single survivor).
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

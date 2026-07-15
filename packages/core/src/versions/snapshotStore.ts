/**
 * Internal storage engine shared by document and image-editor histories.
 * Public APIs keep their domain-specific names and result reasons; this module
 * owns the mechanics that must behave identically across both histories.
 */

import type { ContentContainer } from '../storage/ContentContainer.js';
import { ensureVersionsGitIgnored } from './gitignore.js';
import { formatVersionTimestamp, parseVersionTimestamp } from './timestamp.js';
import type { CoalesceOptions, PrunePolicy, Version } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const INVALID_BASENAME_CHARS = /[<>:"/\\|?*]/;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const mutationQueues = new WeakMap<object, Promise<void>>();

function assertSafeBasename(basename: string): void {
  if (
    basename.length === 0 ||
    basename.length > 200 ||
    basename === '.' ||
    basename === '..' ||
    basename.endsWith('.') ||
    basename.endsWith(' ') ||
    INVALID_BASENAME_CHARS.test(basename) ||
    [...basename].some((char) => {
      const code = char.codePointAt(0)!;
      return code < 32 || code === 127;
    }) ||
    WINDOWS_DEVICE_NAME.test(basename)
  ) {
    throw new TypeError(`Invalid snapshot basename: ${JSON.stringify(basename)}`);
  }
}

export interface SnapshotPathStrategy {
  readonly prefix: string;
  readonly extension: string;
}

export interface SaveTextSnapshotOptions {
  content: string;
  basename: string;
  mimeType: string;
  now?: Date;
  force?: boolean;
}

export interface SaveTextSnapshotResult {
  saved: boolean;
  version: Version | null;
  reason: 'saved' | 'unchanged';
}

export function buildSnapshotPath(
  strategy: SnapshotPathStrategy,
  basename: string,
  date: Date,
  collision = 0,
): string {
  assertSafeBasename(basename);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Snapshot date must be valid');
  if (!Number.isInteger(collision) || collision < 0) {
    throw new RangeError('Snapshot collision must be a non-negative integer');
  }
  const stamp = formatVersionTimestamp(date);
  const suffix = collision > 0 ? `-${collision + 1}` : '';
  return `${strategy.prefix}${basename}.${stamp}${suffix}.${strategy.extension}`;
}

export function parseSnapshotPath(
  strategy: SnapshotPathStrategy,
  path: string,
): { basename: string; timestamp: Date; collision: number } | null {
  if (!path.startsWith(strategy.prefix)) return null;
  const extension = `.${strategy.extension}`;
  const rest = path.slice(strategy.prefix.length);
  if (!rest.endsWith(extension)) return null;
  const stem = rest.slice(0, -extension.length);
  const lastDot = stem.lastIndexOf('.');
  if (lastDot <= 0) return null;

  const basename = stem.slice(0, lastDot);
  const tail = stem.slice(lastDot + 1);
  const dash = tail.indexOf('-');
  let stamp = tail;
  let collision = 0;
  if (dash >= 0) {
    stamp = tail.slice(0, dash);
    const suffix = Number(tail.slice(dash + 1));
    if (!Number.isInteger(suffix) || suffix < 2) return null;
    collision = suffix - 1;
  }

  const timestamp = parseVersionTimestamp(stamp);
  return timestamp ? { basename, timestamp, collision } : null;
}

export async function listSnapshots(
  container: ContentContainer,
  strategy: SnapshotPathStrategy,
  basename?: string,
): Promise<Version[]> {
  const entries = await container.listFiles(strategy.prefix);
  const versions: Version[] = [];
  for (const entry of entries) {
    const parsed = parseSnapshotPath(strategy, entry.path);
    if (!parsed || (basename !== undefined && parsed.basename !== basename)) continue;
    versions.push({
      path: entry.path,
      basename: parsed.basename,
      timestamp: parsed.timestamp,
      size: entry.size,
      collision: parsed.collision,
    });
  }

  versions.sort((a, b) => {
    const timestampDelta = b.timestamp.getTime() - a.timestamp.getTime();
    return timestampDelta || b.collision - a.collision;
  });
  return versions;
}

export async function readTextSnapshot(
  container: ContentContainer,
  version: Version | string,
): Promise<string | null> {
  const path = typeof version === 'string' ? version : version.path;
  const data = await container.readFile(path);
  return data ? decoder.decode(data) : null;
}

export async function saveTextSnapshot(
  container: ContentContainer,
  strategy: SnapshotPathStrategy,
  options: SaveTextSnapshotOptions,
): Promise<SaveTextSnapshotResult> {
  return withContainerMutationLock(container, async () => {
    const versions = await listSnapshots(container, strategy, options.basename);
    if (!options.force && versions.length > 0) {
      const existing = await readTextSnapshot(container, versions[0]!);
      if (existing === options.content) {
        // Backfill containers written before history owned its ignore rule.
        await ensureVersionsGitIgnored(container);
        return { saved: false, version: null, reason: 'unchanged' };
      }
    }

    const now = options.now ?? new Date();
    const data = encoder.encode(options.content);
    await ensureVersionsGitIgnored(container);

    let collision = 0;
    let path = buildSnapshotPath(strategy, options.basename, now, collision);
    if (container.writeFileExclusive) {
      while (!(await container.writeFileExclusive(path, data, options.mimeType))) {
        collision += 1;
        path = buildSnapshotPath(strategy, options.basename, now, collision);
      }
    } else {
      // The shared in-process lock closes the check/write race for legacy
      // adapters. Cross-process safety requires writeFileExclusive().
      while (await container.exists(path)) {
        collision += 1;
        path = buildSnapshotPath(strategy, options.basename, now, collision);
      }
      await container.writeFile(path, data, options.mimeType);
    }

    return {
      saved: true,
      version: {
        path,
        basename: options.basename,
        timestamp: now,
        size: data.byteLength,
        collision,
      },
      reason: 'saved',
    };
  });
}

async function withContainerMutationLock<T>(
  container: ContentContainer,
  operation: () => Promise<T>,
): Promise<T> {
  const key = container.mutationLock ?? container;
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  mutationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (mutationQueues.get(key) === queued) mutationQueues.delete(key);
  }
}

/**
 * Split a newest-first snapshot list into one newest-first list per basename.
 *
 * Retention is a property of a DOCUMENT's history, never of the container:
 * one container can hold several documents' snapshots side by side. Applying
 * a policy to the flat list lets doc B's activity evict doc A's history —
 * a keep-last-n cap consumes its budget on whichever doc saved most recently,
 * and a coalesce window collapses A's only snapshot against B's unrelated one.
 * Every retention decision is therefore made within a basename group.
 *
 * Insertion order follows the (already sorted) input, so each group stays
 * newest-first without a second sort.
 */
function groupByBasename(versions: readonly Version[]): Map<string, Version[]> {
  const groups = new Map<string, Version[]>();
  for (const version of versions) {
    const group = groups.get(version.basename);
    if (group) group.push(version);
    else groups.set(version.basename, [version]);
  }
  return groups;
}

/**
 * Re-order a set of per-group deletions back into the caller-facing
 * newest-first order documented by `pruneVersions` / `coalesceVersions`.
 */
function inListOrder(versions: readonly Version[], toDelete: ReadonlySet<Version>): Version[] {
  return versions.filter((version) => toDelete.has(version));
}

export async function pruneSnapshots(
  container: ContentContainer,
  strategy: SnapshotPathStrategy,
  policy: PrunePolicy,
  basename?: string,
): Promise<Version[]> {
  // Validate before listing so an invalid policy never deletes anything.
  if (policy.type === 'keep-last-n' && (!Number.isSafeInteger(policy.n) || policy.n < 0)) {
    throw new RangeError('keep-last-n requires a non-negative safe integer');
  }
  if (policy.type === 'older-than' && !Number.isFinite(policy.date.getTime())) {
    throw new TypeError('older-than requires a valid date');
  }

  const versions = await listSnapshots(container, strategy, basename);
  const toDelete = new Set<Version>();

  for (const group of groupByBasename(versions).values()) {
    if (policy.type === 'keep-last-n') {
      for (const version of group.slice(policy.n)) toDelete.add(version);
    } else if (policy.type === 'older-than') {
      // Basename-independent, but grouped for uniformity — an absolute
      // cutoff yields the same set either way.
      const cutoff = policy.date.getTime();
      for (const version of group) {
        if (version.timestamp.getTime() < cutoff) toDelete.add(version);
      }
    } else {
      // The predicate sees the document's OWN history as `all`, matching the
      // per-document framing of the other policies (and of an explicit
      // `basename` filter, where `all` is already scoped to one document).
      for (const version of group) {
        if (!policy.keep(version, group)) toDelete.add(version);
      }
    }
  }

  const deleted = inListOrder(versions, toDelete);
  await removeSnapshots(container, deleted);
  return deleted;
}

export async function coalesceSnapshots(
  container: ContentContainer,
  strategy: SnapshotPathStrategy,
  options: CoalesceOptions = {},
  basename?: string,
): Promise<Version[]> {
  const windowMs = options.windowMs ?? 60_000;
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new RangeError('windowMs must be a non-negative finite number');
  }
  const versions = await listSnapshots(container, strategy, basename);
  const toDelete = new Set<Version>();

  // Walk each document's history independently: "adjacent" means adjacent
  // among THAT document's snapshots. Compare against the last kept snapshot —
  // pairwise comparison against a deleted neighbor would chain through a
  // dense run and over-prune it.
  for (const group of groupByBasename(versions).values()) {
    let anchor = group[0]!;
    for (let index = 1; index < group.length; index++) {
      const candidate = group[index]!;
      if (anchor.timestamp.getTime() - candidate.timestamp.getTime() <= windowMs) {
        toDelete.add(candidate);
      } else {
        anchor = candidate;
      }
    }
  }

  const deleted = inListOrder(versions, toDelete);
  await removeSnapshots(container, deleted);
  return deleted;
}

async function removeSnapshots(
  container: ContentContainer,
  versions: readonly Version[],
): Promise<void> {
  for (const version of versions) await container.removeFile(version.path);
}

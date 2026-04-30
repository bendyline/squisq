/**
 * Path conventions for version snapshots.
 *
 * Snapshots live at `<VERSIONS_PREFIX><basename>.<timestamp>[<-suffix>].md`.
 * The optional numeric suffix (`-2`, `-3`, ...) is appended only when two
 * snapshots collide on the same UTC second.
 */

import { formatVersionTimestamp, parseVersionTimestamp } from './timestamp.js';

/** Subfolder (inside the ContentContainer) that holds version snapshots. */
export const VERSIONS_PREFIX = '.versions/';

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
  const stamp = formatVersionTimestamp(date);
  const suffix = collision > 0 ? `-${collision + 1}` : '';
  return `${VERSIONS_PREFIX}${basename}.${stamp}${suffix}.md`;
}

/**
 * Parse a version snapshot path. Returns null if it doesn't match the
 * convention (so unrelated files stored under `.versions/` are ignored).
 */
export function parseVersionPath(
  path: string,
): { basename: string; timestamp: Date; collision: number } | null {
  if (!path.startsWith(VERSIONS_PREFIX)) return null;
  const rest = path.slice(VERSIONS_PREFIX.length);
  if (!rest.endsWith('.md')) return null;
  const stem = rest.slice(0, -'.md'.length);
  // basename can contain dots; the timestamp is always the *last* dot-segment
  // (optionally followed by a `-N` collision suffix).
  const lastDot = stem.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const basename = stem.slice(0, lastDot);
  const tail = stem.slice(lastDot + 1);
  const dash = tail.indexOf('-');
  let stamp: string;
  let collision = 0;
  if (dash >= 0) {
    stamp = tail.slice(0, dash);
    const n = Number(tail.slice(dash + 1));
    if (!Number.isInteger(n) || n < 2) return null;
    collision = n - 1;
  } else {
    stamp = tail;
  }
  const timestamp = parseVersionTimestamp(stamp);
  if (!timestamp) return null;
  return { basename, timestamp, collision };
}

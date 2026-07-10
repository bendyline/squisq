import type { MediaEntry } from '@bendyline/squisq/schemas';

/** Files managed by the container but intentionally omitted from the Files panel. */
export function isVisibleMediaEntry(entry: MediaEntry): boolean {
  const basename = entry.name.slice(entry.name.lastIndexOf('/') + 1);
  return basename.toLowerCase() !== '.gitignore';
}

/** Return the entries that should participate in the Files panel and its count. */
export function filterVisibleMediaEntries(entries: readonly MediaEntry[]): MediaEntry[] {
  return entries.filter(isVisibleMediaEntry);
}

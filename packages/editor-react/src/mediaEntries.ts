import type { MediaEntry } from '@bendyline/squisq/schemas';

const IMAGE_EDIT_STATE_FILENAME = 'state.json';

function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

/** Files managed by the container but intentionally omitted from the Files panel. */
export function isVisibleMediaEntry(entry: MediaEntry): boolean {
  const segments = pathSegments(entry.name);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const basename = lowerSegments[lowerSegments.length - 1] ?? '';

  if (basename === '.gitignore') return false;
  if (lowerSegments.includes('.versions')) return false;

  const parent = lowerSegments[lowerSegments.length - 2] ?? '';
  const isImageEditState =
    basename === IMAGE_EDIT_STATE_FILENAME &&
    (lowerSegments.includes('.imageedits') || parent.endsWith('_files'));

  return !isImageEditState;
}

/** Return the entries that should participate in the Files panel and its count. */
export function filterVisibleMediaEntries(entries: readonly MediaEntry[]): MediaEntry[] {
  return entries.filter(isVisibleMediaEntry);
}

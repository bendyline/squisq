/**
 * Sortable, human-readable timestamps for version filenames.
 *
 * Format: ISO 8601 basic, UTC, second precision, `Z` suffix —
 * e.g. `20260430T152030Z`. Lexicographic order matches chronological order,
 * so `listFiles` returns versions in time order without parsing.
 */

const TIMESTAMP_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format a Date as a sortable, filename-safe UTC timestamp string.
 */
export function formatVersionTimestamp(date: Date): string {
  return (
    String(date.getUTCFullYear()).padStart(4, '0') +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    'T' +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Parse a version timestamp string back to a Date. Returns null if the input
 * doesn't match the expected format.
 */
export function parseVersionTimestamp(stamp: string): Date | null {
  const m = TIMESTAMP_RE.exec(stamp);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

/**
 * The pattern a valid version timestamp matches. Exported so other modules
 * can validate filenames without re-deriving the regex.
 */
export const VERSION_TIMESTAMP_PATTERN = TIMESTAMP_RE;

/**
 * Inline-icon markers for template text.
 *
 * Slide templates flatten rich markdown body content into strings before
 * rendering. Inline icons need to survive that flattening step, so we encode
 * them as sentinel-delimited text markers and let `TextLayer` turn them back
 * into FontAwesome glyphs when rendering.
 */

import type { IconFamily } from './iconData.js';

/**
 * Private-Use-Area sentinel that brackets an encoded icon.
 * Kept as an escape sequence so the source remains valid TypeScript text.
 */
const SENTINEL = '\uE000';

/** Matches one encoded marker: `<sentinel><family>:<name><sentinel>`. */
const MARKER_RE = new RegExp(`${SENTINEL}([a-z]+):([a-zA-Z0-9-]+)${SENTINEL}`, 'g');

/** Encode a resolved icon (family + name) as an embeddable text marker. */
export function iconMarker(family: IconFamily, name: string): string {
  return `${SENTINEL}${family}:${name}${SENTINEL}`;
}

/** True when a string contains at least one encoded icon marker. */
export function hasIconMarker(value: string): boolean {
  return value.includes(SENTINEL);
}

/** Remove every icon marker, leaving a clean plain-text projection. */
export function stripIconMarkers(value: string): string {
  return value.replace(MARKER_RE, '');
}

/** A run of a marker-bearing string: literal text or a resolved icon. */
export type IconTextRun =
  | { type: 'text'; text: string }
  | { type: 'icon'; family: IconFamily; name: string };

/**
 * Split a string into ordered text/icon runs. Text between markers is
 * preserved verbatim, including whitespace; each marker becomes an icon run.
 */
export function splitIconMarkers(value: string): IconTextRun[] {
  const runs: IconTextRun[] = [];
  let lastIndex = 0;
  MARKER_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ type: 'text', text: value.slice(lastIndex, match.index) });
    }
    runs.push({
      type: 'icon',
      family: match[1] as IconFamily,
      name: match[2],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    runs.push({ type: 'text', text: value.slice(lastIndex) });
  }

  return runs;
}

/** FontAwesome CSS class for a resolved icon, e.g. `fa-solid fa-rocket`. */
export function iconClass(family: IconFamily, name: string): string {
  return `fa-${family} fa-${name}`;
}

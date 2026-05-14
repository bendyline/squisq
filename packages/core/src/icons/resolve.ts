/**
 * Icon Resolver
 *
 * Looks up a user-supplied token against the FontAwesome Free catalog.
 *
 * Tokens come in two forms:
 * - **Bare** (`github`) — resolves only when the name is unique across
 *   families. The picker prefers this form for friendliness.
 * - **Qualified** (`fa-brands:github`, `fa-solid:user`) — required when
 *   the name collides across families (e.g. `user` ships in both solid
 *   and regular).
 *
 * Returning `null` from `resolveIcon` is a deliberate signal: callers
 * should render the source token verbatim so authors can write
 * `{[notathing]}` in prose without it being silently swallowed.
 */

import { ICONS } from './iconData.js';
import type { IconEntry, IconFamily } from './iconData.js';

// Index built once per module: name → IconEntry[]. Multi-entry buckets
// indicate cross-family collisions that require a qualified token.
const BY_NAME = new Map<string, IconEntry[]>();
for (const entry of ICONS) {
  const bucket = BY_NAME.get(entry.name);
  if (bucket) bucket.push(entry);
  else BY_NAME.set(entry.name, [entry]);
}

const FAMILY_PREFIXES: Record<string, IconFamily> = {
  'fa-brands': 'brands',
  'fa-solid': 'solid',
  'fa-regular': 'regular',
  brands: 'brands',
  solid: 'solid',
  regular: 'regular',
};

/**
 * True when a token looks like an icon reference. Used by the markdown
 * parser to decide whether a `{[…]}` body in a heading is worth probing
 * (the heading-template path already extracted the trailing annotation
 * by the time inline detection runs).
 */
export function looksLikeIconToken(token: string): boolean {
  return /^[a-zA-Z0-9_:-]+$/.test(token);
}

/**
 * Resolve a token to an icon. Returns `null` when the token is unknown
 * OR when the bare form collides — callers should render `null` results
 * as literal markdown text so authors can opt out by qualifying.
 */
export function resolveIcon(token: string): IconEntry | null {
  if (!looksLikeIconToken(token)) return null;
  // Qualified form: `<family-prefix>:<name>`.
  const colon = token.indexOf(':');
  if (colon > 0) {
    const prefix = token.slice(0, colon);
    const name = token.slice(colon + 1);
    const family = FAMILY_PREFIXES[prefix];
    if (!family) return null;
    const bucket = BY_NAME.get(name);
    return bucket?.find((e) => e.family === family) ?? null;
  }
  // Bare form: must be unique across families.
  const bucket = BY_NAME.get(token);
  if (!bucket || bucket.length !== 1) return null;
  return bucket[0];
}

/**
 * The canonical "shortest unambiguous" token for an icon — bare if the
 * name is unique, otherwise the qualified form. Used when serializing
 * a resolved icon back to markdown so we don't gratuitously qualify
 * names that don't need it.
 */
export function canonicalIconToken(entry: IconEntry): string {
  const bucket = BY_NAME.get(entry.name);
  if (bucket && bucket.length === 1) return entry.name;
  return `fa-${entry.family}:${entry.name}`;
}

/**
 * Render the icon's Unicode codepoint as a single-character string.
 * Returns `''` for entries without a codepoint (defensive — FA always
 * has one). Used by editors and previews that want to display the
 * actual glyph using the FontAwesome font; pair with the right
 * font-family/font-weight for the icon's family.
 */
export function iconGlyph(entry: IconEntry): string {
  if (!entry.unicode) return '';
  const code = parseInt(entry.unicode, 16);
  if (!Number.isFinite(code)) return '';
  return String.fromCodePoint(code);
}

/** Single autocomplete suggestion. `score` ranks lower-is-better:
 *  0 = name starts-with query, 1 = name contains query,
 *  2 = keyword contains query. */
export interface IconSuggestion {
  entry: IconEntry;
  token: string;
  score: number;
}

/**
 * Rank icons against a partial token typed by the user. Used by the
 * Monaco completion provider in editor-react and re-exported so any
 * host can build its own typeahead.
 */
export function suggestIcons(query: string, limit = 50): IconSuggestion[] {
  const q = query.trim().toLowerCase();
  const matches: IconSuggestion[] = [];
  for (const icon of ICONS) {
    let score = -1;
    if (!q) {
      // Empty query — surface a few common icons. We just walk in
      // order; the limit cuts it off.
      score = 3;
    } else if (icon.name.startsWith(q)) {
      score = 0;
    } else if (icon.name.includes(q)) {
      score = 1;
    } else if (icon.keywords.includes(q)) {
      score = 2;
    }
    if (score < 0) continue;
    matches.push({ entry: icon, token: canonicalIconToken(icon), score });
    if (matches.length > 400) break; // hard cap before sort
  }
  matches.sort(
    (a, b) =>
      a.score - b.score ||
      a.token.length - b.token.length ||
      a.token.localeCompare(b.token),
  );
  return matches.slice(0, limit);
}

export type { IconEntry, IconFamily };

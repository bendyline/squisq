/**
 * Frontmatter serialization for user-defined custom themes.
 *
 * The theme analog of {@link ./customTemplatesFrontmatter.ts}. Custom Theme
 * definitions live in the document's YAML frontmatter under the key
 * `squisq-custom-themes`, stored as a single **compact JSON** object keyed
 * by theme id:
 *
 * ```yaml
 * squisq-custom-themes: {"my-brand":{"schemaVersion":"1","id":"my-brand",…}}
 * ```
 *
 * Squisq's frontmatter parser is line-based; a JSON object literal
 * round-trips through it verbatim (single line, no leading quote to strip),
 * so the value is written **unquoted** and stays human-readable and diffable
 * — the same mechanism the custom-templates codec relies on.
 *
 * Only one theme is *active* per doc (selected by id via the `squisq-theme`
 * frontmatter key / `Doc.themeId`), but the payload is a keyed map — parallel
 * to custom templates — so a doc can carry a small catalog and switch between
 * them, and `resolveThemeForDoc` can resolve any of them doc-scoped.
 *
 * Malformed entries are dropped (via `validateTheme`) rather than failing the
 * whole doc load, matching the tolerant behavior of the templates reader.
 */

import type { Theme } from '../schemas/Theme.js';
import { FRONTMATTER_CUSTOM_THEMES_KEY } from '../schemas/Theme.js';
import { validateTheme } from '../schemas/themeValidator.js';

/** Re-export for callers that need the canonical key spelling. */
export { FRONTMATTER_CUSTOM_THEMES_KEY };

/**
 * Normalize the raw frontmatter value into an array of candidate objects.
 * Accepts, in order: a JSON string (current, from the line-based parser),
 * an already-parsed object map (keyed by id), and an array (in case a richer
 * YAML parser delivers one). Returns undefined when absent/unparseable.
 */
function normalizeCandidates(raw: unknown): unknown[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  let value: unknown = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>);
  }
  return undefined;
}

/**
 * Read the custom themes inlined into a document's frontmatter. Returns
 * undefined when the key is absent or holds no valid theme, so callers can
 * omit the field from the Doc.
 */
export function readCustomThemesFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
): Theme[] | undefined {
  if (!frontmatter) return undefined;
  const candidates = normalizeCandidates(frontmatter[FRONTMATTER_CUSTOM_THEMES_KEY]);
  if (!candidates) return undefined;
  const out: Theme[] = [];
  for (const entry of candidates) {
    const result = validateTheme(entry);
    if (result.valid && result.theme) out.push(result.theme);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Encode a list of custom themes into the compact JSON object described in
 * the module header (keyed by theme id). Returns undefined when the input is
 * empty so callers can leave the key off the output.
 */
export function writeCustomThemesToFrontmatter(
  themes: readonly Theme[] | undefined,
): string | undefined {
  if (!themes || themes.length === 0) return undefined;
  const map: Record<string, Theme> = {};
  for (const theme of themes) map[theme.id] = theme;
  return JSON.stringify(map);
}

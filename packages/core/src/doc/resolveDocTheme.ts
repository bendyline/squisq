/**
 * Doc-scoped theme resolution.
 *
 * The theme analog of how `buildRegistry` resolves custom templates: pure and
 * doc-scoped, with no global state. `resolveThemeForDoc` looks up the active
 * theme id in the doc's own custom themes first, then falls back to an
 * optional caller-owned registry, then built-ins via `resolveTheme`.
 *
 * It accepts either a squisq `Doc` (which carries a typed `customThemes`
 * array) or anything with raw `frontmatter` — notably a `MarkdownDocument`,
 * which is the shape every export pipeline pivots through. In the latter case
 * the inline themes are decoded from the `squisq-custom-themes` frontmatter
 * payload. Inline custom themes ship with the doc, exactly like custom
 * templates; host-level themes can be supplied through an explicit registry.
 */

import type { Theme, ThemeRegistry } from '../schemas/Theme.js';
import { resolveTheme } from '../schemas/themeLibrary.js';
import { readFrontmatterThemeId } from '../markdown/utils.js';
import { readCustomThemesFromFrontmatter } from './customThemesFrontmatter.js';

/**
 * The minimal shape `resolveThemeForDoc` needs. Satisfied by both the squisq
 * `Doc` (typed `customThemes` + `themeId`) and a `MarkdownDocument` (raw
 * `frontmatter` carrying the encoded payload).
 */
export interface ThemeResolvable {
  themeId?: string;
  customThemes?: Theme[];
  frontmatter?: Record<string, unknown>;
}

/**
 * Resolve the Theme a document should render with.
 *
 * @param doc - the document (may carry inline custom themes plus a `themeId`
 *   / `squisq-theme` frontmatter selector).
 * @param explicitId - an id that overrides the doc's own selection (e.g. the
 *   editor's theme dropdown, or an export `--theme` option). When omitted, the
 *   doc's `themeId` / frontmatter theme id is used.
 * @returns the matching inline custom theme (doc-scoped) when present, else
 *   the caller-registry or built-in theme for that id, else the default theme.
 */
export function resolveThemeForDoc(
  doc: ThemeResolvable | null | undefined,
  explicitId?: string,
  registry?: ThemeRegistry,
): Theme {
  const id = explicitId ?? doc?.themeId ?? readFrontmatterThemeId(doc?.frontmatter);
  // Prefer the already-parsed list on a squisq Doc; otherwise decode the
  // frontmatter payload (the shape exports see on a MarkdownDocument).
  const inline = doc?.customThemes ?? readCustomThemesFromFrontmatter(doc?.frontmatter);
  const custom = id ? inline?.find((t) => t.id === id) : undefined;
  if (custom) return custom;
  return resolveTheme(id, registry);
}

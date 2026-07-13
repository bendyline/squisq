/**
 * Built-in Theme Library
 *
 * Public entry point for theme lookup. Built-in themes live as JSON
 * sidecars in [./themes/](./themes/) — they share the exact same shape
 * as customizer-authored themes (no two-tier distinction).
 *
 * Usage:
 * ```ts
 * import { THEMES, resolveTheme } from '@bendyline/squisq/schemas';
 *
 * const theme = resolveTheme('minimalist'); // built-in lookup by id
 * const theme = THEMES.documentary;         // direct access to a built-in
 * ```
 */

import type { Theme, ThemeRegistry } from './Theme.js';
import { BUILTIN_THEMES } from './themes/index.js';
import { cloneAndFreezeData } from '../internal/immutable.js';

/** All built-in themes, keyed by id. */
export const THEMES: Readonly<Record<string, Theme>> = Object.freeze(
  Object.fromEntries(
    Object.entries(BUILTIN_THEMES).map(([id, theme]) => [id, cloneAndFreezeData(theme)]),
  ),
);

/** The default theme id. */
export const DEFAULT_THEME_ID = 'standard';

/** The default theme (standard — safe system fonts, no external dependencies). */
export const DEFAULT_THEME: Theme = THEMES[DEFAULT_THEME_ID];

/**
 * Resolve a theme by id. When a caller-owned registry is supplied its themes
 * take precedence over built-ins; unknown ids fall back to the default.
 */
export function resolveTheme(id: string | undefined, registry?: ThemeRegistry): Theme {
  const registered = id ? registry?.get(id) : undefined;
  if (registered) return registered;
  if (id && id in THEMES) return THEMES[id];
  return DEFAULT_THEME;
}

/** Get built-in ids plus ids from an optional caller-owned registry. */
export function getAvailableThemes(registry?: ThemeRegistry): string[] {
  return Array.from(
    new Set([...Object.keys(THEMES), ...(registry?.list().map((theme) => theme.id) ?? [])]),
  );
}

/** Get summaries for built-ins plus an optional caller-owned registry. */
export function getThemeSummaries(
  registry?: ThemeRegistry,
): Array<{ id: string; name: string; description?: string }> {
  return getAvailableThemes(registry).map((id) => {
    const theme = resolveTheme(id, registry);
    return { id, name: theme.name, description: theme.description };
  });
}

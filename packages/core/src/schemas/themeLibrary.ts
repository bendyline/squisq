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
 * const theme = resolveTheme('minimalist'); // by id, with registry override
 * const theme = THEMES.documentary;         // direct access to a built-in
 * ```
 */

import type { Theme } from './Theme.js';
import { lookupRegisteredTheme } from './Theme.js';
import { BUILTIN_THEMES } from './themes/index.js';

/** All built-in themes, keyed by id. */
export const THEMES: Record<string, Theme> = BUILTIN_THEMES;

/** The default theme id. */
export const DEFAULT_THEME_ID = 'standard';

/** The default theme (standard — safe system fonts, no external dependencies). */
export const DEFAULT_THEME: Theme = THEMES[DEFAULT_THEME_ID];

/**
 * Resolve a theme by id. Custom themes registered via `registerTheme()`
 * take precedence over built-ins; otherwise built-ins are searched and
 * the default theme is returned for unknown ids.
 */
export function resolveTheme(id: string | undefined): Theme {
  const registered = lookupRegisteredTheme(id);
  if (registered) return registered;
  if (id && id in THEMES) return THEMES[id];
  return DEFAULT_THEME;
}

/** Get all built-in theme ids. */
export function getAvailableThemes(): string[] {
  return Object.keys(THEMES);
}

/** Get a summary of all built-in themes (id + name + description) for theme pickers. */
export function getThemeSummaries(): Array<{ id: string; name: string; description?: string }> {
  return Object.values(THEMES).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
  }));
}

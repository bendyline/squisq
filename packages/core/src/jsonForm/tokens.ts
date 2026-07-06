/**
 * Pure CSS-custom-property builder shared by `<JsonView>` (read-only, in
 * `@bendyline/squisq-react`) and `<JsonEditor>` (editable, in
 * `@bendyline/squisq-editor-react`).
 *
 * Both components derive an identical token bag from a Theme + resolved
 * Surface; they differ only in the CSS-var prefix (`--squisq-json` vs
 * `--squisq-jsonform`) so the viewer and editor can coexist on one page.
 * This function is the single source of that derivation. It is pure and
 * framework-free: it performs no `window` / `matchMedia` access — the
 * surface must already be resolved to a concrete `SurfaceScheme` (or left
 * `undefined` to skip surface application) by the calling React hook.
 */

import { applySurface, DEFAULT_THEME, resolveFontFamily } from '../schemas/index.js';
import type { SurfaceScheme, Theme } from '../schemas/index.js';

export interface BuildJsonFormTokensOptions {
  /**
   * CSS-var prefix WITHOUT the trailing dash, e.g. `--squisq-json` or
   * `--squisq-jsonform`. Each token key is `${prefix}-${name}`.
   */
  prefix: string;
}

/**
 * Build the CSS custom-property map for a JSON form/view surface.
 *
 * @param theme   The theme to render with (falls back to `DEFAULT_THEME`).
 * @param surface Already-resolved concrete surface, or `undefined` to leave
 *                the theme un-surfaced. (The `'auto'` → concrete resolution
 *                is the React hook's job, so this stays pure.)
 * @param options `{ prefix }` — the CSS-var namespace.
 */
export function buildJsonFormTokens(
  theme: Theme | undefined,
  surface: SurfaceScheme | undefined,
  options: BuildJsonFormTokensOptions,
): Record<string, string> {
  const { prefix } = options;
  const baseTheme = theme ?? DEFAULT_THEME;
  const finalTheme = surface ? applySurface(baseTheme, surface) : baseTheme;

  const titleFont = resolveFontFamily(finalTheme.typography.titleFont, 'system-ui, sans-serif');
  const bodyFont = resolveFontFamily(finalTheme.typography.bodyFont, 'system-ui, sans-serif');
  const monoFont = resolveFontFamily(
    finalTheme.typography.monoFont,
    'ui-monospace, Consolas, monospace',
  );

  return {
    [`${prefix}-bg`]: finalTheme.colors.background,
    [`${prefix}-text`]: finalTheme.colors.text,
    [`${prefix}-muted`]: finalTheme.colors.textMuted,
    [`${prefix}-primary`]: finalTheme.colors.primary,
    [`${prefix}-accent`]: finalTheme.colors.secondary,
    [`${prefix}-warning`]: finalTheme.colors.warning,
    [`${prefix}-border`]: `color-mix(in srgb, ${finalTheme.colors.textMuted} 35%, transparent)`,
    [`${prefix}-input-bg`]: finalTheme.colors.backgroundLight,
    [`${prefix}-title-font`]: titleFont,
    [`${prefix}-body-font`]: bodyFont,
    [`${prefix}-mono-font`]: monoFont,
    [`${prefix}-radius`]: `${finalTheme.style.borderRadius ?? 8}px`,
  };
}

/**
 * Resolve the effective theme after surface application — the companion to
 * `buildJsonFormTokens` for callers that also need the `Theme` object (both
 * hooks return it alongside the style bag).
 */
export function resolveJsonFormTheme(
  theme: Theme | undefined,
  surface: SurfaceScheme | undefined,
): Theme {
  const baseTheme = theme ?? DEFAULT_THEME;
  return surface ? applySurface(baseTheme, surface) : baseTheme;
}

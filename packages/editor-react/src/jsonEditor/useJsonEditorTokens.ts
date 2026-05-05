/**
 * Derive the CSS custom-property bag for `<JsonEditor>` from a Theme +
 * Surface. Mirrors the JsonView token hook in the react package, but
 * uses an editor-specific prefix so the two can coexist on a page.
 */

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import {
  applySurface,
  resolveFontFamily,
  type SurfaceScheme,
  type Theme,
  DEFAULT_THEME,
  DARK_SURFACE,
  LIGHT_SURFACE,
} from '@bendyline/squisq/schemas';

export interface JsonEditorTokens {
  style: CSSProperties;
  theme: Theme;
}

export function useJsonEditorTokens(
  theme: Theme | undefined,
  surface: SurfaceScheme | 'auto' | undefined,
): JsonEditorTokens {
  return useMemo(() => {
    const baseTheme = theme ?? DEFAULT_THEME;
    const resolvedSurface =
      surface === 'auto'
        ? typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-color-scheme: dark)').matches
          ? DARK_SURFACE
          : LIGHT_SURFACE
        : (surface ?? undefined);
    const finalTheme = resolvedSurface ? applySurface(baseTheme, resolvedSurface) : baseTheme;

    const titleFont = resolveFontFamily(finalTheme.typography.titleFont, 'system-ui, sans-serif');
    const bodyFont = resolveFontFamily(finalTheme.typography.bodyFont, 'system-ui, sans-serif');
    const monoFont = resolveFontFamily(
      finalTheme.typography.monoFont,
      'ui-monospace, Consolas, monospace',
    );

    const style: CSSProperties = {
      ['--squisq-jsonform-bg' as string]: finalTheme.colors.background,
      ['--squisq-jsonform-text' as string]: finalTheme.colors.text,
      ['--squisq-jsonform-muted' as string]: finalTheme.colors.textMuted,
      ['--squisq-jsonform-primary' as string]: finalTheme.colors.primary,
      ['--squisq-jsonform-accent' as string]: finalTheme.colors.secondary,
      ['--squisq-jsonform-warning' as string]: finalTheme.colors.warning,
      ['--squisq-jsonform-border' as string]: `color-mix(in srgb, ${finalTheme.colors.textMuted} 35%, transparent)`,
      ['--squisq-jsonform-input-bg' as string]: finalTheme.colors.backgroundLight,
      ['--squisq-jsonform-title-font' as string]: titleFont,
      ['--squisq-jsonform-body-font' as string]: bodyFont,
      ['--squisq-jsonform-mono-font' as string]: monoFont,
      ['--squisq-jsonform-radius' as string]: `${finalTheme.style.borderRadius ?? 8}px`,
    };

    return { style, theme: finalTheme };
  }, [theme, surface]);
}

/**
 * Derive the CSS custom-property bag for `<JsonView>` from a Theme + Surface.
 * Mirrors the pattern in LinearDocView so JsonView re-themes consistently
 * with the rest of Squisq.
 */

import { useMemo } from 'react';
import {
  applySurface,
  resolveFontFamily,
  type SurfaceScheme,
  type Theme,
} from '@bendyline/squisq/schemas';
import { DEFAULT_THEME } from '@bendyline/squisq/doc';
import { useAutoSurface } from '../hooks/useAutoSurface';

export interface JsonViewTokens {
  /** Inline style object to spread onto the root element. */
  style: React.CSSProperties;
  /** The effective theme (after surface application). */
  theme: Theme;
}

export function useJsonViewTokens(
  theme: Theme | undefined,
  surface: SurfaceScheme | 'auto' | undefined,
): JsonViewTokens {
  const auto = useAutoSurface(surface === 'auto');
  const effectiveSurface = surface === 'auto' ? auto : (surface ?? undefined);

  return useMemo(() => {
    const baseTheme = theme ?? DEFAULT_THEME;
    const finalTheme = effectiveSurface ? applySurface(baseTheme, effectiveSurface) : baseTheme;

    const titleFont = resolveFontFamily(finalTheme.typography.titleFont, 'system-ui, sans-serif');
    const bodyFont = resolveFontFamily(finalTheme.typography.bodyFont, 'system-ui, sans-serif');
    const monoFont = resolveFontFamily(
      finalTheme.typography.monoFont,
      'ui-monospace, Consolas, monospace',
    );

    const style: React.CSSProperties = {
      ['--squisq-json-bg' as string]: finalTheme.colors.background,
      ['--squisq-json-text' as string]: finalTheme.colors.text,
      ['--squisq-json-muted' as string]: finalTheme.colors.textMuted,
      ['--squisq-json-primary' as string]: finalTheme.colors.primary,
      ['--squisq-json-accent' as string]: finalTheme.colors.secondary,
      ['--squisq-json-border' as string]: `color-mix(in srgb, ${finalTheme.colors.textMuted} 35%, transparent)`,
      ['--squisq-json-title-font' as string]: titleFont,
      ['--squisq-json-body-font' as string]: bodyFont,
      ['--squisq-json-mono-font' as string]: monoFont,
      ['--squisq-json-radius' as string]: `${finalTheme.style.borderRadius ?? 8}px`,
    };

    return { style, theme: finalTheme };
  }, [theme, effectiveSurface]);
}

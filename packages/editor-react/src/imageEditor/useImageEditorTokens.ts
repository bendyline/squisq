/**
 * Derive `--squisq-image-editor-*` CSS custom properties from a Theme +
 * SurfaceScheme, mirroring `useJsonViewTokens` in squisq-react. Lets the
 * ImageEditor re-theme consistently with the rest of Squisq (light/dark
 * surface, theme palette, font family overrides).
 */

import { useMemo, type CSSProperties } from 'react';
import {
  applySurface,
  resolveFontFamily,
  type SurfaceScheme,
  type Theme,
} from '@bendyline/squisq/schemas';
import { DEFAULT_THEME } from '@bendyline/squisq/doc';
import { useAutoSurface } from '@bendyline/squisq-react';

export interface ImageEditorTokens {
  /** Inline style object to spread onto the root `.squisq-image-editor`. */
  style: CSSProperties;
  /** The effective theme (after surface application). */
  theme: Theme;
}

export function useImageEditorTokens(
  theme: Theme | undefined,
  surface: SurfaceScheme | 'auto' | undefined,
): ImageEditorTokens {
  const auto = useAutoSurface(surface === 'auto');
  const effectiveSurface = surface === 'auto' ? auto : (surface ?? undefined);

  return useMemo(() => {
    const baseTheme = theme ?? DEFAULT_THEME;
    const finalTheme = effectiveSurface ? applySurface(baseTheme, effectiveSurface) : baseTheme;

    const bg = finalTheme.colors.background;
    const text = finalTheme.colors.text;
    const muted = finalTheme.colors.textMuted;
    const accent = finalTheme.colors.primary;

    // Panel / control surfaces are derived by mixing toward the opposite
    // pole (text color), so the same recipe works for both light and dark
    // surfaces without conditional branches.
    const panelBg = `color-mix(in srgb, ${bg} 92%, ${text} 8%)`;
    const panelBorder = `color-mix(in srgb, ${bg} 80%, ${text} 20%)`;
    const controlBg = `color-mix(in srgb, ${bg} 86%, ${text} 14%)`;
    const controlBorder = `color-mix(in srgb, ${bg} 72%, ${text} 28%)`;
    const workspaceBg = `color-mix(in srgb, ${bg} 95%, ${text} 5%)`;

    const bodyFont = resolveFontFamily(
      finalTheme.typography.bodyFont,
      'system-ui, -apple-system, sans-serif',
    );

    const style: CSSProperties = {
      ['--squisq-image-editor-bg' as string]: bg,
      ['--squisq-image-editor-panel-bg' as string]: panelBg,
      ['--squisq-image-editor-panel-border' as string]: panelBorder,
      ['--squisq-image-editor-text' as string]: text,
      ['--squisq-image-editor-text-muted' as string]: muted,
      ['--squisq-image-editor-accent' as string]: accent,
      ['--squisq-image-editor-control-bg' as string]: controlBg,
      ['--squisq-image-editor-control-border' as string]: controlBorder,
      ['--squisq-image-editor-workspace-bg' as string]: workspaceBg,
      ['--squisq-image-editor-body-font' as string]: bodyFont,
    };

    return { style, theme: finalTheme };
  }, [theme, effectiveSurface]);
}

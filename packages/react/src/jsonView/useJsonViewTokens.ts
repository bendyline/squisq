/**
 * Derive the CSS custom-property bag for `<JsonView>` from a Theme + Surface.
 * Mirrors the pattern in LinearDocView so JsonView re-themes consistently
 * with the rest of Squisq.
 */

import { useMemo } from 'react';
import { type SurfaceScheme, type Theme } from '@bendyline/squisq/schemas';
import { buildJsonFormTokens, resolveJsonFormTheme } from '@bendyline/squisq/jsonForm';
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
    const style = buildJsonFormTokens(theme, effectiveSurface, {
      prefix: '--squisq-json',
    }) as unknown as React.CSSProperties;
    return { style, theme: resolveJsonFormTheme(theme, effectiveSurface) };
  }, [theme, effectiveSurface]);
}

/**
 * Derive the CSS custom-property bag for `<JsonEditor>` from a Theme +
 * Surface. Mirrors the JsonView token hook in the react package, but
 * uses an editor-specific prefix so the two can coexist on a page.
 */

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { type SurfaceScheme, type Theme } from '@bendyline/squisq/schemas';
import { buildJsonFormTokens, resolveJsonFormTheme } from '@bendyline/squisq/jsonForm';
import { useAutoSurface } from '@bendyline/squisq-react';

export interface JsonEditorTokens {
  style: CSSProperties;
  theme: Theme;
}

export function useJsonEditorTokens(
  theme: Theme | undefined,
  surface: SurfaceScheme | 'auto' | undefined,
): JsonEditorTokens {
  // Reactive `prefers-color-scheme` tracking (matches `<JsonView>`), so the
  // editor re-themes live when the OS switches light/dark under `'auto'`.
  const auto = useAutoSurface(surface === 'auto');
  const effectiveSurface = surface === 'auto' ? auto : (surface ?? undefined);

  return useMemo(() => {
    const style = buildJsonFormTokens(theme, effectiveSurface, {
      prefix: '--squisq-jsonform',
    }) as unknown as CSSProperties;
    return { style, theme: resolveJsonFormTheme(theme, effectiveSurface) };
  }, [theme, effectiveSurface]);
}

import { useEffect, useMemo, useState } from 'react';
import { relativeLuminance, type Theme } from '@bendyline/squisq/schemas';

/**
 * The WYSIWYG canvas only paints itself in the active Squisq theme's colors
 * when theme styling is set to "Fonts & colors" (View menu →
 * `data-theme-inheritance="fonts-colors"`). At the default setting the canvas
 * is the editor's own light/dark chrome instead, so handing Mermaid the
 * document theme's neutrals drops a light card into a dark editor.
 *
 * Swap only the neutral slots — page, surface, text — for the surface the
 * diagram is actually drawn on. Accents (primary, secondary, highlight,
 * warning) are left alone so the diagram keeps the theme's identity, which is
 * also what makes an adapted theme safe to feed straight into
 * `buildMermaidThemeVariables`.
 */

export type MermaidSurfaceScheme = 'light' | 'dark';

type SurfaceNeutrals = Pick<
  Theme['colors'],
  'background' | 'backgroundLight' | 'text' | 'textMuted'
>;

/** Mirrors `.squisq-editor-shell` / `.squisq-wysiwyg-editor` in editor.css. */
const EDITOR_SURFACE: Record<MermaidSurfaceScheme, SurfaceNeutrals> = {
  light: {
    background: '#ffffff',
    backgroundLight: '#f5f5f5',
    text: '#1f2937',
    textMuted: '#6b7280',
  },
  dark: {
    background: '#111827',
    backgroundLight: '#1f2937',
    text: '#e5e7eb',
    textMuted: '#9ca3af',
  },
};

/** Same test `buildMermaidThemeVariables` uses to set Mermaid's `darkMode`. */
export function mermaidSurfaceScheme(theme: Theme): MermaidSurfaceScheme {
  return relativeLuminance(theme.colors.background) < 0.5 ? 'dark' : 'light';
}

export function adaptThemeToSurface(theme: Theme, scheme: MermaidSurfaceScheme): Theme {
  return { ...theme, colors: { ...theme.colors, ...EDITOR_SURFACE[scheme] } };
}

interface HostSurface {
  scheme: MermaidSurfaceScheme;
  inheritsThemeColors: boolean;
}

function readHostSurface(host: HTMLElement | null | undefined): HostSurface {
  const inheritance = host?.closest<HTMLElement>('[data-theme-inheritance]')?.dataset
    .themeInheritance;
  return {
    scheme: host?.closest<HTMLElement>('[data-theme]')?.dataset.theme === 'dark' ? 'dark' : 'light',
    inheritsThemeColors: inheritance === 'fonts-colors',
  };
}

function applyHostSurface(surface: HostSurface, theme: Theme): Theme {
  return surface.inheritsThemeColors ? theme : adaptThemeToSurface(theme, surface.scheme);
}

/**
 * Resolve the theme a Mermaid widget mounted under `host` should render with.
 * Tiptap mounts each widget in its own React root, so the surrounding editor
 * chrome is only reachable through the host element's ancestors.
 */
export function resolveMermaidSurfaceTheme(
  host: HTMLElement | null | undefined,
  theme: Theme,
): Theme {
  return applyHostSurface(readHostSurface(host), theme);
}

/** Reactive `resolveMermaidSurfaceTheme` — re-resolves when the shell retints. */
export function useMermaidSurfaceTheme(host: HTMLElement | null | undefined, theme: Theme): Theme {
  const [surface, setSurface] = useState<HostSurface>(() => readHostSurface(host));
  useEffect(() => {
    // Re-resolving to an equal surface must keep the same object: the canvas
    // rerenders its diagram whenever the theme identity changes.
    const sync = () =>
      setSurface((current) => {
        const next = readHostSurface(host);
        return current.scheme === next.scheme &&
          current.inheritsThemeColors === next.inheritsThemeColors
          ? current
          : next;
      });
    sync();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(sync);
    const ancestors = new Set(
      [
        host?.closest<HTMLElement>('[data-theme]'),
        host?.closest<HTMLElement>('[data-theme-inheritance]'),
      ].filter((element): element is HTMLElement => Boolean(element)),
    );
    for (const ancestor of ancestors) {
      observer.observe(ancestor, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-theme-inheritance'],
      });
    }
    return () => observer.disconnect();
  }, [host]);
  return useMemo(() => applyHostSurface(surface, theme), [surface, theme]);
}

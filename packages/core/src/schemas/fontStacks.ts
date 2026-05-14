/**
 * Font Stacks
 *
 * Curated registry of font families used by built-in themes and offered in
 * the theme customizer. Each stack has a stable `id` (referenced by JSON
 * theme files via `{ stackId }`) and a CSS `family` string that resolves
 * to the actual font when rendered.
 *
 * Themes never carry raw CSS font strings — they reference a `stackId` or
 * specify a `{ custom: { name, fallback } }` form, both of which resolve
 * here at render time.
 */

import type { FontFamily, FontFamilyKind } from './Theme.js';

export interface FontStack {
  /** Stable identifier referenced by Theme JSON. */
  id: string;
  /** Display label for pickers. */
  label: string;
  /** Full CSS font-family string with safe fallbacks. */
  family: string;
  /** Categorical bucket for the picker UI. */
  kind: FontFamilyKind;
  /**
   * Google Fonts family name, when this stack is served by Google Fonts.
   * Used by exports that bundle a `<link>` to fonts.googleapis.com so the
   * face renders correctly even when the host page doesn't preload it.
   * Omit (or set to undefined) for purely system stacks.
   */
  googleFontFamily?: string;
}

/** All curated stacks, in the order they should appear in pickers. */
export const AVAILABLE_FONT_STACKS: FontStack[] = [
  // System defaults
  {
    id: 'system-sans',
    label: 'System Sans',
    family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    kind: 'sans',
  },
  {
    id: 'system-serif',
    label: 'System Serif',
    family: 'Georgia, "Times New Roman", serif',
    kind: 'serif',
  },
  {
    id: 'system-mono',
    label: 'System Mono',
    family: 'Consolas, "Courier New", monospace',
    kind: 'mono',
  },
  // Curated Google Fonts. `googleFontFamily` is the canonical family
  // name Google serves the face under (used by exports that emit a
  // `<link rel="stylesheet" href="https://fonts.googleapis.com/...">`
  // so the face renders even when the host doesn't preload it).
  {
    id: 'inter',
    label: 'Inter',
    family: '"Inter", "Segoe UI", Roboto, sans-serif',
    kind: 'sans',
    googleFontFamily: 'Inter',
  },
  {
    id: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    family: '"IBM Plex Sans", "Segoe UI", Roboto, sans-serif',
    kind: 'sans',
    googleFontFamily: 'IBM Plex Sans',
  },
  {
    id: 'roboto',
    label: 'Roboto',
    family: '"Roboto", "Segoe UI", Arial, sans-serif',
    kind: 'sans',
    googleFontFamily: 'Roboto',
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    family: '"DM Sans", "Segoe UI", Roboto, sans-serif',
    kind: 'sans',
    googleFontFamily: 'DM Sans',
  },
  {
    id: 'oswald',
    label: 'Oswald',
    family: '"Oswald", Impact, "Arial Black", sans-serif',
    kind: 'display',
    googleFontFamily: 'Oswald',
  },
  {
    id: 'playfair',
    label: 'Playfair Display',
    family: '"Playfair Display", Georgia, serif',
    kind: 'serif',
    googleFontFamily: 'Playfair Display',
  },
  {
    id: 'source-serif',
    label: 'Source Serif',
    family: '"Source Serif 4", "PT Serif", Georgia, serif',
    kind: 'serif',
    googleFontFamily: 'Source Serif 4',
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    family: '"Merriweather", Georgia, serif',
    kind: 'serif',
    googleFontFamily: 'Merriweather',
  },
  {
    id: 'lora',
    label: 'Lora',
    family: '"Lora", "Merriweather", Georgia, serif',
    kind: 'serif',
    googleFontFamily: 'Lora',
  },
  {
    id: 'pt-serif',
    label: 'PT Serif',
    family: '"PT Serif", Georgia, serif',
    kind: 'serif',
    googleFontFamily: 'PT Serif',
  },
  {
    id: 'crimson',
    label: 'Crimson Text',
    family: '"Crimson Text", Georgia, serif',
    kind: 'serif',
    googleFontFamily: 'Crimson Text',
  },
  {
    id: 'cormorant',
    label: 'Cormorant Garamond',
    family: '"Cormorant Garamond", Garamond, Georgia, serif',
    kind: 'serif',
    googleFontFamily: 'Cormorant Garamond',
  },
  {
    id: 'dm-serif',
    label: 'DM Serif Display',
    family: '"DM Serif Display", Georgia, serif',
    kind: 'display',
    googleFontFamily: 'DM Serif Display',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: '"JetBrains Mono", "Fira Code", Consolas, monospace',
    kind: 'mono',
    googleFontFamily: 'JetBrains Mono',
  },
  // Themed system stacks with emoji fallbacks (used by gezellig)
  {
    id: 'system-sans-emoji',
    label: 'System Sans + Emoji',
    family:
      'system-ui, -apple-system, "Segoe UI", Roboto, "OpenMoji Color", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    kind: 'sans',
  },
  {
    id: 'system-serif-emoji',
    label: 'System Serif + Emoji',
    family:
      'Georgia, "Times New Roman", "OpenMoji Color", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif',
    kind: 'serif',
  },
];

const STACKS_BY_ID: Record<string, FontStack> = Object.fromEntries(
  AVAILABLE_FONT_STACKS.map((s) => [s.id, s]),
);

/** Look up a stack by id. Returns undefined if not registered. */
export function getFontStack(id: string): FontStack | undefined {
  return STACKS_BY_ID[id];
}

/** Default fallback CSS family per kind, used when a custom font has no fallback specified. */
const FALLBACK_BY_KIND: Record<FontFamilyKind, string> = {
  sans: 'system-ui, sans-serif',
  serif: 'Georgia, serif',
  mono: 'Consolas, monospace',
  display: 'Impact, Arial, sans-serif',
};

/**
 * Resolve a `FontFamily` reference (or legacy raw string) to a CSS family string.
 * Used by `getThemeFont` at render time. Never returns an empty string —
 * unrecognized stackIds fall back to the requested role's default.
 */
export function resolveFontFamily(
  family: FontFamily | string | undefined,
  roleFallback: string,
): string {
  if (!family) return roleFallback;
  if (typeof family === 'string') return family;
  if ('stackId' in family) {
    const stack = STACKS_BY_ID[family.stackId];
    return stack ? stack.family : roleFallback;
  }
  if ('custom' in family) {
    const { name, fallback } = family.custom;
    const fb =
      fallback === 'system-ui'
        ? 'system-ui, sans-serif'
        : fallback === 'serif'
          ? 'Georgia, serif'
          : fallback === 'monospace'
            ? 'Consolas, monospace'
            : 'system-ui, sans-serif';
    const safeName = name.includes(' ') || name.includes(',') ? `"${name}"` : name;
    return `${safeName}, ${fb}`;
  }
  return roleFallback;
}

/** Convenience: quick `{ stackId }` factory for code that constructs themes. */
export function fontStack(id: string): FontFamily {
  return { stackId: id };
}

/**
 * Build a `https://fonts.googleapis.com/css2?...` URL that loads the
 * subset of supplied `FontFamily` references that are served by Google
 * Fonts. Returns `null` when nothing in the list needs Google hosting
 * (system stacks, custom fonts, or unknown stack ids) — callers can use
 * that to skip emitting a `<link>` entirely.
 *
 * The URL requests regular + bold (400/700) for each family, which is
 * what the templates use. `display=swap` keeps the fallback visible
 * while the web font streams in.
 */
export function buildGoogleFontsUrl(families: Array<FontFamily | undefined>): string | null {
  const names = new Set<string>();
  for (const f of families) {
    if (!f || typeof f === 'string') continue;
    if ('stackId' in f) {
      const stack = STACKS_BY_ID[f.stackId];
      if (stack?.googleFontFamily) names.add(stack.googleFontFamily);
    }
  }
  if (names.size === 0) return null;
  // css2 syntax: ?family=Name+With+Spaces:wght@400;700&family=Other:wght@400;700&display=swap
  const params = Array.from(names)
    .sort()
    .map((name) => `family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;700`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/** Default fallback families exposed for tools that need them. */
export const FONT_FALLBACKS = FALLBACK_BY_KIND;

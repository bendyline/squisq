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
  // Curated Google Fonts (the host site loads them; Squisq does not)
  {
    id: 'inter',
    label: 'Inter',
    family: '"Inter", "Segoe UI", Roboto, sans-serif',
    kind: 'sans',
  },
  {
    id: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    family: '"IBM Plex Sans", "Segoe UI", Roboto, sans-serif',
    kind: 'sans',
  },
  {
    id: 'roboto',
    label: 'Roboto',
    family: '"Roboto", "Segoe UI", Arial, sans-serif',
    kind: 'sans',
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    family: '"DM Sans", "Segoe UI", Roboto, sans-serif',
    kind: 'sans',
  },
  {
    id: 'oswald',
    label: 'Oswald',
    family: '"Oswald", Impact, "Arial Black", sans-serif',
    kind: 'display',
  },
  {
    id: 'playfair',
    label: 'Playfair Display',
    family: '"Playfair Display", Georgia, serif',
    kind: 'serif',
  },
  {
    id: 'source-serif',
    label: 'Source Serif',
    family: '"Source Serif 4", "PT Serif", Georgia, serif',
    kind: 'serif',
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    family: '"Merriweather", Georgia, serif',
    kind: 'serif',
  },
  {
    id: 'lora',
    label: 'Lora',
    family: '"Lora", "Merriweather", Georgia, serif',
    kind: 'serif',
  },
  {
    id: 'pt-serif',
    label: 'PT Serif',
    family: '"PT Serif", Georgia, serif',
    kind: 'serif',
  },
  {
    id: 'crimson',
    label: 'Crimson Text',
    family: '"Crimson Text", Georgia, serif',
    kind: 'serif',
  },
  {
    id: 'cormorant',
    label: 'Cormorant Garamond',
    family: '"Cormorant Garamond", Garamond, Georgia, serif',
    kind: 'serif',
  },
  {
    id: 'dm-serif',
    label: 'DM Serif Display',
    family: '"DM Serif Display", Georgia, serif',
    kind: 'display',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: '"JetBrains Mono", "Fira Code", Consolas, monospace',
    kind: 'mono',
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

/** Default fallback families exposed for tools that need them. */
export const FONT_FALLBACKS = FALLBACK_BY_KIND;

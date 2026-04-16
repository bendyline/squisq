/**
 * Theme System
 *
 * A Theme bundles color palette, typography, visual style, render-style
 * algorithm, and per-block color schemes into one JSON-serializable object.
 * Builders choose a theme from the built-in library or create a custom one
 * via `createTheme(base, overrides)`.
 *
 * Design principles:
 * - Fully JSON-serializable (no functions) — storable in config / APIs.
 * - Doc carries an optional `themeId` pointer; resolution happens at render time.
 * - `createTheme` deep-merges a base theme with partial overrides.
 */

import type { LayoutHints } from './LayoutStrategy.js';
import type { AnimationType, TransitionType } from './Doc.js';
import type { PersistentLayerConfig } from './BlockTemplates.js';

// ============================================
// Color Palette
// ============================================

/**
 * Core color palette for a theme. Every color is a CSS color string.
 */
export interface ThemeColorPalette {
  /** Primary accent color */
  primary: string;
  /** Secondary accent color */
  secondary: string;
  /** Background color (typically dark) */
  background: string;
  /** Lighter background for contrast panels */
  backgroundLight: string;
  /** Main text color */
  text: string;
  /** Muted/secondary text color */
  textMuted: string;
  /** Highlight/emphasis color */
  highlight: string;
  /** Warning/alert color */
  warning: string;
}

/**
 * A named color scheme used by templates for per-block color variation
 * (e.g., statHighlight or sectionHeader).
 */
export interface ThemeColorScheme {
  /** Background fill */
  bg: string;
  /** Primary text tint */
  text: string;
  /** Accent / secondary tint */
  accent: string;
}

// ============================================
// Typography
// ============================================

/**
 * Typography settings for a theme.
 */
export interface ThemeTypography {
  /** Font family for body / description text */
  bodyFontFamily: string;
  /** Font family for titles and headings */
  titleFontFamily: string;
  /** Font family for code / monospaced text (optional) */
  monoFontFamily?: string;
  /** Multiplier applied to LayoutHints.titleScale (default 1.0) */
  titleScale?: number;
  /** Multiplier applied to LayoutHints.bodyScale (default 1.0) */
  bodyScale?: number;
  /** Default body line height (default 1.4) */
  lineHeight?: number;
  /** Default title line height */
  titleLineHeight?: number;
  /** Default title font weight */
  titleWeight?: 'normal' | 'bold';
}

// ============================================
// Visual Style
// ============================================

/**
 * Global visual-style knobs that templates consult.
 */
export interface ThemeStyle {
  /** Default border radius for cards / shapes (px) */
  borderRadius?: number;
  /** Whether templates should default to text shadows */
  textShadow?: boolean;
  /** Darkness of overlay on image-backed blocks (0–1) */
  overlayOpacity?: number;
  /** Multiplier on all animation durations (1.0 = normal, <1 faster, >1 slower) */
  animationSpeed?: number;
  /** Default horizontal padding for text (percentage string, e.g. "5%") */
  blockPadding?: string;
}

// ============================================
// Render Style
// ============================================

/**
 * Render-style algorithm preset. Controls layout tweaks, default animations,
 * transitions, and per-template behavioral hints.
 */
export interface RenderStyle {
  /** Identifier for this algorithmic approach (e.g. "documentary", "magazine") */
  name: string;
  /** Partial overrides merged onto the orientation-based LayoutHints */
  layoutOverrides?: Partial<LayoutHints>;
  /** Default entrance animation for text layers */
  defaultTextAnimation?: AnimationType;
  /** Default animation for background / image layers */
  defaultImageAnimation?: AnimationType;
  /** Whether to apply Ken Burns ambient motion to images by default */
  ambientMotion?: boolean;
  /** Default block-to-block transition */
  defaultTransition?: { type: TransitionType; duration?: number };
  /**
   * Per-template behavioral hints. Keys are template names, values are
   * string/number/boolean maps that templates can read to vary their output.
   *
   * @example
   * ```
   * { statHighlight: { entrance: 'dramatic' }, titleBlock: { showAccentLine: false } }
   * ```
   */
  templateHints?: Record<string, Record<string, string | number | boolean>>;
}

// ============================================
// Theme
// ============================================

/**
 * A complete, JSON-serializable theme definition.
 */
export interface Theme {
  /** Unique identifier (e.g. "documentary") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Short description for theme pickers */
  description?: string;
  /** Color palette */
  colors: ThemeColorPalette;
  /** Typography settings */
  typography: ThemeTypography;
  /** Global visual-style knobs */
  style: ThemeStyle;
  /** Algorithmic render-style preset */
  renderStyle: RenderStyle;
  /**
   * Named color schemes for per-block color variation.
   * Templates reference these by name (e.g. "blue", "warm").
   */
  colorSchemes: Record<string, ThemeColorScheme>;
  /** Optional persistent layers baked into the theme */
  persistentLayers?: PersistentLayerConfig;
}

// ============================================
// Deep-Partial helper type
// ============================================

/**
 * Recursively makes every property optional.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ============================================
// Helpers
// ============================================

/**
 * Deep-merge `source` into `target`, returning a new object.
 * Arrays are replaced wholesale (not concatenated).
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: DeepPartial<T>): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const srcVal = (source as Record<string, unknown>)[key];
    const tgtVal = (target as Record<string, unknown>)[key];
    if (
      srcVal !== null &&
      srcVal !== undefined &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      tgtVal !== undefined &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as DeepPartial<Record<string, unknown>>,
      );
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result as T;
}

/**
 * Create a new theme by deep-merging overrides onto a base theme.
 * The returned theme gets its own `id` if one is provided in overrides,
 * otherwise keeps the base theme's `id` suffixed with "-custom".
 *
 * @example
 * ```ts
 * const myTheme = createTheme(THEMES.documentary, {
 *   colors: { primary: '#ff0000' },
 *   typography: { bodyFontFamily: '"Inter", sans-serif' },
 * });
 * ```
 */
export function createTheme(base: Theme, overrides: DeepPartial<Theme>): Theme {
  const merged = deepMerge(
    base as unknown as Record<string, unknown>,
    overrides as DeepPartial<Record<string, unknown>>,
  ) as unknown as Theme;
  if (!overrides.id && merged.id === base.id) {
    merged.id = `${base.id}-custom`;
  }
  return merged;
}

// ============================================
// Surface Schemes — orthogonal to Theme
// ============================================

/**
 * A Surface Scheme is the light/dark axis, orthogonal to the editorial
 * identity of a Theme. A Theme chooses voice (serif vs sans, muted vs
 * bold, documentary vs magazine); a SurfaceScheme chooses what the paper
 * looks like. Any theme can render on either surface.
 *
 * When a SurfaceScheme is applied to a Theme (via `applySurface`), these
 * fields override the corresponding entries in `ThemeColorPalette` —
 * everything else (primary, highlight, warning, etc.) stays as the theme
 * defined it.
 */
export interface SurfaceScheme {
  /** Identifier — 'light', 'dark', or a custom id. */
  id: string;
  background: string;
  backgroundLight: string;
  text: string;
  textMuted: string;
}

/** Near-white paper with dark text — standard light mode. */
export const LIGHT_SURFACE: SurfaceScheme = {
  id: 'light',
  background: '#ffffff',
  backgroundLight: '#f5f5f5',
  text: '#1a1a1a',
  textMuted: '#666666',
};

/** Dark charcoal paper with light text — standard dark mode. */
export const DARK_SURFACE: SurfaceScheme = {
  id: 'dark',
  background: '#1a202c',
  backgroundLight: '#2d3748',
  text: '#f0f0f0',
  textMuted: '#a0aec0',
};

/**
 * Overlay a SurfaceScheme's surface colors onto a Theme's palette,
 * leaving everything else (primary, highlight, warning, typography,
 * style, renderStyle, colorSchemes) untouched. Returns a new Theme;
 * callers that want to preserve the original's id should set it
 * explicitly in the overrides.
 */
export function applySurface(theme: Theme, surface: SurfaceScheme): Theme {
  return {
    ...theme,
    colors: {
      ...theme.colors,
      background: surface.background,
      backgroundLight: surface.backgroundLight,
      text: surface.text,
      textMuted: surface.textMuted,
    },
  };
}

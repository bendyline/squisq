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
  const merged = deepMerge(base as unknown as Record<string, unknown>, overrides as DeepPartial<Record<string, unknown>>) as unknown as Theme;
  if (!overrides.id && merged.id === base.id) {
    merged.id = `${base.id}-custom`;
  }
  return merged;
}

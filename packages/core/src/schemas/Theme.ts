/**
 * Theme System
 *
 * A Theme bundles color palette, typography, visual style, render-style
 * algorithm, and per-block color schemes into one JSON-serializable object.
 *
 * Built-in themes and customizer-authored themes share this exact schema.
 * Customizer-authored themes additionally specify `seedColors` so the few
 * fields the user picked can be re-edited later; built-ins typically omit
 * `seedColors` and ship with explicit `colors` already filled in.
 *
 * Design principles:
 * - Fully JSON-serializable. No functions; no raw CSS font strings.
 * - Font families are structured `FontFamily` references resolved by
 *   `resolveFontFamily()` at render time.
 * - Doc carries an optional `themeId`; resolution happens at render time
 *   via `resolveTheme(id)`.
 * - `createTheme` deep-merges a base theme with partial overrides;
 *   `compileTheme` fills in defaults and derives missing color slots from
 *   `seedColors`; both produce a complete `Theme`.
 */

import type { LayoutHints } from './LayoutStrategy.js';
import type { AnimationType, TransitionType } from './Doc.js';
import type { PersistentLayerConfig } from './BlockTemplates.js';

// ============================================
// Schema version
// ============================================

/** Current Theme schema version. Bump on breaking changes; loader migrates. */
export const THEME_SCHEMA_VERSION = '1' as const;
export type ThemeSchemaVersion = typeof THEME_SCHEMA_VERSION;

// ============================================
// Color Palette
// ============================================

/**
 * Core color palette for a theme. Every color is a `#rrggbb` hex string.
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

/**
 * Optional authoring metadata. When present and `colors` is partial,
 * `compileTheme` derives missing color slots from these seeds via OKLCh
 * lightening / darkening. Round-trips a customizer-authored theme back
 * into editable form.
 */
export interface ThemeSeedColors {
  primary: string;
  secondary?: string;
  accent?: string;
  background?: string;
  text?: string;
}

// ============================================
// Typography
// ============================================

/** Categorical bucket for a font family — drives default fallback. */
export type FontFamilyKind = 'sans' | 'serif' | 'mono' | 'display';

/**
 * Structured reference to a font family. Either a curated stack id (looked
 * up in `AVAILABLE_FONT_STACKS`) or a custom user-supplied name with a
 * structured fallback bucket. Themes never carry raw CSS family strings.
 */
export type FontFamily =
  | { stackId: string }
  | {
      custom: {
        name: string;
        fallback: 'serif' | 'sans-serif' | 'monospace' | 'system-ui';
      };
    };

/**
 * Typography settings for a theme.
 */
export interface ThemeTypography {
  /** Font family for body / description text */
  bodyFont: FontFamily;
  /** Font family for titles and headings */
  titleFont: FontFamily;
  /** Font family for code / monospaced text (optional) */
  monoFont?: FontFamily;
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
   * Templates that consume hints publish a `hintSchema` export documenting
   * the keys they recognise.
   */
  templateHints?: Record<string, Record<string, string | number | boolean>>;
}

// ============================================
// Theme
// ============================================

/**
 * A complete, JSON-serializable theme definition. Built-in and customizer-
 * authored themes share this exact shape.
 */
export interface Theme {
  /** Schema version. Always '1' for now. */
  schemaVersion: ThemeSchemaVersion;
  /** Unique identifier (e.g. "documentary") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Short description for theme pickers */
  description?: string;
  /** Optional authoring seeds (customizer fills these; built-ins typically omit) */
  seedColors?: ThemeSeedColors;
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
 */
export function createTheme(base: Theme, overrides: DeepPartial<Theme>): Theme {
  const merged = deepMerge(
    base as unknown as Record<string, unknown>,
    overrides as DeepPartial<Record<string, unknown>>,
  ) as unknown as Theme;
  if (!overrides.id && merged.id === base.id) {
    merged.id = `${base.id}-custom`;
  }
  if (!merged.schemaVersion) merged.schemaVersion = THEME_SCHEMA_VERSION;
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
 * style, renderStyle, colorSchemes) untouched.
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

// ============================================
// Runtime registry — for custom themes
// ============================================

const CUSTOM_THEME_REGISTRY = new Map<string, Theme>();

/**
 * Register a Theme so it can be looked up by id via `resolveTheme(id)`.
 * Lets `Doc.themeId` round-trip through Doc serialization for custom themes.
 *
 * Registered themes take precedence over built-ins with the same id.
 */
export function registerTheme(theme: Theme): void {
  CUSTOM_THEME_REGISTRY.set(theme.id, theme);
}

/** Remove a previously registered theme. */
export function unregisterTheme(id: string): void {
  CUSTOM_THEME_REGISTRY.delete(id);
}

/** Snapshot of all currently registered (non-built-in) themes. */
export function getRegisteredThemes(): Theme[] {
  return Array.from(CUSTOM_THEME_REGISTRY.values());
}

/** @internal — used by themeLibrary's `resolveTheme` to check the registry first. */
export function lookupRegisteredTheme(id: string | undefined): Theme | undefined {
  if (!id) return undefined;
  return CUSTOM_THEME_REGISTRY.get(id);
}

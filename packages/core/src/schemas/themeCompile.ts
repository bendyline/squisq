/**
 * Theme Compilation
 *
 * Turns a partial Theme (typically authored by the customizer panel from
 * a few seed colors and preset choices) into a complete, validated Theme
 * by:
 *
 *   1. Filling unspecified fields from a hardcoded `STARTER_THEME`.
 *   2. Deriving missing color slots from `seedColors` via OKLCh math.
 *   3. Validating the result.
 *
 * Built-in themes ship as fully-specified Theme JSON and skip this step.
 */

import type {
  Theme,
  DeepPartial,
  ThemeColorPalette,
  ThemeColorScheme,
  ThemeSeedColors,
  FontFamily,
} from './Theme.js';
import { THEME_SCHEMA_VERSION, createTheme } from './Theme.js';
import { assertTheme } from './themeValidator.js';
import {
  oklchLighten,
  oklchDarken,
  oklchSetChroma,
  pickContrastingText,
  relativeLuminance,
} from './colorUtils.js';

/** Internal default theme used to fill in fields the customizer doesn't expose. */
const STARTER_BODY_FONT: FontFamily = { stackId: 'system-sans' };
const STARTER_TITLE_FONT: FontFamily = { stackId: 'system-serif' };
const STARTER_MONO_FONT: FontFamily = { stackId: 'system-mono' };

const STARTER_COLOR_SCHEMES: Record<string, ThemeColorScheme> = {
  blue: { bg: '#1a365d', text: '#63b3ed', accent: '#90cdf4' },
  green: { bg: '#22543d', text: '#9ae6b4', accent: '#68d391' },
  purple: { bg: '#44337a', text: '#d6bcfa', accent: '#b794f4' },
  red: { bg: '#742a2a', text: '#fc8181', accent: '#feb2b2' },
  orange: { bg: '#744210', text: '#fbd38d', accent: '#f6ad55' },
  teal: { bg: '#234e52', text: '#81e6d9', accent: '#4fd1c5' },
};

export const STARTER_THEME: Theme = {
  schemaVersion: THEME_SCHEMA_VERSION,
  id: 'custom',
  name: 'Custom Theme',
  description: 'Customizer starter — gets overridden by user choices.',
  colors: {
    primary: '#3182ce',
    secondary: '#4a5568',
    background: '#1a202c',
    backgroundLight: '#2d3748',
    text: '#f7fafc',
    textMuted: '#a0aec0',
    highlight: '#4299e1',
    warning: '#fc8181',
  },
  typography: {
    bodyFont: STARTER_BODY_FONT,
    titleFont: STARTER_TITLE_FONT,
    monoFont: STARTER_MONO_FONT,
    titleWeight: 'bold',
  },
  style: {
    textShadow: true,
    overlayOpacity: 0.45,
    animationSpeed: 1.0,
    borderRadius: 6,
  },
  renderStyle: {
    name: 'standard',
    defaultTextAnimation: 'fadeIn',
    defaultImageAnimation: 'slowZoom',
    ambientMotion: true,
    defaultTransition: { type: 'fade', duration: 0.7 },
  },
  colorSchemes: STARTER_COLOR_SCHEMES,
};

/**
 * Derive a full `ThemeColorPalette` from `seedColors`, with any explicit
 * `partialColors` taking precedence over derived values. Background and
 * text are guessed from luminance when the user gave only a primary.
 */
export function deriveColorPalette(
  seeds: ThemeSeedColors,
  partialColors: Partial<ThemeColorPalette> = {},
  opts: { contrast?: 'subtle' | 'balanced' | 'high' } = {},
): ThemeColorPalette {
  const spread = opts.contrast === 'high' ? 0.22 : opts.contrast === 'subtle' ? 0.08 : 0.15;

  const primary = seeds.primary;
  const secondary = seeds.secondary ?? oklchSetChroma(oklchLighten(primary, 0.05), 0.5);
  const accent = seeds.accent ?? oklchLighten(primary, spread);

  // Decide light vs dark surface from the explicit background, the seed background,
  // or default to dark.
  const bgSeed = partialColors.background ?? seeds.background;
  let background: string;
  if (bgSeed) {
    background = bgSeed;
  } else {
    // Pick a dark or light background that contrasts with primary
    background = relativeLuminance(primary) > 0.5 ? '#0a0a0a' : '#1a202c';
  }
  const isLightSurface = relativeLuminance(background) > 0.5;

  const backgroundLight =
    partialColors.backgroundLight ??
    (isLightSurface ? oklchDarken(background, 0.04) : oklchLighten(background, 0.04));

  const text =
    partialColors.text ?? seeds.text ?? pickContrastingText(background, '#f7fafc', '#1a202c');
  const textMuted =
    partialColors.textMuted ??
    (isLightSurface ? oklchLighten(text, 0.25) : oklchDarken(text, 0.25));

  const highlight = partialColors.highlight ?? accent;
  const warning = partialColors.warning ?? '#fc8181';

  return {
    primary: partialColors.primary ?? primary,
    secondary: partialColors.secondary ?? secondary,
    background,
    backgroundLight,
    text,
    textMuted,
    highlight,
    warning,
  };
}

/** Map a contrast preset to numeric spread used by `deriveColorPalette`. */
export type ContrastPreset = 'subtle' | 'balanced' | 'high';

export interface CompileOptions {
  /** Contrast level for OKLCh derivation (default 'balanced'). */
  contrast?: ContrastPreset;
}

/**
 * Compile a partial Theme into a complete one. Fills missing fields from
 * `STARTER_THEME`, derives missing color slots from `seedColors` (when
 * present), and validates the result.
 */
export function compileTheme(partial: DeepPartial<Theme>, opts: CompileOptions = {}): Theme {
  // Step 1: deep-merge over the starter
  const merged = createTheme(STARTER_THEME, partial);
  merged.schemaVersion = THEME_SCHEMA_VERSION;

  // Step 1b: typography fonts are discriminated unions ({stackId} | {custom}),
  // so deep-merge would leave stale keys from the starter when the partial
  // switches form. Replace each font wholesale when explicitly provided.
  const partialTypography = partial.typography;
  if (partialTypography) {
    if (partialTypography.titleFont !== undefined) {
      merged.typography.titleFont = partialTypography.titleFont as FontFamily;
    }
    if (partialTypography.bodyFont !== undefined) {
      merged.typography.bodyFont = partialTypography.bodyFont as FontFamily;
    }
    if (partialTypography.monoFont !== undefined) {
      merged.typography.monoFont = partialTypography.monoFont as FontFamily;
    }
  }

  // Step 2: derive missing color slots from seeds, if present
  if (merged.seedColors) {
    const partialColors = (partial.colors ?? {}) as Partial<ThemeColorPalette>;
    merged.colors = deriveColorPalette(merged.seedColors, partialColors, {
      contrast: opts.contrast,
    });
  }

  // Step 3: validate
  return assertTheme(merged, `compiled theme "${merged.id}"`);
}

/**
 * Parse a JSON string into a validated Theme. Throws on invalid input.
 */
export function parseTheme(json: string): Theme {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid theme JSON: ${msg}`);
  }
  return assertTheme(parsed, 'parsed theme');
}

/**
 * Serialize a Theme to a stable, pretty-printed JSON string. Round-trips
 * cleanly through `parseTheme`.
 */
export function serializeTheme(theme: Theme): string {
  return JSON.stringify(theme, null, 2);
}

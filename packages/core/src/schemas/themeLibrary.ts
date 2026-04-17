/**
 * Built-in Theme Library
 *
 * Ships 8 curated themes covering documentary, editorial, minimal, and
 * cinematic styles. Each theme is fully JSON-serializable.
 *
 * Usage:
 * ```ts
 * import { THEMES, resolveTheme } from '@bendyline/squisq/schemas';
 *
 * const theme = resolveTheme('minimalist'); // look up by id
 * const theme = THEMES.documentary;         // direct access
 * ```
 */

import type { Theme, ThemeColorScheme } from './Theme.js';

// ============================================
// Shared constants
// ============================================

// ── Font stacks ──────────────────────────────────────────────────
// Each stack lists the recommended Google Font first (works when the
// wrapping site loads it), then degrades to safe system fonts.
// Squisq itself does NOT load Google Fonts.

/** System fonts only — no external dependencies. */
const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SYSTEM_SERIF = 'Georgia, "Times New Roman", serif';
const SYSTEM_MONO = 'Consolas, "Courier New", monospace';

/** Theme-specific stacks with Google Font leads. */
const PLAYFAIR = '"Playfair Display", Georgia, serif';
const SOURCE_SERIF = '"Source Serif 4", "PT Serif", Georgia, serif';
const INTER = '"Inter", "Segoe UI", Roboto, sans-serif';
const OSWALD = '"Oswald", Impact, "Arial Black", sans-serif';
const ROBOTO = '"Roboto", "Segoe UI", Arial, sans-serif';
const MERRIWEATHER = '"Merriweather", Georgia, serif';
const LORA = '"Lora", "Merriweather", Georgia, serif';
const JETBRAINS_MONO = '"JetBrains Mono", "Fira Code", Consolas, monospace';
const IBM_PLEX_SANS = '"IBM Plex Sans", "Segoe UI", Roboto, sans-serif';
const DM_SERIF = '"DM Serif Display", Georgia, serif';
const DM_SANS = '"DM Sans", "Segoe UI", Roboto, sans-serif';
const CORMORANT = '"Cormorant Garamond", Garamond, Georgia, serif';
const CRIMSON = '"Crimson Text", Georgia, serif';
const PT_SERIF = '"PT Serif", Georgia, serif';

/** Standard 6-scheme set used by the documentary theme (migrated from old COLOR_SCHEMES). */
const CLASSIC_COLOR_SCHEMES: Record<string, ThemeColorScheme> = {
  blue: { bg: '#1a365d', text: '#63b3ed', accent: '#90cdf4' },
  green: { bg: '#22543d', text: '#9ae6b4', accent: '#68d391' },
  purple: { bg: '#44337a', text: '#d6bcfa', accent: '#b794f4' },
  red: { bg: '#742a2a', text: '#fc8181', accent: '#feb2b2' },
  orange: { bg: '#744210', text: '#fbd38d', accent: '#f6ad55' },
  teal: { bg: '#234e52', text: '#81e6d9', accent: '#4fd1c5' },
};

// ============================================
// 1. Standard (default — safe system fonts, no external dependencies)
// ============================================

const standard: Theme = {
  id: 'standard',
  name: 'Standard',
  description: 'Clean and safe. System fonts only — no external font dependencies.',
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
    bodyFontFamily: SYSTEM_SANS,
    titleFontFamily: SYSTEM_SERIF,
    monoFontFamily: SYSTEM_MONO,
    titleWeight: 'bold',
  },
  style: {
    textShadow: true,
    overlayOpacity: 0.45,
    animationSpeed: 1.0,
  },
  renderStyle: {
    name: 'standard',
    defaultTextAnimation: 'fadeIn',
    defaultImageAnimation: 'slowZoom',
    ambientMotion: true,
    defaultTransition: { type: 'fade', duration: 0.7 },
  },
  colorSchemes: CLASSIC_COLOR_SCHEMES,
  persistentLayers: {
    bottomLayers: [
      {
        template: 'gradientBackground',
        config: { type: 'gradientBackground', preset: 'dark-vignette' },
      },
    ],
  },
};

// ============================================
// 2. Documentary
// ============================================

const documentary: Theme = {
  id: 'documentary',
  name: 'Documentary',
  description: 'Classic dark cinematic look with elegant serif typography.',
  colors: {
    primary: '#3d5a80',
    secondary: '#63b3ed',
    background: '#1a202c',
    backgroundLight: '#2d3748',
    text: '#ffffff',
    textMuted: '#a0aec0',
    highlight: '#63b3ed',
    warning: '#fc8181',
  },
  typography: {
    bodyFontFamily: SOURCE_SERIF,
    titleFontFamily: PLAYFAIR,
    titleWeight: 'bold',
  },
  style: {
    textShadow: true,
    overlayOpacity: 0.5,
    animationSpeed: 1.0,
  },
  renderStyle: {
    name: 'documentary',
    defaultTextAnimation: 'fadeIn',
    defaultImageAnimation: 'slowZoom',
    ambientMotion: true,
    defaultTransition: { type: 'fade', duration: 0.8 },
  },
  colorSchemes: CLASSIC_COLOR_SCHEMES,
  persistentLayers: {
    bottomLayers: [
      {
        template: 'gradientBackground',
        config: { type: 'gradientBackground', preset: 'dark-vignette' },
      },
    ],
  },
};

// ============================================
// 2. Minimalist
// ============================================

const minimalist: Theme = {
  id: 'minimalist',
  name: 'Minimalist',
  description: 'Clean near-white background with sans-serif type and minimal animation.',
  colors: {
    primary: '#2d3748',
    secondary: '#4a5568',
    background: '#f7fafc',
    backgroundLight: '#edf2f7',
    text: '#1a202c',
    textMuted: '#718096',
    highlight: '#3182ce',
    warning: '#e53e3e',
  },
  typography: {
    bodyFontFamily: INTER,
    titleFontFamily: INTER,
    titleWeight: 'bold',
    lineHeight: 1.6,
  },
  style: {
    textShadow: false,
    overlayOpacity: 0.3,
    animationSpeed: 1.2,
    borderRadius: 8,
  },
  renderStyle: {
    name: 'minimalist',
    defaultTextAnimation: 'fadeIn',
    ambientMotion: false,
    defaultTransition: { type: 'fade', duration: 0.6 },
    templateHints: {
      titleBlock: { showAccentLine: false },
    },
  },
  colorSchemes: {
    blue: { bg: '#ebf8ff', text: '#2b6cb0', accent: '#3182ce' },
    green: { bg: '#f0fff4', text: '#276749', accent: '#38a169' },
    purple: { bg: '#faf5ff', text: '#553c9a', accent: '#805ad5' },
    red: { bg: '#fff5f5', text: '#c53030', accent: '#e53e3e' },
    orange: { bg: '#fffaf0', text: '#c05621', accent: '#dd6b20' },
    teal: { bg: '#e6fffa', text: '#285e61', accent: '#319795' },
  },
};

// ============================================
// 3. Bold
// ============================================

const bold: Theme = {
  id: 'bold',
  name: 'Bold',
  description: 'High-contrast black with vivid accents and dramatic animations.',
  colors: {
    primary: '#e53e3e',
    secondary: '#ed8936',
    background: '#000000',
    backgroundLight: '#1a1a1a',
    text: '#ffffff',
    textMuted: '#cbd5e0',
    highlight: '#f6e05e',
    warning: '#fc8181',
  },
  typography: {
    bodyFontFamily: ROBOTO,
    titleFontFamily: OSWALD,
    titleWeight: 'bold',
    titleScale: 1.15,
    bodyScale: 1.0,
    titleLineHeight: 1.1,
  },
  style: {
    textShadow: true,
    overlayOpacity: 0.6,
    animationSpeed: 0.8,
  },
  renderStyle: {
    name: 'bold',
    defaultTextAnimation: 'zoomIn',
    defaultImageAnimation: 'slowZoom',
    ambientMotion: true,
    defaultTransition: { type: 'dissolve', duration: 0.5 },
    templateHints: {
      statHighlight: { entrance: 'dramatic' },
      fullBleedQuote: { entrance: 'dramatic' },
    },
  },
  colorSchemes: {
    blue: { bg: '#1a202c', text: '#63b3ed', accent: '#90cdf4' },
    green: { bg: '#1a202c', text: '#48bb78', accent: '#68d391' },
    purple: { bg: '#1a202c', text: '#b794f4', accent: '#d6bcfa' },
    red: { bg: '#1a202c', text: '#fc8181', accent: '#feb2b2' },
    orange: { bg: '#1a202c', text: '#f6ad55', accent: '#fbd38d' },
    teal: { bg: '#1a202c', text: '#4fd1c5', accent: '#81e6d9' },
  },
};

// ============================================
// 4. Morning Light
// ============================================

const morningLight: Theme = {
  id: 'morning-light',
  name: 'Morning Light',
  description: 'Warm light background with dark text and gentle serif typography.',
  colors: {
    primary: '#744210',
    secondary: '#975a16',
    background: '#faf8f5',
    backgroundLight: '#f5f0eb',
    text: '#2d3748',
    textMuted: '#718096',
    highlight: '#dd6b20',
    warning: '#c53030',
  },
  typography: {
    bodyFontFamily: LORA,
    titleFontFamily: MERRIWEATHER,
    titleWeight: 'bold',
    lineHeight: 1.7,
  },
  style: {
    textShadow: false,
    overlayOpacity: 0.35,
    animationSpeed: 1.1,
    borderRadius: 4,
  },
  renderStyle: {
    name: 'morning-light',
    defaultTextAnimation: 'fadeIn',
    ambientMotion: false,
    defaultTransition: { type: 'fade', duration: 1.0 },
  },
  colorSchemes: {
    blue: { bg: '#ebf8ff', text: '#2c5282', accent: '#4299e1' },
    green: { bg: '#f0fff4', text: '#22543d', accent: '#48bb78' },
    purple: { bg: '#faf5ff', text: '#44337a', accent: '#9f7aea' },
    red: { bg: '#fff5f5', text: '#9b2c2c', accent: '#fc8181' },
    orange: { bg: '#fffaf0', text: '#744210', accent: '#ed8936' },
    teal: { bg: '#e6fffa', text: '#234e52', accent: '#38b2ac' },
  },
};

// ============================================
// 5. Tech Dark
// ============================================

const techDark: Theme = {
  id: 'tech-dark',
  name: 'Tech Dark',
  description: 'True black with neon cyan/green accents and monospace titles.',
  colors: {
    primary: '#00e5ff',
    secondary: '#00e676',
    background: '#0a0a0a',
    backgroundLight: '#1a1a2e',
    text: '#e0e0e0',
    textMuted: '#9e9e9e',
    highlight: '#00e5ff',
    warning: '#ff5252',
  },
  typography: {
    bodyFontFamily: IBM_PLEX_SANS,
    titleFontFamily: JETBRAINS_MONO,
    monoFontFamily: JETBRAINS_MONO,
    titleWeight: 'bold',
    titleScale: 0.9,
    lineHeight: 1.5,
  },
  style: {
    textShadow: true,
    overlayOpacity: 0.55,
    animationSpeed: 0.9,
    borderRadius: 2,
  },
  renderStyle: {
    name: 'tech-dark',
    defaultTextAnimation: 'typewriter',
    defaultImageAnimation: 'slowZoom',
    ambientMotion: true,
    defaultTransition: { type: 'dissolve', duration: 0.4 },
    templateHints: {
      statHighlight: { entrance: 'dramatic' },
    },
  },
  colorSchemes: {
    blue: { bg: '#0d1b2a', text: '#00b0ff', accent: '#40c4ff' },
    green: { bg: '#0d1b0d', text: '#00e676', accent: '#69f0ae' },
    purple: { bg: '#1a0d2e', text: '#d500f9', accent: '#ea80fc' },
    red: { bg: '#2e0d0d', text: '#ff5252', accent: '#ff8a80' },
    orange: { bg: '#2e1a0d', text: '#ff9100', accent: '#ffab40' },
    teal: { bg: '#0d2e2e', text: '#1de9b6', accent: '#64ffda' },
  },
};

// ============================================
// 6. Magazine
// ============================================

const magazine: Theme = {
  id: 'magazine',
  name: 'Magazine',
  description: 'Rich editorial palette with mixed serif/sans typography and slide transitions.',
  colors: {
    primary: '#c53030',
    secondary: '#2b6cb0',
    background: '#1a202c',
    backgroundLight: '#2d3748',
    text: '#f7fafc',
    textMuted: '#cbd5e0',
    highlight: '#ed8936',
    warning: '#fc8181',
  },
  typography: {
    bodyFontFamily: DM_SANS,
    titleFontFamily: DM_SERIF,
    titleWeight: 'bold',
    titleScale: 1.05,
    lineHeight: 1.5,
  },
  style: {
    textShadow: true,
    overlayOpacity: 0.45,
    animationSpeed: 1.0,
    borderRadius: 6,
  },
  renderStyle: {
    name: 'magazine',
    defaultTextAnimation: 'fadeIn',
    defaultImageAnimation: 'slowZoom',
    ambientMotion: true,
    defaultTransition: { type: 'slideLeft', duration: 0.7 },
  },
  colorSchemes: {
    blue: { bg: '#1a365d', text: '#90cdf4', accent: '#63b3ed' },
    green: { bg: '#1c4532', text: '#9ae6b4', accent: '#68d391' },
    purple: { bg: '#322659', text: '#d6bcfa', accent: '#b794f4' },
    red: { bg: '#63171b', text: '#feb2b2', accent: '#fc8181' },
    orange: { bg: '#652b19', text: '#fbd38d', accent: '#f6ad55' },
    teal: { bg: '#1d4044', text: '#81e6d9', accent: '#4fd1c5' },
  },
};

// ============================================
// 7. Cinematic
// ============================================

const cinematic: Theme = {
  id: 'cinematic',
  name: 'Cinematic',
  description: 'Ultra-dark with moody gradients, gold accents, and slow dissolve transitions.',
  colors: {
    primary: '#d69e2e',
    secondary: '#b7791f',
    background: '#0a0f1a',
    backgroundLight: '#1a202c',
    text: '#f7fafc',
    textMuted: '#a0aec0',
    highlight: '#ecc94b',
    warning: '#fc8181',
  },
  typography: {
    bodyFontFamily: CRIMSON,
    titleFontFamily: CORMORANT,
    titleWeight: 'bold',
    lineHeight: 1.5,
    titleLineHeight: 1.2,
  },
  style: {
    textShadow: true,
    overlayOpacity: 0.55,
    animationSpeed: 1.2,
  },
  renderStyle: {
    name: 'cinematic',
    defaultTextAnimation: 'fadeIn',
    defaultImageAnimation: 'slowZoom',
    ambientMotion: true,
    defaultTransition: { type: 'dissolve', duration: 1.2 },
    templateHints: {
      titleBlock: { showAccentLine: true },
    },
  },
  colorSchemes: {
    blue: { bg: '#0d1b2a', text: '#90cdf4', accent: '#63b3ed' },
    green: { bg: '#0d1b14', text: '#9ae6b4', accent: '#68d391' },
    purple: { bg: '#1a0d2e', text: '#d6bcfa', accent: '#b794f4' },
    red: { bg: '#2a0d0d', text: '#fc8181', accent: '#feb2b2' },
    orange: { bg: '#2a1a0d', text: '#fbd38d', accent: '#f6ad55' },
    teal: { bg: '#0d2a2a', text: '#81e6d9', accent: '#4fd1c5' },
  },
  persistentLayers: {
    bottomLayers: [
      {
        template: 'gradientBackground',
        config: { type: 'gradientBackground', preset: 'radial-dark' },
      },
    ],
  },
};

// ============================================
// 8. Warm Earth
// ============================================

const warmEarth: Theme = {
  id: 'warm-earth',
  name: 'Warm Earth',
  description: 'Natural warm tones with earthy browns and terracotta accents.',
  colors: {
    primary: '#9c4221',
    secondary: '#c05621',
    background: '#1c1410',
    backgroundLight: '#2d241e',
    text: '#faf5f0',
    textMuted: '#c4a882',
    highlight: '#dd6b20',
    warning: '#e53e3e',
  },
  typography: {
    bodyFontFamily: PT_SERIF,
    titleFontFamily: PT_SERIF,
    titleWeight: 'bold',
    lineHeight: 1.6,
  },
  style: {
    textShadow: true,
    overlayOpacity: 0.5,
    animationSpeed: 1.1,
  },
  renderStyle: {
    name: 'warm-earth',
    defaultTextAnimation: 'fadeIn',
    defaultImageAnimation: 'panLeft',
    ambientMotion: true,
    defaultTransition: { type: 'fade', duration: 0.9 },
  },
  colorSchemes: {
    blue: { bg: '#2a1f14', text: '#90cdf4', accent: '#63b3ed' },
    green: { bg: '#1e2a14', text: '#9ae6b4', accent: '#68d391' },
    purple: { bg: '#2a142a', text: '#d6bcfa', accent: '#b794f4' },
    red: { bg: '#2a1414', text: '#fc8181', accent: '#feb2b2' },
    orange: { bg: '#2a1e0a', text: '#fbd38d', accent: '#f6ad55' },
    teal: { bg: '#142a28', text: '#81e6d9', accent: '#4fd1c5' },
  },
  persistentLayers: {
    bottomLayers: [
      {
        template: 'gradientBackground',
        config: { type: 'gradientBackground', preset: 'earth-tones' },
      },
    ],
  },
};

// ============================================
// 9. Gezellig
// ============================================

/**
 * Warm sage + terracotta palette that matches the Gezel desktop app.
 * Background is a subtly orange-tinted near-black — a much warmer surface
 * than the standard `#1a202c`-family dark themes. Primary is Gezel's
 * accent orange (`#b0724c`); secondary is the titlebar sage (`#667f62`).
 *
 * Typography uses system fonts with emoji fallbacks at the tail of each
 * stack — `OpenMoji Color` first (picked up when the host app has loaded
 * its WOFF with `unicode-range` scoped to emoji codepoints), then the
 * platform emoji fonts. Hosts that haven't registered OpenMoji fall
 * through to the platform emoji font transparently.
 *
 * "Gezellig" — Dutch, roughly "cozy / companionable", which is the brand
 * direction of the Gezel app (an ensemble of AI gezels that feel like a
 * crew, not a robot). Works as a general-purpose warm dark theme outside
 * the app too.
 */
const GEZELLIG_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "OpenMoji Color", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const GEZELLIG_SERIF =
  'Georgia, "Times New Roman", "OpenMoji Color", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif';

const gezellig: Theme = {
  id: 'gezellig',
  name: 'Gezellig',
  description: 'Warm sage + terracotta palette inspired by the Gezel desktop app. Subtle orange-tinted dark background, cream text, sage and terracotta accents.',
  colors: {
    primary: '#b0724c',
    secondary: '#667f62',
    background: '#1f1a17',
    backgroundLight: '#2b2420',
    text: '#f3ede0',
    textMuted: '#a89b85',
    highlight: '#c0875d',
    warning: '#e07a6b',
  },
  typography: {
    bodyFontFamily: GEZELLIG_SANS,
    titleFontFamily: GEZELLIG_SERIF,
    monoFontFamily: SYSTEM_MONO,
    titleWeight: 'bold',
    lineHeight: 1.55,
  },
  style: {
    textShadow: false,
    overlayOpacity: 0.4,
    animationSpeed: 1.0,
    borderRadius: 6,
  },
  renderStyle: {
    name: 'gezellig',
    defaultTextAnimation: 'fadeIn',
    defaultImageAnimation: 'slowZoom',
    ambientMotion: false,
    defaultTransition: { type: 'fade', duration: 0.6 },
  },
  colorSchemes: {
    // Warm, earthen palette with a sage-green outlier for contrast.
    terracotta: { bg: '#3d2620', text: '#f3ede0', accent: '#c0875d' },
    sage: { bg: '#28332a', text: '#e3ead9', accent: '#8aa589' },
    amber: { bg: '#3d2e17', text: '#fbe3a8', accent: '#d4a149' },
    plum: { bg: '#2e1f2a', text: '#e8d4e0', accent: '#b088a5' },
    ink: { bg: '#1a1f26', text: '#d5dde8', accent: '#7b8fa8' },
    cream: { bg: '#f3ede0', text: '#2b2420', accent: '#b0724c' },
  },
};

// ============================================
// Theme Library
// ============================================

/**
 * All built-in themes, keyed by id.
 */
export const THEMES: Record<string, Theme> = {
  standard,
  documentary,
  minimalist,
  bold,
  'morning-light': morningLight,
  'tech-dark': techDark,
  magazine,
  cinematic,
  'warm-earth': warmEarth,
  gezellig,
};

/** The default theme id. */
export const DEFAULT_THEME_ID = 'standard';

/** The default theme (standard — safe system fonts, no external dependencies). */
export const DEFAULT_THEME: Theme = standard;

/**
 * Resolve a theme by id. Returns the default theme when `id` is
 * undefined or not found in the library.
 */
export function resolveTheme(id: string | undefined): Theme {
  if (id && id in THEMES) return THEMES[id];
  return DEFAULT_THEME;
}

/**
 * Get all available theme ids.
 */
export function getAvailableThemes(): string[] {
  return Object.keys(THEMES);
}

/**
 * Get a summary of all themes (id + name + description) for theme pickers.
 */
export function getThemeSummaries(): Array<{ id: string; name: string; description?: string }> {
  return Object.values(THEMES).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
  }));
}

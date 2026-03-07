/**
 * Viewport Configuration
 *
 * Defines viewport dimensions for doc rendering across different aspect ratios.
 * Templates use this configuration to adapt their layouts appropriately.
 *
 * Supported aspect ratios:
 * - landscape (16:9) - Default, standard video/presentation format
 * - portrait (9:16) - Vertical video, mobile stories
 * - square (1:1) - Social media posts
 * - standard (4:3) - Legacy presentation format
 */

/**
 * Viewport configuration for doc rendering.
 */
export interface ViewportConfig {
  /** Canonical width in virtual pixels */
  width: number;
  /** Canonical height in virtual pixels */
  height: number;
  /** Human-readable name for debugging/display */
  name: string;
}

/**
 * Standard viewport presets for common aspect ratios.
 */
export const VIEWPORT_PRESETS = {
  /** 16:9 landscape (default, 1080p) */
  landscape: { width: 1920, height: 1080, name: '16:9 Landscape' },
  /** 9:16 portrait (vertical video, stories) */
  portrait: { width: 1080, height: 1920, name: '9:16 Portrait' },
  /** 1:1 square (social media) */
  square: { width: 1080, height: 1080, name: '1:1 Square' },
  /** 4:3 standard (legacy) */
  standard: { width: 1440, height: 1080, name: '4:3 Standard' },
} as const;

/**
 * Viewport preset name.
 */
export type ViewportPreset = keyof typeof VIEWPORT_PRESETS;

/**
 * Viewport orientation derived from aspect ratio.
 */
export type ViewportOrientation = 'landscape' | 'portrait' | 'square';

/**
 * Get a viewport configuration from a preset name or return the config if already a ViewportConfig.
 */
export function getViewport(viewport: ViewportPreset | ViewportConfig): ViewportConfig {
  if (typeof viewport === 'string') {
    return VIEWPORT_PRESETS[viewport];
  }
  return viewport;
}

/**
 * Calculate font scale factor for a viewport.
 * Based on diagonal pixels relative to 1080p landscape reference.
 * This ensures text remains readable across different viewport sizes.
 */
export function calculateFontScale(viewport: ViewportConfig): number {
  const referenceDiagonal = Math.sqrt(1920 * 1920 + 1080 * 1080); // ~2203
  const currentDiagonal = Math.sqrt(viewport.width * viewport.width + viewport.height * viewport.height);
  return currentDiagonal / referenceDiagonal;
}

/**
 * Determine if viewport is landscape, portrait, or square.
 */
export function getViewportOrientation(viewport: ViewportConfig): ViewportOrientation {
  const ratio = viewport.width / viewport.height;
  // Allow small tolerance for "square" classification
  if (Math.abs(ratio - 1) < 0.05) return 'square';
  return ratio > 1 ? 'landscape' : 'portrait';
}

/**
 * Get aspect ratio as a string (e.g., "16:9", "9:16", "1:1").
 */
export function getAspectRatioString(viewport: ViewportConfig): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(viewport.width, viewport.height);
  return `${viewport.width / divisor}:${viewport.height / divisor}`;
}

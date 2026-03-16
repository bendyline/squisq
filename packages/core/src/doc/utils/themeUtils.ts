/**
 * Theme Utilities
 *
 * Template-facing helpers that read from the Theme object on the
 * TemplateContext. Templates call these instead of hard-coding style
 * decisions, so the same template code adapts to any theme.
 */

import type { TemplateContext } from '../../schemas/BlockTemplates.js';
import type { ThemeColorScheme, RenderStyle } from '../../schemas/Theme.js';
import type { AnimationType } from '../../schemas/Doc.js';

// ============================================
// Color Scheme Resolution
// ============================================

/** Fallback color scheme when a name is not found in the theme. */
const FALLBACK_COLOR_SCHEME: ThemeColorScheme = {
  bg: '#1a365d',
  text: '#63b3ed',
  accent: '#90cdf4',
};

/**
 * Resolve a named color scheme from the theme, with a safe fallback.
 * Templates call this instead of `COLOR_SCHEMES[name]`.
 */
export function resolveColorScheme(
  context: TemplateContext,
  name: string | undefined,
): ThemeColorScheme {
  const schemes = context.theme.colorSchemes;
  if (name && name in schemes) return schemes[name];
  // Fall back to first defined scheme, then hard fallback
  const keys = Object.keys(schemes);
  if (keys.length > 0) return schemes[keys[0]];
  return FALLBACK_COLOR_SCHEME;
}

// ============================================
// Font Sizing
// ============================================

/**
 * Calculate a theme-aware scaled font size.
 * Applies the theme's typography scale multipliers on top of the
 * viewport-based font scale from LayoutStrategy.
 *
 * @param basePx  Base font size designed for 1920×1080
 * @param context Template context (includes fontScale, layout, theme)
 * @param isTitle Whether this is title text (uses titleScale) or body (bodyScale)
 */
export function themedFontSize(
  basePx: number,
  context: TemplateContext,
  isTitle: boolean = false,
): number {
  const { fontScale, layout, theme } = context;

  // Base scale from viewport + orientation
  const layoutScale = isTitle ? layout.titleScale : layout.bodyScale;

  // Theme multiplier (defaults to 1.0 when not set)
  const themeScale = isTitle
    ? (theme.typography.titleScale ?? 1.0)
    : (theme.typography.bodyScale ?? 1.0);

  return Math.round(basePx * fontScale * layoutScale * themeScale);
}

// ============================================
// Animation Helpers
// ============================================

/**
 * Scale an animation duration by the theme's animationSpeed multiplier.
 * A speed of 1.0 returns the base duration unchanged.
 */
export function scaleAnimationDuration(baseDuration: number, context: TemplateContext): number {
  const speed = context.theme.style.animationSpeed ?? 1.0;
  return baseDuration * speed;
}

/**
 * Get the theme's default animation type for a layer kind.
 * Returns `undefined` when the theme doesn't specify one (template picks its own).
 */
export function getDefaultAnimation(
  context: TemplateContext,
  layerType: 'text' | 'image',
): AnimationType | undefined {
  const rs: RenderStyle = context.theme.renderStyle;
  return layerType === 'text' ? rs.defaultTextAnimation : rs.defaultImageAnimation;
}

// ============================================
// Style Helpers
// ============================================

/**
 * Whether the theme defaults to text shadows.
 * Templates should consult this when choosing `shadow: true/false`.
 */
export function shouldUseShadow(context: TemplateContext): boolean {
  return context.theme.style.textShadow ?? true;
}

/**
 * Get the theme's overlay opacity for image-backed blocks.
 */
export function getOverlayOpacity(context: TemplateContext): number {
  return context.theme.style.overlayOpacity ?? 0.5;
}

// ============================================
// Template Hint Access
// ============================================

/**
 * Read a per-template hint from the theme's renderStyle.
 * Returns `fallback` when the hint isn't defined.
 *
 * @example
 * ```ts
 * const entrance = getTemplateHint(context, 'statHighlight', 'entrance', 'subtle');
 * ```
 */
export function getTemplateHint<T extends string | number | boolean>(
  context: TemplateContext,
  templateName: string,
  key: string,
  fallback: T,
): T {
  const hints = context.theme.renderStyle.templateHints;
  if (!hints) return fallback;
  const tplHints = hints[templateName];
  if (!tplHints || !(key in tplHints)) return fallback;
  return tplHints[key] as T;
}

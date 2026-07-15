/**
 * Cover Block Template
 *
 * Full-screen hero image with title overlay, shown before playback starts.
 * This is the "poster for the doc, displaying the
 * article's hero image with elegant title treatment.
 *
 * Features:
 * - Full-screen hero image with Ken Burns ambient motion
 * - Gradient overlay for text readability
 * - Large centered title with optional subtitle
 * - No animation delays (shown at rest, not during playback)
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { TemplateContext } from '../../schemas/BlockTemplates.js';
import type { StartBlockConfig } from '../../schemas/Doc.js';
import { getThemeFont, themedFontSize, themedImageTreatment } from '../utils/themeUtils.js';
import { relativeLuminance, withAlpha } from '../../schemas/colorUtils.js';
import { mapAmbientMotion } from './accentImage.js';

/**
 * Input for coverBlock template - matches StartBlockConfig
 */
export interface CoverBlockInput {
  /** Path to hero image (omit for theme-driven background) */
  heroSrc?: string;
  /** Alt text for the hero image */
  heroAlt?: string;
  /** Title to display over the hero */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Ambient motion for the hero image */
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
  /** Photo credit / artist name */
  heroCredit?: string;
  /** License identifier */
  heroLicense?: string;
  /** Per-block override for the theme's photographic image grade. */
  imageTreatment?: 'none' | 'mono' | 'duotone' | 'warm' | 'cool';
}

/** Base (pre-viewport-scale) font size for a full-size cover title. */
const COVER_TITLE_BASE_PX = 120;
/** Title length (chars) that still reads well at the full base size. */
const COVER_TITLE_COMFORTABLE_CHARS = 26;
/** Readability floor so very long titles never shrink to nothing. */
const COVER_TITLE_MIN_BASE_PX = 62;

/**
 * Compute the base cover-title font size for a given title, shrinking long
 * titles so their wrapped block fits the frame. Returns the pre-viewport-scale
 * value expected by {@link themedFontSize}; short titles get the full base.
 */
export function fitCoverTitleSize(title: string): number {
  const len = title.trim().length;
  if (len <= COVER_TITLE_COMFORTABLE_CHARS) return COVER_TITLE_BASE_PX;
  const scaled = COVER_TITLE_BASE_PX * Math.sqrt(COVER_TITLE_COMFORTABLE_CHARS / len);
  return Math.max(COVER_TITLE_MIN_BASE_PX, Math.round(scaled));
}

function isStandardLightCover(context: TemplateContext): boolean {
  const { theme } = context;
  return theme.id === 'standard' && relativeLuminance(theme.colors.background) > 0.85;
}

/** One stop of the hero scrim. `pos` is the distance from the frame's BOTTOM (0..100). */
export interface CoverScrimStop {
  /** Percent up from the bottom of the frame — matches `linear-gradient(0deg, …)`. */
  pos: number;
  /** Opacity of the theme background tint at this stop. */
  alpha: number;
}

/**
 * Opacity ramp of the hero scrim, from the frame's bottom edge upward.
 *
 * The scrim is tinted from `theme.colors.background` (never a hard-coded
 * black), so `theme.colors.text` painted on top stays legible *by
 * construction* on light and dark themes alike — the same rule
 * `imageWithCaption` and `sectionHeader` follow.
 *
 * Because the tint is the theme background rather than black, the ramp has to
 * carry the readability that a black scrim used to get for free from being
 * dark: the hero photo underneath is arbitrary, so the composite of
 * scrim-over-photo only converges on the theme background where alpha is
 * high. The title band (~59%–82% from the top; see the `y` values below) is
 * therefore held at alpha ≥ 0.79, which keeps the worst case across all 11
 * built-in themes — light theme text over a black photo, or dark theme text
 * over a white one — above WCAG AA. Above that band the ramp falls away
 * quickly so the top ~40% of the hero reads as a photograph.
 */
export const COVER_SCRIM_STOPS: readonly CoverScrimStop[] = [
  { pos: 0, alpha: 0.95 },
  { pos: 38, alpha: 0.86 },
  { pos: 58, alpha: 0.4 },
  { pos: 78, alpha: 0.1 },
  { pos: 100, alpha: 0 },
];

/**
 * Scrim opacity at a vertical position, expressed the way layer positions are
 * (`y` percent DOWN from the top of the frame). Linear interpolation between
 * {@link COVER_SCRIM_STOPS} — the same ramp the CSS gradient renders.
 */
export function coverScrimAlphaAtY(yPctFromTop: number): number {
  const pos = 100 - yPctFromTop;
  const stops = COVER_SCRIM_STOPS;
  if (pos <= stops[0].pos) return stops[0].alpha;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const next = stops[i];
    if (pos <= next.pos) {
      const t = (pos - prev.pos) / (next.pos - prev.pos);
      return prev.alpha + (next.alpha - prev.alpha) * t;
    }
  }
  return stops[stops.length - 1].alpha;
}

/** Build the hero scrim's CSS gradient, tinted from the theme background. */
function coverScrimGradient(background: string): string {
  const stops = COVER_SCRIM_STOPS.map((s) => `${withAlpha(background, s.alpha)} ${s.pos}%`);
  return `linear-gradient(0deg, ${stops.join(', ')})`;
}

/**
 * Generate cover block layers from StartBlockConfig.
 */
export function coverBlock(input: CoverBlockInput, context: TemplateContext): Layer[] {
  const treatment = themedImageTreatment(context, input.imageTreatment);
  const { heroSrc, heroAlt, title, subtitle, ambientMotion, heroCredit, heroLicense } = input;
  const { theme, layout } = context;
  const standardLightCover = !heroSrc && isStandardLightCover(context);

  // Scale font sizes for viewport - cover titles are larger than regular title blocks.
  // The cover title wraps within maxTextWidth but does not otherwise shrink, so a long
  // title (e.g. "Seattle: The Emerald City That Rebuilt Itself on Top of Itself") wrapped
  // to three 120px lines overflows the frame and is clipped by the player controls.
  // Auto-fit the base size to title length so long titles stay within the frame. The
  // wrapped title's total height grows with fontSize² × length (line count ∝ length ×
  // fontSize / width, line height ∝ fontSize), so scaling the base by √(threshold/length)
  // keeps the wrapped block's area roughly constant past the threshold. Short titles are
  // unaffected (scale clamps at 1).
  const titleFontSize = themedFontSize(fitCoverTitleSize(title), context, true);
  const subtitleFontSize = themedFontSize(40, context, false);

  const layers: Layer[] = [];

  if (heroSrc) {
    // Hero image path: full-screen image with gradient overlay for text readability
    const imageAnimation = mapAmbientMotion(ambientMotion);

    layers.push(
      {
        type: 'image',
        id: 'cover-hero',
        content: {
          src: heroSrc,
          alt: heroAlt || title,
          fit: 'cover',
          credit: heroCredit,
          license: heroLicense,
          ...(treatment ? { treatment } : {}),
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
        animation: imageAnimation,
      },
      {
        type: 'shape',
        id: 'cover-gradient',
        content: {
          shape: 'rect',
          fill: coverScrimGradient(theme.colors.background),
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      },
    );
  } else {
    if (standardLightCover) {
      // Standard Light needs a restrained cover-poster treatment; a
      // full-strength primary radial hotspot overwhelms dark serif text
      // and makes the subtitle muddy.
      layers.push(
        {
          type: 'shape',
          id: 'cover-bg',
          content: {
            shape: 'rect',
            fill: theme.colors.background,
          },
          position: { x: 0, y: 0, width: '100%', height: '100%' },
        },
        {
          type: 'shape',
          id: 'cover-bg-tint',
          content: {
            shape: 'rect',
            fill: `radial-gradient(ellipse at 50% 40%, ${withAlpha(theme.colors.primary, 0.16)} 0%, ${withAlpha(theme.colors.primary, 0.07)} 38%, ${withAlpha(theme.colors.primary, 0)} 78%)`,
          },
          position: { x: 0, y: 0, width: '100%', height: '100%' },
        },
      );
    } else {
      // Non-Standard themes keep the existing dramatic radial cover look.
      layers.push({
        type: 'shape',
        id: 'cover-bg',
        content: {
          shape: 'rect',
          fill: `radial-gradient(ellipse at 50% 40%, ${theme.colors.primary} 0%, ${theme.colors.background} 100%)`,
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      });
    }

    // Subtle decorative accent line below title
    layers.push({
      type: 'shape',
      id: 'cover-accent',
      content: {
        shape: 'rect',
        fill: standardLightCover
          ? withAlpha(theme.colors.primary, 0.24)
          : 'rgba(255, 255, 255, 0.2)',
      },
      position: {
        x: '35%',
        y: subtitle ? '42%' : '58%',
        width: '30%',
        height: '2px',
      },
    });
  }

  // Title - positioned lower when over hero, centered when over solid background
  layers.push({
    type: 'text',
    id: 'cover-title',
    content: {
      text: title,
      style: {
        fontSize: titleFontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: theme.colors.text,
        textAlign: 'center',
        shadow: !standardLightCover,
      },
    },
    position: {
      x: '50%',
      y: heroSrc ? (subtitle ? '70%' : '75%') : subtitle ? layout.primaryY : '50%',
      anchor: 'center',
      width: layout.maxTextWidth,
    },
    // No animation delay - shown immediately at rest
    animation: { type: 'fadeIn', duration: 0.8 },
  });

  // Add subtitle if provided
  if (subtitle) {
    layers.push({
      type: 'text',
      id: 'cover-subtitle',
      content: {
        text: subtitle,
        style: {
          fontSize: subtitleFontSize,
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: standardLightCover ? 'bold' : 'normal',
          color: standardLightCover ? withAlpha(theme.colors.text, 0.78) : theme.colors.textMuted,
          textAlign: 'center',
          lineHeight: 1.5,
        },
      },
      position: {
        x: '50%',
        y: heroSrc ? '82%' : layout.secondaryY,
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 0.8, delay: 0.2 },
    });
  }

  return layers;
}

/**
 * Convert StartBlockConfig to CoverBlockInput.
 */
export function startBlockToCoverInput(config: StartBlockConfig): CoverBlockInput {
  return {
    heroSrc: config.heroSrc,
    heroAlt: config.heroAlt,
    title: config.title,
    subtitle: config.subtitle,
    ambientMotion: config.ambientMotion,
    heroCredit: config.heroCredit,
    heroLicense: config.heroLicense,
  };
}

/**
 * Expand a StartBlockConfig into a renderable Block.
 * This is used by the player to render the cover block at rest.
 */
export function expandCoverBlock(config: StartBlockConfig, context: TemplateContext): Layer[] {
  const input = startBlockToCoverInput(config);
  return coverBlock(input, context);
}

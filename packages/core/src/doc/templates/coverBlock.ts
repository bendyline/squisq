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

/**
 * Generate cover block layers from StartBlockConfig.
 */
export function coverBlock(input: CoverBlockInput, context: TemplateContext): Layer[] {
  const treatment = themedImageTreatment(context, input.imageTreatment);
  const { heroSrc, heroAlt, title, subtitle, ambientMotion, heroCredit, heroLicense } = input;
  const { theme, layout } = context;

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
          fill: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.1) 70%, transparent 100%)',
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      },
    );
  } else {
    // No hero image: use a rich theme-driven background with radial gradient
    layers.push({
      type: 'shape',
      id: 'cover-bg',
      content: {
        shape: 'rect',
        fill: `radial-gradient(ellipse at 50% 40%, ${theme.colors.primary} 0%, ${theme.colors.background} 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    });

    // Subtle decorative accent line below title
    layers.push({
      type: 'shape',
      id: 'cover-accent',
      content: {
        shape: 'rect',
        fill: 'rgba(255, 255, 255, 0.2)',
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
        shadow: true,
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
          color: theme.colors.textMuted,
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

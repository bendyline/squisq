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
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import type { StartBlockConfig } from '../../schemas/Doc.js';
import { getThemeFont } from '../utils/themeUtils.js';
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
}

/**
 * Generate cover block layers from StartBlockConfig.
 */
export function coverBlock(input: CoverBlockInput, context: TemplateContext): Layer[] {
  const { heroSrc, heroAlt, title, subtitle, ambientMotion, heroCredit, heroLicense } = input;
  const { theme, layout } = context;

  // Scale font sizes for viewport - cover titles are larger than regular title blocks
  const titleFontSize = scaledFontSize(120, context, true);
  const subtitleFontSize = scaledFontSize(40, context, false);

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

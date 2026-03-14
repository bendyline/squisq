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
import { mapAmbientMotion } from './accentImage.js';

/**
 * Input for coverBlock template - matches StartBlockConfig
 */
export interface CoverBlockInput {
  /** Path to hero image */
  heroSrc: string;
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

  // Scale font sizes for viewport - use larger sizes for the cover
  const titleFontSize = scaledFontSize(96, context, true);
  const subtitleFontSize = scaledFontSize(36, context, false);

  // Determine Ken Burns animation
  const imageAnimation = mapAmbientMotion(ambientMotion);

  const layers: Layer[] = [
    // Full-screen hero image
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
    // Gradient overlay for text readability - from bottom
    {
      type: 'shape',
      id: 'cover-gradient',
      content: {
        shape: 'rect',
        fill: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.1) 70%, transparent 100%)',
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
    // Title - positioned lower in the frame to work with hero composition
    {
      type: 'text',
      id: 'cover-title',
      content: {
        text: title,
        style: {
          fontSize: titleFontSize,
          fontWeight: 'bold',
          color: theme.text,
          textAlign: 'center',
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: subtitle ? '70%' : '75%',
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      // No animation delay - shown immediately at rest
      animation: { type: 'fadeIn', duration: 0.8 },
    },
  ];

  // Add subtitle if provided
  if (subtitle) {
    layers.push({
      type: 'text',
      id: 'cover-subtitle',
      content: {
        text: subtitle,
        style: {
          fontSize: subtitleFontSize,
          color: theme.textMuted,
          textAlign: 'center',
          lineHeight: 1.5,
        },
      },
      position: {
        x: '50%',
        y: '82%',
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

/**
 * Image With Caption Template
 *
 * Full-screen background image with text overlay.
 * Supports Ken Burns animation effects (zoom, pan).
 * Adapts caption positioning and font sizes for different viewports.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { ImageWithCaptionInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { getThemeFont } from '../utils/themeUtils.js';
import { cleanCaption } from './captionUtils.js';
import { mapAmbientMotion } from './accentImage.js';

export function imageWithCaption(input: ImageWithCaptionInput, context: TemplateContext): Layer[] {
  const {
    imageSrc,
    imageAlt,
    caption: rawCaption,
    captionPosition: _captionPosition = 'bottom',
    ambientMotion,
    isTitle,
    subtitle,
    imageCredit,
    imageLicense,
  } = input;
  const caption = rawCaption ? cleanCaption(rawCaption) : rawCaption;
  const { theme, layout } = context;

  // Scale font sizes for viewport
  const captionFontSize = scaledFontSize(36, context, false);
  const titleFontSize = scaledFontSize(96, context, true);
  const subtitleFontSize = scaledFontSize(36, context, false);

  // Determine animation based on ambientMotion setting
  // Support both new 'ambientMotion' and legacy 'kenBurns' property
  const legacyKenBurns = (input as unknown as Record<string, unknown>).kenBurns as
    | string
    | undefined;
  const motion: string | undefined = ambientMotion || legacyKenBurns;
  const imageAnimation = mapAmbientMotion(motion);

  const layers: Layer[] = [
    // Background image
    {
      type: 'image',
      id: 'bg-image',
      content: {
        src: imageSrc,
        alt: imageAlt,
        fit: 'cover',
        credit: imageCredit,
        license: imageLicense,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      animation: imageAnimation,
    },
  ];

  // TITLE MODE: Large centered title over hero image (like cover slide)
  if (isTitle && caption) {
    // Full gradient overlay for title readability (similar to cover slide)
    layers.push({
      type: 'shape',
      id: 'title-gradient',
      content: {
        shape: 'rect',
        fill: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.1) 70%, transparent 100%)',
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    });

    // Title text - large and centered in lower portion
    layers.push({
      type: 'text',
      id: 'title',
      content: {
        text: caption,
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
        y: subtitle ? '70%' : '75%',
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 0.8 },
    });

    // Optional subtitle
    if (subtitle) {
      layers.push({
        type: 'text',
        id: 'subtitle',
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
          y: '82%',
          anchor: 'center',
          width: layout.maxTextWidth,
        },
        animation: { type: 'fadeIn', duration: 0.8, delay: 0.2 },
      });
    }

    return layers;
  }

  // STANDARD MODE: Caption at bottom
  if (caption) {
    // Subtle gradient at bottom for caption readability (raised above media controls)
    layers.push({
      type: 'shape',
      id: 'caption-gradient',
      content: {
        shape: 'rect',
        fill: 'linear-gradient(0deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)',
      },
      position: {
        x: 0,
        y: '65%',
        width: '100%',
        height: '35%',
      },
    });

    // Caption text - raised above media controls
    layers.push({
      type: 'text',
      id: 'caption',
      content: {
        text: caption,
        style: {
          fontSize: captionFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.text,
          textAlign: 'center',
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: '82%',
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 1.5, delay: 0.5 },
    });
  }

  return layers;
}

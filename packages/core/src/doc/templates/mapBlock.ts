/**
 * Map Block Template
 *
 * Full-screen geographic map with optional title and caption overlays.
 * Great for establishing geographic context at the start of a doc
 * or when discussing location-specific content.
 * Adapts font sizes and positioning for different viewports.
 *
 * Map tiles are fetched from free/open-source providers.
 * See docs/MAP_TILES.md for available styles and attribution requirements.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { MapBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { getThemeFont, shouldUseShadow, themedFontSize } from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { mapAmbientMotion } from './accentImage.js';

export function mapBlock(input: MapBlockInput, context: TemplateContext): Layer[] {
  const {
    center,
    zoom,
    mapStyle = 'terrain',
    title,
    caption,
    markers,
    ambientMotion,
    staticSrc,
  } = input;
  const { theme, layout } = context;

  // Scale font sizes for viewport
  const titleFontSize = themedFontSize(64, context, true);
  const captionFontSize = themedFontSize(32, context, false);

  // Determine animation based on ambientMotion setting
  const mapAnimation = mapAmbientMotion(ambientMotion);

  const layers: Layer[] = [
    // Map background
    {
      type: 'map',
      id: 'map-bg',
      content: {
        center,
        zoom,
        style: mapStyle,
        markers,
        showAttribution: true,
        staticSrc, // Use pre-rendered image if available
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      animation: mapAnimation,
    },
  ];

  // Overlay bands are tinted from the theme background so the theme text
  // color on them stays readable in light and dark themes alike; they
  // fade out toward the map so the band doesn't read as a hard seam.
  const bg = theme.colors.background;

  // Add title overlay if provided
  if (title) {
    layers.push({
      type: 'shape',
      id: 'title-overlay',
      content: {
        shape: 'rect',
        fill: `linear-gradient(180deg, ${withAlpha(bg, 0.85)} 0%, ${withAlpha(bg, 0.6)} 70%, ${withAlpha(bg, 0)} 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '20%' },
    });

    // Title text - positioned at top of slide
    layers.push({
      type: 'text',
      id: 'title',
      content: {
        text: title,
        style: {
          fontSize: titleFontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: '50%',
        y: '9%',
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 1, delay: 0.3 },
    });
  }

  // Add caption if provided
  if (caption) {
    layers.push({
      type: 'shape',
      id: 'caption-overlay',
      content: {
        shape: 'rect',
        fill: `linear-gradient(0deg, ${withAlpha(bg, 0.85)} 0%, ${withAlpha(bg, 0.6)} 70%, ${withAlpha(bg, 0)} 100%)`,
      },
      position: { x: 0, y: '80%', width: '100%', height: '20%' },
    });

    // Caption text
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
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: '50%',
        y: layout.captionY,
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 1, delay: 0.5 },
    });
  }

  return layers;
}

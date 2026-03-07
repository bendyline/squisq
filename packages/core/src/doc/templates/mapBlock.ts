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

import type { Layer, Animation } from '../../schemas/Doc.js';
import type { MapBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';

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
  const titleFontSize = scaledFontSize(64, context, true);
  const captionFontSize = scaledFontSize(32, context, false);

  // Determine animation based on ambientMotion setting
  let mapAnimation: Animation | undefined;
  if (ambientMotion) {
    switch (ambientMotion) {
      case 'zoomIn':
        mapAnimation = { type: 'slowZoom', direction: 'in' };
        break;
      case 'zoomOut':
        mapAnimation = { type: 'slowZoom', direction: 'out' };
        break;
      case 'panLeft':
        mapAnimation = { type: 'panLeft' };
        break;
      case 'panRight':
        mapAnimation = { type: 'panRight' };
        break;
    }
  }

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
        staticSrc,  // Use pre-rendered image if available
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      animation: mapAnimation,
    },
  ];

  // Add title overlay if provided
  if (title) {
    // Gradient overlay at top for title readability
    layers.push({
      type: 'shape',
      id: 'title-overlay',
      content: {
        shape: 'rect',
        fill: 'rgba(0,0,0,0.6)',
      },
      position: { x: 0, y: 0, width: '100%', height: '18%' },
    });

    // Title text - positioned at top of slide
    layers.push({
      type: 'text',
      id: 'title',
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
        y: '9%',
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 1, delay: 0.3 },
    });
  }

  // Add caption if provided
  if (caption) {
    // Gradient overlay at bottom for caption readability
    layers.push({
      type: 'shape',
      id: 'caption-overlay',
      content: {
        shape: 'rect',
        fill: 'rgba(0,0,0,0.6)',
      },
      position: { x: 0, y: '82%', width: '100%', height: '18%' },
    });

    // Caption text
    layers.push({
      type: 'text',
      id: 'caption',
      content: {
        text: caption,
        style: {
          fontSize: captionFontSize,
          color: theme.text,
          textAlign: 'center',
          shadow: true,
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

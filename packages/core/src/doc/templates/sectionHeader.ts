/**
 * Section Header Template
 *
 * Section title card with optional background image.
 * Used to introduce new sections of a story.
 * When an image is provided, displays like a title slide with the image as background.
 * Without an image, falls back to a colored background.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { SectionHeaderInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { COLOR_SCHEMES, scaledFontSize } from '../../schemas/BlockTemplates.js';

export function sectionHeader(input: SectionHeaderInput, context: TemplateContext): Layer[] {
  const { title, colorScheme = 'blue', imageSrc, imageAlt, ambientMotion } = input;
  const { layout } = context;
  const colors = COLOR_SCHEMES[colorScheme];

  // Scale font sizes for viewport
  const titleFontSize = scaledFontSize(72, context, true);

  const layers: Layer[] = [];

  // Background - either image or solid color
  if (imageSrc) {
    // Image background with Ken Burns effect
    layers.push({
      type: 'image',
      id: 'bg-image',
      content: {
        src: imageSrc,
        alt: imageAlt || title,
        fit: 'cover',
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      animation: ambientMotion
        ? { type: ambientMotion as any, duration: 8 }
        : { type: 'slowZoom', duration: 8, direction: 'in' },
    });

    // Dark overlay for text readability
    layers.push({
      type: 'shape',
      id: 'overlay',
      content: {
        shape: 'rect',
        fill: 'rgba(0, 0, 0, 0.5)',
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    });
  } else {
    // Solid color background
    layers.push({
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: colors.bg,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    });

    // Decorative lines above and below title
    layers.push({
      type: 'shape',
      id: 'line-top',
      content: { shape: 'rect', fill: `${colors.text}33` },
      position: { x: '50%', y: '40%', width: '20%', height: '2px', anchor: 'center' },
    });
    layers.push({
      type: 'shape',
      id: 'line-bottom',
      content: { shape: 'rect', fill: `${colors.text}33` },
      position: { x: '50%', y: '60%', width: '20%', height: '2px', anchor: 'center' },
    });
  }

  // Section title - white text with shadow for readability over images
  layers.push({
    type: 'text',
    id: 'title',
    content: {
      text: title,
      style: {
        fontSize: titleFontSize,
        fontWeight: 'bold',
        color: imageSrc ? '#ffffff' : colors.text,
        textAlign: 'center',
        shadow: true,
      },
    },
    position: {
      x: '50%',
      y: '50%',
      anchor: 'center',
      width: layout.maxTextWidth,
    },
    animation: { type: 'fadeIn', duration: 1.5 },
  });

  return layers;
}

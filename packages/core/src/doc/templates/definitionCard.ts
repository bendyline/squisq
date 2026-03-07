/**
 * Definition Card Template
 *
 * Dictionary-style slide with a large term and its definition.
 * Good for explaining local words, place names, or cultural concepts.
 * Supports optional accent images.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { DefinitionCardInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { COLOR_SCHEMES, scaledFontSize } from '../../schemas/BlockTemplates.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';

export function definitionCard(input: DefinitionCardInput, context: TemplateContext): Layer[] {
  const { term, definition, origin, colorScheme = 'blue', accentImage } = input;
  const { theme } = context;
  const colors = COLOR_SCHEMES[colorScheme];

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  const termFontSize = scaledFontSize(72, context, true);
  const defFontSize = scaledFontSize(32, context, false);
  const originFontSize = scaledFontSize(22, context, false);

  const layers: Layer[] = [
    // Background — warm gradient
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: `linear-gradient(145deg, #1e2030 0%, ${theme.background} 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  // Add accent image layers
  if (accentImage) {
    layers.push(...createAccentLayers(accentImage, input.id));
  }

  // Term — large, accent-colored
  layers.push({
    type: 'text',
    id: 'term',
    content: {
      text: term,
      style: {
        fontSize: termFontSize,
        fontWeight: 'bold',
        color: colors.text,
        textAlign: 'center',
        shadow: !!accentImage,
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('30%', accentLayout),
      anchor: 'center',
    },
    animation: { type: 'fadeIn', duration: 1.5 },
  });

  // Horizontal separator line
  layers.push({
    type: 'shape',
    id: 'separator',
    content: {
      shape: 'rect',
      fill: `${colors.text}33`, // accent color at 20% opacity
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('42%', accentLayout),
      width: '30%',
      height: '2px',
      anchor: 'center',
    },
  });

  // Definition text
  layers.push({
    type: 'text',
    id: 'definition',
    content: {
      text: definition,
      style: {
        fontSize: defFontSize,
        color: theme.text,
        textAlign: 'center',
        lineHeight: 1.6,
        maxLines: 4,
        shadow: !!accentImage,
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('55%', accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation: { type: 'fadeIn', duration: 1, delay: 0.8 },
  });

  // Origin if provided
  if (origin) {
    layers.push({
      type: 'text',
      id: 'origin',
      content: {
        text: origin,
        style: {
          fontSize: originFontSize,
          color: theme.textMuted,
          textAlign: 'center',
          shadow: !!accentImage,
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY('78%', accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 0.8, delay: 1.5 },
    });
  }

  return layers;
}

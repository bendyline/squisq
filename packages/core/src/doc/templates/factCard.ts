/**
 * Fact Card Template
 *
 * Key fact with explanation and optional source.
 * Useful for presenting important information clearly.
 * Adapts font sizes and positioning for different viewports.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { FactCardInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';
import { createBackgroundLayer } from './captionUtils.js';

export function factCard(input: FactCardInput, context: TemplateContext): Layer[] {
  const { fact, explanation, source, accentImage } = input;
  const { theme } = context;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Scale font sizes for viewport
  const factFontSize = scaledFontSize(56, context, true);
  const explainFontSize = scaledFontSize(32, context, false);
  const sourceFontSize = scaledFontSize(20, context, false);

  const layers: Layer[] = [
    createBackgroundLayer(
      'bg',
      `linear-gradient(170deg, #1e2030 0%, ${theme.colors.background} 100%)`,
    ),
  ];

  // Add accent image layers (behind text, after background)
  if (accentImage) {
    layers.push(...createAccentLayers(accentImage, input.id));
  }

  // Fact (main statement)
  layers.push({
    type: 'text',
    id: 'fact',
    content: {
      text: fact,
      style: {
        fontSize: factFontSize,
        fontWeight: 'bold',
        color: theme.colors.text,
        textAlign: 'center',
        lineHeight: 1.4,
        shadow: true,
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('35%', accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation: { type: 'fadeIn', duration: 1.5 },
  });

  // Explanation
  layers.push({
    type: 'text',
    id: 'explanation',
    content: {
      text: explanation,
      style: {
        fontSize: explainFontSize,
        color: theme.colors.textMuted,
        textAlign: 'center',
        lineHeight: 1.5,
        shadow: !!accentImage,
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('60%', accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation: { type: 'fadeIn', duration: 1, delay: 0.8 },
  });

  // Add source if provided
  if (source) {
    layers.push({
      type: 'text',
      id: 'source',
      content: {
        text: source,
        style: {
          fontSize: sourceFontSize,
          color: theme.colors.textMuted,
          textAlign: 'center',
          shadow: !!accentImage,
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY('85%', accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 0.8, delay: 1.5 },
    });
  }

  return layers;
}

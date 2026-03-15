/**
 * Quote Block Template
 *
 * Large centered quote with optional attribution.
 * Good for impactful statements or descriptions.
 * Adapts font sizes and positioning for different viewports.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { QuoteBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';
import { createBackgroundLayer } from './captionUtils.js';

export function quoteBlock(input: QuoteBlockInput, context: TemplateContext): Layer[] {
  const { quote, attribution, accentImage } = input;
  const { theme, layout } = context;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Scale font sizes for viewport
  const quoteFontSize = scaledFontSize(48, context, true);
  const attrFontSize = scaledFontSize(24, context, false);

  // Decorative quotation mark font size
  const decorativeQuoteFontSize = scaledFontSize(280, context, true);

  const layers: Layer[] = [
    createBackgroundLayer(
      'bg',
      `linear-gradient(160deg, ${theme.backgroundLight} 0%, #1e2636 100%)`,
    ),
  ];

  // Add accent image layers (behind text, after background)
  if (accentImage) {
    layers.push(...createAccentLayers(accentImage, input.id));
  }

  // Decorative opening quotation mark — oversized, low-opacity behind quote
  layers.push({
    type: 'text',
    id: 'deco-quote',
    content: {
      text: '\u201C',
      style: {
        fontSize: decorativeQuoteFontSize,
        color: 'rgba(255, 255, 255, 0.06)',
        textAlign: 'center',
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('18%', accentLayout),
      anchor: 'center',
    },
  });

  // Quote text - positioned based on accent layout
  const quoteY = attribution ? layout.primaryY : '50%';
  layers.push({
    type: 'text',
    id: 'quote',
    content: {
      text: quote,
      style: {
        fontSize: quoteFontSize,
        color: theme.text,
        textAlign: 'center',
        lineHeight: 1.6,
        shadow: true,
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY(quoteY, accentLayout),
      anchor: 'center',
      width: accentLayout.textWidth,
    },
    animation: { type: 'fadeIn', duration: 2 },
  });

  // Add attribution if provided
  if (attribution) {
    layers.push({
      type: 'text',
      id: 'attribution',
      content: {
        text: `— ${attribution}`,
        style: {
          fontSize: attrFontSize,
          color: theme.textMuted,
          textAlign: 'center',
          shadow: !!accentImage,
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY(layout.captionY, accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 1.5 },
    });
  }

  return layers;
}

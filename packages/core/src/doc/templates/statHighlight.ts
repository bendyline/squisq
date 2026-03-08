/**
 * Stat Highlight Template
 *
 * Large statistic/number with description and optional detail.
 * Great for emphasizing key data points.
 * Adapts font sizes and positioning for different viewports.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { StatHighlightInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { COLOR_SCHEMES, scaledFontSize } from '../../schemas/BlockTemplates.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';

export function statHighlight(input: StatHighlightInput, context: TemplateContext): Layer[] {
  const { stat, description, detail, colorScheme = 'blue', accentImage } = input;
  const { theme, layout } = context;
  const colors = COLOR_SCHEMES[colorScheme] ?? COLOR_SCHEMES.blue;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Scale font sizes — stat is dramatically large, description is understated
  const statFontSize = scaledFontSize(148, context, true);
  const descFontSize = scaledFontSize(32, context, false);
  const detailFontSize = scaledFontSize(26, context, false);

  const layers: Layer[] = [
    // Background — subtle vertical gradient for depth
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: `linear-gradient(180deg, ${theme.background} 0%, #0f1520 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  // Add accent image layers (behind text, after background)
  if (accentImage) {
    layers.push(...createAccentLayers(accentImage, input.id));
  }

  // Big stat — hero element, dominates the slide
  layers.push({
    type: 'text',
    id: 'stat',
    content: {
      text: stat,
      style: {
        fontSize: statFontSize,
        fontWeight: 'bold',
        color: colors.text,
        shadow: !!accentImage,
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('32%', accentLayout),
      anchor: 'center',
    },
    animation: { type: 'zoomIn', duration: 0.6 },
  });

  // Description — smaller and understated beneath the stat
  layers.push({
    type: 'text',
    id: 'description',
    content: {
      text: description,
      style: {
        fontSize: descFontSize,
        color: theme.textMuted,
        textAlign: 'center',
        lineHeight: 1.6,
        shadow: !!accentImage,
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('58%', accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation: { type: 'fadeIn', duration: 1, delay: 0.3 },
  });

  // Add detail if provided
  if (detail) {
    layers.push({
      type: 'text',
      id: 'detail',
      content: {
        text: detail,
        style: {
          fontSize: detailFontSize,
          color: colors.accent,
          textAlign: 'center',
          shadow: !!accentImage,
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY('75%', accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 1 },
    });
  }

  return layers;
}

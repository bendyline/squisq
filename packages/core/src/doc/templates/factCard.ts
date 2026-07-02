/**
 * Fact Card Template
 *
 * Key fact with explanation and optional source, composed as one
 * vertically-centered lockup: each element is placed relative to the
 * estimated height of the one above it, so short content doesn't leave
 * fixed-slot voids and long content doesn't collide.
 * Adapts font sizes and positioning for different viewports.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { FactCardInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  shouldUseShadow,
  themedEntrance,
  themedFontSize,
  themedSurfaceGradient,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';
import { createBackgroundLayer, estimateTextHeight } from './captionUtils.js';

export function factCard(input: FactCardInput, context: TemplateContext): Layer[] {
  const { fact, explanation, source, accentImage } = input;
  const { theme, viewport } = context;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Scale font sizes for viewport
  const factFontSize = themedFontSize(56, context, true);
  const explainFontSize = themedFontSize(28, context, false);
  const sourceFontSize = themedFontSize(20, context, false);

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 170))];

  // Add accent image layers (behind text, after background)
  if (accentImage) {
    layers.push(...createAccentLayers(accentImage, input.id, themedImageTreatment(context, input.imageTreatment)));
  }

  // Estimate each element's height so the stack reads as one lockup.
  const textWidthPx = (parseFloat(accentLayout.textWidth) / 100) * viewport.width;
  const factH = estimateTextHeight(fact, factFontSize, textWidthPx, 1.3);
  const explainH = estimateTextHeight(explanation, explainFontSize, textWidthPx, 1.5);
  const sourceH = source ? sourceFontSize * 1.4 : 0;
  const gap = factFontSize * 0.9;
  const sourceGap = source ? explainFontSize * 1.1 : 0;
  const totalH = factH + gap + explainH + sourceGap + sourceH;

  // Center the lockup slightly above the geometric middle (optical center).
  const groupTopPct = 47 - (totalH / 2 / viewport.height) * 100;
  const pct = (px: number) => groupTopPct + (px / viewport.height) * 100;

  const factY = pct(factH / 2);
  const explainY = pct(factH + gap + explainH / 2);
  const sourceY = pct(factH + gap + explainH + sourceGap + sourceH / 2);

  // Fact (main statement)
  layers.push({
    type: 'text',
    id: 'fact',
    content: {
      text: fact,
      style: {
        fontSize: factFontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: theme.colors.text,
        textAlign: 'center',
        lineHeight: 1.3,
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY(`${factY}%`, accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1.5 }),
  });

  // Explanation
  layers.push({
    type: 'text',
    id: 'explanation',
    content: {
      text: explanation,
      style: {
        fontSize: explainFontSize,
        fontFamily: getThemeFont(context, 'body'),
        color: theme.colors.textMuted,
        textAlign: 'center',
        lineHeight: 1.5,
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY(`${explainY}%`, accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1, delay: 0.8 }),
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
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'center',
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY(`${sourceY}%`, accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 0.8, delay: 1.5 },
    });
  }

  return layers;
}

/**
 * Quote Block Template
 *
 * Large centered quote with optional attribution, composed as one
 * vertically-centered lockup: the attribution hangs a fixed distance
 * below the quote's estimated bottom edge instead of being pinned to a
 * far-away layout slot.
 * Adapts font sizes and positioning for different viewports.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { QuoteBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  shouldUseShadow,
  themedEntrance,
  themedFontSize,
  themedSurfaceGradient,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';
import { createBackgroundLayer, estimateTextHeight } from './captionUtils.js';

export function quoteBlock(input: QuoteBlockInput, context: TemplateContext): Layer[] {
  const { quote, attribution, accentImage } = input;
  const { theme, viewport } = context;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Scale font sizes for viewport
  const quoteFontSize = themedFontSize(48, context, true);
  const attrFontSize = themedFontSize(26, context, false);
  const quoteLineHeight = Math.max(theme.typography.titleLineHeight ?? 1.4, 1.25);

  // Decorative quotation mark font size
  const decorativeQuoteFontSize = themedFontSize(280, context, true);

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 160))];

  // Add accent image layers (behind text, after background)
  if (accentImage) {
    layers.push(...createAccentLayers(accentImage, input.id, themedImageTreatment(context, input.imageTreatment)));
  }

  // Decorative opening quotation mark — oversized, low-opacity behind the
  // quote. Derived from the theme text color so it stays a subtle ornament
  // on light and dark surfaces alike (a hard-coded white glyph was
  // invisible on both).
  layers.push({
    type: 'text',
    id: 'deco-quote',
    content: {
      text: '“',
      style: {
        fontSize: decorativeQuoteFontSize,
        fontFamily: getThemeFont(context, 'title'),
        color: withAlpha(theme.colors.text, 0.09),
        textAlign: 'center',
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('26%', accentLayout),
      anchor: 'center',
    },
  });

  // Quote text — optically centered, nudged up slightly when an
  // attribution hangs below it.
  const quoteYPct = attribution ? 45 : 50;
  layers.push({
    type: 'text',
    id: 'quote',
    content: {
      text: quote,
      style: {
        fontSize: quoteFontSize,
        fontFamily: getThemeFont(context, 'title'),
        color: theme.colors.text,
        textAlign: 'center',
        lineHeight: quoteLineHeight,
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY(`${quoteYPct}%`, accentLayout),
      anchor: 'center',
      width: accentLayout.textWidth,
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 2 }),
  });

  // Attribution hangs just below the quote's estimated bottom edge, so
  // the two read as one lockup instead of the attribution stranding near
  // the bottom of the block.
  if (attribution) {
    const quoteWidthPx = (parseFloat(accentLayout.textWidth) / 100) * viewport.width;
    const quoteHeightPx = estimateTextHeight(quote, quoteFontSize, quoteWidthPx, quoteLineHeight);
    const gapPx = quoteFontSize * 1.7;
    const attrYPct = Math.min(82, quoteYPct + ((quoteHeightPx / 2 + gapPx) / viewport.height) * 100);

    layers.push({
      type: 'text',
      id: 'attribution',
      content: {
        text: `— ${attribution}`,
        style: {
          fontSize: attrFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'center',
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY(`${attrYPct}%`, accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 1.5 },
    });
  }

  return layers;
}

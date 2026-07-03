/**
 * Pull Quote Template
 *
 * Quote text over a full-bleed background image with dark overlay.
 * Cinematic alternative to quoteBlock when a high-quality image is available.
 * Combines the visual impact of imageWithCaption with the text focus of quoteBlock.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { PullQuoteInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  themedEntrance,
  themedFontSize,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { estimateTextHeight } from './captionUtils.js';

export function pullQuote(input: PullQuoteInput, context: TemplateContext): Layer[] {
  const { text, attribution, backgroundImage, ambientMotion } = input;
  const { viewport } = context;

  const treatment = themedImageTreatment(context, input.imageTreatment);

  // Guard: backgroundImage is required
  if (!backgroundImage?.src) return [];

  const quoteFontSize = themedFontSize(52, context, true);
  const attrFontSize = themedFontSize(26, context, false);
  const decoFontSize = themedFontSize(200, context, true);
  const quoteLineHeight = 1.4;
  const quoteYPct = attribution ? 45 : 50;

  const layers: Layer[] = [
    // Full-bleed background image
    {
      type: 'image',
      id: 'bg-image',
      content: {
        src: backgroundImage.src,
        alt: backgroundImage.alt,
        fit: 'cover',
        credit: backgroundImage.credit,
        license: backgroundImage.license,
        ...(treatment ? { treatment } : {}),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      animation: ambientMotion ? { type: ambientMotion, duration: 15 } : undefined,
    },

    // Dark overlay for text readability
    {
      type: 'shape',
      id: 'overlay',
      content: {
        shape: 'rect',
        fill: 'rgba(0, 0, 0, 0.55)',
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },

    // Decorative quotation mark
    {
      type: 'text',
      id: 'deco-quote',
      content: {
        text: '\u201C',
        style: {
          fontSize: decoFontSize,
          fontFamily: getThemeFont(context, 'title'),
          color: 'rgba(255, 255, 255, 0.08)',
          textAlign: 'center',
        },
      },
      position: {
        x: '50%',
        y: '20%',
        anchor: 'center',
      },
    },

    // Quote text
    {
      type: 'text',
      id: 'quote-text',
      content: {
        text,
        style: {
          fontSize: quoteFontSize,
          fontFamily: getThemeFont(context, 'title'),
          color: '#ffffff',
          textAlign: 'center',
          lineHeight: quoteLineHeight,
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: `${quoteYPct}%`,
        anchor: 'center',
        width: '72%',
      },
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 2 }),
    },
  ];

  // Attribution \u2014 hangs just below the quote's estimated bottom edge so
  // the two read as one lockup instead of stranding near the bottom.
  if (attribution) {
    const quoteWidthPx = 0.72 * viewport.width;
    const quoteHeightPx = estimateTextHeight(text, quoteFontSize, quoteWidthPx, quoteLineHeight);
    const attrYPct = Math.min(
      82,
      quoteYPct + ((quoteHeightPx / 2 + quoteFontSize * 1.7) / viewport.height) * 100,
    );
    layers.push({
      type: 'text',
      id: 'attribution',
      content: {
        text: `\u2014 ${attribution}`,
        style: {
          fontSize: attrFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: 'rgba(255, 255, 255, 0.85)',
          textAlign: 'center',
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: `${attrYPct}%`,
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 1.5 },
    });
  }

  return layers;
}

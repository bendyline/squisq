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
import { scaledFontSize } from '../../schemas/BlockTemplates.js';

export function pullQuote(input: PullQuoteInput, context: TemplateContext): Layer[] {
  const { text, attribution, backgroundImage, ambientMotion } = input;
  const { theme: _theme } = context;

  const quoteFontSize = scaledFontSize(52, context, true);
  const attrFontSize = scaledFontSize(24, context, false);
  const decoFontSize = scaledFontSize(200, context, true);

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
          color: '#ffffff',
          textAlign: 'center',
          lineHeight: 1.5,
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: attribution ? '45%' : '50%',
        anchor: 'center',
        width: '80%',
      },
      animation: { type: 'fadeIn', duration: 2 },
    },
  ];

  // Attribution
  if (attribution) {
    layers.push({
      type: 'text',
      id: 'attribution',
      content: {
        text: `\u2014 ${attribution}`,
        style: {
          fontSize: attrFontSize,
          color: 'rgba(255, 255, 255, 0.7)',
          textAlign: 'center',
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: '72%',
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 1.5 },
    });
  }

  return layers;
}

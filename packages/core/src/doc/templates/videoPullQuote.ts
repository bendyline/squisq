/**
 * Video Pull Quote Template
 *
 * Quote text over a video clip background with dark overlay.
 * Cinematic alternative to pullQuote when a video clip is available.
 * Combines the visual dynamism of live video with the text focus of quoteBlock.
 *
 * The video plays muted — narration audio is the only sound track.
 *
 * This is shared code used by both site and efb-app doc renderers.
 *
 * Related Files:
 * - shared/story/templates/pullQuote.ts — image-based equivalent
 * - schemas/StoryScript.ts — VideoLayer type
 * - site/src/components/story/layers/VideoLayer.tsx — rendering component
 */

import type { Layer } from '../../schemas/Doc.js';
import type { VideoPullQuoteInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';

export function videoPullQuote(input: VideoPullQuoteInput, context: TemplateContext): Layer[] {
  const { text, attribution, backgroundVideo } = input;

  const quoteFontSize = scaledFontSize(52, context, true);
  const attrFontSize = scaledFontSize(24, context, false);
  const decoFontSize = scaledFontSize(200, context, true);

  const layers: Layer[] = [
    // Full-bleed background video clip
    {
      type: 'video',
      id: 'bg-video',
      content: {
        src: backgroundVideo.src,
        posterSrc: backgroundVideo.posterSrc,
        alt: backgroundVideo.alt,
        fit: 'cover',
        clipStart: backgroundVideo.clipStart,
        clipEnd: backgroundVideo.clipEnd,
        credit: backgroundVideo.credit,
        license: backgroundVideo.license,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
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

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
import { getThemeFont, themedFontSize } from '../utils/themeUtils.js';
import { estimateTextHeight } from './captionUtils.js';

export function videoPullQuote(input: VideoPullQuoteInput, context: TemplateContext): Layer[] {
  const { text, attribution, backgroundVideo } = input;
  const { viewport } = context;

  // Guard: backgroundVideo is required
  if (!backgroundVideo?.src) return [];

  const quoteFontSize = themedFontSize(52, context, true);
  const attrFontSize = themedFontSize(26, context, false);
  const decoFontSize = themedFontSize(200, context, true);
  const quoteLineHeight = 1.4;
  const quoteYPct = attribution ? 45 : 50;

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
      animation: { type: 'fadeIn', duration: 2 },
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

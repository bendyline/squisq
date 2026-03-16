/**
 * Full Bleed Quote Template
 *
 * Short dramatic text filling the viewport like a movie title card.
 * Designed for punchy text under 60 characters. Uses massive font
 * centered on a dark vignette background.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { FullBleedQuoteInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { resolveColorScheme } from '../utils/themeUtils.js';

export function fullBleedQuote(input: FullBleedQuoteInput, context: TemplateContext): Layer[] {
  const { text, colorScheme = 'blue' } = input;
  const { theme } = context;
  const colors = resolveColorScheme(context, colorScheme);

  // Massive font for dramatic impact
  const textFontSize = scaledFontSize(120, context, true);

  return [
    // Background — dark radial vignette for cinematic feel
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: `radial-gradient(ellipse at 50% 50%, ${theme.colors.backgroundLight} 0%, #000000 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
    // The text — massive, centered
    {
      type: 'text',
      id: 'impact-text',
      content: {
        text,
        style: {
          fontSize: textFontSize,
          fontWeight: 'bold',
          color: colors.text,
          textAlign: 'center',
          lineHeight: 1.2,
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: '50%',
        anchor: 'center',
        width: '85%',
      },
      animation: { type: 'fadeIn', duration: 1.5 },
    },
  ];
}

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
import {
  resolveColorScheme,
  getThemeFont,
  shouldUseShadow,
  themedFontSize,
} from '../utils/themeUtils.js';
import { oklchDarken } from '../../schemas/colorUtils.js';

/**
 * Hint schema published for the theme validator + future customizer hint UI.
 * Themes may set `templateHints.fullBleedQuote` entries matching these keys.
 */
export const fullBleedQuoteHintSchema = {
  /** Entrance style for the quote text. 'subtle' or 'dramatic'. */
  entrance: {
    type: 'string' as const,
    options: ['subtle', 'dramatic'] as const,
    default: 'subtle',
  },
} as const;

export function fullBleedQuote(input: FullBleedQuoteInput, context: TemplateContext): Layer[] {
  const { text, colorScheme = 'blue' } = input;
  const colors = resolveColorScheme(context, colorScheme);

  // Massive font for dramatic impact
  const textFontSize = themedFontSize(120, context, true);

  return [
    // Background — radial vignette built from the color scheme's own
    // surface, so the card takes on the scheme (and the theme behind it)
    // instead of vignetting every theme into hard black.
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: `radial-gradient(ellipse at 50% 50%, ${colors.bg} 0%, ${oklchDarken(colors.bg, 0.12)} 100%)`,
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
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: colors.text,
          textAlign: 'center',
          lineHeight: 1.2,
          shadow: shouldUseShadow(context),
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

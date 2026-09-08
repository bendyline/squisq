/**
 * Full Bleed Quote Template
 *
 * Short dramatic text filling the viewport like a movie title card.
 * Designed for punchy text under 60 characters — massive type centred on a
 * vignette built from the color scheme — but Markdown authors hand it whole
 * paragraphs too, so the type is sized from the text length, shrunk to fit
 * a central band, and finally line-clamped rather than ever leaving the
 * frame. The measured block is centred in the band, so a one-liner still
 * sits at the optical centre while a long body fills it top to bottom.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { FullBleedQuoteInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  resolveColorScheme,
  getTemplateHint,
  getThemeFont,
  shouldUseShadow,
  themedFontSize,
} from '../utils/themeUtils.js';
import { oklchDarken } from '../../schemas/colorUtils.js';
import { fitProse } from './captionUtils.js';

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

/** Horizontal text column, as fractions of the viewport width. */
const COLUMN_LEFT = 0.075;
const COLUMN_WIDTH = 0.85;
/** Vertical band the text may occupy, as fractions of the viewport height. */
const BAND_TOP = 0.1;
const BAND_BOTTOM = 0.9;
/** Fraction of the band the estimate may fill (wide faces wrap earlier). */
const BAND_FILL = 0.94;
/** Line height for the impact type. */
const LINE_HEIGHT = 1.2;
/**
 * Length-based pre-scale: the full 120px only for a genuine title-card line
 * (≤ 40 characters), easing down to 60% by 160 characters. `fitProse` then
 * handles whatever still does not fit.
 */
const FULL_SIZE_CHARS = 40;
const MIN_SIZE_CHARS = 160;
const MIN_LENGTH_FACTOR = 0.6;

function lengthFactor(text: string): number {
  const length = text.trim().length;
  if (length <= FULL_SIZE_CHARS) return 1;
  const t = Math.min(1, (length - FULL_SIZE_CHARS) / (MIN_SIZE_CHARS - FULL_SIZE_CHARS));
  return 1 - t * (1 - MIN_LENGTH_FACTOR);
}

export function fullBleedQuote(input: FullBleedQuoteInput, context: TemplateContext): Layer[] {
  const { text, colorScheme = 'blue' } = input;
  const { viewport } = context;
  const colors = resolveColorScheme(context, colorScheme);
  const H = viewport.height;
  const W = viewport.width;
  const pct = (px: number): string => `${Number(((px / H) * 100).toFixed(3))}%`;

  // Massive font for dramatic impact, eased down for longer text.
  const impactFontSize = themedFontSize(120, context, true);
  const baseFontSize = Math.round(impactFontSize * lengthFactor(text));
  const bandHeightPx = (BAND_BOTTOM - BAND_TOP) * H;

  const fit = fitProse({
    text,
    baseFontSize,
    minFontSize: Math.max(28, impactFontSize / 3),
    maxWidthPx: COLUMN_WIDTH * W,
    maxHeightPx: bandHeightPx * BAND_FILL,
    lineHeight: LINE_HEIGHT,
  });

  // Centre the measured block in the band (never above its top).
  const topPx = Math.max(
    BAND_TOP * H,
    (BAND_TOP + (BAND_BOTTOM - BAND_TOP) / 2) * H - fit.heightPx / 2,
  );

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
    // The text — massive, centered, boxed so it can never leave the frame.
    {
      type: 'text',
      id: 'impact-text',
      content: {
        text,
        style: {
          fontSize: fit.fontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: colors.text,
          textAlign: 'center',
          lineHeight: LINE_HEIGHT,
          shadow: shouldUseShadow(context),
          // Real glyphs of wide display / mono / CJK faces exceed the 0.5em
          // wrap estimate; the renderer measures and scales into the box.
          shrinkToFit: true,
          ...(fit.maxLines ? { maxLines: fit.maxLines } : {}),
        },
      },
      position: {
        x: `${COLUMN_LEFT * 100}%`,
        y: pct(topPx),
        width: `${COLUMN_WIDTH * 100}%`,
        height: pct(fit.heightPx),
        anchor: 'top-left',
      },
      animation:
        getTemplateHint<string>(context, 'fullBleedQuote', 'entrance', 'subtle') === 'dramatic'
          ? { type: 'zoomIn', duration: 0.8 }
          : { type: 'fadeIn', duration: 1.5 },
    },
  ];
}

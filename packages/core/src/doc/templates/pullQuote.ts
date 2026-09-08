/**
 * Pull Quote Template
 *
 * Quote text over a full-bleed background image with dark overlay.
 * Cinematic alternative to quoteBlock when a high-quality image is available.
 * Combines the visual impact of imageWithCaption with the text focus of quoteBlock.
 *
 * Without a background image (the common Markdown case — a heading and a
 * body with no picture) the same lockup renders on the theme surface: a
 * missing image degrades to a themed quote card, never to a blank block.
 *
 * Layout: the quote and attribution are one measured stack. The quote body
 * is shrunk to fit the frame (stepping the size down and re-wrapping, then
 * clamping with `maxLines` at the readable floor), the attribution hangs a
 * fixed gap below the quote's measured bottom, and the whole stack is
 * centred on the block — so a one-line quote still sits where it always
 * did, while a 180-word body stays inside the frame instead of running
 * off the bottom.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer, TextLayer } from '../../schemas/Doc.js';
import type { PullQuoteInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  shouldUseShadow,
  themedEntrance,
  themedFontSize,
  themedImageTreatment,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { createBackgroundLayer, estimateWrappedLineCount, fitProse } from './captionUtils.js';
import { mapAmbientMotion } from './accentImage.js';

/** Column the lockup occupies, as a percent of viewport width. */
const COLUMN_LEFT_PCT = 14;
const COLUMN_WIDTH_PCT = 72;
/** Vertical band the stack may occupy, as a percent of viewport height. */
const FRAME_TOP_PCT = 10;
const FRAME_BOTTOM_PCT = 90;
/**
 * Wide display faces (Oswald, JetBrains Mono) wrap earlier than the
 * character-count estimate, so the fitted block only claims this share of
 * the band and leaves the rest as slack for the extra lines.
 */
const FIT_SLACK = 0.93;

const QUOTE_LINE_HEIGHT = 1.35;
const ATTR_LINE_HEIGHT = 1.4;

export interface PullQuoteLockupOptions {
  text: string;
  attribution?: string;
  /**
   * True when the lockup sits on a photo/video behind a dark scrim (white
   * text with shadows); false when it sits on the theme surface (theme
   * text colours).
   */
  overMedia: boolean;
}

/**
 * The text layers shared by `pullQuote` and `videoPullQuote`: decorative
 * quotation mark, fitted quote body, and optional attribution, positioned
 * as one measured stack centred on the block.
 */
export function pullQuoteLockup(
  options: PullQuoteLockupOptions,
  context: TemplateContext,
): Layer[] {
  const { text, attribution, overMedia } = options;
  const { theme, viewport } = context;

  const pct = (px: number): number => (px / viewport.height) * 100;

  const quoteBaseSize = themedFontSize(52, context, true);
  const quoteMinSize = Math.max(18, themedFontSize(24, context, true));
  const attrFontSize = themedFontSize(26, context, false);
  const decoBaseSize = themedFontSize(200, context, true);
  const decoMinSize = themedFontSize(72, context, true);

  const columnWidthPx = (COLUMN_WIDTH_PCT / 100) * viewport.width;
  const frameTopPx = (FRAME_TOP_PCT / 100) * viewport.height;
  const frameHeightPx = ((FRAME_BOTTOM_PCT - FRAME_TOP_PCT) / 100) * viewport.height;

  // Attribution height is fixed by its own text; the quote gets whatever
  // remains of the band after the attribution and the gap between them.
  const attrText = attribution ? `— ${attribution}` : '';
  const attrHeightPx = attribution
    ? estimateWrappedLineCount(attrText, attrFontSize, columnWidthPx) *
      attrFontSize *
      ATTR_LINE_HEIGHT
    : 0;
  const gapReservePx = attribution ? quoteBaseSize * 0.6 : 0;
  const quoteMaxHeightPx = Math.max(
    quoteMinSize * QUOTE_LINE_HEIGHT,
    (frameHeightPx - attrHeightPx - gapReservePx) * FIT_SLACK,
  );

  const fit = fitProse({
    text,
    baseFontSize: quoteBaseSize,
    minFontSize: quoteMinSize,
    maxWidthPx: columnWidthPx,
    maxHeightPx: quoteMaxHeightPx,
    lineHeight: QUOTE_LINE_HEIGHT,
  });

  const gapPx = attribution ? Math.max(16, fit.fontSize * 0.6) : 0;
  const stackHeightPx = fit.heightPx + gapPx + attrHeightPx;
  // Centre the whole stack on the block, but never above the frame's top.
  const stackTopPx = Math.max(frameTopPx, viewport.height / 2 - stackHeightPx / 2);
  const quoteTopPct = pct(stackTopPx);
  const attrTopPct = pct(stackTopPx + fit.heightPx + gapPx);

  // The ornament floats above the first line and only claims the headroom
  // the stack leaves it: it shrinks as the stack grows and is dropped once
  // it would have to sit on top of the quote to fit at all.
  const decoHeadroomPx = stackTopPx - 0.03 * viewport.height;
  const decoFontSize = Math.min(decoBaseSize, Math.floor(decoHeadroomPx / 0.6));
  const showDeco = decoFontSize >= decoMinSize;
  const decoYPct = quoteTopPct - pct(decoFontSize * 0.55);

  const shadow = overMedia ? true : shouldUseShadow(context);
  const quoteColor = overMedia ? '#ffffff' : theme.colors.text;
  const attrColor = overMedia ? 'rgba(255, 255, 255, 0.85)' : theme.colors.textMuted;
  const decoColor = overMedia ? 'rgba(255, 255, 255, 0.08)' : withAlpha(theme.colors.text, 0.09);

  const quoteLayer: TextLayer = {
    type: 'text',
    id: 'quote-text',
    content: {
      text,
      style: {
        fontSize: fit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        color: quoteColor,
        textAlign: 'center',
        lineHeight: QUOTE_LINE_HEIGHT,
        shadow,
        // The wrap above is an estimate; wide display faces and CJK/Arabic
        // runs (which the renderer breaks by character count) can still run
        // wider than the column, so the renderer measures the real glyphs
        // and scales the block down to the column when they do.
        shrinkToFit: true,
        ...(fit.maxLines ? { maxLines: fit.maxLines } : {}),
      },
    },
    // Top-left anchored so wrapped lines grow from a known top edge;
    // horizontal centring comes from textAlign inside the column.
    position: {
      x: `${COLUMN_LEFT_PCT}%`,
      y: `${quoteTopPct.toFixed(2)}%`,
      anchor: 'top-left',
      width: `${COLUMN_WIDTH_PCT}%`,
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 2 }),
  };

  const layers: Layer[] = [];

  // Decorative quotation mark
  if (showDeco) {
    layers.push({
      type: 'text',
      id: 'deco-quote',
      content: {
        text: '“',
        style: {
          fontSize: decoFontSize,
          fontFamily: getThemeFont(context, 'title'),
          color: decoColor,
          textAlign: 'center',
        },
      },
      position: {
        x: '50%',
        y: `${decoYPct.toFixed(2)}%`,
        anchor: 'center',
      },
    });
  }

  layers.push(quoteLayer);

  // Attribution hangs just below the quote's measured bottom edge so the
  // two read as one lockup instead of stranding near the bottom.
  if (attribution) {
    layers.push({
      type: 'text',
      id: 'attribution',
      content: {
        text: attrText,
        style: {
          fontSize: attrFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: attrColor,
          textAlign: 'center',
          lineHeight: ATTR_LINE_HEIGHT,
          shadow,
        },
      },
      position: {
        x: `${COLUMN_LEFT_PCT}%`,
        y: `${attrTopPct.toFixed(2)}%`,
        anchor: 'top-left',
        width: `${COLUMN_WIDTH_PCT}%`,
      },
      animation: { type: 'fadeIn', duration: 1, delay: 1.5 },
    });
  }

  return layers;
}

/** Dark scrim that keeps white text legible over a photo or video. */
export function pullQuoteOverlayLayer(): Layer {
  return createBackgroundLayer('overlay', 'rgba(0, 0, 0, 0.55)');
}

export function pullQuote(input: PullQuoteInput, context: TemplateContext): Layer[] {
  const { text, attribution, backgroundImage, ambientMotion } = input;

  const treatment = themedImageTreatment(context, input.imageTreatment);
  const layers: Layer[] = [];

  if (backgroundImage?.src) {
    layers.push(
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
        // Same authored `ambientMotion` vocabulary as every other image
        // template — map it to a real Ken Burns animation rather than passing
        // the token straight through as an animation type.
        animation: mapAmbientMotion(ambientMotion, 15),
      },
      // Dark overlay for text readability
      pullQuoteOverlayLayer(),
    );
  } else {
    // No image: the quote renders on the theme surface (like quoteBlock)
    // rather than the template producing a blank block.
    layers.push(createBackgroundLayer('bg', themedSurfaceGradient(context, 160)));
  }

  layers.push(
    ...pullQuoteLockup({ text, attribution, overMedia: Boolean(backgroundImage?.src) }, context),
  );

  return layers;
}

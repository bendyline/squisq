/**
 * Quote Block Template
 *
 * Large centered quote with optional attribution, composed as one measured
 * lockup: the quote body is shrunk-to-fit into the band that remains below
 * the title, the attribution hangs a fixed distance below the quote's
 * measured bottom edge, and the whole lockup floats around the slide's
 * optical centre — so a one-line quote still reads as a composed card and a
 * 180-word body never leaves the frame or overprints its attribution.
 *
 * Every text layer is anchored top-left with the column's width (the
 * renderer puts the first line's top at `y` and hangs further lines below
 * it), and `textAlign: 'center'` centres the lines inside that box.
 * Adapts font sizes and positioning for different viewports.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer, TextLayer } from '../../schemas/Doc.js';
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
import { createAccentLayers, getAccentLayout, DEFAULT_LAYOUT } from './accentImage.js';
import { createBackgroundLayer, fitProse } from './captionUtils.js';

/** Top of the optional title, as a fraction of the viewport height. */
const TITLE_TOP = 0.11;
/** Top of the lockup band when there is no title. */
const BAND_TOP = 0.1;
/** Bottom of the lockup band (attribution never sits below this). */
const BAND_BOTTOM = 0.88;
/** Optical centre the quote + attribution lockup floats around. */
const LOCKUP_CENTRE = 0.5;
/** Fraction of the remaining band the quote body may fill (wide faces wrap earlier). */
const BODY_FILL = 0.94;
/** Smallest size the ornament renders at before it is dropped. */
const MIN_DECO_PX = 90;

export function quoteBlock(input: QuoteBlockInput, context: TemplateContext): Layer[] {
  const { title, quote, attribution, accentImage } = input;
  const { theme, viewport } = context;
  const H = viewport.height;
  const W = viewport.width;
  const pct = (px: number): string => `${Number(((px / H) * 100).toFixed(3))}%`;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;
  // A bottom strip shifts the whole content region up; fold that into the band.
  const yShiftPx = accentLayout.adjustY ? (accentLayout.textYAdjust / 100) * H : 0;

  // Text column (centred at textCenterX, textWidth wide).
  const colWidthPct = parseFloat(accentLayout.textWidth);
  const colCenterPct = parseFloat(accentLayout.textCenterX);
  const colLeft = `${Number((colCenterPct - colWidthPct / 2).toFixed(3))}%`;
  const colWidthPx = (colWidthPct / 100) * W;

  // Scale font sizes for viewport
  const quoteFontSize = themedFontSize(48, context, true);
  const titleFontSize = themedFontSize(34, context, true);
  const attrFontSize = themedFontSize(26, context, false);
  const quoteLineHeight = Math.max(theme.typography.titleLineHeight ?? 1.4, 1.25);
  const titleLineHeight = 1.3;
  const attrLineHeight = 1.4;

  // Decorative quotation mark font size
  const decorativeQuoteFontSize = themedFontSize(280, context, true);

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 160))];

  // Add accent image layers (behind text, after background)
  if (accentImage) {
    layers.push(
      ...createAccentLayers(
        accentImage,
        input.id,
        themedImageTreatment(context, input.imageTreatment),
      ),
    );
  }

  const bandTopPx = Math.max(0.05 * H, (title ? TITLE_TOP : BAND_TOP) * H + yShiftPx);
  const bandBottomPx = BAND_BOTTOM * H + yShiftPx;

  // Title (kicker) — pinned to the top of the band; a long heading steps
  // down and finally clamps rather than eating the quote's space.
  let lockupMinTopPx = bandTopPx;
  let titleBottomPx = bandTopPx;
  if (title) {
    const titleFit = fitProse({
      text: title,
      baseFontSize: titleFontSize,
      minFontSize: Math.max(20, titleFontSize * 0.7),
      maxWidthPx: colWidthPx,
      maxHeightPx: 0.14 * H,
      lineHeight: titleLineHeight,
    });
    titleBottomPx = bandTopPx + titleFit.heightPx;
    lockupMinTopPx = titleBottomPx + 0.04 * H;
    layers.push({
      type: 'text',
      id: 'quote-title',
      content: {
        text: title,
        style: {
          fontSize: titleFit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: 'bold',
          color: theme.colors.textMuted,
          textAlign: 'center',
          lineHeight: titleLineHeight,
          shadow: shouldUseShadow(context),
          shrinkToFit: true,
          ...(titleFit.maxLines ? { maxLines: titleFit.maxLines } : {}),
        },
      },
      position: {
        x: colLeft,
        y: pct(bandTopPx),
        width: accentLayout.textWidth,
        height: pct(titleFit.heightPx),
        anchor: 'top-left',
      },
      animation: { type: 'fadeIn', duration: 0.8 },
    });
  }

  // Attribution reservation (measured before the quote so the body only
  // takes the height that is really left).
  // Plus a quarter line of slack: wide display faces (Oswald, JetBrains Mono)
  // wrap a touch taller than the estimate and used to graze the attribution.
  const attrGapPx = attribution ? 0.035 * H + 0.3 * quoteFontSize : 0;
  const attrFit = attribution
    ? fitProse({
        text: `— ${attribution}`,
        baseFontSize: attrFontSize,
        minFontSize: Math.max(18, attrFontSize * 0.75),
        maxWidthPx: colWidthPx,
        maxHeightPx: 0.12 * H,
        lineHeight: attrLineHeight,
      })
    : null;
  const attrHeightPx = attrFit ? attrFit.heightPx : 0;

  // Quote body — shrink-to-fit into whatever band remains, with a small
  // reserve because wide display faces wrap earlier than the estimate.
  const bodyMaxHeightPx = Math.max(
    quoteFontSize * quoteLineHeight,
    (bandBottomPx - lockupMinTopPx - attrGapPx - attrHeightPx) * BODY_FILL,
  );
  const quoteFit = fitProse({
    text: quote,
    baseFontSize: quoteFontSize,
    minFontSize: Math.max(22, quoteFontSize * 0.55),
    maxWidthPx: colWidthPx,
    maxHeightPx: bodyMaxHeightPx,
    lineHeight: quoteLineHeight,
  });

  // Float the measured lockup around the optical centre, but never above
  // the title or below the band.
  const lockupHeightPx = quoteFit.heightPx + attrGapPx + attrHeightPx;
  const lockupTopPx = Math.min(
    Math.max(LOCKUP_CENTRE * H + yShiftPx - lockupHeightPx / 2, lockupMinTopPx),
    Math.max(lockupMinTopPx, bandBottomPx - lockupHeightPx),
  );
  const quoteTopPx = lockupTopPx;
  const quoteBottomPx = quoteTopPx + quoteFit.heightPx;

  // Decorative opening quotation mark — oversized, low-opacity, sitting in
  // the gap between the title and the quote with its em box hugging the
  // quote's top edge. Derived from the theme text color so it stays a
  // subtle ornament on light and dark surfaces alike. Shrunk to the gap and
  // dropped when the gap is too small to hold it without touching text.
  const decoGapTopPx = title ? titleBottomPx : Math.max(0, bandTopPx - 0.05 * H);
  const decoMarginPx = 12;
  const decoRoomPx = quoteTopPx - decoGapTopPx - 2 * decoMarginPx;
  const decoFontSize = Math.min(decorativeQuoteFontSize, decoRoomPx / 1.2);
  if (decoFontSize >= MIN_DECO_PX) {
    layers.push({
      type: 'text',
      id: 'deco-quote',
      content: {
        text: '“',
        style: {
          fontSize: decoFontSize,
          fontFamily: getThemeFont(context, 'title'),
          color: withAlpha(theme.colors.text, 0.09),
          textAlign: 'center',
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: pct(quoteTopPx - decoMarginPx - decoFontSize * 0.6),
        anchor: 'center',
      },
    });
  }

  const quoteLayer: TextLayer = {
    type: 'text',
    id: 'quote',
    content: {
      text: quote,
      style: {
        fontSize: quoteFit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        color: theme.colors.text,
        textAlign: 'center',
        lineHeight: quoteLineHeight,
        shadow: shouldUseShadow(context),
        // Real glyphs (mono, CJK, condensed display faces) can run wider
        // than the 0.5em wrap estimate; let the renderer scale the block
        // into its box instead of letting lines cross the frame edge.
        shrinkToFit: true,
        ...(quoteFit.maxLines ? { maxLines: quoteFit.maxLines } : {}),
      },
    },
    position: {
      x: colLeft,
      y: pct(quoteTopPx),
      width: accentLayout.textWidth,
      height: pct(quoteFit.heightPx),
      anchor: 'top-left',
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 2 }),
  };
  layers.push(quoteLayer);

  // Attribution hangs just below the quote's measured bottom edge, so the
  // two read as one lockup instead of the attribution stranding near the
  // bottom of the block (or, for a long quote, landing on top of it).
  if (attribution && attrFit) {
    layers.push({
      type: 'text',
      id: 'attribution',
      content: {
        text: `— ${attribution}`,
        style: {
          fontSize: attrFit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'center',
          lineHeight: attrLineHeight,
          shadow: shouldUseShadow(context),
          shrinkToFit: true,
          ...(attrFit.maxLines ? { maxLines: attrFit.maxLines } : {}),
        },
      },
      position: {
        x: colLeft,
        y: pct(quoteBottomPx + attrGapPx),
        width: accentLayout.textWidth,
        height: pct(attrFit.heightPx),
        anchor: 'top-left',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 1.5 },
    });
  }

  return layers;
}

/**
 * Date Event Template
 *
 * Timeline-style slide with prominent date and description.
 * Supports different moods: neutral, somber, celebratory.
 * Adapts font sizes and positioning for different viewports.
 *
 * Date, description and footer share one left edge inside a centred
 * column — the description is running prose, and centred prose reads as
 * a ragged blob. Every text layer carries the column width so the
 * renderer pins the text to the column's left edge.
 *
 * The lockup is a measured stack, not a set of fixed slots: each slot is
 * a box whose top sits at the previous slot's estimated bottom, the
 * description shrinks (then clamps) to the height that remains, and the
 * whole group is centred on the frame's optical centre. Fixed percentages
 * collided as soon as the description wrapped — the renderer hangs extra
 * lines *below* a height-less centre-anchored point — and left the bottom
 * third empty for a one-line body.
 *
 * Each text layer is a centre-anchored box (the column-centre `x`
 * convention shared by the other prose lockups) with an explicit height
 * and `verticalAlign: 'top'`, so the renderer resolves the text top to
 * the box top and the wrapped block grows downward from a known edge.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer, Position } from '../../schemas/Doc.js';
import type { DateEventInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { oklchDarken, relativeLuminance } from '../../schemas/colorUtils.js';
import {
  createAccentLayers,
  getAccentLayout,
  ACCENT_STRIP_SIZE,
  DEFAULT_LAYOUT,
} from './accentImage.js';
import { estimateProseLineCount, fitProse } from './captionUtils.js';

/**
 * Mood accents tint the hero date, not the surface — the surface always
 * comes from the theme. (Hard-coded dark mood panels used to turn light
 * and warm themes into a cold navy slide.)
 */
const MOOD_ACCENTS = {
  neutral: '#63b3ed',
  somber: '#e53e3e',
  celebratory: '#68d391',
};

/** Line-height multipliers the layers render with (and the stack measures with). */
const DATE_LINE_HEIGHT = 1.15;
const DESC_LINE_HEIGHT = 1.6;
const FOOTER_LINE_HEIGHT = 1.4;

/** Vertical safe band, as a fraction of the viewport height. */
const BAND_TOP = 0.08;
const BAND_BOTTOM = 0.92;
/** Where the group's centre sits inside the band (slightly above middle). */
const OPTICAL_CENTRE = 0.46;
/** Extra height held back from the body so wide faces that wrap early still fit. */
const BODY_SLACK = 0.05;
/** Share of the band the hero date may take before it steps down. */
const HERO_MAX_SHARE = 0.28;
/**
 * Glyph slack added to each text box beyond the line-count estimate, so the
 * renderer's shrinkToFit only fires when the real face runs wider than the
 * wrap estimate — not because a tall ascender grazes the box bottom.
 */
const BOX_SLACK_EM = 0.35;

export function dateEvent(input: DateEventInput, context: TemplateContext): Layer[] {
  const { date, description, footer, mood = 'neutral', accentImage } = input;
  const { theme, viewport } = context;
  // Deepen the mood accent on light surfaces so the hero date keeps contrast.
  const moodAccent = MOOD_ACCENTS[mood];
  const dateColor =
    relativeLuminance(theme.colors.background) > 0.5 ? oklchDarken(moodAccent, 0.25) : moodAccent;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Column geometry.
  const columnWidthPct = parseFloat(accentLayout.textWidth);
  const columnWidthPx = (columnWidthPct / 100) * viewport.width;

  // A bottom strip owns the lower part of the frame; the band shrinks to
  // the area above it instead of nudging fixed slots up by a few percent.
  const bandTopPx = BAND_TOP * viewport.height;
  const bandBottomPx = accentLayout.adjustY
    ? ((100 - ACCENT_STRIP_SIZE - 3) / 100) * viewport.height
    : BAND_BOTTOM * viewport.height;
  const bandHeightPx = bandBottomPx - bandTopPx;

  // Scale font sizes — date is the hero element
  const dateBaseSize = themedFontSize(96, context, true);
  const descBaseSize = themedFontSize(30, context, false);
  const footerFontSize = themedFontSize(26, context, false);

  // Hero: a long heading promoted into the date slot steps down (and at the
  // floor clamps) instead of wrapping through the rest of the lockup.
  const dateFit = fitProse({
    text: date,
    baseFontSize: dateBaseSize,
    minFontSize: Math.round(dateBaseSize * 0.4),
    maxWidthPx: columnWidthPx,
    maxHeightPx: HERO_MAX_SHARE * bandHeightPx,
    lineHeight: DATE_LINE_HEIGHT,
  });
  const dateH = dateFit.heightPx;

  const hasDescription = description.trim().length > 0;
  const footerText = footer && footer.trim() ? footer : undefined;

  const footerH = footerText
    ? estimateProseLineCount(footerText, footerFontSize, columnWidthPx) *
      footerFontSize *
      FOOTER_LINE_HEIGHT
    : 0;
  // Keep the gap after the date whenever anything follows it, so a footer
  // never sits flush against the date box when the description is empty.
  const descGap = hasDescription || footerText ? Math.round(dateBaseSize * 0.55) : 0;
  const footerGap = footerText ? Math.round(descBaseSize * 1.1) : 0;

  // Body: shrink to the height that remains, then clamp at the readable floor.
  const bodyMaxH = Math.max(
    descBaseSize * DESC_LINE_HEIGHT,
    bandHeightPx - dateH - descGap - footerGap - footerH - BODY_SLACK * viewport.height,
  );
  const descFit = hasDescription
    ? fitProse({
        text: description,
        baseFontSize: descBaseSize,
        minFontSize: Math.max(18, Math.round(descBaseSize * 0.6)),
        maxWidthPx: columnWidthPx,
        maxHeightPx: bodyMaxH,
        lineHeight: DESC_LINE_HEIGHT,
      })
    : null;
  const descH = descFit ? descFit.heightPx : 0;

  // Centre the measured group on the band's optical centre; never above the band.
  const totalH = dateH + descGap + descH + footerGap + footerH;
  const groupTopPx = Math.max(bandTopPx, bandTopPx + OPTICAL_CENTRE * bandHeightPx - totalH / 2);
  const dateTop = groupTopPx;
  const descTop = dateTop + dateH + descGap;
  const footerTop = descTop + descH + footerGap;

  // Centre-anchored box whose top edge is `topPx` (paired with verticalAlign 'top').
  const box = (topPx: number, heightPx: number): Position => {
    const height = Math.round(heightPx);
    return {
      x: accentLayout.textCenterX,
      y: `${(((topPx + height / 2) / viewport.height) * 100).toFixed(3)}%`,
      width: accentLayout.textWidth,
      height,
      anchor: 'center',
    };
  };

  const layers: Layer[] = [
    // Background — theme surface gradient (diagonal to differentiate
    // from other text templates)
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: themedSurfaceGradient(context, 135),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

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

  // Date — hero element, much larger
  layers.push({
    type: 'text',
    id: 'date',
    content: {
      text: date,
      style: {
        fontSize: dateFit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: dateColor,
        textAlign: 'left',
        verticalAlign: 'top',
        lineHeight: DATE_LINE_HEIGHT,
        shrinkToFit: true,
        ...(dateFit.maxLines ? { maxLines: dateFit.maxLines } : {}),
        shadow: shouldUseShadow(context),
      },
    },
    position: box(dateTop, dateH + dateFit.fontSize * BOX_SLACK_EM),
    animation: { type: 'fadeIn', duration: 1.5 },
  });

  // Description — constrained width for proper text wrapping. Skipped when
  // the body is empty so the hero is not echoed by a blank slot.
  if (descFit) {
    layers.push({
      type: 'text',
      id: 'description',
      content: {
        text: description,
        style: {
          fontSize: descFit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.text,
          textAlign: 'left',
          verticalAlign: 'top',
          lineHeight: DESC_LINE_HEIGHT,
          shrinkToFit: true,
          ...(descFit.maxLines ? { maxLines: descFit.maxLines } : {}),
          shadow: shouldUseShadow(context),
        },
      },
      position: box(descTop, descH + descFit.fontSize * BOX_SLACK_EM),
      animation: { type: 'fadeIn', duration: 2, delay: 1 },
    });
  }

  // Add footer if provided — always below the measured body, never at a fixed slot.
  if (footerText) {
    layers.push({
      type: 'text',
      id: 'footer',
      content: {
        text: footerText,
        style: {
          fontSize: footerFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'left',
          verticalAlign: 'top',
          lineHeight: FOOTER_LINE_HEIGHT,
          shrinkToFit: true,
          shadow: shouldUseShadow(context),
        },
      },
      position: box(footerTop, footerH + footerFontSize * BOX_SLACK_EM),
      animation: { type: 'fadeIn', duration: 1, delay: 3 },
    });
  }

  return layers;
}

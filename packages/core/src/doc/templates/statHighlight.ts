/**
 * Stat Highlight Template
 *
 * Large statistic/number with description and optional detail.
 * Great for emphasizing key data points.
 * Adapts font sizes and positioning for different viewports.
 *
 * Reads as a KPI card: the stat, description and detail share one left
 * edge inside a centred column. The description is frequently a whole
 * paragraph (an unannotated heading + body lands here), and centred
 * paragraphs read as a ragged blob. Every text layer carries the column
 * width so the renderer pins the text to the column's left edge.
 *
 * Geometry: the three slots are measured with the renderer's word-wrap and
 * stacked top-down inside a safe band (8%–92% of the frame), the group
 * centred on the optical centre. A long heading promoted into the stat slot
 * steps its size down (to 40%) instead of leaving the frame; the
 * description shrinks to the height that remains and clamps with an
 * ellipsis at the readable floor; the detail always sits below the
 * description's measured bottom. Each layer carries an explicit box plus
 * `shrinkToFit`, so the renderer centres the wrapped block on its anchor
 * (rather than hanging extra lines below it) and scales real glyphs down if
 * a wide face or CJK text runs past the column.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { StatHighlightInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  resolveColorScheme,
  getTemplateHint,
  getThemeFont,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { createAccentLayers, getAccentLayout, DEFAULT_LAYOUT } from './accentImage.js';
import { createBackgroundLayer, fitProse } from './captionUtils.js';

/**
 * Hint schema published for the theme validator + future customizer hint UI.
 * Themes may set `templateHints.statHighlight` entries matching these keys.
 */
export const statHighlightHintSchema = {
  /** Entrance style for the stat number. 'subtle' or 'dramatic'. */
  entrance: {
    type: 'string' as const,
    options: ['subtle', 'dramatic'] as const,
    default: 'subtle',
  },
} as const;

/** Vertical band (fractions of the frame) the lockup may occupy. */
const SAFE_TOP = 0.08;
const SAFE_BOTTOM = 0.92;
/** Optical centre of the lockup as a fraction of the frame height. */
const OPTICAL_CENTER = 0.47;
/** Share of the safe band the stat may take before it steps down. */
const HERO_MAX_SHARE = 0.38;

const STAT_LINE_HEIGHT = 1.1;
const DESC_LINE_HEIGHT = 1.5;
const DETAIL_LINE_HEIGHT = 1.4;

export function statHighlight(input: StatHighlightInput, context: TemplateContext): Layer[] {
  const { stat, colorScheme = 'blue', accentImage } = input;
  const { theme, viewport } = context;
  const colors = resolveColorScheme(context, colorScheme);

  // Input derivation falls back to the heading for a missing body, which
  // would print the stat twice; an echo of the stat is treated as no body.
  const rawDescription = (input.description ?? '').trim();
  const description = rawDescription === stat.trim() ? '' : rawDescription;
  const detail = (input.detail ?? '').trim();

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Scale font sizes — stat is dramatically large, description is understated
  const statFontSize = themedFontSize(148, context, true);
  const descFontSize = themedFontSize(32, context, false);
  const detailFontSize = themedFontSize(26, context, false);

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 180))];

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

  // ---- Measure -----------------------------------------------------------
  const frameH = viewport.height;
  const columnPx = (parseFloat(accentLayout.textWidth) / 100) * viewport.width;
  // A bottom strip covers the lower 35% of the frame; keep the lockup above it.
  const safeTopPx = SAFE_TOP * frameH;
  const safeBottomPx =
    (accentLayout.adjustY ? SAFE_BOTTOM + accentLayout.textYAdjust / 100 : SAFE_BOTTOM) * frameH;
  const availablePx = Math.max(descFontSize * 3, safeBottomPx - safeTopPx);

  // Hero: a real stat ("73%") never needs this, but a sixteen-word heading
  // promoted into the slot steps down to 40% size and clamps at the floor.
  const statFit = fitProse({
    text: stat,
    baseFontSize: statFontSize,
    minFontSize: Math.round(statFontSize * 0.4),
    maxWidthPx: columnPx,
    maxHeightPx: availablePx * HERO_MAX_SHARE,
    lineHeight: STAT_LINE_HEIGHT,
  });
  const statBoxH = statFit.heightPx + statFit.fontSize * 0.2;

  // Sits close under the stat (the ~26% fixed gap it used to get read as
  // two unrelated elements floating in the panel).
  const gap = description || detail ? Math.round(statFit.fontSize * 0.3) : 0;

  // Detail: one or two lines, never more.
  const detailFit = detail
    ? fitProse({
        text: detail,
        baseFontSize: detailFontSize,
        minFontSize: detailFontSize,
        maxWidthPx: columnPx,
        maxHeightPx: 2 * detailFontSize * DETAIL_LINE_HEIGHT,
        lineHeight: DETAIL_LINE_HEIGHT,
      })
    : null;
  const detailBoxH = detailFit ? detailFit.heightPx + detailFontSize * 0.3 : 0;
  const detailGap = detailFit && description ? Math.round(descFontSize * 0.9) : 0;

  // Description: shrink to whatever height remains, keeping a little slack
  // for faces that wrap earlier than the estimate.
  const descSlack = descFontSize * DESC_LINE_HEIGHT * 0.4;
  const descMaxPx = Math.max(
    descFontSize * DESC_LINE_HEIGHT,
    availablePx * 0.95 - statBoxH - gap - detailGap - detailBoxH - descSlack,
  );
  const descFit = description
    ? fitProse({
        text: description,
        baseFontSize: descFontSize,
        minFontSize: Math.max(18, Math.round(descFontSize * 0.6)),
        maxWidthPx: columnPx,
        maxHeightPx: descMaxPx,
        lineHeight: DESC_LINE_HEIGHT,
      })
    : null;
  const descBoxH = descFit ? descFit.heightPx + descSlack : 0;

  // ---- Place -------------------------------------------------------------
  const totalH = statBoxH + gap + descBoxH + detailGap + detailBoxH;
  const groupTop = Math.min(
    Math.max(safeTopPx, OPTICAL_CENTER * frameH - totalH / 2),
    Math.max(safeTopPx, safeBottomPx - totalH),
  );
  const statTop = groupTop;
  const descTop = statTop + statBoxH + gap;
  const detailTop = descTop + descBoxH + detailGap;

  const pct = (px: number) => `${Number(((px / frameH) * 100).toFixed(3))}%`;
  const box = (top: number, height: number) => ({
    x: accentLayout.textCenterX,
    y: pct(top + height / 2),
    width: accentLayout.textWidth,
    height: pct(height),
    anchor: 'center' as const,
  });

  // Big stat — hero element, dominates the slide
  layers.push({
    type: 'text',
    id: 'stat',
    content: {
      text: stat,
      style: {
        fontSize: statFit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: colors.text,
        textAlign: 'left',
        lineHeight: STAT_LINE_HEIGHT,
        shadow: shouldUseShadow(context),
        shrinkToFit: true,
        ...(statFit.maxLines ? { maxLines: statFit.maxLines } : {}),
      },
    },
    position: box(statTop, statBoxH),
    animation:
      getTemplateHint<string>(context, 'statHighlight', 'entrance', 'subtle') === 'dramatic'
        ? { type: 'zoomIn', duration: 0.4 }
        : { type: 'zoomIn', duration: 0.6 },
  });

  // Description — smaller and understated beneath the stat (skipped when
  // the block has no body, so the stat centres alone).
  if (descFit) {
    layers.push({
      type: 'text',
      id: 'description',
      content: {
        text: description,
        style: {
          fontSize: descFit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'left',
          lineHeight: DESC_LINE_HEIGHT,
          shadow: shouldUseShadow(context),
          shrinkToFit: true,
          ...(descFit.maxLines ? { maxLines: descFit.maxLines } : {}),
        },
      },
      position: box(descTop, descBoxH),
      animation: { type: 'fadeIn', duration: 1, delay: 0.3 },
    });
  }

  // Add detail if provided
  if (detailFit) {
    layers.push({
      type: 'text',
      id: 'detail',
      content: {
        text: detail,
        style: {
          fontSize: detailFit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          // Scheme *text* rather than *accent*: accents in the built-in
          // schemes are tuned as chart/fill colors and drop below legible
          // contrast as body copy on light surfaces.
          color: colors.text,
          textAlign: 'left',
          lineHeight: DETAIL_LINE_HEIGHT,
          shadow: shouldUseShadow(context),
          shrinkToFit: true,
          ...(detailFit.maxLines ? { maxLines: detailFit.maxLines } : {}),
        },
      },
      position: box(detailTop, detailBoxH),
      animation: { type: 'fadeIn', duration: 1, delay: 1 },
    });
  }

  return layers;
}

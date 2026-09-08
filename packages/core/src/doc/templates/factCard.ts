/**
 * Fact Card Template
 *
 * Key fact with explanation and optional source, composed as one
 * vertically-centered lockup: each element is placed relative to the
 * estimated height of the one above it, so short content doesn't leave
 * fixed-slot voids and long content doesn't collide. The column floats
 * at the slide's centre but the text inside it is LEFT-aligned — the
 * explanation is running prose (often several paragraphs or a list), and
 * centred prose reads as a ragged blob. Every layer carries the column
 * width so the renderer pins the text to the column's left edge instead
 * of the anchor point.
 *
 * Geometry: every slot is measured with the same word-wrap the renderer
 * uses, then stacked top-down inside a safe band (8%–92% of the frame). The
 * fact steps its size down when a long heading lands in the hero slot, the
 * explanation shrinks to the height that remains (and clamps with an
 * ellipsis at the readable floor), and the source always sits below the
 * explanation's measured bottom. Each layer is given an explicit box plus
 * `shrinkToFit`, so the renderer centres the wrapped block on the anchor
 * (instead of hanging extra lines below it) and scales real glyphs down if
 * a wide face or CJK text runs past the column.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { FactCardInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  shouldUseShadow,
  themedEntrance,
  themedFontSize,
  themedSurfaceGradient,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { createAccentLayers, getAccentLayout, DEFAULT_LAYOUT } from './accentImage.js';
import { createBackgroundLayer, fitProse } from './captionUtils.js';

/** Vertical band (fractions of the frame) the lockup may occupy. */
const SAFE_TOP = 0.08;
const SAFE_BOTTOM = 0.92;
/** Optical centre of the lockup as a fraction of the frame height. */
const OPTICAL_CENTER = 0.47;
/** Share of the safe band the fact may take before it steps down. */
const HERO_MAX_SHARE = 0.36;

const FACT_LINE_HEIGHT = 1.3;
const EXPLAIN_LINE_HEIGHT = 1.5;
const SOURCE_LINE_HEIGHT = 1.4;

export function factCard(input: FactCardInput, context: TemplateContext): Layer[] {
  const { fact, accentImage } = input;
  const explanation = (input.explanation ?? '').trim();
  const source = (input.source ?? '').trim();
  const { theme, viewport } = context;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Scale font sizes for viewport. The explanation sits at ~60% of the fact
  // size — large enough to read comfortably as the secondary line while still
  // clearly subordinate to the headline fact.
  const factFontSize = themedFontSize(56, context, true);
  const explainFontSize = themedFontSize(34, context, false);
  const sourceFontSize = themedFontSize(20, context, false);

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 170))];

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
  const availablePx = Math.max(explainFontSize * 3, safeBottomPx - safeTopPx);

  // Hero: a long heading promoted into the fact slot steps down (to half
  // size) rather than leaving the frame; at the floor it clamps to 3 lines.
  const factFit = fitProse({
    text: fact,
    baseFontSize: factFontSize,
    minFontSize: Math.round(factFontSize * 0.5),
    maxWidthPx: columnPx,
    maxHeightPx: availablePx * HERO_MAX_SHARE,
    lineHeight: FACT_LINE_HEIGHT,
  });
  const factBoxH = factFit.heightPx + factFit.fontSize * 0.3;

  const gap = explanation ? Math.round(factFit.fontSize * 0.8) : 0;

  // Source: one or two lines, never more.
  const sourceFit = source
    ? fitProse({
        text: source,
        baseFontSize: sourceFontSize,
        minFontSize: sourceFontSize,
        maxWidthPx: columnPx,
        maxHeightPx: 2 * sourceFontSize * SOURCE_LINE_HEIGHT,
        lineHeight: SOURCE_LINE_HEIGHT,
      })
    : null;
  const sourceBoxH = sourceFit ? sourceFit.heightPx + sourceFontSize * 0.3 : 0;
  const sourceGap = sourceFit ? Math.round(explainFontSize * 0.9) : 0;

  // Explanation: shrink to whatever height remains, keeping a little slack
  // for faces that wrap earlier than the estimate.
  const explainSlack = explainFontSize * EXPLAIN_LINE_HEIGHT * 0.4;
  const explainMaxPx = Math.max(
    explainFontSize * EXPLAIN_LINE_HEIGHT,
    availablePx * 0.95 - factBoxH - gap - sourceGap - sourceBoxH - explainSlack,
  );
  const explainFit = explanation
    ? fitProse({
        text: explanation,
        baseFontSize: explainFontSize,
        minFontSize: Math.max(18, Math.round(explainFontSize * 0.6)),
        maxWidthPx: columnPx,
        maxHeightPx: explainMaxPx,
        lineHeight: EXPLAIN_LINE_HEIGHT,
      })
    : null;
  const explainBoxH = explainFit ? explainFit.heightPx + explainSlack : 0;

  // ---- Place -------------------------------------------------------------
  const totalH = factBoxH + gap + explainBoxH + sourceGap + sourceBoxH;
  const groupTop = Math.min(
    Math.max(safeTopPx, OPTICAL_CENTER * frameH - totalH / 2),
    Math.max(safeTopPx, safeBottomPx - totalH),
  );
  const factTop = groupTop;
  const explainTop = factTop + factBoxH + gap;
  const sourceTop = explainTop + explainBoxH + sourceGap;

  const pct = (px: number) => `${Number(((px / frameH) * 100).toFixed(3))}%`;
  const box = (top: number, height: number) => ({
    x: accentLayout.textCenterX,
    y: pct(top + height / 2),
    width: accentLayout.textWidth,
    height: pct(height),
    anchor: 'center' as const,
  });

  // Fact (main statement)
  layers.push({
    type: 'text',
    id: 'fact',
    content: {
      text: fact,
      style: {
        fontSize: factFit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: theme.colors.text,
        textAlign: 'left',
        lineHeight: FACT_LINE_HEIGHT,
        shadow: shouldUseShadow(context),
        shrinkToFit: true,
        ...(factFit.maxLines ? { maxLines: factFit.maxLines } : {}),
      },
    },
    position: box(factTop, factBoxH),
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1.5 }),
  });

  // Explanation (skipped when the block has no body — the fact centres alone)
  if (explainFit) {
    layers.push({
      type: 'text',
      id: 'explanation',
      content: {
        text: explanation,
        style: {
          fontSize: explainFit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'left',
          lineHeight: EXPLAIN_LINE_HEIGHT,
          shadow: shouldUseShadow(context),
          shrinkToFit: true,
          ...(explainFit.maxLines ? { maxLines: explainFit.maxLines } : {}),
        },
      },
      position: box(explainTop, explainBoxH),
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1, delay: 0.8 }),
    });
  }

  // Add source if provided
  if (sourceFit) {
    layers.push({
      type: 'text',
      id: 'source',
      content: {
        text: source,
        style: {
          fontSize: sourceFit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'left',
          lineHeight: SOURCE_LINE_HEIGHT,
          shadow: shouldUseShadow(context),
          shrinkToFit: true,
          ...(sourceFit.maxLines ? { maxLines: sourceFit.maxLines } : {}),
        },
      },
      position: box(sourceTop, sourceBoxH),
      animation: { type: 'fadeIn', duration: 0.8, delay: 1.5 },
    });
  }

  return layers;
}

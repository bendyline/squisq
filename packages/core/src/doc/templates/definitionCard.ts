/**
 * Definition Card Template
 *
 * Dictionary-style slide with a large term and its definition.
 * Good for explaining local words, place names, or cultural concepts.
 * Supports optional accent images.
 *
 * The lockup sits in a centred column but reads left-aligned, like a
 * dictionary entry: term, rule, definition and origin share one left
 * edge. Every text layer carries the column width so the renderer pins
 * the text to that edge rather than fanning it out around the anchor.
 *
 * The entry is a measured stack: the term is fitted first (a long heading
 * promoted into the term slot steps down rather than wrapping through the
 * definition), the rule hangs from the term's estimated bottom, the
 * definition shrinks to the height that remains — clamping with an
 * ellipsis only at the readable floor — and the origin sits below the
 * definition's measured bottom. The group is centred on the frame's
 * optical centre so a one-line definition still reads as one composed
 * entry.
 *
 * Each text layer is a centre-anchored box (the column-centre `x`
 * convention shared by the other prose lockups) with an explicit height
 * and `verticalAlign: 'top'`, so the renderer resolves the text top to
 * the box top and the wrapped block grows downward from a known edge.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer, Position } from '../../schemas/Doc.js';
import type { DefinitionCardInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  resolveColorScheme,
  getThemeFont,
  shouldUseShadow,
  themedEntrance,
  themedFontSize,
  themedSurfaceGradient,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import {
  createAccentLayers,
  getAccentLayout,
  ACCENT_STRIP_SIZE,
  DEFAULT_LAYOUT,
} from './accentImage.js';
import { createBackgroundLayer, estimateProseLineCount, fitProse } from './captionUtils.js';

/** Line-height multipliers the layers render with (and the stack measures with). */
const TERM_LINE_HEIGHT = 1.15;
const DEF_LINE_HEIGHT = 1.6;
const ORIGIN_LINE_HEIGHT = 1.4;
const RULE_HEIGHT_PX = 2;

/** Vertical safe band, as a fraction of the viewport height. */
const BAND_TOP = 0.08;
const BAND_BOTTOM = 0.92;
/** Where the group's centre sits inside the band (slightly above middle). */
const OPTICAL_CENTRE = 0.46;
/** Extra height held back from the definition so wide faces that wrap early still fit. */
const BODY_SLACK = 0.05;
/** Share of the band the term may take before it steps down. */
const HERO_MAX_SHARE = 0.28;
/**
 * Glyph slack added to each text box beyond the line-count estimate, so the
 * renderer's shrinkToFit only fires when the real face runs wider than the
 * wrap estimate — not because a tall ascender grazes the box bottom.
 */
const BOX_SLACK_EM = 0.35;

export function definitionCard(input: DefinitionCardInput, context: TemplateContext): Layer[] {
  const { term, definition, origin, colorScheme = 'blue', accentImage } = input;
  const { theme, viewport } = context;
  const colors = resolveColorScheme(context, colorScheme);

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;
  // Left edge of the text column — the separator rule hangs from it so it
  // lines up with the left-aligned text above and below.
  const columnWidthPct = parseFloat(accentLayout.textWidth);
  const columnLeft = `${parseFloat(accentLayout.textCenterX) - columnWidthPct / 2}%`;
  const columnWidthPx = (columnWidthPct / 100) * viewport.width;

  // A bottom strip owns the lower part of the frame; the band shrinks to
  // the area above it instead of nudging fixed slots up by a few percent.
  const bandTopPx = BAND_TOP * viewport.height;
  const bandBottomPx = accentLayout.adjustY
    ? ((100 - ACCENT_STRIP_SIZE - 3) / 100) * viewport.height
    : BAND_BOTTOM * viewport.height;
  const bandHeightPx = bandBottomPx - bandTopPx;

  const termBaseSize = themedFontSize(72, context, true);
  const defBaseSize = themedFontSize(32, context, false);
  const originFontSize = themedFontSize(22, context, false);

  // Term: fit first so a long heading steps down instead of running through
  // the definition; at the floor it clamps with an ellipsis.
  const termFit = fitProse({
    text: term,
    baseFontSize: termBaseSize,
    minFontSize: Math.round(termBaseSize * 0.45),
    maxWidthPx: columnWidthPx,
    maxHeightPx: HERO_MAX_SHARE * bandHeightPx,
    lineHeight: TERM_LINE_HEIGHT,
  });
  const termH = termFit.heightPx;

  const hasDefinition = definition.trim().length > 0;
  const originText = origin && origin.trim() ? origin : undefined;

  const originH = originText
    ? estimateProseLineCount(originText, originFontSize, columnWidthPx) *
      originFontSize *
      ORIGIN_LINE_HEIGHT
    : 0;
  // Term → rule → definition spacing, proportional to the term size.
  const ruleGap = Math.round(termBaseSize * 0.4);
  const defGap = hasDefinition ? Math.round(termBaseSize * 0.4) : 0;
  const originGap = originText ? Math.round(defBaseSize * 1.0) : 0;

  // Definition: shrink to the height that remains, then clamp at the floor.
  const bodyMaxH = Math.max(
    defBaseSize * DEF_LINE_HEIGHT,
    bandHeightPx -
      termH -
      ruleGap -
      RULE_HEIGHT_PX -
      defGap -
      originGap -
      originH -
      BODY_SLACK * viewport.height,
  );
  const defFit = hasDefinition
    ? fitProse({
        text: definition,
        baseFontSize: defBaseSize,
        minFontSize: Math.max(18, Math.round(defBaseSize * 0.6)),
        maxWidthPx: columnWidthPx,
        maxHeightPx: bodyMaxH,
        lineHeight: DEF_LINE_HEIGHT,
      })
    : null;
  const defH = defFit ? defFit.heightPx : 0;

  // Centre the measured group on the band's optical centre; never above the band.
  const totalH = termH + ruleGap + RULE_HEIGHT_PX + defGap + defH + originGap + originH;
  const groupTopPx = Math.max(bandTopPx, bandTopPx + OPTICAL_CENTRE * bandHeightPx - totalH / 2);
  const termTop = groupTopPx;
  const ruleTop = termTop + termH + ruleGap;
  const defTop = ruleTop + RULE_HEIGHT_PX + defGap;
  const originTop = defTop + defH + originGap;

  const pct = (px: number) => `${((px / viewport.height) * 100).toFixed(3)}%`;
  // Centre-anchored box whose top edge is `topPx` (paired with verticalAlign 'top').
  const box = (topPx: number, heightPx: number): Position => {
    const height = Math.round(heightPx);
    return {
      x: accentLayout.textCenterX,
      y: pct(topPx + height / 2),
      width: accentLayout.textWidth,
      height,
      anchor: 'center',
    };
  };

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 145))];

  // Add accent image layers
  if (accentImage) {
    layers.push(
      ...createAccentLayers(
        accentImage,
        input.id,
        themedImageTreatment(context, input.imageTreatment),
      ),
    );
  }

  // Term — large, accent-colored
  layers.push({
    type: 'text',
    id: 'term',
    content: {
      text: term,
      style: {
        fontSize: termFit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: colors.text,
        textAlign: 'left',
        verticalAlign: 'top',
        lineHeight: TERM_LINE_HEIGHT,
        shrinkToFit: true,
        ...(termFit.maxLines ? { maxLines: termFit.maxLines } : {}),
        shadow: shouldUseShadow(context),
      },
    },
    position: box(termTop, termH + termFit.fontSize * BOX_SLACK_EM),
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1.5 }),
  });

  // Horizontal separator line — hangs from the term's measured bottom
  layers.push({
    type: 'shape',
    id: 'separator',
    content: {
      shape: 'rect',
      fill: `${colors.text}33`, // accent color at 20% opacity
    },
    position: {
      x: columnLeft,
      y: pct(ruleTop),
      width: '30%',
      height: `${RULE_HEIGHT_PX}px`,
      anchor: 'top-left',
    },
  });

  // Definition text — skipped when the body is empty so the term is not
  // echoed by a blank slot.
  if (defFit) {
    layers.push({
      type: 'text',
      id: 'definition',
      content: {
        text: definition,
        style: {
          fontSize: defFit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.text,
          textAlign: 'left',
          verticalAlign: 'top',
          lineHeight: DEF_LINE_HEIGHT,
          shrinkToFit: true,
          ...(defFit.maxLines ? { maxLines: defFit.maxLines } : {}),
          shadow: shouldUseShadow(context),
        },
      },
      position: box(defTop, defH + defFit.fontSize * BOX_SLACK_EM),
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1, delay: 0.8 }),
    });
  }

  // Origin if provided — always below the measured definition
  if (originText) {
    layers.push({
      type: 'text',
      id: 'origin',
      content: {
        text: originText,
        style: {
          fontSize: originFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'left',
          verticalAlign: 'top',
          lineHeight: ORIGIN_LINE_HEIGHT,
          shrinkToFit: true,
          shadow: shouldUseShadow(context),
        },
      },
      position: box(originTop, originH + originFontSize * BOX_SLACK_EM),
      animation: { type: 'fadeIn', duration: 0.8, delay: 1.5 },
    });
  }

  return layers;
}

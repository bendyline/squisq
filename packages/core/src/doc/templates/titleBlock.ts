/**
 * Title Block Template
 *
 * Large title with optional subtitle for doc intros.
 * Centered text with fade-in animations, composed as one lockup:
 * accent rule, title, and subtitle are measured and stacked (each slot
 * below the previous one's measured bottom) instead of fixed slots that
 * collide on wrap. The whole stack is centred around the composition's
 * historic centre so a one-line title lands where it always did, while a
 * long title steps its size down (and, at the readable floor, clamps its
 * line count) so it never leaves the frame or runs into the subtitle.
 * Adapts font sizes and positioning for different viewports.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { TitleBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getTemplateHint,
  getThemeFont,
  shouldUseShadow,
  themedEntrance,
  themedFontSize,
} from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { fitProse } from './captionUtils.js';

/**
 * Hint schema published for the theme validator + future customizer hint UI.
 * Themes may set `templateHints.title` entries matching these keys.
 */
export const titleBlockHintSchema = {
  /** Whether to render a thin accent line above the title. Default: theme-dependent. */
  showAccentLine: { type: 'boolean' as const, default: true },
} as const;

/** Line height the title renders at (set explicitly so the estimate matches). */
const TITLE_LINE_HEIGHT = 1.15;
/** Line height the subtitle renders at. */
const SUBTITLE_LINE_HEIGHT = 1.5;
/** Gap between the accent rule and the title's top edge, in px. */
const ACCENT_GAP_PX = 56;
/** Base gap between the title's bottom edge and the subtitle's top edge, in px. */
const TITLE_SUBTITLE_GAP_PX = 56;
/** Share of the frame the title may occupy before it steps its size down. */
const TITLE_BUDGET_WITH_SUBTITLE = 0.4;
const TITLE_BUDGET_ALONE = 0.5;
/** Share of the frame the subtitle may occupy before it steps its size down. */
const SUBTITLE_BUDGET = 0.2;
/** Keep the lockup clear of the frame edges (percent of the viewport height). */
const FRAME_MARGIN_PCT = 7;

export function titleBlock(input: TitleBlockInput, context: TemplateContext): Layer[] {
  const { title, subtitle, backgroundColor } = input;
  const { theme, layout, viewport } = context;

  // Scale font sizes for viewport
  const titleFontSize = themedFontSize(96, context, true);
  const subtitleFontSize = themedFontSize(36, context, false);

  const baseBg = backgroundColor || theme.colors.primary;

  const px = (v: number) => (v / viewport.height) * 100;
  const maxWidthPx = (parseFloat(layout.maxTextWidth) / 100) * viewport.width;

  // Measure the title (stepping its size down when a long heading would
  // otherwise swallow the frame) so the rule and subtitle key off its real
  // extent — fixed slots let the rule overlap the ascenders and stranded the
  // subtitle inside a wrapped title.
  const titleFit = fitProse({
    text: title,
    baseFontSize: titleFontSize,
    minFontSize: Math.round(titleFontSize * 0.55),
    maxWidthPx,
    maxHeightPx: viewport.height * (subtitle ? TITLE_BUDGET_WITH_SUBTITLE : TITLE_BUDGET_ALONE),
    lineHeight: TITLE_LINE_HEIGHT,
    step: 4,
  });
  const titleH = titleFit.heightPx;

  const subtitleFit = subtitle
    ? fitProse({
        text: subtitle,
        baseFontSize: subtitleFontSize,
        minFontSize: Math.round(subtitleFontSize * 0.7),
        maxWidthPx,
        maxHeightPx: viewport.height * SUBTITLE_BUDGET,
        lineHeight: SUBTITLE_LINE_HEIGHT,
        step: 2,
      })
    : undefined;
  const subH = subtitleFit?.heightPx ?? 0;

  // A wrapped display face uses more of its final line box than a one-line
  // heading. Give the subtitle a little extra breathing room only after a
  // wrap, while preserving the established composition for short titles.
  const titleSubtitleGapPx =
    TITLE_SUBTITLE_GAP_PX + (titleFit.lines > 1 ? titleFit.fontSize * 0.25 : 0);
  const stackH = titleH + (subtitle ? titleSubtitleGapPx + subH : 0);

  // Centre the measured stack around the composition's historic centre: a
  // one-line title used to sit at 42% (48% without a subtitle) with a
  // one-line subtitle hanging 56px below it. Longer content grows
  // symmetrically around that centre instead of hanging below the anchor.
  const oneLineSubH = subtitleFontSize * SUBTITLE_LINE_HEIGHT;
  const historicCentrePct = subtitle ? 42 + px((TITLE_SUBTITLE_GAP_PX + oneLineSubH) / 2) : 48;
  let stackTopPct = historicCentrePct - px(stackH / 2);
  // Never let the lockup leave the frame; bias toward the top margin when
  // the stack is too tall for the centre it wants.
  const maxTopPct = 100 - FRAME_MARGIN_PCT - px(stackH);
  stackTopPct = Math.max(FRAME_MARGIN_PCT, Math.min(stackTopPct, maxTopPct));

  const titleTopPct = stackTopPct;
  const titleCentrePct = titleTopPct + px(titleH / 2);
  const subtitleTopPct = titleTopPct + px(titleH + titleSubtitleGapPx);
  const subtitleCentrePct = subtitleTopPct + px(subH / 2);

  const layers: Layer[] = [
    // Background — theme surface with a soft radial accent tint. The tint
    // is translucent so the theme's text color keeps its contrast with the
    // surface; a full-strength `primary` hotspot behind the title made
    // dark-primary light themes unreadable.
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: theme.colors.background,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
    {
      type: 'shape',
      id: 'bg-tint',
      content: {
        shape: 'rect',
        fill: `radial-gradient(ellipse at 50% 40%, ${withAlpha(baseBg, 0.32)} 0%, ${withAlpha(baseBg, 0)} 75%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  // Subtle decorative line, clear above the title's ascenders. Themes can
  // hide it via `templateHints.title.showAccentLine: false` (the line is
  // decorative; title/subtitle positions don't depend on it).
  if (getTemplateHint(context, 'title', 'showAccentLine', true)) {
    layers.push({
      type: 'shape',
      id: 'accent-line',
      content: {
        shape: 'rect',
        fill: withAlpha(theme.colors.text, 0.3),
      },
      position: {
        x: '44%',
        y: `${Math.max(2, titleTopPct - px(ACCENT_GAP_PX))}%`,
        width: '12%',
        height: '3px',
      },
    });
  }

  layers.push(
    // Title — an explicit box plus shrinkToFit so the renderer centres the
    // wrapped block on the anchor (instead of hanging extra lines below it)
    // and scales a wide display face down to the box when the glyphs run
    // wider than the width estimate.
    {
      type: 'text',
      id: 'title',
      content: {
        text: title,
        style: {
          fontSize: titleFit.fontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          lineHeight: TITLE_LINE_HEIGHT,
          shadow: shouldUseShadow(context),
          shrinkToFit: true,
          ...(titleFit.maxLines ? { maxLines: titleFit.maxLines } : {}),
        },
      },
      position: {
        x: '50%',
        y: `${titleCentrePct}%`,
        anchor: 'center',
        width: layout.maxTextWidth,
        height: `${px(titleH)}%`,
      },
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 2 }),
    },
  );

  // Add subtitle if provided — hangs from the title's measured bottom edge
  if (subtitle && subtitleFit) {
    layers.push({
      type: 'text',
      id: 'subtitle',
      content: {
        text: subtitle,
        style: {
          fontSize: subtitleFit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'center',
          lineHeight: SUBTITLE_LINE_HEIGHT,
          shrinkToFit: true,
          ...(subtitleFit.maxLines ? { maxLines: subtitleFit.maxLines } : {}),
        },
      },
      position: {
        x: '50%',
        y: `${subtitleCentrePct}%`,
        anchor: 'center',
        width: layout.maxTextWidth,
        height: `${px(subH)}%`,
      },
      animation: { type: 'fadeIn', duration: 1.5, delay: 1 },
    });
  }

  return layers;
}

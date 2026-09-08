/**
 * Section Header Template
 *
 * Section title card with optional background image.
 * Used to introduce new sections of a story.
 * When an image is provided, displays like a title slide with the image as background.
 * Without an image, falls back to a colored background.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { SectionHeaderInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  resolveColorScheme,
  getThemeFont,
  shouldUseShadow,
  themedEntrance,
  themedFontSize,
  themedScrim,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { mapAmbientMotion } from './accentImage.js';
import { fitProse } from './captionUtils.js';

/** Line height the title renders at (the text layer's default, set explicitly). */
const TITLE_LINE_HEIGHT = 1.4;
/** Gap between the title's measured edge and each decorative rule, in px. */
const RULE_GAP_PX = 40;
/** Share of the frame the title may occupy before it steps its size down. */
const TITLE_BUDGET = 0.5;

export function sectionHeader(input: SectionHeaderInput, context: TemplateContext): Layer[] {
  const { title = '', colorScheme = 'blue', imageSrc, imageAlt, ambientMotion } = input;
  const { theme, layout, viewport } = context;

  const treatment = themedImageTreatment(context, input.imageTreatment);
  const colors = resolveColorScheme(context, colorScheme);

  // Scale font sizes for viewport. Section dividers are the loudest
  // interstitial in a doc, so the title sits a step above ordinary
  // content-block headings.
  const titleFontSize = themedFontSize(84, context, true);

  // The rule pair brackets the title, so it has to key off the title's
  // wrapped extent: fixed 40%/60% slots ran straight through the second line
  // of a long section name. A long heading steps its size down (and, at the
  // readable floor, clamps its line count) so the block never exceeds half
  // the frame; the explicit box + shrinkToFit then lets the renderer centre
  // the wrapped block on 50% instead of hanging extra lines below it.
  // Short titles keep the established 40/60 composition.
  const maxWidthPx = (parseFloat(layout.maxTextWidth) / 100) * viewport.width;
  const titleFit = fitProse({
    text: title,
    baseFontSize: titleFontSize,
    minFontSize: Math.round(titleFontSize * 0.55),
    maxWidthPx,
    maxHeightPx: viewport.height * TITLE_BUDGET,
    lineHeight: TITLE_LINE_HEIGHT,
    step: 4,
  });
  const titleH = titleFit.heightPx;
  const px = (v: number) => (v / viewport.height) * 100;
  const ruleOffsetPct = Math.max(10, px(titleH / 2 + RULE_GAP_PX));

  const layers: Layer[] = [];

  // Background - either image or solid color
  if (imageSrc) {
    // Image background with Ken Burns effect
    layers.push({
      type: 'image',
      id: 'bg-image',
      content: {
        src: imageSrc,
        alt: imageAlt || title,
        fit: 'cover',
        ...(treatment ? { treatment } : {}),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      // Route through mapAmbientMotion like every other image template: the
      // authored vocabulary (`zoomIn`/`panLeft`/…) are NOT AnimationTypes, so
      // passing them raw produced an unknown animation here while the same
      // input animated correctly on imageWithCaption/coverBlock/accentImage.
      animation: mapAmbientMotion(ambientMotion, 8) ?? {
        type: 'slowZoom',
        duration: 8,
        direction: 'in',
      },
    });

    // Theme-tinted overlay for text readability — light themes get a
    // light scrim with dark theme text, dark themes the familiar dark one.
    layers.push({
      type: 'shape',
      id: 'overlay',
      content: {
        shape: 'rect',
        fill: themedScrim(context),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    });
  } else {
    // Solid color background
    layers.push({
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: colors.bg,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    });

    // Decorative lines above and below title
    layers.push({
      type: 'shape',
      id: 'line-top',
      content: { shape: 'rect', fill: withAlpha(colors.text, 0.2) },
      position: {
        x: '50%',
        y: `${50 - ruleOffsetPct}%`,
        width: '20%',
        height: '2px',
        anchor: 'center',
      },
    });
    layers.push({
      type: 'shape',
      id: 'line-bottom',
      content: { shape: 'rect', fill: withAlpha(colors.text, 0.2) },
      position: {
        x: '50%',
        y: `${50 + ruleOffsetPct}%`,
        width: '20%',
        height: '2px',
        anchor: 'center',
      },
    });
  }

  // Section title — theme text over the theme-tinted scrim (readable by
  // construction), scheme text on the solid-color fallback
  layers.push({
    type: 'text',
    id: 'title',
    content: {
      text: title,
      style: {
        fontSize: titleFit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: imageSrc ? theme.colors.text : colors.text,
        textAlign: 'center',
        lineHeight: TITLE_LINE_HEIGHT,
        shadow: shouldUseShadow(context),
        shrinkToFit: true,
        ...(titleFit.maxLines ? { maxLines: titleFit.maxLines } : {}),
      },
    },
    position: {
      x: '50%',
      y: '50%',
      anchor: 'center',
      width: layout.maxTextWidth,
      height: `${px(titleH)}%`,
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1.5 }),
  });

  return layers;
}

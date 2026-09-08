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
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';
import { createBackgroundLayer } from './captionUtils.js';

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

export function statHighlight(input: StatHighlightInput, context: TemplateContext): Layer[] {
  const { stat, description, detail, colorScheme = 'blue', accentImage } = input;
  const { theme } = context;
  const colors = resolveColorScheme(context, colorScheme);

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

  // Big stat — hero element, dominates the slide
  layers.push({
    type: 'text',
    id: 'stat',
    content: {
      text: stat,
      style: {
        fontSize: statFontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: colors.text,
        textAlign: 'left',
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('36%', accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation:
      getTemplateHint<string>(context, 'statHighlight', 'entrance', 'subtle') === 'dramatic'
        ? { type: 'zoomIn', duration: 0.4 }
        : { type: 'zoomIn', duration: 0.6 },
  });

  // Description — smaller and understated beneath the stat. Sits close
  // under the stat (the ~26% fixed gap it used to get read as two
  // unrelated elements floating in the panel).
  layers.push({
    type: 'text',
    id: 'description',
    content: {
      text: description,
      style: {
        fontSize: descFontSize,
        fontFamily: getThemeFont(context, 'body'),
        color: theme.colors.textMuted,
        textAlign: 'left',
        lineHeight: 1.5,
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('54%', accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation: { type: 'fadeIn', duration: 1, delay: 0.3 },
  });

  // Add detail if provided
  if (detail) {
    layers.push({
      type: 'text',
      id: 'detail',
      content: {
        text: detail,
        style: {
          fontSize: detailFontSize,
          fontFamily: getThemeFont(context, 'body'),
          // Scheme *text* rather than *accent*: accents in the built-in
          // schemes are tuned as chart/fill colors and drop below legible
          // contrast as body copy on light surfaces.
          color: colors.text,
          textAlign: 'left',
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY('66%', accentLayout),
        width: accentLayout.textWidth,
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 1 },
    });
  }

  return layers;
}

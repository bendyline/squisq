/**
 * Definition Card Template
 *
 * Dictionary-style slide with a large term and its definition.
 * Good for explaining local words, place names, or cultural concepts.
 * Supports optional accent images.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
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
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';
import { createBackgroundLayer } from './captionUtils.js';

export function definitionCard(input: DefinitionCardInput, context: TemplateContext): Layer[] {
  const { term, definition, origin, colorScheme = 'blue', accentImage } = input;
  const { theme } = context;
  const colors = resolveColorScheme(context, colorScheme);

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  const termFontSize = themedFontSize(72, context, true);
  const defFontSize = themedFontSize(32, context, false);
  const originFontSize = themedFontSize(22, context, false);

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
        fontSize: termFontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: colors.text,
        textAlign: 'center',
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('30%', accentLayout),
      anchor: 'center',
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1.5 }),
  });

  // Horizontal separator line
  layers.push({
    type: 'shape',
    id: 'separator',
    content: {
      shape: 'rect',
      fill: `${colors.text}33`, // accent color at 20% opacity
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('42%', accentLayout),
      width: '30%',
      height: '2px',
      anchor: 'center',
    },
  });

  // Definition text
  layers.push({
    type: 'text',
    id: 'definition',
    content: {
      text: definition,
      style: {
        fontSize: defFontSize,
        fontFamily: getThemeFont(context, 'body'),
        color: theme.colors.text,
        textAlign: 'center',
        lineHeight: 1.6,
        maxLines: 4,
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('55%', accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1, delay: 0.8 }),
  });

  // Origin if provided
  if (origin) {
    layers.push({
      type: 'text',
      id: 'origin',
      content: {
        text: origin,
        style: {
          fontSize: originFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign: 'center',
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY('70%', accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 0.8, delay: 1.5 },
    });
  }

  return layers;
}

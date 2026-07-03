/**
 * Date Event Template
 *
 * Timeline-style slide with prominent date and description.
 * Supports different moods: neutral, somber, celebratory.
 * Adapts font sizes and positioning for different viewports.
 *
 * Supports optional accent images that appear as tasteful side/bottom strips.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { DateEventInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { oklchDarken, relativeLuminance } from '../../schemas/colorUtils.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';

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

export function dateEvent(input: DateEventInput, context: TemplateContext): Layer[] {
  const { date, description, footer, mood = 'neutral', accentImage } = input;
  const { theme } = context;
  // Deepen the mood accent on light surfaces so the hero date keeps contrast.
  const moodAccent = MOOD_ACCENTS[mood];
  const dateColor =
    relativeLuminance(theme.colors.background) > 0.5 ? oklchDarken(moodAccent, 0.25) : moodAccent;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Scale font sizes — date is the hero element
  const dateFontSize = themedFontSize(96, context, true);
  const descFontSize = themedFontSize(30, context, false);
  const footerFontSize = themedFontSize(26, context, false);

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
        fontSize: dateFontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: dateColor,
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('35%', accentLayout),
      anchor: 'center',
    },
    animation: { type: 'fadeIn', duration: 1.5 },
  });

  // Description - constrained width for proper text wrapping
  layers.push({
    type: 'text',
    id: 'description',
    content: {
      text: description,
      style: {
        fontSize: descFontSize,
        fontFamily: getThemeFont(context, 'body'),
        color: theme.colors.text,
        textAlign: 'center',
        lineHeight: 1.6,
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: accentLayout.textCenterX,
      y: adjustY('58%', accentLayout),
      width: accentLayout.textWidth,
      anchor: 'center',
    },
    animation: { type: 'fadeIn', duration: 2, delay: 1 },
  });

  // Add footer if provided
  if (footer) {
    layers.push({
      type: 'text',
      id: 'footer',
      content: {
        text: footer,
        style: {
          fontSize: footerFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY('72%', accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 3 },
    });
  }

  return layers;
}

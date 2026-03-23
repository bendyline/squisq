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
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { getThemeFont } from '../utils/themeUtils.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';

const MOOD_COLORS = {
  neutral: { bg: '#1a202c', date: '#63b3ed', text: '#ffffff' },
  somber: { bg: '#1a1a2e', date: '#e53e3e', text: '#a0aec0' },
  celebratory: { bg: '#1a365d', date: '#68d391', text: '#ffffff' },
};

export function dateEvent(input: DateEventInput, context: TemplateContext): Layer[] {
  const { date, description, footer, mood = 'neutral', accentImage } = input;
  const { theme } = context;
  const colors = MOOD_COLORS[mood];

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  // Scale font sizes — date is the hero element
  const dateFontSize = scaledFontSize(96, context, true);
  const descFontSize = scaledFontSize(30, context, false);
  const footerFontSize = scaledFontSize(26, context, false);

  const layers: Layer[] = [
    // Background — unique diagonal gradient to differentiate from other dark templates
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: `linear-gradient(135deg, ${colors.bg} 0%, #0d1117 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  // Add accent image layers (behind text, after background)
  if (accentImage) {
    layers.push(...createAccentLayers(accentImage, input.id));
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
        color: colors.date,
        shadow: !!accentImage,
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
        color: colors.text,
        textAlign: 'center',
        lineHeight: 1.8,
        shadow: !!accentImage,
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
          shadow: !!accentImage,
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY('82%', accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 3 },
    });
  }

  return layers;
}

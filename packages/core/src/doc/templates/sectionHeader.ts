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

import type { Layer, AnimationType } from '../../schemas/Doc.js';
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

export function sectionHeader(input: SectionHeaderInput, context: TemplateContext): Layer[] {
  const { title = '', colorScheme = 'blue', imageSrc, imageAlt, ambientMotion } = input;
  const { theme, layout } = context;

  const treatment = themedImageTreatment(context, input.imageTreatment);
  const colors = resolveColorScheme(context, colorScheme);

  // Scale font sizes for viewport. Section dividers are the loudest
  // interstitial in a doc, so the title sits a step above ordinary
  // content-block headings.
  const titleFontSize = themedFontSize(84, context, true);

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
      animation: ambientMotion
        ? { type: ambientMotion as AnimationType, duration: 8 }
        : { type: 'slowZoom', duration: 8, direction: 'in' },
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
      content: { shape: 'rect', fill: `${colors.text}33` },
      position: { x: '50%', y: '40%', width: '20%', height: '2px', anchor: 'center' },
    });
    layers.push({
      type: 'shape',
      id: 'line-bottom',
      content: { shape: 'rect', fill: `${colors.text}33` },
      position: { x: '50%', y: '60%', width: '20%', height: '2px', anchor: 'center' },
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
        fontSize: titleFontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: imageSrc ? theme.colors.text : colors.text,
        textAlign: 'center',
        shadow: shouldUseShadow(context),
      },
    },
    position: {
      x: '50%',
      y: '50%',
      anchor: 'center',
      width: layout.maxTextWidth,
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1.5 }),
  });

  return layers;
}

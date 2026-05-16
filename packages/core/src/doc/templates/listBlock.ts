/**
 * List Block Template
 *
 * Displays 3-5 items in a numbered vertical list with staggered animations.
 * Good for enumerations like "things to see", "key features", or "tips".
 * Supports optional accent images.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { ListBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { getThemeFont } from '../utils/themeUtils.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';

export function listBlock(input: ListBlockInput, context: TemplateContext): Layer[] {
  const { title, accentImage } = input;
  // `items` is required by the schema, but malformed / partially-authored
  // blocks (e.g. someone wrote `template: list` with no items yet) reach
  // this code path during live preview. Treat missing/non-array as empty
  // so we render the title-and-background frame instead of blowing up
  // every keystroke with a TypeError.
  const items: string[] = Array.isArray(input.items) ? input.items : [];
  const { theme } = context;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  const titleFontSize = scaledFontSize(44, context, true);
  const itemFontSize = scaledFontSize(34, context, false);

  const layers: Layer[] = [
    // Background — gradient
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: `linear-gradient(155deg, ${theme.colors.backgroundLight} 0%, ${theme.colors.background} 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  // Add accent image layers
  if (accentImage) {
    layers.push(...createAccentLayers(accentImage, input.id));
  }

  // Title if provided
  const startY = title ? 30 : 22;
  if (title) {
    layers.push({
      type: 'text',
      id: 'list-title',
      content: {
        text: title,
        style: {
          fontSize: titleFontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          shadow: !!accentImage,
        },
      },
      position: {
        x: accentLayout.textCenterX,
        y: adjustY('16%', accentLayout),
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 1 },
    });
  }

  // Left edge of the text column — derived from the center+width pair so
  // items sit flush with the column's left margin instead of being
  // centered. Falls back to a safe 8% if the layout strings ever turn
  // out unparseable (they're authored, but defensive against future
  // edits to the accent-layout types).
  const centerX = parseFloat(accentLayout.textCenterX);
  const widthPct = parseFloat(accentLayout.textWidth);
  const leftX =
    Number.isFinite(centerX) && Number.isFinite(widthPct) ? `${centerX - widthPct / 2}%` : '8%';

  // Calculate vertical spacing for items. We keep the available band
  // (startY → endY) but use a tighter line-height (1.2) so wrapped
  // items don't bleed into the next entry as aggressively as the old
  // 1.4 value did.
  const endY = 80;
  const spacing = items.length > 1 ? (endY - startY) / (items.length - 1) : 0;

  // List items with staggered animation
  for (let i = 0; i < items.length; i++) {
    const y = startY + spacing * i;
    const itemText = `${i + 1}.  ${items[i]}`;

    layers.push({
      type: 'text',
      id: `item-${i}`,
      content: {
        text: itemText,
        style: {
          fontSize: itemFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.text,
          textAlign: 'left',
          lineHeight: 1.2,
          shadow: !!accentImage,
        },
      },
      position: {
        x: leftX,
        y: adjustY(`${y}%`, accentLayout),
        width: accentLayout.textWidth,
      },
      animation: { type: 'fadeIn', duration: 0.8, delay: 0.3 + 0.3 * i },
    });
  }

  return layers;
}

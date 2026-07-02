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
import { getThemeFont, shouldUseShadow, themedEntrance, themedFontSize, themedImageTreatment } from '../utils/themeUtils.js';
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

  const titleFontSize = themedFontSize(44, context, true);
  const itemFontSize = themedFontSize(34, context, false);

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
    layers.push(...createAccentLayers(accentImage, input.id, themedImageTreatment(context, input.imageTreatment)));
  }

  // Left edge of the text column — derived from the center+width pair so
  // the title and items share one left axis instead of a centered title
  // floating over a left-aligned column. Falls back to a safe 8% if the
  // layout strings ever turn out unparseable (they're authored, but
  // defensive against future edits to the accent-layout types).
  const centerX = parseFloat(accentLayout.textCenterX);
  const widthPct = parseFloat(accentLayout.textWidth);
  const leftX =
    Number.isFinite(centerX) && Number.isFinite(widthPct) ? `${centerX - widthPct / 2}%` : '8%';

  // Title if provided
  const startY = title ? 34 : 26;
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
          textAlign: 'left',
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: leftX,
        y: adjustY('20%', accentLayout),
        width: accentLayout.textWidth,
      },
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1 }),
    });
  }

  // Stack items with a fixed compact gap rather than stretching them
  // across the available band. Distributing items across (startY → 80%)
  // left big vertical gaps for short lists and made the slide read as a
  // sparse menu instead of a tight enumeration; conversely a bare
  // line-height gap read as a cramped paragraph — 18px of air keeps each
  // entry its own line without breaking the group.
  //
  // Spacing = item line-height (34px base × 1.2) + 18px gap, expressed
  // as % of the 1080px design canvas (~5.4%). Wrapped items push the
  // next entry down via their own line-height, so this sets the
  // minimum baseline-to-baseline distance for unwrapped items.
  const LIST_ITEM_BASE_PX = 34;
  const LIST_ITEM_LINE_HEIGHT = 1.2;
  const LIST_ITEM_GAP_PX = 18;
  const DESIGN_HEIGHT_PX = 1080;
  const spacing =
    ((LIST_ITEM_BASE_PX * LIST_ITEM_LINE_HEIGHT + LIST_ITEM_GAP_PX) / DESIGN_HEIGHT_PX) * 100;

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
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: leftX,
        y: adjustY(`${y}%`, accentLayout),
        width: accentLayout.textWidth,
      },
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 0.8, delay: 0.3 + 0.3 * i }),
    });
  }

  return layers;
}

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
import {
  getThemeFont,
  shouldUseShadow,
  themedEntrance,
  themedFontSize,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { createAccentLayers, getAccentLayout, adjustY, DEFAULT_LAYOUT } from './accentImage.js';

const LIST_ITEM_LINE_HEIGHT = 1.2;
const LIST_ITEM_GAP_PX = 18;

/**
 * Mirror the renderer's character-based wrapping closely enough to reserve
 * vertical space for each independently positioned text layer.
 */
function estimateWrappedLineCount(text: string, fontSize: number, maxWidth: number): number {
  if (!text.trim()) return 1;

  const charsPerLine = Math.floor(maxWidth / (fontSize * 0.5));
  if (charsPerLine <= 0) return 1;

  let lineCount = 0;
  let currentLineLength = 0;

  for (const word of text.split(/\s+/)) {
    const testLineLength = currentLineLength ? currentLineLength + 1 + word.length : word.length;

    if (testLineLength <= charsPerLine) {
      currentLineLength = testLineLength;
      continue;
    }

    if (currentLineLength) lineCount += 1;

    let remainingLength = word.length;
    while (remainingLength > charsPerLine) {
      lineCount += 1;
      remainingLength -= charsPerLine;
    }
    currentLineLength = remainingLength;
  }

  return Math.max(1, lineCount + (currentLineLength ? 1 : 0));
}

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
    layers.push(
      ...createAccentLayers(
        accentImage,
        input.id,
        themedImageTreatment(context, input.imageTreatment),
      ),
    );
  }

  // Left edge of the text column — derived from the center+width pair so
  // the title and items share one left axis instead of a centered title
  // floating over a left-aligned column. Falls back to a safe 8% if the
  // layout strings ever turn out unparseable (they're authored, but
  // defensive against future edits to the accent-layout types).
  const centerX = parseFloat(accentLayout.textCenterX);
  const widthPct = parseFloat(accentLayout.textWidth);
  const leftPct =
    Number.isFinite(centerX) && Number.isFinite(widthPct) ? centerX - widthPct / 2 : 8;
  const leftX = `${leftPct}%`;

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

  // Render the number and body in separate columns. The body is therefore a
  // single text layer whose wrapped lines all share the same x coordinate,
  // producing a hanging indent instead of wrapping underneath the number.
  const textWidthPx = (Number.isFinite(widthPct) ? widthPct / 100 : 0.85) * context.viewport.width;
  const markerText = `${items.length}.`;
  const markerWidthPx = Math.max(itemFontSize, markerText.length * itemFontSize * 0.5);
  const markerGapPx = itemFontSize * 0.35;
  const bodyIndentPx = markerWidthPx + markerGapPx;
  const bodyLeftX = `${leftPct + (bodyIndentPx / context.viewport.width) * 100}%`;
  const bodyWidthPx = Math.max(itemFontSize, textWidthPx - bodyIndentPx);
  let itemY = startY;

  // List items with staggered animation
  for (let i = 0; i < items.length; i++) {
    const itemText = items[i]!;
    const lineCount = estimateWrappedLineCount(itemText, itemFontSize, bodyWidthPx);
    const animation = themedEntrance(context, 'text', {
      type: 'fadeIn',
      duration: 0.8,
      delay: 0.3 + 0.3 * i,
    });

    layers.push({
      type: 'text',
      id: `item-${i}-marker`,
      content: {
        text: `${i + 1}.`,
        style: {
          fontSize: itemFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.text,
          textAlign: 'right',
          lineHeight: LIST_ITEM_LINE_HEIGHT,
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: leftX,
        y: adjustY(`${itemY}%`, accentLayout),
        width: markerWidthPx,
      },
      animation,
    });

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
          lineHeight: LIST_ITEM_LINE_HEIGHT,
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: bodyLeftX,
        y: adjustY(`${itemY}%`, accentLayout),
        width: bodyWidthPx,
      },
      animation,
    });

    const itemHeightPx = lineCount * itemFontSize * LIST_ITEM_LINE_HEIGHT;
    itemY += ((itemHeightPx + LIST_ITEM_GAP_PX) / context.viewport.height) * 100;
  }

  return layers;
}

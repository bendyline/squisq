/**
 * List Block Template
 *
 * Displays 3-5 items in a numbered vertical list with staggered animations.
 * Good for enumerations like "things to see", "key features", or "tips".
 * Supports optional accent images.
 *
 * Longer lists shrink to fit: the item type steps down from its base size
 * until the whole list sits above the bottom margin, stopping at a minimum
 * readable size. Past that floor the tail of the list simply runs off the
 * slide — an unreadable list is worse than a truncated one.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { ListBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { extractRichListItems } from '../templateInputs.js';
import {
  getThemeFont,
  shouldUseShadow,
  themedEntrance,
  themedFontSize,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import {
  ACCENT_STRIP_SIZE,
  createAccentLayers,
  getAccentLayout,
  adjustY,
  DEFAULT_LAYOUT,
} from './accentImage.js';
import { estimateWrappedLineCount } from './captionUtils.js';

const LIST_ITEM_LINE_HEIGHT = 1.2;
const LIST_ITEM_BASE_FONT_PX = 34;
/** Inter-item gap at the base font size; it scales down with the type. */
const LIST_ITEM_GAP_PX = 18;
/**
 * Floor for the shrink-to-fit pass. Slide geometry is authored at the 1080p
 * reference, where one PowerPoint point on a 16:9 slide (960×540 pt) is two
 * pixels — so 16px is the 8pt minimum a projected slide is still readable at.
 */
const LIST_ITEM_MIN_FONT_PX = 16;
/** Bottom margin the list must clear, mirroring the 8% left margin. */
const LIST_BOTTOM_MARGIN_PCT = 8;
/** Breathing room between the last item and a bottom accent strip. */
const LIST_STRIP_CLEARANCE_PCT = 2;
/**
 * Relaxed vertical layout: the title parked at 20% of the frame and the
 * items starting at 34% (26% when untitled). Right for the 3-5 item lists
 * the template was designed around, where the air above the title is part
 * of the composition.
 */
const LIST_RELAXED_TITLE_TOP_PCT = 20;
const LIST_RELAXED_ITEMS_TOP_PCT = 34;
const LIST_RELAXED_UNTITLED_TOP_PCT = 26;
/**
 * Condensed vertical layout for dense lists: the title hugs the top of the
 * frame and the items begin directly beneath it. Chosen only once the list
 * at its base size would overflow the relaxed layout — the top margin is the
 * first thing to give, before the shrink-to-fit pass spends any type size.
 */
const LIST_CONDENSED_TOP_PCT = 8;
const LIST_CONDENSED_TITLE_GAP_PX = 22;
const LIST_TITLE_LINE_HEIGHT = 1.15;

// The wrap estimator now lives with the other shared text-metric helpers so
// every prose template reserves space the same way; re-exported here because
// the list tests (and any external caller) import it from this module.
export { estimateWrappedLineCount } from './captionUtils.js';

interface ListItemGeometry {
  /** Right-aligned column holding the `N.` marker. */
  markerWidthPx: number;
  /** Marker column + gap: where the body column begins. */
  bodyIndentPx: number;
  /** Width available to the wrapped body text. */
  bodyWidthPx: number;
  /** Vertical gap after each item, scaled with the font. */
  gapPx: number;
}

/**
 * Column geometry for a given item font size. The marker column is sized
 * for the widest marker (the last item's number) so every body line shares
 * one left edge — a hanging indent instead of wrapping under the number.
 */
function listItemGeometry(
  fontSize: number,
  baseFontSize: number,
  itemCount: number,
  textWidthPx: number,
): ListItemGeometry {
  const markerText = `${itemCount}.`;
  const markerWidthPx = Math.max(fontSize, markerText.length * fontSize * 0.5);
  const markerGapPx = fontSize * 0.35;
  const bodyIndentPx = markerWidthPx + markerGapPx;
  return {
    markerWidthPx,
    bodyIndentPx,
    bodyWidthPx: Math.max(fontSize, textWidthPx - bodyIndentPx),
    gapPx: LIST_ITEM_GAP_PX * (fontSize / baseFontSize),
  };
}

/** Total height the list occupies at a font size, gaps included. */
function measureListHeightPx(
  items: string[],
  fontSize: number,
  geometry: ListItemGeometry,
): number {
  let heightPx = 0;
  for (const itemText of items) {
    const lineCount = estimateWrappedLineCount(itemText, fontSize, geometry.bodyWidthPx);
    heightPx += lineCount * fontSize * LIST_ITEM_LINE_HEIGHT + geometry.gapPx;
  }
  return heightPx;
}

export function listBlock(input: ListBlockInput, context: TemplateContext): Layer[] {
  const { title, accentImage } = input;
  // `items` is required by the schema, but malformed / partially-authored
  // blocks (e.g. someone wrote `template: list` with no items yet) reach
  // this code path during live preview. Treat missing/non-array as empty
  // so we render the title-and-background frame instead of blowing up
  // every keystroke with a TypeError.
  const items: string[] = Array.isArray(input.items) ? input.items : [];
  const richItems = extractRichListItems(context.block?.contents);
  const { theme } = context;

  // Get layout adjustments if accent image is present
  const accentLayout = accentImage ? getAccentLayout(accentImage.position) : DEFAULT_LAYOUT;

  const titleFontSize = themedFontSize(44, context, true);
  const baseItemFontSize = themedFontSize(LIST_ITEM_BASE_FONT_PX, context, false);
  const minItemFontSize = Math.min(
    baseItemFontSize,
    themedFontSize(LIST_ITEM_MIN_FONT_PX, context, false),
  );

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

  // Vertical plan. Item y values are computed in the un-adjusted space that
  // `adjustY` later shifts (a bottom strip moves everything up by
  // `textYAdjust`), so every limit here is expressed in that same space: the
  // bottom margin, or the top of a bottom strip, minus the shift that will be
  // applied — and likewise the condensed top edge, which must still land at
  // 8% AFTER the shift or adjustY's 5% clamp would stack the title on the
  // first item.
  const textWidthPx = (Number.isFinite(widthPct) ? widthPct / 100 : 0.85) * context.viewport.width;
  const bottomLimitPct =
    (accentImage?.position === 'bottom-strip'
      ? 100 - ACCENT_STRIP_SIZE - LIST_STRIP_CLEARANCE_PCT
      : 100 - LIST_BOTTOM_MARGIN_PCT) - accentLayout.textYAdjust;

  // Relaxed first: a short list keeps its air. Once the list at its base size
  // would overflow that layout, condense — pull the title up to the top of
  // the frame and start the items right under it — so a dense list spends
  // the frame on content before the shrink-to-fit pass below spends type.
  const baseGeometry = listItemGeometry(
    baseItemFontSize,
    baseItemFontSize,
    items.length,
    textWidthPx,
  );
  const relaxedStartY = title ? LIST_RELAXED_ITEMS_TOP_PCT : LIST_RELAXED_UNTITLED_TOP_PCT;
  const relaxedBottomPct =
    relaxedStartY +
    (measureListHeightPx(items, baseItemFontSize, baseGeometry) / context.viewport.height) * 100;
  const condensed = relaxedBottomPct > bottomLimitPct;
  const condensedTopPct = LIST_CONDENSED_TOP_PCT - accentLayout.textYAdjust;
  const titleTopPct = condensed ? condensedTopPct : LIST_RELAXED_TITLE_TOP_PCT;
  let startY = relaxedStartY;
  if (condensed) {
    const titleHeightPx = title
      ? estimateWrappedLineCount(title, titleFontSize, textWidthPx) *
          titleFontSize *
          LIST_TITLE_LINE_HEIGHT +
        LIST_CONDENSED_TITLE_GAP_PX
      : 0;
    startY = condensedTopPct + (titleHeightPx / context.viewport.height) * 100;
  }

  // Title if provided
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
        y: adjustY(`${titleTopPct}%`, accentLayout),
        width: accentLayout.textWidth,
      },
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1 }),
    });
  }

  // Shrink to fit whatever the condensed layout still cannot hold.
  const availablePx = Math.max(0, ((bottomLimitPct - startY) / 100) * context.viewport.height);

  let itemFontSize = baseItemFontSize;
  let geometry = baseGeometry;
  while (
    itemFontSize > minItemFontSize &&
    measureListHeightPx(items, itemFontSize, geometry) > availablePx
  ) {
    itemFontSize -= 1;
    geometry = listItemGeometry(itemFontSize, baseItemFontSize, items.length, textWidthPx);
  }

  // Render the number and body in separate columns. The body is therefore a
  // single text layer whose wrapped lines all share the same x coordinate,
  // producing a hanging indent instead of wrapping underneath the number.
  const { markerWidthPx, bodyIndentPx, bodyWidthPx, gapPx } = geometry;
  const bodyLeftX = `${leftPct + (bodyIndentPx / context.viewport.width) * 100}%`;
  let itemY = startY;

  // List items with staggered animation
  for (let i = 0; i < items.length; i++) {
    const itemText = items[i]!;
    const itemHtml = richItems[i]?.text === itemText ? richItems[i]?.html : undefined;
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
        ...(itemHtml ? { html: itemHtml } : {}),
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
    itemY += ((itemHeightPx + gapPx) / context.viewport.height) * 100;
  }

  return layers;
}

import { contentBlock } from './contentBlock.js';
import type { MarkdownBlockNode } from '../../markdown/types.js';
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

import { taskMarker, type Layer, type TextLayer } from '../../schemas/Doc.js';
import type { ListBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { extractRichListItems } from '../templateInputs.js';
import {
  getThemeFont,
  shouldUseShadow,
  motionEntrance,
  themedFontSize,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import {
  ACCENT_STRIP_SIZE,
  createAccentLayers,
  getAccentLayout,
  adjustY,
  DEFAULT_LAYOUT,
  accentForViewport,
} from './accentImage.js';
import { estimateProseLineCount, estimateWrappedLineCount } from './captionUtils.js';
// conceptBlocks imports this module too; `frame` is only called at render
// time, so the cycle never reads an uninitialized binding.
import { frame } from './conceptBlocks.js';

/** Flow id tying the marker and item layers into one native list (see TextFlow). */
const LIST_ITEMS_FLOW = 'list-items';
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
  ordered = true,
): ListItemGeometry {
  const markerText = ordered ? `${itemCount}.` : '•';
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

/**
 * How far a short list's items may grow past their base size: the concept
 * ramp's top step (`PLAIN_BASE × MAX_SCALE`, 45px at 1080p), filling no more
 * than `LIST_GROW_SHARE` of the room beneath the headline.
 */
const LIST_ITEM_GROWN_FONT_PX = 45;
const LIST_GROW_SHARE = 0.9;
/** The largest an item may be as a share of the headline above it. */
const LIST_ITEM_HEADLINE_SHARE = 0.8;

/**
 * A list slide in the shared lockup the concept slides use (`frame`: themed
 * surface, accent rule, 60px headline), its items set as large as the room
 * allows. The relaxed layout this replaces set a 44px title over 34px items
 * in the top half of the frame — a heading barely larger than its body, and
 * an empty lower half — and the player cannot grow these items itself, since
 * each item's box is sized to its lines. So short lists grow here, up to the
 * ramp's top step, and long ones shrink to the readable floor as before.
 */
function lockupListLayers(
  input: ListBlockInput,
  items: string[],
  richItems: ReturnType<typeof extractRichListItems>,
  ordered: boolean,
  context: TemplateContext,
): Layer[] {
  const { theme } = context;
  const lockup = frame({ title: input.title, colorScheme: input.colorScheme }, context);
  // The list's headline keeps the layer id it has always had.
  const layers: Layer[] = lockup.layers.map((layer) =>
    layer.id === 'title' ? { ...layer, id: 'list-title' } : layer,
  );
  const widthPx = lockup.right - lockup.left;
  const baseFontSize = themedFontSize(LIST_ITEM_BASE_FONT_PX, context, false);
  // Items never grow past this share of the headline, so the heading stays
  // the clear top of the hierarchy (in portrait the ramp's top step would
  // otherwise overtake it).
  const headline = layers.find(
    (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'list-title',
  )?.content.style.fontSize;
  const grownFontSize = Math.max(
    baseFontSize,
    Math.min(
      themedFontSize(LIST_ITEM_GROWN_FONT_PX, context, false),
      headline ? Math.floor(headline * LIST_ITEM_HEADLINE_SHARE) : Infinity,
    ),
  );
  const minFontSize = Math.min(baseFontSize, themedFontSize(LIST_ITEM_MIN_FONT_PX, context, false));
  const heightAt = (fontSize: number) =>
    measureListHeightPx(
      items,
      fontSize,
      listItemGeometry(fontSize, baseFontSize, items.length, widthPx, ordered),
    );
  // A dense list starts right under the headline, as the old condensed
  // layout did, before it spends any type size.
  const { height: H } = context.viewport;
  const top =
    heightAt(baseFontSize) > lockup.bottom - lockup.top
      ? Math.max(H * 0.1, lockup.top - H * (lockup.portrait ? 0.05 : 0.07) + H * 0.025)
      : lockup.top;
  const availablePx = Math.max(0, lockup.bottom - top);

  let fontSize = baseFontSize;
  // Grow a short list: the largest size whose items fill no more than the
  // grow share of the room.
  for (let size = grownFontSize; size > baseFontSize; size -= 1) {
    if (heightAt(size) <= availablePx * LIST_GROW_SHARE) {
      fontSize = size;
      break;
    }
  }
  // Shrink a long one to the floor; past it the tail runs off the slide.
  while (fontSize > minFontSize && heightAt(fontSize) > availablePx) fontSize -= 1;

  const { markerWidthPx, bodyIndentPx, bodyWidthPx, gapPx } = listItemGeometry(
    fontSize,
    baseFontSize,
    items.length,
    widthPx,
    ordered,
  );
  const checks = itemChecks(context, items.length);
  let itemTop = top;
  for (let i = 0; i < items.length; i++) {
    const itemText = items[i]!;
    const itemHtml = richItems[i]?.text === itemText ? richItems[i]?.html : undefined;
    const lineCount = estimateProseLineCount(itemText, fontSize, bodyWidthPx);
    const animation = motionEntrance(context, {
      type: 'fadeIn',
      duration: 0.8,
      delay: 0.3 + 0.3 * i,
    });
    const style = {
      fontSize,
      fontFamily: getThemeFont(context, 'body'),
      color: theme.colors.text,
      lineHeight: LIST_ITEM_LINE_HEIGHT,
      shadow: shouldUseShadow(context),
    };
    layers.push({
      type: 'text',
      id: `item-${i}-marker`,
      content: {
        text: checks[i] !== undefined ? taskMarker(checks[i]!) : ordered ? `${i + 1}.` : '•',
        flow: { id: LIST_ITEMS_FLOW, role: 'marker' },
        // Markers in the lockup's accent, as the concept slides set theirs.
        style: { ...style, color: lockup.accent, textAlign: 'right' },
      },
      position: { x: lockup.left, y: itemTop, width: markerWidthPx },
      animation,
    });
    layers.push({
      type: 'text',
      id: `item-${i}`,
      content: {
        text: itemText,
        ...(itemHtml ? { html: itemHtml } : {}),
        paragraphs: [
          {
            text: itemText,
            list: {
              ordered,
              level: 0,
              ...(ordered ? { number: i + 1 } : {}),
              ...(checks[i] !== undefined ? { checked: checks[i] } : {}),
            },
          },
        ],
        flow: { id: LIST_ITEMS_FLOW },
        style: { ...style, textAlign: 'left' },
      },
      position: {
        x: lockup.left + bodyIndentPx,
        y: itemTop,
        width: bodyWidthPx,
        // Sized from the same line count that reserved the room, so nested
        // sub-items in a rich item's hidden-overflow box are not cut off.
        height: lineCount * fontSize * LIST_ITEM_LINE_HEIGHT + fontSize * 0.5,
      },
      animation,
    });
    itemTop += lineCount * fontSize * LIST_ITEM_LINE_HEIGHT + gapPx;
  }
  return layers;
}

/**
 * Each item's task state (`- [ ]` / `- [x]`), read from the block's list,
 * when its items are the slide's items. A task item shows its box as its
 * marker; every renderer and the PPTX export key off `list.checked`.
 */
function itemChecks(context: TemplateContext, count: number): Array<boolean | undefined> {
  const list = context.block?.contents?.find((node) => node.type === 'list');
  const items = list && list.type === 'list' ? list.children : [];
  return Array.from({ length: count }, (_, i) => {
    const checked = items.length === count ? items[i]?.checked : undefined;
    return typeof checked === 'boolean' ? checked : undefined;
  });
}

/** Total height the list occupies at a font size, gaps included. */
function measureListHeightPx(
  items: string[],
  fontSize: number,
  geometry: ListItemGeometry,
): number {
  let heightPx = 0;
  for (const itemText of items) {
    // Nested sub-items arrive as `\n`-separated lines the renderer honours.
    const lineCount = estimateProseLineCount(itemText, fontSize, geometry.bodyWidthPx);
    heightPx += lineCount * fontSize * LIST_ITEM_LINE_HEIGHT + geometry.gapPx;
  }
  return heightPx;
}

export function listBlock(input: ListBlockInput, context: TemplateContext): Layer[] {
  const { title } = input;
  const items: string[] = Array.isArray(input.items) ? input.items : [];
  // No items is no list: the block is shown as content instead
  // (`materializeBlockLayers`), so a `{[list]}` over prose keeps its prose.
  // A summary slide is the exception: its items are withheld on purpose and
  // the heading alone is the slide.
  if (items.length === 0 && !context.block?.summaryMode) return [];
  const build = input.build ?? context.block?.build;
  if (build && build.mode !== 'off') {
    // Keep the full hierarchy in one flowing rich-text layout; fragments own
    // their markers and text, so revealing a child cannot reflow its parent.
    const rich = extractRichListItems(context.block?.contents);
    const matches = rich.length === items.length && rich.every((item, i) => item.text === items[i]);
    const contents: MarkdownBlockNode[] = matches
      ? (context.block?.contents ?? [])
      : [
          {
            type: 'list',
            ordered: input.ordered !== false,
            children: items.map((text) => ({
              type: 'listItem',
              children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
            })),
          },
        ];
    const layers = contentBlock(
      { ...input, template: 'content', title: input.title ?? '', build },
      {
        ...context,
        block: {
          id: input.id,
          duration: input.duration,
          startTime: 0,
          audioSegment: input.audioSegment,
          ...context.block,
          summaryMode: undefined,
          contents,
          build,
        },
      },
    );
    const accent = accentForViewport(input.accentImage, context.viewport);
    if (accent) {
      const layout = getAccentLayout(accent.position);
      layers.splice(
        1,
        0,
        ...createAccentLayers(
          accent,
          input.id,
          themedImageTreatment(context, input.imageTreatment),
        ),
      );
      const textLeft = `${parseFloat(layout.textCenterX) - parseFloat(layout.textWidth) / 2}%`;
      for (const layer of layers) {
        // The headline's accent rule moves with the headline.
        if (layer.id === 'accent-rule') {
          layer.position.x = textLeft;
          layer.position.y = adjustY(String(layer.position.y), layout);
          continue;
        }
        if (layer.type !== 'text' || (layer.id !== 'title' && layer.id !== 'body')) continue;
        layer.position.x = textLeft;
        layer.position.width = layout.textWidth;
        layer.position.y = adjustY(String(layer.position.y), layout);
        if (layer.id === 'body' && accent.position === 'bottom-strip')
          layer.position.height = `${68 - ACCENT_STRIP_SIZE}%`;
      }
    }
    return layers;
  }
  const accentImage = accentForViewport(input.accentImage, context.viewport);
  // `items` is required by the schema, but malformed / partially-authored
  // blocks (e.g. someone wrote `template: list` with no items yet) reach
  // this code path during live preview. Treat missing/non-array as empty
  // so we render the title-and-background frame instead of blowing up
  // every keystroke with a TypeError.
  // Unordered Markdown lists render bullets; ordered (and legacy unflagged)
  // inputs keep the `1.` markers.
  const ordered = input.ordered !== false;
  const richItems = extractRichListItems(context.block?.contents);
  // An accent image shares the frame; its layouts keep the relaxed plan below.
  if (!accentImage) return lockupListLayers(input, items, richItems, ordered, context);
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
    ordered,
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
      animation: motionEntrance(context, { type: 'fadeIn', duration: 1 }),
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
    geometry = listItemGeometry(itemFontSize, baseItemFontSize, items.length, textWidthPx, ordered);
  }

  // Render the number and body in separate columns. The body is therefore a
  // single text layer whose wrapped lines all share the same x coordinate,
  // producing a hanging indent instead of wrapping underneath the number.
  const { markerWidthPx, bodyIndentPx, bodyWidthPx, gapPx } = geometry;
  const bodyLeftX = `${leftPct + (bodyIndentPx / context.viewport.width) * 100}%`;
  const checks = itemChecks(context, items.length);
  let itemY = startY;

  // List items with staggered animation
  for (let i = 0; i < items.length; i++) {
    const itemText = items[i]!;
    const itemHtml = richItems[i]?.text === itemText ? richItems[i]?.html : undefined;
    const lineCount = estimateProseLineCount(itemText, itemFontSize, bodyWidthPx);
    const animation = motionEntrance(context, {
      type: 'fadeIn',
      duration: 0.8,
      delay: 0.3 + 0.3 * i,
    });

    layers.push({
      type: 'text',
      id: `item-${i}-marker`,
      content: {
        // Bullets stay bullets; only ordered (or legacy, unflagged) lists count.
        text: checks[i] !== undefined ? taskMarker(checks[i]!) : ordered ? `${i + 1}.` : '•',
        flow: { id: LIST_ITEMS_FLOW, role: 'marker' },
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
        paragraphs: [
          {
            text: itemText,
            list: {
              ordered,
              level: 0,
              ...(ordered ? { number: i + 1 } : {}),
              ...(checks[i] !== undefined ? { checked: checks[i] } : {}),
            },
          },
        ],
        flow: { id: LIST_ITEMS_FLOW },
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
        // Rich (HTML) items render in a hidden-overflow box the renderer
        // sizes from the plain text; size it here from the same line count
        // that reserved the vertical space so nested sub-items are not cut off.
        height: lineCount * itemFontSize * LIST_ITEM_LINE_HEIGHT + itemFontSize * 0.5,
      },
      animation,
    });

    const itemHeightPx = lineCount * itemFontSize * LIST_ITEM_LINE_HEIGHT;
    itemY += ((itemHeightPx + gapPx) / context.viewport.height) * 100;
  }

  return layers;
}

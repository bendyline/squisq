/**
 * Layout block template.
 *
 * Renders the parent block's children as free-form, **absolutely
 * positioned** layers on a canvas (text boxes, shapes, images). Unlike
 * `drawingBlock`, coordinates are used as-is — there is no fit-to-viewport
 * scaling — because a layout is a fixed-canvas composition.
 *
 * Each child is one layer: `### {#id} {[<type> x=.. y=.. …]}`. A text box's
 * content lives in its child body as markdown (see `computeLayoutLayers`).
 * Children render in document order (first child = back-most layer).
 */

import type { Layer, TextLayer } from '../../schemas/Doc.js';
import type { TemplateBlock, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { getThemeFont } from '../utils/themeUtils.js';
import { computeLayoutLayers } from './layoutLayout.js';
import { createBackgroundLayer } from './captionUtils.js';

export function layoutBlock(input: TemplateBlock, context: TemplateContext): Layer[] {
  const { theme, viewport, children = [] } = context;
  // Theme ink for un-styled text and strokes — the fixed dark-slate
  // default disappeared on dark themes.
  const { layers } = computeLayoutLayers(children, viewport, { ink: theme.colors.text });
  // The theme's page under the composition (first layer = back-most), as every
  // other template draws; without it a layout was a black slide in a light deck.
  const background = createBackgroundLayer('bg', theme.colors.background);
  return [background, ...(layers.length > 0 ? layers : [emptyHint(input, context)])];
}

function emptyHint(input: TemplateBlock, context: TemplateContext): TextLayer {
  return {
    type: 'text',
    id: 'layout-empty',
    content: {
      text: (input as { title?: string }).title ?? 'Empty layout',
      style: {
        fontSize: scaledFontSize(36, context, true),
        fontFamily: getThemeFont(context, 'title'),
        color: context.theme.colors.textMuted,
        textAlign: 'center',
      },
    },
    position: { x: '50%', y: '50%', anchor: 'center' },
  };
}

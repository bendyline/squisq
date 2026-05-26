/**
 * rawLayers — passthrough template for editor-authored Layer arrays.
 *
 * Backs the `layout` and `drawing` block templates. Both surfaces let
 * authors arrange a free-form Layer[] via the Scene engine in the
 * editor; the layers are serialized into a `data-block-attrs` Pandoc
 * param named `layers="<base64-json>"`.
 *
 * SSR rendering pipeline (when fully wired up): the markdown parser
 * decodes `layers` from the heading's Pandoc params into `block.layers`,
 * then this template returns those layers unchanged. v1 of the Scene
 * shipping editor support; SSR consumption is a follow-up — until
 * `markdownToDoc` decodes the param, this template returns an empty
 * array and authored layouts/drawings will not appear in previews.
 */

import type { Layer, TextLayer } from '../../schemas/Doc.js';
import type { TemplateBlock, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { getThemeFont } from '../utils/themeUtils.js';

/**
 * Template body for `layout` and `drawing`. Both surfaces share this
 * passthrough behavior — the difference between them lives in the
 * editor (different default toolsets), not in the SSR output.
 *
 * SSR rendering pipeline (when fully wired up): the markdown parser
 * decodes `layers` from the heading's Pandoc params into `block.layers`,
 * then this template returns those layers unchanged. v1 ships editor
 * support only; until `markdownToDoc` decodes the param, this template
 * emits a single placeholder TextLayer so previews don't appear empty.
 */
export function rawLayersBlock(
  input: TemplateBlock,
  context: TemplateContext,
): Layer[] {
  const { theme, viewport } = context;
  const title = (input as { title?: string }).title ?? 'Open in editor to view';
  const placeholder: TextLayer = {
    id: 'raw-layers-placeholder',
    type: 'text',
    position: {
      x: viewport.width / 2,
      y: viewport.height / 2,
      width: viewport.width * 0.8,
      anchor: 'center',
    },
    content: {
      text: title,
      style: {
        fontSize: scaledFontSize(36, context, true),
        fontFamily: getThemeFont(context, 'title'),
        color: theme.colors.textMuted,
        textAlign: 'center',
      },
    },
  };
  return [placeholder];
}

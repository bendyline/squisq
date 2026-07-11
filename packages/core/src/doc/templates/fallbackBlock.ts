/**
 * Fallback Block Rendering
 *
 * The graceful-degradation guarantee: a block whose template can't render —
 * unknown template name, template function threw, or returned a non-array —
 * still renders its heading and body text as a plain, readable card instead
 * of a blank slide. A small notice line names the problem so authors (and
 * agents reviewing screenshots) can see *why* the block degraded.
 *
 * This is intentionally not a registered template: it can't be requested by
 * name, only reached when a requested template fails. See `materializeBlockLayers()`.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { Block } from '../../schemas/Doc.js';
import type { DocBlock, TemplateContext } from '../../schemas/BlockTemplates.js';
import { resolveColorScheme, getThemeFont, themedFontSize } from '../utils/themeUtils.js';
import { extractPlainText } from '../../markdown/utils.js';

/** Cap body text so a long section doesn't overflow the card. */
const MAX_BODY_CHARS = 600;

/**
 * Render a block's heading + body text as plain layers, with a notice line
 * describing why the requested template didn't render.
 *
 * @param block   The block that failed to render via its template.
 * @param context Template context (theme, viewport).
 * @param notice  Short problem description, e.g. `Unknown template "photGrid"`.
 */
export function fallbackBlockLayers(
  block: DocBlock,
  context: TemplateContext,
  notice: string,
): Layer[] {
  const colors = resolveColorScheme(context, 'blue');
  const { layout } = context;

  const title = (block as Block).title ?? (block as Block).id ?? '';
  const body = extractBodyText(block as Block);

  const layers: Layer[] = [
    {
      type: 'shape',
      id: 'fallback-bg',
      content: { shape: 'rect', fill: colors.bg },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  if (title) {
    layers.push({
      type: 'text',
      id: 'fallback-title',
      content: {
        text: title,
        style: {
          fontSize: themedFontSize(56, context, true),
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: colors.text,
          textAlign: 'center',
        },
      },
      position: {
        x: '50%',
        y: body ? '28%' : '50%',
        anchor: 'center',
        width: layout.maxTextWidth,
      },
    });
  }

  if (body) {
    layers.push({
      type: 'text',
      id: 'fallback-body',
      content: {
        text: body,
        style: {
          fontSize: themedFontSize(28, context),
          fontFamily: getThemeFont(context, 'body'),
          color: colors.text,
          textAlign: 'center',
        },
      },
      position: {
        x: '50%',
        y: '55%',
        anchor: 'center',
        width: layout.maxTextWidth,
      },
    });
  }

  layers.push({
    type: 'text',
    id: 'fallback-notice',
    content: {
      text: `⚠ ${notice}`,
      style: {
        fontSize: themedFontSize(18, context),
        fontFamily: getThemeFont(context, 'body'),
        color: `${colors.text}99`,
        textAlign: 'center',
      },
    },
    position: { x: '50%', y: '92%', anchor: 'center', width: layout.maxTextWidth },
  });

  return layers;
}

/** Plain text of a block's body contents, truncated for card display. */
function extractBodyText(block: Block): string {
  if (!block.contents || block.contents.length === 0) return '';
  const text = block.contents
    .map((node) => extractPlainText(node))
    .join('\n')
    .trim();
  if (text.length <= MAX_BODY_CHARS) return text;
  return `${text.slice(0, MAX_BODY_CHARS).trimEnd()}…`;
}

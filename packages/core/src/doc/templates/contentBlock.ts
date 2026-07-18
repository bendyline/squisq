/**
 * Content-first template.
 *
 * Unlike visual-summary templates, this template deliberately preserves the
 * complete plain-text projection of a Markdown block. It is intended as the
 * loss-averse first pass for generated decks; authors can replace it with a
 * more visual template after validation and preview.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { ContentBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { extractPlainText } from '../../markdown/utils.js';
import { getThemeFont, shouldUseShadow, themedFontSize } from '../utils/themeUtils.js';
import { createBackgroundLayer } from './captionUtils.js';

function completeBodyText(context: TemplateContext): string {
  return (
    (context.block?.contents ?? [])
      // Mermaid source is already materialized as a visual layer. Repeating the
      // fence text as prose makes the loss-averse default noisy without
      // preserving any additional authored meaning.
      .filter((node) => !(node.type === 'code' && node.lang?.trim().toLowerCase() === 'mermaid'))
      .map((node) => extractPlainText(node))
      .join('\n')
      .trim()
  );
}

function bodyFontSize(body: string, context: TemplateContext): number {
  const base = body.length > 1800 ? 18 : body.length > 1100 ? 21 : body.length > 650 ? 24 : 28;
  return themedFontSize(base, context, false);
}

export function contentBlock(input: ContentBlockInput, context: TemplateContext): Layer[] {
  const { theme } = context;
  const title = input.title ?? context.block?.title ?? '';
  const body = completeBodyText(context);
  const layers: Layer[] = [createBackgroundLayer('bg', theme.colors.background)];

  if (title) {
    layers.push({
      type: 'text',
      id: 'title',
      content: {
        text: title,
        style: {
          fontSize: themedFontSize(46, context, true),
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'left',
          lineHeight: 1.15,
          shadow: shouldUseShadow(context),
        },
      },
      position: { x: '8%', y: '9%', width: '84%', height: '15%', anchor: 'top-left' },
    });
  }

  if (body) {
    layers.push({
      type: 'text',
      id: 'body',
      content: {
        text: body,
        style: {
          fontSize: bodyFontSize(body, context),
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.text,
          textAlign: 'left',
          lineHeight: 1.35,
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: '8%',
        y: title ? '28%' : '10%',
        width: '84%',
        height: title ? '64%' : '82%',
        anchor: 'top-left',
      },
    });
  }

  return layers;
}

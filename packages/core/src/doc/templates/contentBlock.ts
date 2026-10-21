import { planContentBuilds } from '../builds.js';
/**
 * Content-first template.
 *
 * Unlike visual-summary templates, this template deliberately preserves the
 * complete plain-text projection of a Markdown block. It is intended as the
 * loss-averse first pass for generated decks; authors can replace it with a
 * more visual template after validation and preview.
 */

import type { Layer, TextParagraph } from '../../schemas/Doc.js';
import type { ContentBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import type { MarkdownBlockNode, MarkdownList } from '../../markdown/types.js';
import { extractPlainText } from '../../markdown/utils.js';
import {
  isMaterializedMediaNode,
  markdownBlockSeparatorLines,
  renderMarkdownBlocksHtml,
} from '../templateInputs.js';
import { getThemeFont, shouldUseShadow, themedFontSize } from '../utils/themeUtils.js';
import { createBackgroundLayer } from './captionUtils.js';

function bodyNodes(context: TemplateContext): MarkdownBlockNode[] {
  if (context.block?.summaryMode === 'headings-and-features') return [];
  return (context.block?.contents ?? []).filter(
    // Mermaid source and hosted-video links are already materialized as
    // visual layers (a diagram, a player). Repeating them as prose makes the
    // loss-averse default noisy without preserving any additional meaning.
    (node) => !isMaterializedMediaNode(node),
  );
}

function listParagraphs(list: MarkdownList, level = 0): TextParagraph[] {
  const ordered = Boolean(list.ordered);
  return list.children.flatMap((item, index) => {
    const ownText = item.children
      .filter((node) => node.type !== 'list')
      .map((node) => extractPlainText(node).trim())
      .filter(Boolean)
      .join(' ');
    const paragraphs: TextParagraph[] = ownText
      ? [
          {
            text: ownText,
            list: { ordered, level, ...(ordered ? { number: (list.start ?? 1) + index } : {}) },
          },
        ]
      : [];
    for (const child of item.children) {
      if (child.type === 'list') paragraphs.push(...listParagraphs(child, level + 1));
    }
    return paragraphs;
  });
}

/** A paragraph as plain text: list items carry their indent and marker. */
function plainParagraphText({ text, list }: TextParagraph): string {
  if (!list) return text;
  const marker = list.ordered ? `${list.number ?? 1}.` : '•';
  return `${'  '.repeat(list.level)}${marker} ${text}`;
}

/**
 * The body as paragraphs, list items kept structured, with blank paragraphs
 * standing in for the blank lines between blocks. Trimmed like the plain
 * text it projects to, so `text` stays exactly the historical body string.
 */
function completeBodyParagraphs(nodes: readonly MarkdownBlockNode[]): TextParagraph[] {
  const paragraphs = nodes.flatMap((node, index): TextParagraph[] => {
    const own = node.type === 'list' ? listParagraphs(node) : [{ text: extractPlainText(node) }];
    if (index === 0) return own;
    const blankLines = markdownBlockSeparatorLines(nodes[index - 1], node) - 1;
    return [...Array.from({ length: blankLines }, () => ({ text: '' })), ...own];
  });
  while (paragraphs.length && !plainParagraphText(paragraphs[0]!).trim()) paragraphs.shift();
  while (paragraphs.length && !plainParagraphText(paragraphs[paragraphs.length - 1]!).trim()) {
    paragraphs.pop();
  }
  const first = paragraphs[0];
  if (first && !first.list) paragraphs[0] = { ...first, text: first.text.trimStart() };
  const last = paragraphs[paragraphs.length - 1];
  if (last) paragraphs[paragraphs.length - 1] = { ...last, text: last.text.trimEnd() };
  return paragraphs;
}

function bodyFontSize(body: string, context: TemplateContext): number {
  const base = body.length > 1800 ? 18 : body.length > 1100 ? 21 : body.length > 650 ? 24 : 28;
  return themedFontSize(base, context, false);
}

export function contentBlock(input: ContentBlockInput, context: TemplateContext): Layer[] {
  const { theme } = context;
  const title = input.title ?? context.block?.title ?? '';
  const markdown = bodyNodes(context);
  const paragraphs = completeBodyParagraphs(markdown);
  const body = paragraphs.map(plainParagraphText).join('\n');
  const builds = planContentBuilds(markdown, input.build ?? context.block?.build);
  const bodyHtml = renderMarkdownBlocksHtml(markdown, builds);
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
      position: { x: '8%', y: '9%', width: '84%', height: '10%', anchor: 'top-left' },
    });
  }

  if (body) {
    layers.push({
      type: 'text',
      id: 'body',
      content: {
        text: body,
        ...(builds.steps.length ? { buildSteps: builds.steps } : {}),
        ...(bodyHtml ? { html: bodyHtml } : {}),
        // Only a body with list items has structure `text` cannot carry.
        ...(paragraphs.some((paragraph) => paragraph.list) ? { paragraphs } : {}),
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
        y: title ? '20%' : '10%',
        width: '84%',
        height: title ? '72%' : '82%',
        anchor: 'top-left',
      },
    });
  }

  return layers;
}

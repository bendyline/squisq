import { planContentBuilds } from '../builds.js';
/**
 * Content-first template.
 *
 * Unlike visual-summary templates, this template deliberately preserves the
 * complete plain-text projection of a Markdown block. It is intended as the
 * loss-averse first pass for generated decks; authors can replace it with a
 * more visual template after validation and preview.
 */

import { taskMarker, type Layer, type TextParagraph } from '../../schemas/Doc.js';
import type { ContentBlockInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import type { MarkdownBlockNode, MarkdownList, MarkdownTable } from '../../markdown/types.js';
import { extractPlainText } from '../../markdown/utils.js';
import {
  isMaterializedMediaNode,
  isPictureParagraph,
  markdownBlockSeparatorLines,
  renderMarkdownBlocksHtml,
} from '../templateInputs.js';
import { getThemeFont, shouldUseShadow, themedFontSize } from '../utils/themeUtils.js';
import { createBackgroundLayer } from './captionUtils.js';

/**
 * Slide text reads a wrapped source line as one line: the text layer turns
 * every newline into a line break, and a soft-wrapped bullet broke
 * mid-sentence on a PPTX slide. Hard breaks stay line breaks.
 */
const SLIDE_TEXT = { softBreaks: 'space' } as const;

function bodyNodes(context: TemplateContext): MarkdownBlockNode[] {
  if (context.block?.summaryMode === 'headings-and-features') return [];
  // A summary's tables and diagram fences are its features, drawn beside its
  // words (`appendRichContentLayers`), never repeated as body text.
  const summary = !!context.block?.summaryMode;
  return (context.block?.contents ?? []).filter(
    // Mermaid source, hosted-video links and picture-only paragraphs are
    // already materialized as visual layers (a diagram, a player, the picture
    // itself). Repeating them as prose makes the loss-averse default noisy
    // without preserving any additional meaning — a pasted picture's alt text
    // is just its generated file name. A footnote's definition belongs in the
    // speaker notes, where the PPTX export puts it, not in the slide's text.
    (node) =>
      node.type !== 'footnoteDefinition' &&
      !isMaterializedMediaNode(node) &&
      !isPictureParagraph(node) &&
      !(summary && (node.type === 'table' || node.type === 'code')),
  );
}

function listParagraphs(list: MarkdownList, level = 0): TextParagraph[] {
  const ordered = Boolean(list.ordered);
  return list.children.flatMap((item, index) => {
    const ownText = item.children
      .filter((node) => node.type !== 'list')
      .map((node) => extractPlainText(node, SLIDE_TEXT).trim())
      .filter(Boolean)
      .join(' ');
    const checked = typeof item.checked === 'boolean' ? { checked: item.checked } : {};
    const paragraphs: TextParagraph[] = ownText
      ? [
          {
            text: ownText,
            list: {
              ordered,
              level,
              ...(ordered ? { number: (list.start ?? 1) + index } : {}),
              ...checked,
            },
          },
        ]
      : [];
    for (const child of item.children) {
      if (child.type === 'list') paragraphs.push(...listParagraphs(child, level + 1));
    }
    return paragraphs;
  });
}

/**
 * A table as one paragraph: its plain rows as `text` (unchanged for every
 * plain consumer) and its cells as `table`, so a PPTX deck can write the
 * native table the slideshow draws instead of lines of spaced words.
 */
function tableParagraph(table: MarkdownTable): TextParagraph {
  const cells = (row: MarkdownTable['children'][number] | undefined) =>
    (row?.children ?? []).map((cell) => extractPlainText(cell).trim());
  const [head, ...body] = table.children;
  return {
    text: extractPlainText(table),
    table: {
      header: cells(head),
      rows: body.map((row) => cells(row)),
      ...(table.align?.some(Boolean) ? { align: table.align.map((value) => value ?? null) } : {}),
    },
  };
}

/** A paragraph as plain text: list items carry their indent and marker. */
function plainParagraphText({ text, list }: TextParagraph): string {
  if (!list) return text;
  const marker =
    list.checked !== undefined
      ? taskMarker(list.checked)
      : list.ordered
        ? `${list.number ?? 1}.`
        : '•';
  return `${'  '.repeat(list.level)}${marker} ${text}`;
}

/**
 * The body as paragraphs, list items kept structured, with blank paragraphs
 * standing in for the blank lines between blocks. Trimmed like the plain
 * text it projects to, so `text` stays exactly the historical body string.
 */
function completeBodyParagraphs(nodes: readonly MarkdownBlockNode[]): TextParagraph[] {
  const paragraphs = nodes.flatMap((node, index): TextParagraph[] => {
    const own =
      node.type === 'list'
        ? listParagraphs(node)
        : node.type === 'table'
          ? [tableParagraph(node)]
          : [{ text: extractPlainText(node, SLIDE_TEXT) }];
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

/**
 * The body's base size. Short bodies start larger: the slideshow grows a
 * slide's text by at most 2× (and only while every box still holds it), so a
 * sentence or two set at 28px stayed small in the top third of the frame.
 */
function bodyFontSize(body: string, context: TemplateContext): number {
  const base =
    body.length > 1800
      ? 18
      : body.length > 1100
        ? 21
        : body.length > 650
          ? 24
          : body.length > 300
            ? 28
            : body.length > 120
              ? 34
              : 40;
  return themedFontSize(base, context, false);
}

/**
 * The headline: the concept slides' lockup size (60px at 1080p), so a content
 * slide's heading reads as clearly larger than its body (a 40px body at most),
 * with an accent rule above it as theirs have. Its box keeps room for the
 * slideshow's 2× grow — a tight box would hold the whole slide at its base
 * size, since every box must fit at the shared scale.
 */
const HEADLINE_PX = 60;
const HEADLINE_TOP_PCT = 9;
const HEADLINE_BOX_PCT = 14;
const BODY_TOP_PCT = 24;

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
    const titleFontSize = themedFontSize(HEADLINE_PX, context, true);
    const { height: H } = context.viewport;
    const ruleHeight = Math.max(4, Math.round(H * 0.006));
    const ruleTopPct = HEADLINE_TOP_PCT - ((ruleHeight + titleFontSize * 0.3) / H) * 100;
    layers.push({
      type: 'shape',
      id: 'accent-rule',
      content: {
        shape: 'rect',
        fill: theme.colors.highlight || theme.colors.primary,
        borderRadius: ruleHeight / 2,
      },
      position: {
        x: '8%',
        y: `${Math.max(1, ruleTopPct)}%`,
        width: '4.5%',
        height: `${(ruleHeight / H) * 100}%`,
        anchor: 'top-left',
      },
    });
    layers.push({
      type: 'text',
      id: 'title',
      content: {
        text: title,
        style: {
          fontSize: titleFontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'left',
          lineHeight: 1.15,
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: '8%',
        y: `${HEADLINE_TOP_PCT}%`,
        width: '84%',
        height: `${HEADLINE_BOX_PCT}%`,
        anchor: 'top-left',
      },
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
        // Only a body with list items or tables has structure `text` cannot carry.
        ...(paragraphs.some((paragraph) => paragraph.list || paragraph.table)
          ? { paragraphs }
          : {}),
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
        y: title ? `${BODY_TOP_PCT}%` : '10%',
        width: '84%',
        height: title ? `${92 - BODY_TOP_PCT}%` : '82%',
        anchor: 'top-left',
      },
    });
  }

  return layers;
}

/**
 * Build the text-first Document-mode projection for a transformed Doc.
 *
 * Transform-generated blocks are programmatic template inputs: unlike blocks
 * parsed from Markdown, they do not carry `sourceHeading` / `contents` nodes.
 * `docToMarkdown()` intentionally omits such blocks because its primary job is
 * lossless authoring round-trips. For a summarized preview we instead give the
 * generated blocks a temporary, readable authoring shape before serializing.
 */

import { docToMarkdown } from '@bendyline/squisq/doc';
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownHeading, MarkdownParagraph } from '@bendyline/squisq/markdown';
import type { Block, Doc } from '@bendyline/squisq/schemas';

function textParagraph(value: string): MarkdownParagraph {
  return { type: 'paragraph', children: [{ type: 'text', value }] };
}

function textHeading(value: string, depth: 1 | 2 = 2): MarkdownHeading {
  return { type: 'heading', depth, children: [{ type: 'text', value }] };
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
}

interface ReadableBlockContent {
  title?: string;
  body: string[];
}

/** Extract the reader-facing copy carried by a programmatic template block. */
function readableTemplateContent(block: Block): ReadableBlockContent {
  const value = block as unknown as Record<string, unknown>;
  const template = stringValue(value, 'template');
  const explicitTitle = stringValue(value, 'title');

  switch (template) {
    case 'statHighlight':
      return {
        title: stringValue(value, 'stat') ?? explicitTitle,
        body: [stringValue(value, 'description')].filter(Boolean) as string[],
      };
    case 'factCard':
      return {
        title: stringValue(value, 'fact') ?? explicitTitle,
        body: [stringValue(value, 'explanation')].filter(Boolean) as string[],
      };
    case 'quote':
      return {
        title: stringValue(value, 'quote') ?? explicitTitle,
        body: [stringValue(value, 'attribution')].filter(Boolean) as string[],
      };
    case 'fullBleedQuote':
    case 'pullQuote':
      return {
        title: stringValue(value, 'text') ?? stringValue(value, 'quote') ?? explicitTitle,
        body: [stringValue(value, 'attribution')].filter(Boolean) as string[],
      };
    case 'dateEvent':
      return {
        title: stringValue(value, 'date') ?? explicitTitle,
        body: [stringValue(value, 'description')].filter(Boolean) as string[],
      };
    case 'definitionCard':
      return {
        title: stringValue(value, 'term') ?? explicitTitle,
        body: [stringValue(value, 'definition'), stringValue(value, 'origin')].filter(
          Boolean,
        ) as string[],
      };
    case 'twoColumn':
      return {
        title: stringValue(value, 'header') ?? explicitTitle ?? 'Comparison',
        body: [stringValue(value, 'left'), stringValue(value, 'right')].filter(Boolean) as string[],
      };
    case 'list':
      return {
        title: explicitTitle ?? 'Highlights',
        body: stringList(value, 'items'),
      };
    case 'imageWithCaption':
      return {
        title: stringValue(value, 'caption') ?? stringValue(value, 'imageAlt') ?? explicitTitle,
        body: [],
      };
    default:
      return {
        title: explicitTitle,
        body: [
          stringValue(value, 'body'),
          stringValue(value, 'description'),
          stringValue(value, 'text'),
        ].filter(Boolean) as string[],
      };
  }
}

function hasAuthoredShape(block: Block): boolean {
  return !!(
    block.sourceHeading ||
    block.standaloneAnnotation ||
    (block.contents && block.contents.length > 0)
  );
}

function makeReadableBlock(block: Block): Block {
  const children = block.children?.map(makeReadableBlock);
  if (hasAuthoredShape(block)) {
    return children === block.children ? block : { ...block, children };
  }

  const readable = readableTemplateContent(block);
  return {
    ...block,
    // Document mode is intentionally text-first. Removing the template from
    // this temporary projection prevents docToMarkdown from re-adding a
    // presentation annotation to the synthesized heading.
    template: undefined,
    sourceHeading: readable.title ? textHeading(readable.title) : undefined,
    contents: readable.body.map(textParagraph),
    children,
  };
}

function documentTitle(doc: Doc): string | undefined {
  if (doc.startBlock?.title?.trim()) return doc.startBlock.title.trim();
  const title = doc.frontmatter?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

function hasLevelOneHeading(blocks: Block[]): boolean {
  return blocks.some(
    (block) =>
      block.sourceHeading?.depth === 1 ||
      (block.children ? hasLevelOneHeading(block.children) : false),
  );
}

/** Serialize a transformed Doc into readable Markdown for Document mode. */
export function buildDocumentPreviewMarkdown(doc: Doc): string {
  const blocks = doc.blocks.map(makeReadableBlock);
  const title = documentTitle(doc);
  const titledBlocks =
    title && !hasLevelOneHeading(blocks)
      ? [
          {
            id: 'transform-document-title',
            startTime: 0,
            duration: 0,
            audioSegment: 0,
            sourceHeading: textHeading(title, 1),
            contents: [],
          } satisfies Block,
          ...blocks,
        ]
      : blocks;

  return stringifyMarkdown(docToMarkdown({ ...doc, blocks: titledBlocks }));
}

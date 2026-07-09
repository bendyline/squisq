import { useMemo } from 'react';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';
import type { Block, DocBlock, MediaProvider, Theme, ViewportConfig } from '@bendyline/squisq/schemas';
import {
  deriveTemplateInputs,
  extractBodyPlainText,
  extractBlockquoteText,
  extractImages,
  extractListItems,
  extractTableFromContents,
  getLayers,
  type RenderContext,
} from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';

export interface TemplatePreviewSource {
  block: Block;
  theme: Theme;
  viewport: ViewportConfig;
  basePath?: string;
  mediaProvider?: MediaProvider | null;
}

export interface TemplateContentPreviewProps {
  templateName: string;
  source?: TemplatePreviewSource;
  fallback: JSX.Element;
}

const NUMBER_RE =
  /(?:[$\u20ac\u00a3\u00a5]\s?\d+(?:[.,]\d+)*(?:\s?(?:[MBK]|million|billion|thousand))?|\d+(?:[.,]\d+)*\s?(?:%|\u2030|x|\u00d7|[MBK]|million|billion|thousand|percent|years?|days?|hours?)|\d{3,}(?:[.,]\d+)*)/i;

const DATE_RE =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|Q[1-4]\s+\d{4}|\d{4}s|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/i;

export function TemplateContentPreview({
  templateName,
  source,
  fallback,
}: TemplateContentPreviewProps) {
  const visual = useMemo(
    () => (source ? resolveTemplateContentPreview(templateName, source) : null),
    [templateName, source],
  );

  if (!source || !visual) return fallback;

  return (
    <div
      className="squisq-template-gallery-content-preview"
      style={{ aspectRatio: `${source.viewport.width} / ${source.viewport.height}` }}
      aria-hidden="true"
    >
      <MediaContext.Provider value={source.mediaProvider ?? null}>
        <BlockRenderer
          block={visual}
          blockTime={0}
          basePath={source.basePath ?? '/'}
          viewport={source.viewport}
        />
      </MediaContext.Provider>
    </div>
  );
}

export function resolveTemplateContentPreview(
  templateName: string,
  source: TemplatePreviewSource,
): Block | null {
  const { block, theme, viewport } = source;
  const headingText = getHeadingText(block);
  const bodyText = extractBodyPlainText(block.contents);
  const sameTemplate = block.template === templateName;
  const existingInputs =
    sameTemplate &&
    ((block.templateData && Object.keys(block.templateData).length > 0) ||
      (block.templateOverrides && Object.keys(block.templateOverrides).length > 0));
  const inputs = buildTemplatePreviewInputs(templateName, block, headingText, bodyText);

  if (!inputs && !existingInputs) return null;

  const candidate: Block = {
    ...block,
    id: `template-preview-${block.id}-${templateName}`,
    template: templateName,
    title: headingText || block.title || templateName,
    duration: 1,
    audioSegment: 0,
    layers: undefined,
    templateData: sameTemplate ? block.templateData : undefined,
    templateOverrides: sameTemplate ? block.templateOverrides : undefined,
    ...(inputs ?? {}),
  };

  const ctx: RenderContext = {
    blockIndex: 0,
    totalBlocks: 1,
    theme,
    viewport,
  };

  try {
    const layers = getLayers(candidate as unknown as DocBlock, ctx);
    if (layers.length === 0) return null;
    return { ...candidate, layers };
  } catch {
    return null;
  }
}

function buildTemplatePreviewInputs(
  templateName: string,
  block: Block,
  headingText: string,
  bodyText: string,
): Record<string, unknown> | null {
  const contents = block.contents;
  const text = [headingText, bodyText].filter(Boolean).join('\n');

  switch (templateName) {
    case 'title':
      return text
        ? {
            title: headingText || firstLine(bodyText) || 'Untitled',
            ...(headingText && bodyText ? { subtitle: bodyText } : {}),
          }
        : null;
    case 'sectionHeader': {
      if (!text) return null;
      const image = extractImages(contents, 1)[0];
      return {
        title: headingText || firstLine(bodyText) || 'Untitled',
        ...(image
          ? {
              imageSrc: image.src,
              imageAlt: image.alt || headingText,
            }
          : {}),
      };
    }
    case 'statHighlight':
      return NUMBER_RE.test(text)
        ? deriveTemplateInputs(templateName, headingText, contents, { placeholders: false })
        : null;
    case 'quote':
    case 'fullBleedQuote': {
      const quoteText = extractBlockquoteText(contents) || bodyText;
      return quoteText
        ? deriveTemplateInputs(templateName, headingText, contents, { placeholders: false })
        : null;
    }
    case 'pullQuote':
      return derivePullQuoteInputs(block, headingText, bodyText);
    case 'factCard':
      return headingText && bodyText
        ? deriveTemplateInputs(templateName, headingText, contents, { placeholders: false })
        : null;
    case 'twoColumn':
      return deriveTwoColumnInputs(block, headingText, bodyText);
    case 'dateEvent':
      return DATE_RE.test(text)
        ? deriveTemplateInputs(templateName, headingText, contents, { placeholders: false })
        : null;
    case 'definitionCard':
      return headingText && bodyText
        ? deriveTemplateInputs(templateName, headingText, contents, { placeholders: false })
        : null;
    case 'comparisonBar':
      return deriveComparisonInputs(block);
    case 'map':
    case 'videoWithCaption':
    case 'videoPullQuote':
      return null;
    case 'diagram':
    case 'layout':
    case 'drawing':
      return block.children && block.children.length > 0 ? { title: headingText } : null;
    default:
      return deriveTemplateInputs(templateName, headingText, contents, { placeholders: false });
  }
}

function derivePullQuoteInputs(
  block: Block,
  headingText: string,
  bodyText: string,
): Record<string, unknown> | null {
  const image = extractImages(block.contents, 1)[0];
  const text = extractBlockquoteText(block.contents) || bodyText || headingText;
  if (!image || !text) return null;
  return {
    text,
    backgroundImage: {
      src: image.src,
      alt: image.alt || headingText,
    },
  };
}

function deriveTwoColumnInputs(
  block: Block,
  headingText: string,
  bodyText: string,
): Record<string, unknown> | null {
  const items = extractListItems(block.contents);
  if (items.length >= 2) {
    return {
      ...(headingText ? { header: headingText } : {}),
      left: { label: trimPreviewText(items[0]) },
      right: { label: trimPreviewText(items[1]) },
    };
  }

  const chunks = bodyText
    .split(/\n{2,}|\n|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (headingText && chunks.length >= 1) {
    return {
      left: { label: trimPreviewText(headingText) },
      right: { label: trimPreviewText(chunks[0]) },
    };
  }
  if (chunks.length >= 2) {
    return {
      left: { label: trimPreviewText(chunks[0]) },
      right: { label: trimPreviewText(chunks[1]) },
    };
  }
  return null;
}

function deriveComparisonInputs(block: Block): Record<string, unknown> | null {
  const table = extractTableFromContents(block.contents);
  if (table) {
    const values = table.rows
      .map((row) => ({
        label: row[0] || 'Value',
        value: parseNumericValue(row.slice(1).join(' ')),
      }))
      .filter((row): row is { label: string; value: number } => row.value !== null);
    if (values.length >= 2) {
      return {
        leftLabel: trimPreviewText(values[0].label, 24),
        leftValue: values[0].value,
        rightLabel: trimPreviewText(values[1].label, 24),
        rightValue: values[1].value,
      };
    }
  }

  const bodyText = extractBodyPlainText(block.contents);
  const matches = Array.from(bodyText.matchAll(new RegExp(NUMBER_RE.source, 'gi')))
    .map((match) => parseNumericValue(match[0]))
    .filter((value): value is number => value !== null);
  if (matches.length < 2) return null;

  return {
    leftLabel: 'A',
    leftValue: matches[0],
    rightLabel: 'B',
    rightValue: matches[1],
  };
}

function parseNumericValue(raw: string): number | null {
  const normalized = raw.replace(/[$\u20ac\u00a3\u00a5,%\u2030]/g, '').replace(/,/g, '').trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

function getHeadingText(block: Block): string {
  if (block.sourceHeading) return extractPlainText(block.sourceHeading).trim();
  return (block.title ?? block.id ?? '').trim();
}

function firstLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

function trimPreviewText(value: string, max = 72): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

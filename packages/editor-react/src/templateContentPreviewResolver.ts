import type {
  Block,
  CustomTemplateDefinition,
  DocBlock,
  MediaProvider,
  Theme,
  ViewportConfig,
} from '@bendyline/squisq/schemas';
import {
  coerceTemplateParams,
  deriveTemplateInputs,
  extractBodyPlainText,
  extractEmbeddedVideos,
  extractBlockquoteText,
  extractImages,
  extractListItems,
  extractTableFromContents,
  materializeBlockLayers,
  type MaterializeBlockLayersOptions,
} from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';

export interface TemplatePreviewSource {
  block: Block;
  theme: Theme;
  viewport: ViewportConfig;
  basePath?: string;
  mediaProvider?: MediaProvider | null;
  customTemplates?: readonly CustomTemplateDefinition[];
}

export interface TemplatePreviewResult {
  visual: Block | null;
  warning?: string;
}

const NUMBER_RE =
  /(?:[$\u20ac\u00a3\u00a5]\s?\d+(?:[.,]\d+)*(?:\s?(?:[MBK]|million|billion|thousand))?|\d+(?:[.,]\d+)*\s?(?:%|\u2030|x|\u00d7|[MBK]|million|billion|thousand|percent|years?|days?|hours?)|\d{3,}(?:[.,]\d+)*)/i;

const DATE_RE =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|Q[1-4]\s+\d{4}|\d{4}s|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/i;

export function resolveTemplateContentPreview(
  templateName: string,
  source: TemplatePreviewSource,
): Block | null {
  return resolveTemplateContentPreviewResult(templateName, source).visual;
}

export function resolveTemplateContentPreviewResult(
  templateName: string,
  source: TemplatePreviewSource,
): TemplatePreviewResult {
  const { block, theme, viewport } = source;
  const headingText = getHeadingText(block);
  const bodyText = extractBodyPlainText(block.contents);
  const sameTemplate = block.template === templateName;
  // Authored data fences survive a template change; automatically derived
  // inputs are rebuilt from the body for the new template.
  const templateData = sameTemplate || !block.autoTemplate ? block.templateData : undefined;
  const existingInputs =
    sameTemplate &&
    ((block.templateData && Object.keys(block.templateData).length > 0) ||
      (block.templateOverrides && Object.keys(block.templateOverrides).length > 0));
  // Picking a different template preserves the heading's annotation params.
  // Check them using the target template's coercion, just as rendering does.
  const providedInputs: Record<string, unknown> = {
    ...block,
    ...templateData,
    ...coerceTemplateParams(templateName, block.templateOverrides ?? {}).input,
  };
  const { inputs, warning } = buildTemplatePreviewInputs(
    templateName,
    block,
    headingText,
    bodyText,
    providedInputs,
  );

  if (!inputs && (warning || !existingInputs)) return { visual: null, warning };

  const candidate: Block = {
    ...(inputs ?? {}),
    ...block,
    id: `template-preview-${block.id}-${templateName}`,
    template: templateName,
    title: headingText || block.title || templateName,
    duration: 1,
    audioSegment: 0,
    layers: undefined,
    templateData,
    templateOverrides: block.templateOverrides,
  };

  const ctx: MaterializeBlockLayersOptions = {
    blockIndex: 0,
    totalBlocks: 1,
    theme,
    viewport,
    customTemplates: source.customTemplates,
  };

  try {
    const materialized = materializeBlockLayers(candidate as unknown as DocBlock, ctx);
    const { layers } = materialized;
    if (materialized.diagnostic) {
      return { visual: null, warning: materialized.diagnostic.message };
    }
    if (layers.length === 0) return { visual: null, warning };
    return {
      visual: { ...candidate, layers },
    };
  } catch {
    return { visual: null, warning };
  }
}

function buildTemplatePreviewInputs(
  templateName: string,
  block: Block,
  headingText: string,
  bodyText: string,
  provided: Record<string, unknown>,
): { inputs: Record<string, unknown> | null; warning?: string } {
  const contents = block.contents;
  const text = [headingText, bodyText].filter(Boolean).join('\n');
  const hasAuthoredHeadingInput =
    block.template === templateName && !!block.sourceHeading && !!headingText;

  switch (templateName) {
    case 'content':
      // The content renderer reads the original AST from `context.block`.
      // A non-null input is still needed to opt into a live gallery preview.
      return { inputs: text ? { title: headingText } : null };
    case 'title':
      return {
        inputs: text
          ? {
              title: headingText || firstLine(bodyText) || 'Untitled',
              ...(headingText && bodyText ? { subtitle: bodyText } : {}),
            }
          : null,
      };
    case 'sectionHeader': {
      if (!text) return { inputs: null };
      const image = extractImages(contents, 1)[0];
      return {
        inputs: {
          title: headingText || firstLine(bodyText) || 'Untitled',
          ...(image
            ? {
                imageSrc: image.src,
                imageAlt: image.alt || headingText,
              }
            : {}),
        },
      };
    }
    case 'statHighlight':
      if (!hasAuthoredHeadingInput && !hasTextOrNumber(provided.stat) && !NUMBER_RE.test(text)) {
        return { inputs: null, warning: 'No stat found in this block' };
      }
      return {
        inputs: deriveTemplateInputs(templateName, headingText, contents, { placeholders: false }),
      };
    case 'quote':
    case 'fullBleedQuote': {
      const quoteText = extractBlockquoteText(contents) || bodyText;
      return {
        inputs:
          quoteText ||
          hasAuthoredHeadingInput ||
          hasTextOrNumber(provided[templateName === 'quote' ? 'quote' : 'text'])
            ? (deriveTemplateInputs(templateName, headingText, contents, { placeholders: false }) ??
              {})
            : null,
      };
    }
    case 'pullQuote': {
      const inputs = derivePullQuoteInputs(block, headingText, bodyText);
      const hasImage =
        hasMediaSource(provided.backgroundImage) || extractImages(contents, 1).length > 0;
      return {
        inputs: hasImage ? (inputs ?? { text: bodyText || headingText }) : null,
        ...(hasImage ? {} : { warning: 'No image found in this block' }),
      };
    }
    case 'factCard':
    case 'definitionCard':
      return {
        inputs:
          headingText &&
          (bodyText ||
            hasTextOrNumber(provided[templateName === 'factCard' ? 'explanation' : 'definition']))
            ? deriveTemplateInputs(templateName, headingText, contents, { placeholders: false })
            : null,
      };
    case 'twoColumn':
      return {
        inputs:
          deriveTwoColumnInputs(block, headingText, bodyText) ??
          (provided.left && provided.right ? {} : null),
      };
    case 'dateEvent':
      if (!hasAuthoredHeadingInput && !hasTextOrNumber(provided.date) && !DATE_RE.test(text)) {
        return { inputs: null, warning: 'No date found in this block' };
      }
      return {
        inputs: deriveTemplateInputs(templateName, headingText, contents, { placeholders: false }),
      };
    case 'comparisonBar': {
      const comparisonInputs =
        deriveComparisonInputs(block) ??
        (hasTextOrNumber(provided.leftValue) && hasTextOrNumber(provided.rightValue) ? {} : null);
      return {
        inputs: comparisonInputs,
        ...(comparisonInputs ? {} : { warning: 'No stat found in this block' }),
      };
    }
    case 'leftFeature':
    case 'rightFeature': {
      const hasFeature =
        hasText(provided.imageSrc) ||
        extractImages(contents, 1).length > 0 ||
        extractEmbeddedVideos(contents, 1).length > 0 ||
        (contents ?? []).some(
          (node) =>
            node.type === 'code' &&
            node.lang?.trim().toLowerCase() === 'mermaid' &&
            !!node.value.trim(),
        ) ||
        ['diagram', 'tree', 'timeline'].some(
          (template) =>
            !!deriveTemplateInputs(template, headingText, contents, { placeholders: false }),
        );
      return {
        inputs: hasFeature
          ? (deriveTemplateInputs(templateName, headingText, contents, { placeholders: false }) ?? {
              title: headingText,
              body: bodyText,
            })
          : null,
        ...(hasFeature ? {} : { warning: 'No visual feature found in this block' }),
      };
    }
    case 'imageWithCaption':
    case 'photoGrid': {
      const imageCount = extractImages(contents, templateName === 'photoGrid' ? 2 : 1).length;
      const hasProvidedImages =
        templateName === 'photoGrid'
          ? Array.isArray(provided.images) &&
            provided.images.length > 0 &&
            provided.images.every(hasMediaSource)
          : hasText(provided.imageSrc);
      const needsMoreImages =
        !hasProvidedImages && (templateName === 'photoGrid' ? imageCount < 2 : imageCount === 0);
      return {
        inputs: needsMoreImages
          ? null
          : (deriveTemplateInputs(templateName, headingText, contents, { placeholders: false }) ??
            {}),
        ...(needsMoreImages
          ? {
              warning:
                imageCount === 1
                  ? 'Photo Grid needs at least two images'
                  : 'No image found in this block',
            }
          : {}),
      };
    }
    case 'map': {
      const center = provided.center as { lat?: unknown; lng?: unknown } | undefined;
      const hasLocation =
        typeof center?.lat === 'number' &&
        Number.isFinite(center.lat) &&
        typeof center.lng === 'number' &&
        Number.isFinite(center.lng);
      return {
        inputs: hasLocation ? {} : null,
        ...(hasLocation ? {} : { warning: 'No map location found in this block' }),
      };
    }
    case 'videoWithCaption':
    case 'videoPullQuote': {
      const inputs = deriveTemplateInputs(templateName, headingText, contents, {
        placeholders: false,
      });
      const hasVideo =
        templateName === 'videoWithCaption'
          ? hasText(provided.videoSrc) || hasText(inputs?.videoSrc)
          : hasMediaSource(provided.backgroundVideo) || hasMediaSource(inputs?.backgroundVideo);
      return {
        inputs: hasVideo ? (inputs ?? {}) : null,
        ...(hasVideo
          ? {}
          : {
              warning: block.media?.some((clip) => clip.kind === 'video')
                ? "This template needs an inline video; this block's video plays separately"
                : 'No video found in this block',
            }),
      };
    }
    case 'diagram':
      return {
        inputs:
          deriveTemplateInputs(templateName, headingText, contents, { placeholders: false }) ??
          (block.children?.length || (Array.isArray(provided.nodes) && provided.nodes.length > 0)
            ? { title: headingText }
            : null),
      };
    case 'layout':
    case 'drawing':
      return {
        inputs: block.children && block.children.length > 0 ? { title: headingText } : null,
      };
    case 'barChart':
    case 'columnChart':
    case 'pieChart':
    case 'donutChart':
    case 'lineChart':
    case 'areaChart':
    case 'scatterChart':
    case 'dataTable': {
      const chartInputs =
        deriveTemplateInputs(templateName, headingText, contents, {
          placeholders: false,
        }) ??
        (Array.isArray(provided.headers) && Array.isArray(provided.rows) && provided.rows.length > 0
          ? {}
          : null);
      return {
        inputs: chartInputs,
        ...(chartInputs ? {} : { warning: 'No table found in this block' }),
      };
    }
    case 'list': {
      const inputs =
        deriveTemplateInputs(templateName, headingText, contents, { placeholders: false }) ??
        (Array.isArray(provided.items) && provided.items.length > 0 && provided.items.every(hasText)
          ? {}
          : null);
      return {
        inputs,
        ...(inputs ? {} : { warning: 'No list found in this block' }),
      };
    }
    default:
      return {
        inputs: deriveTemplateInputs(templateName, headingText, contents, { placeholders: false }),
      };
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
  const normalized = raw
    .replace(/[$\u20ac\u00a3\u00a5,%\u2030]/g, '')
    .replace(/,/g, '')
    .trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

function hasTextOrNumber(value: unknown): boolean {
  return hasText(value) || (typeof value === 'number' && Number.isFinite(value));
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasMediaSource(value: unknown): boolean {
  return !!value && typeof value === 'object' && hasText((value as Record<string, unknown>).src);
}

function getHeadingText(block: Block): string {
  if (block.sourceHeading) return extractPlainText(block.sourceHeading).trim();
  return (block.title ?? block.id ?? '').trim();
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}

function trimPreviewText(value: string, max = 72): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

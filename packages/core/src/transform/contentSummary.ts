/** Scoped visual extraction and bounded prose for compact summary styles. */
import type { Block } from '../schemas/Doc.js';
import type { TemplateBlock } from '../schemas/BlockTemplates.js';
import type { HtmlNode, MarkdownBlockNode, MarkdownNode } from '../markdown/types.js';
import { extractPlainText, getChildren } from '../markdown/utils.js';
import { stringifyHtmlNodes } from '../markdown/htmlParse.js';
import { deriveTemplateInputs } from '../doc/templateInputs.js';
import { isAsciiDiagramFence } from '../doc/asciiDiagram/detect.js';
import { isTreeFence } from '../doc/treeview/detect.js';
import { isAsciiTimelineFence } from '../doc/asciiTimeline/detect.js';
import { isContainerTemplate } from '../doc/templates/templateNames.js';
import { coerceTemplateParams } from '../doc/templates/inputDescriptors.js';

const NATIVE_FEATURE_TEMPLATES = new Set([
  'diagram',
  'tree',
  'timeline',
  'map',
  'drawing',
  'layout',
  'dataTable',
  'barChart',
  'columnChart',
  'pieChart',
  'donutChart',
  'lineChart',
  'areaChart',
  'scatterChart',
]);
const VIDEO_FILE_RE = /\.(?:webm|mp4|mov|m4v|ogv)(?:[?#].*)?$/i;
const PROSE_KEYS = new Set([
  'body',
  'subtitle',
  'description',
  'explanation',
  'definition',
  'detail',
  'caption',
  'quote',
  'text',
]);

/** One sentence, at most 24 words / 180 characters, including the ellipsis. */
export function briefText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const sentence = normalized.match(/^.*?[.!?](?:["'”’])?(?=\s|$)/)?.[0] ?? normalized;
  const words = sentence.split(/\s+/).filter(Boolean);
  let brief = words.slice(0, 24).join(' ');
  const truncated = words.length > 24 || brief.length > 180;
  if (brief.length > 179 && truncated) {
    brief = brief
      .slice(0, 179)
      .replace(/\s+\S*$/, '')
      .trimEnd();
  }
  return truncated ? `${brief.replace(/[.,;:!?]+$/, '')}…` : brief;
}

/** Remove HTML prose while retaining media attributes and nested video sources. */
function htmlFeatures(nodes: HtmlNode[]): HtmlNode[] {
  return nodes.flatMap((node): HtmlNode[] => {
    if (node.type !== 'htmlElement') return [];
    const tag = node.tagName.toLowerCase();
    if (tag === 'img') return [node];
    if (tag === 'video') {
      return [
        {
          ...node,
          children: node.children.filter(
            (child) =>
              child.type === 'htmlElement' &&
              ['source', 'track'].includes(child.tagName.toLowerCase()),
          ),
        },
      ];
    }
    return htmlFeatures(node.children);
  });
}

/** Lift nested visuals into top-level body nodes without their surrounding prose. */
export function extractFeatureContents(
  contents: MarkdownBlockNode[] | undefined,
  keepData = false,
): MarkdownBlockNode[] {
  const features: MarkdownBlockNode[] = [];
  const visit = (node: MarkdownNode): void => {
    if (node.type === 'code') {
      if (
        node.lang?.trim().toLowerCase() === 'mermaid' ||
        isAsciiDiagramFence(node) ||
        isTreeFence(node) ||
        isAsciiTimelineFence(node) ||
        (keepData && /^(json|ya?ml)$/i.test(node.lang ?? '') && /\bdata\b/i.test(node.meta ?? ''))
      )
        features.push(node);
      return;
    }
    if (node.type === 'table') {
      if (keepData) features.push(node);
      else for (const child of getChildren(node)) visit(child);
      return;
    }
    if (node.type === 'image' || (node.type === 'link' && VIDEO_FILE_RE.test(node.url))) {
      features.push({ type: 'paragraph', children: [node] });
      return;
    }
    if (node.type === 'htmlBlock' || node.type === 'htmlInline') {
      const htmlChildren = htmlFeatures(node.htmlChildren);
      if (htmlChildren.length) {
        features.push({
          type: 'htmlBlock',
          htmlChildren,
          rawHtml: stringifyHtmlNodes(htmlChildren),
        });
      }
      return;
    }
    for (const child of getChildren(node)) visit(child);
  };
  for (const node of contents ?? []) visit(node);
  return features;
}

function withoutProse<T>(record: Record<string, T> | undefined): Record<string, T> | undefined {
  return (
    record && Object.fromEntries(Object.entries(record).filter(([key]) => !PROSE_KEYS.has(key)))
  );
}

/** Preserve programmatically supplied imagery as well as Markdown body media. */
function typedMediaContents(block: Block): MarkdownBlockNode[] {
  const record: Record<string, unknown> = {
    ...block,
    ...block.templateData,
    ...coerceTemplateParams(block.template ?? '', block.templateOverrides ?? {}).input,
  };
  const contents: MarkdownBlockNode[] = [];
  const addImage = (src: unknown, alt: unknown): void => {
    if (typeof src === 'string' && src) {
      contents.push({
        type: 'paragraph',
        children: [{ type: 'image', url: src, alt: typeof alt === 'string' ? alt : '' }],
      });
    }
  };
  addImage(record.imageSrc, record.imageAlt);
  for (const key of ['accentImage', 'backgroundImage']) {
    const image = record[key];
    if (image && typeof image === 'object') {
      const data = image as Record<string, unknown>;
      addImage(data.src, data.alt);
    }
  }
  if (Array.isArray(record.images)) {
    for (const image of record.images) {
      if (image && typeof image === 'object') {
        const data = image as Record<string, unknown>;
        addImage(data.src, data.alt);
      }
    }
  }
  if (typeof record.videoSrc === 'string' && record.videoSrc) {
    const htmlChildren: HtmlNode[] = [
      {
        type: 'htmlElement',
        tagName: 'video',
        selfClosing: false,
        children: [],
        attributes: {
          src: record.videoSrc,
          ...(typeof record.posterSrc === 'string' ? { poster: record.posterSrc } : {}),
        },
      },
    ];
    contents.push({ type: 'htmlBlock', htmlChildren, rawHtml: stringifyHtmlNodes(htmlChildren) });
  }
  return contents;
}

export function summarizeBlock(block: Block, mode: 'brief' | 'headings-and-features'): Block {
  const title = block.sourceHeading ? extractPlainText(block.sourceHeading) : (block.title ?? '');
  const nativeFeature = NATIVE_FEATURE_TEMPLATES.has(block.template ?? '');
  const authoredTemplate =
    mode === 'headings-and-features' &&
    !!block.template &&
    !block.autoTemplate &&
    (!block.sourceHeading ||
      !!block.sourceHeading.templateAnnotation ||
      !!block.promotedBodyAnnotation);
  const keepTemplate = nativeFeature || authoredTemplate;
  const tableInputs = keepTemplate
    ? null
    : deriveTemplateInputs('dataTable', title, block.contents);
  const featureContents = extractFeatureContents(block.contents, keepTemplate || !!tableInputs);
  const brief =
    mode === 'brief'
      ? briefText(
          (block.contents ?? [])
            .filter((node) => ['paragraph', 'list', 'blockquote'].includes(node.type))
            .map(extractPlainText)
            .join(' '),
        )
      : '';
  const template = keepTemplate
    ? block.template!
    : tableInputs
      ? 'dataTable'
      : brief
        ? 'content'
        : 'sectionHeader';
  const contents: MarkdownBlockNode[] = [
    ...(brief && !nativeFeature && !tableInputs
      ? [{ type: 'paragraph' as const, children: [{ type: 'text' as const, value: brief }] }]
      : []),
    ...featureContents,
    ...typedMediaContents(block),
  ];
  const base: Block & { sourceStartTime: number; sourceDuration: number } = {
    id: block.id,
    startTime: block.startTime,
    duration: block.duration,
    audioSegment: block.audioSegment,
    title,
    template,
    contents,
    summaryMode: mode,
    ...(mode === 'headings-and-features' && !keepTemplate && !tableInputs && contents.length
      ? { summaryLayout: 'feature' as const }
      : {}),
    sourceBlockId: block.id,
    sourceCharOffset: 0,
    sourceStartTime: block.startTime,
    sourceDuration: block.duration,
    transition: block.transition,
    media: block.media,
    ...(block.sourceHeading
      ? { sourceHeading: { ...block.sourceHeading, templateAnnotation: { template } } }
      : {}),
  };
  if (!keepTemplate && !tableInputs) return base;
  // Blank defaults as well as authored prose: deriving template inputs from
  // visual-only contents must not turn image alt text or diagram code into a body.
  const headingInputs = authoredTemplate
    ? {
        body: '',
        subtitle: '',
        description: template === 'statHighlight' ? title : '',
        explanation: '',
        definition: '',
        detail: '',
        ...(template === 'list' ? { items: [] } : {}),
        ...(template === 'imageWithCaption' || template === 'videoWithCaption'
          ? { caption: title }
          : {}),
        ...(template === 'quote' ? { quote: title } : {}),
        ...(template === 'pullQuote' || template === 'fullBleedQuote' ? { text: title } : {}),
      }
    : {};
  return {
    ...(keepTemplate ? withoutProse(block as unknown as Record<string, unknown>) : {}),
    ...base,
    ...headingInputs,
    children: keepTemplate && isContainerTemplate(template) ? block.children : undefined,
    templateData: tableInputs ?? { ...withoutProse(block.templateData), ...headingInputs },
    templateOverrides: keepTemplate
      ? withoutProse(
          template === 'list'
            ? Object.fromEntries(
                Object.entries(block.templateOverrides ?? {}).filter(([key]) => key !== 'items'),
              )
            : block.templateOverrides,
        )
      : undefined,
  };
}

/** Bound promoted highlights too, and keep their source block's media. */
export function summarizeHighlight(block: TemplateBlock, source: Block): TemplateBlock {
  const summary = {
    ...block,
    summaryMode: 'brief' as const,
    contents: [...extractFeatureContents(source.contents), ...typedMediaContents(source)],
    media: source.media,
  };
  if (summary.template === 'quote') return { ...summary, quote: briefText(summary.quote) };
  if (summary.template === 'statHighlight')
    return { ...summary, description: briefText(summary.description), detail: undefined };
  if (summary.template === 'fullBleedQuote' || summary.template === 'pullQuote')
    return { ...summary, text: briefText(summary.text) };
  return summary;
}

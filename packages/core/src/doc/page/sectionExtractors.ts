/**
 * Per-template section extractors — the page analog of the SVG template
 * registry. Each extractor maps one typed template input onto a
 * `PageSection` draft: a section kind, a variant, and filled content slots.
 *
 * Inherently spatial templates (diagram/tree/timeline/map/drawing/layout)
 * become `canvas-embed` drafts that carry the merged template block; the
 * SVG pipeline renders those internally (including their own titles), so
 * canvas drafts deliberately leave the text slots empty.
 *
 * The registry is total over the built-in template registry — a coverage
 * test asserts every registered template id resolves to an extractor.
 */

import type { Block } from '../../schemas/Doc.js';
import type {
  AccentImage,
  ComparisonBarInput,
  ContentBlockInput,
  DataTableInput,
  DateEventInput,
  DefinitionCardInput,
  FactCardInput,
  FullBleedQuoteInput,
  BigTextInput,
  ImageWithCaptionInput,
  LeftFeatureInput,
  ListBlockInput,
  PhotoGridInput,
  PullQuoteInput,
  QuoteBlockInput,
  RightFeatureInput,
  SectionHeaderInput,
  StatHighlightInput,
  TemplateBlock,
  TitleBlockInput,
  TwoColumnInput,
  VideoPullQuoteInput,
  VideoWithCaptionInput,
} from '../../schemas/BlockTemplates.js';
import type { MarkdownBlockNode } from '../../markdown/types.js';
import { extractPlainText } from '../../markdown/utils.js';
import { extractRichListItems } from '../templateInputs.js';
import { buildChartData } from '../templates/chart/parse.js';
import type { PageEmphasis } from '../../schemas/PageStyle.js';
import type { PageMedia, PageRichText, PageSection, PageSpatialKind } from './PageSection.js';

/** Extraction context passed to each extractor. */
export interface PageSectionContext {
  /** The source block (for canvas embeds and ids). */
  block: Block;
  /** Aspect reference for canvas embeds. */
  viewport: { width: number; height: number };
}

/** What an extractor produces before the art-direction pass. */
export interface PageSectionDraft {
  kind: PageSection['kind'];
  variant?: string;
  slots: PageSection['slots'];
  /** Suggested emphasis (default 'standard'); art direction may override. */
  emphasis?: PageEmphasis;
  /** True when the section sits on its own full-bleed media background. */
  mediaBackground?: boolean;
  /** Block-authored color-scheme name — wins over theme accent rotation. */
  colorScheme?: string;
  hints?: Record<string, string | number | boolean>;
}

export type SectionExtractor = (input: TemplateBlock, ctx: PageSectionContext) => PageSectionDraft;

/** Rich text from the merged input's body contents, when it has any. */
function bodyRichText(input: TemplateBlock): PageRichText | undefined {
  const contents = (input as unknown as { contents?: MarkdownBlockNode[] }).contents;
  if (!contents || contents.length === 0) return undefined;
  const text = contents
    .map((node) => extractPlainText(node))
    .join('\n')
    .trim();
  return text ? { text, markdown: contents } : undefined;
}

function accentImageMedia(accent?: AccentImage): PageMedia | undefined {
  if (!accent?.src) return undefined;
  return {
    type: 'image',
    src: accent.src,
    alt: accent.alt ?? '',
    credit: accent.credit,
    license: accent.license,
  };
}

/** Build a canvas-embed draft around the merged template block. */
function canvasDraft(
  spatial: PageSpatialKind,
  ctx: PageSectionContext,
  block?: Block,
): PageSectionDraft {
  return {
    kind: 'canvas-embed',
    variant: spatial,
    slots: {
      media: {
        type: 'canvas',
        spatial,
        block: block ?? ctx.block,
        aspect: { width: ctx.viewport.width, height: ctx.viewport.height },
      },
    },
  };
}

const title: SectionExtractor = (input) => {
  const t = input as TitleBlockInput;
  // The slide template ignores body content (a title card's body only feeds
  // narration), but on a page that text would be silently lost — fall back
  // to the block's first paragraph as the hero subtitle.
  const contents = (input as unknown as { contents?: MarkdownBlockNode[] }).contents;
  const firstParagraph = contents?.find((node) => node.type === 'paragraph');
  const subtitle = t.subtitle ?? (firstParagraph ? extractPlainText(firstParagraph) : undefined);
  return {
    kind: 'hero',
    variant: 'title',
    slots: { title: t.title, subtitle },
    emphasis: 'lead',
    hints: t.backgroundColor ? { backgroundColor: t.backgroundColor } : undefined,
  };
};

const sectionHeader: SectionExtractor = (input) => {
  const s = input as SectionHeaderInput;
  const media: PageMedia | undefined = s.imageSrc
    ? { type: 'image', src: s.imageSrc, alt: s.imageAlt ?? '' }
    : undefined;
  return {
    kind: 'banner',
    slots: { title: s.title, media },
    colorScheme: s.colorScheme,
    mediaBackground: !!s.imageSrc,
  };
};

const bigText: SectionExtractor = (input) => {
  const b = input as BigTextInput;
  const media: PageMedia | undefined = b.imageSrc
    ? { type: 'image', src: b.imageSrc, alt: b.imageAlt ?? '' }
    : undefined;
  // On a page the gigantic slide type reads as a lead hero band; the image
  // variant keeps its full-bleed background. Like the slide, it carries the
  // title alone — body content is narration, not page copy.
  return {
    kind: 'hero',
    variant: media ? 'media' : 'title',
    slots: { title: b.title, media },
    emphasis: 'lead',
    mediaBackground: !!media,
  };
};

const content: SectionExtractor = (input) => {
  const c = input as ContentBlockInput;
  return {
    kind: 'prose',
    slots: { title: c.title, body: bodyRichText(input) },
  };
};

const statHighlight: SectionExtractor = (input) => {
  const s = input as StatHighlightInput;
  return {
    kind: 'stat-band',
    variant: 'single',
    slots: {
      items: [{ value: s.stat, title: s.description, body: s.detail }],
      media: accentImageMedia(s.accentImage),
    },
    emphasis: 'strong',
    colorScheme: s.colorScheme,
  };
};

const quote: SectionExtractor = (input) => {
  const q = input as QuoteBlockInput;
  return {
    kind: 'quote-band',
    variant: 'plain',
    slots: {
      title: q.title,
      body: { text: q.quote ?? '' },
      attribution: q.attribution,
      media: accentImageMedia(q.accentImage),
    },
  };
};

const factCard: SectionExtractor = (input) => {
  const f = input as FactCardInput;
  return {
    kind: 'callout',
    variant: 'fact',
    slots: {
      title: f.fact,
      body: { text: f.explanation ?? '' },
      meta: f.source,
      media: accentImageMedia(f.accentImage),
    },
  };
};

const twoColumn: SectionExtractor = (input) => {
  const t = input as TwoColumnInput;
  return {
    kind: 'card-grid',
    variant: 'two-column',
    slots: {
      title: t.header,
      items: [
        { title: t.left?.label, body: t.left?.sublabel, accentScheme: t.leftColor },
        { title: t.right?.label, body: t.right?.sublabel, accentScheme: t.rightColor },
      ],
    },
  };
};

const dateEvent: SectionExtractor = (input) => {
  const d = input as DateEventInput;
  return {
    kind: 'timeline-rail',
    slots: {
      milestone: {
        date: d.date ?? '',
        description: d.description ?? '',
        footer: d.footer,
        mood: d.mood,
      },
      media: accentImageMedia(d.accentImage),
    },
  };
};

const imageWithCaption: SectionExtractor = (input) => {
  const i = input as ImageWithCaptionInput;
  const media: PageMedia = {
    type: 'image',
    src: i.imageSrc,
    alt: i.imageAlt ?? '',
    credit: i.imageCredit,
    license: i.imageLicense,
  };
  if (i.isTitle) {
    return {
      kind: 'hero',
      variant: 'media',
      slots: { title: i.caption, subtitle: i.subtitle, media },
      emphasis: 'lead',
      mediaBackground: true,
    };
  }
  return {
    kind: 'media-figure',
    variant: 'image',
    slots: { media, caption: i.caption },
  };
};

function featureDraft(
  input: LeftFeatureInput | RightFeatureInput,
  side: 'left' | 'right',
): PageSectionDraft {
  return {
    kind: 'feature-split',
    variant: side === 'left' ? 'media-left' : 'media-right',
    slots: {
      title: input.title,
      body: input.body ? { text: input.body } : undefined,
      media: {
        type: 'image',
        src: input.imageSrc,
        alt: input.imageAlt ?? '',
        width: input.imageWidth,
        height: input.imageHeight,
      },
    },
  };
}

const leftFeature: SectionExtractor = (input) => featureDraft(input as LeftFeatureInput, 'left');
const rightFeature: SectionExtractor = (input) => featureDraft(input as RightFeatureInput, 'right');

const fullBleedQuote: SectionExtractor = (input) => {
  const f = input as FullBleedQuoteInput;
  return {
    kind: 'quote-band',
    variant: 'display',
    slots: { body: { text: f.text ?? '' } },
    emphasis: 'strong',
    colorScheme: f.colorScheme,
  };
};

const list: SectionExtractor = (input) => {
  const l = input as ListBlockInput;
  const contents = (input as unknown as { contents?: MarkdownBlockNode[] }).contents;
  const richItems = extractRichListItems(contents);
  return {
    kind: 'item-list',
    slots: {
      title: l.title,
      items: (l.items ?? []).map((item, index) => ({
        body: item,
        ...(richItems[index]?.text === item ? { markdown: richItems[index].markdown } : {}),
      })),
      media: accentImageMedia(l.accentImage),
    },
    colorScheme: l.colorScheme,
  };
};

const photoGrid: SectionExtractor = (input) => {
  const p = input as PhotoGridInput;
  const images = p.images ?? [];
  // A gallery block whose body has no images yet would render as an empty
  // band — keep the authored heading/body text visible instead.
  const fallback =
    images.length === 0
      ? {
          title: (input as unknown as { title?: string }).title,
          body: bodyRichText(input),
        }
      : undefined;
  return {
    kind: 'gallery',
    slots: {
      ...fallback,
      caption: p.caption,
      items: images.map((img) => ({
        media: {
          type: 'image',
          src: img.src,
          alt: img.alt ?? '',
          credit: img.credit,
          license: img.license,
        } as PageMedia,
      })),
    },
  };
};

const definitionCard: SectionExtractor = (input) => {
  const d = input as DefinitionCardInput;
  return {
    kind: 'callout',
    variant: 'definition',
    slots: {
      title: d.term,
      body: { text: d.definition ?? '' },
      meta: d.origin,
      media: accentImageMedia(d.accentImage),
    },
    colorScheme: d.colorScheme,
  };
};

const comparisonBar: SectionExtractor = (input) => {
  const c = input as ComparisonBarInput;
  return {
    kind: 'stat-band',
    variant: 'comparison',
    slots: {
      items: [
        { title: c.leftLabel, value: c.leftValue },
        { title: c.rightLabel, value: c.rightValue },
      ],
      meta: c.unit,
    },
    emphasis: 'strong',
    colorScheme: c.colorScheme,
  };
};

const pullQuote: SectionExtractor = (input) => {
  const p = input as PullQuoteInput;
  const bg = p.backgroundImage;
  return {
    kind: 'quote-band',
    variant: 'full-bleed',
    slots: {
      body: { text: p.text ?? '' },
      attribution: p.attribution,
      media: bg?.src
        ? { type: 'image', src: bg.src, alt: bg.alt ?? '', credit: bg.credit, license: bg.license }
        : undefined,
    },
    emphasis: 'strong',
    mediaBackground: !!bg?.src,
  };
};

const videoWithCaption: SectionExtractor = (input) => {
  const v = input as VideoWithCaptionInput;
  return {
    kind: 'media-figure',
    variant: 'video',
    slots: {
      media: {
        type: 'video',
        src: v.videoSrc,
        posterSrc: v.posterSrc,
        alt: v.videoAlt ?? '',
        clipStart: v.clipStart,
        clipEnd: v.clipEnd,
        credit: v.videoCredit,
        license: v.videoLicense,
      },
      caption: v.caption,
    },
  };
};

const videoPullQuote: SectionExtractor = (input) => {
  const v = input as VideoPullQuoteInput;
  const bg = v.backgroundVideo;
  return {
    kind: 'quote-band',
    variant: 'full-bleed',
    slots: {
      body: { text: v.text ?? '' },
      attribution: v.attribution,
      media: bg?.src
        ? {
            type: 'video',
            src: bg.src,
            posterSrc: bg.posterSrc,
            alt: bg.alt ?? '',
            clipStart: bg.clipStart,
            clipEnd: bg.clipEnd,
            credit: bg.credit,
            license: bg.license,
          }
        : undefined,
    },
    emphasis: 'strong',
    mediaBackground: !!bg?.src,
  };
};

const dataTable: SectionExtractor = (input) => {
  const d = input as DataTableInput;
  return {
    kind: 'table-section',
    slots: {
      title: d.title,
      table: { headers: d.headers ?? [], rows: d.rows ?? [], align: d.align },
    },
    colorScheme: d.colorScheme,
  };
};

// Charts embed their SVG rendition (same layers as the slide pipeline), so
// page mode and every HTML export show the identical themed chart.
const chartExtractor: SectionExtractor = (input, ctx) => {
  // A chart with no chartable table falls back to a native prose section
  // (mirroring the slide engine's content fallback) instead of embedding a
  // fixed-aspect canvas of prose.
  const chart = input as unknown as {
    headers?: string[];
    rows?: string[][];
    labelColumn?: string;
    valueColumns?: string[];
  };
  const chartable =
    Array.isArray(chart.headers) &&
    Array.isArray(chart.rows) &&
    buildChartData({ headers: chart.headers, rows: chart.rows }, chart) !== null;
  if (chartable) return canvasDraft('chart', ctx, input as unknown as Block);
  return content(input, ctx);
};

const diagram: SectionExtractor = (input, ctx) =>
  canvasDraft('diagram', ctx, input as unknown as Block);
const tree: SectionExtractor = (input, ctx) => canvasDraft('tree', ctx, input as unknown as Block);
const timeline: SectionExtractor = (input, ctx) =>
  canvasDraft('timeline', ctx, input as unknown as Block);
const map: SectionExtractor = (input, ctx) => canvasDraft('map', ctx, input as unknown as Block);
const drawing: SectionExtractor = (input, ctx) =>
  canvasDraft('drawing', ctx, input as unknown as Block);
const layout: SectionExtractor = (input, ctx) =>
  canvasDraft('layout', ctx, input as unknown as Block);

/**
 * Extractors keyed by canonical template id — 1:1 with the SVG template
 * registry (`templates/registry.ts`).
 */
export const sectionExtractors: Record<string, SectionExtractor> = {
  title,
  sectionHeader,
  bigText,
  content,
  statHighlight,
  quote,
  factCard,
  twoColumn,
  dateEvent,
  imageWithCaption,
  leftFeature,
  rightFeature,
  map,
  fullBleedQuote,
  list,
  photoGrid,
  definitionCard,
  comparisonBar,
  pullQuote,
  videoWithCaption,
  videoPullQuote,
  dataTable,
  barChart: chartExtractor,
  columnChart: chartExtractor,
  pieChart: chartExtractor,
  donutChart: chartExtractor,
  lineChart: chartExtractor,
  areaChart: chartExtractor,
  scatterChart: chartExtractor,
  diagram,
  tree,
  timeline,
  layout,
  drawing,
};

/**
 * PPTX Export
 *
 * Converts a squisq MarkdownDocument (or Doc) into a .pptx file
 * by generating PresentationML + DrawingML XML and assembling the
 * OOXML package.
 *
 * Slide segmentation: each H1 or H2 heading starts a new slide.
 * The heading becomes the slide title; content below becomes the body.
 *
 * Supports:
 * - Theme-based styling (background, text colors, fonts from squisq themes)
 * - Image embedding (pass images as ArrayBuffers via options)
 * - Inline formatting (bold, italic, strikethrough, code, links)
 * - Lists, code blocks, blockquotes, tables, math
 *
 * No third-party pptx library — all XML is generated directly using
 * the shared ooxml/ infrastructure.
 *
 * @example
 * ```ts
 * import { parseMarkdown } from '@bendyline/squisq/markdown';
 * import { markdownDocToPptx } from '@bendyline/squisq-formats/pptx';
 *
 * const md = parseMarkdown('# Slide 1\n\nHello world\n\n## Slide 2\n\nMore content');
 * const blob = await markdownDocToPptx(md, { themeId: 'documentary' });
 * ```
 */

import type {
  Block,
  Doc,
  Layer,
  PathLayer,
  Position,
  ShapeLayer,
  TableLayer,
  TextLayer,
  TextStyle,
  Transition,
  TransitionDirection,
  TreeLayerItem,
} from '@bendyline/squisq/schemas';
import { resolveFontFamily, VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import type { Theme, ThemeRegistry } from '@bendyline/squisq/schemas';
import {
  createTemplateContext,
  docToMarkdown,
  expandCoverBlock,
  expandDocBlocks,
  flattenRenderableBlocks,
  isTemplateBlock,
  resolvePersistentLayers,
  resolveThemeForDoc,
} from '@bendyline/squisq/doc';
import { stripIconMarkers } from '@bendyline/squisq/icon-marker';
import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownHeading,
  MarkdownParagraph,
  MarkdownBlockquote,
  MarkdownList,
  MarkdownListItem,
  MarkdownCodeBlock,
  MarkdownTable,
  MarkdownTableRow,
  MarkdownHtmlBlock,
  MarkdownMathBlock,
  MarkdownLink,
  MarkdownImage,
} from '@bendyline/squisq/markdown';
import { readFrontmatterThemeId } from '@bendyline/squisq/markdown';

import { createPackage } from '../ooxml/writer.js';
import { RelIdAllocator } from '../ooxml/relIds.js';
import { xmlDeclaration, escapeXml } from '../ooxml/xmlUtils.js';
import { inferMimeType } from '../html/imageUtils.js';
import { stripHtmlTags, extractPlainText } from '../shared/text.js';
import { toOoxmlHex } from '../shared/ooxmlColor.js';
import { sanitizeOfficeHyperlink } from '../shared/officeHyperlinks.js';
import {
  inlineNodesToRuns,
  inlineNodeToRuns,
  type InlineRunHandlers,
} from '../shared/inlineRuns.js';
import {
  NS_PML,
  NS_PML_2010,
  NS_DRAWINGML,
  NS_MC,
  NS_R,
  REL_OFFICE_DOCUMENT,
  REL_SLIDE,
  REL_SLIDE_LAYOUT,
  REL_SLIDE_MASTER,
  REL_THEME,
  REL_HYPERLINK,
  REL_IMAGE,
  CONTENT_TYPE_PPTX_PRESENTATION,
  CONTENT_TYPE_PPTX_SLIDE,
  CONTENT_TYPE_PPTX_SLIDE_LAYOUT,
  CONTENT_TYPE_PPTX_SLIDE_MASTER,
  CONTENT_TYPE_PPTX_THEME,
} from '../ooxml/namespaces.js';
import {
  DEFAULT_FONT,
  DEFAULT_TITLE_FONT,
  DEFAULT_CODE_FONT,
  DEFAULT_TITLE_SIZE,
  DEFAULT_CODE_SIZE,
  HYPERLINK_COLOR,
  TITLE_LEFT,
  TITLE_TOP,
  TITLE_WIDTH,
  TITLE_HEIGHT,
  BODY_LEFT,
  BODY_TOP,
  BODY_WIDTH,
  BODY_HEIGHT,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
} from './styles.js';
import {
  buildPresentationXml,
  buildSlideMasterXml,
  buildSlideLayoutXml,
  buildThemeXml,
} from './templates.js';

// ============================================
// Public API
// ============================================

/**
 * Options for PPTX export.
 */
export interface PptxExportOptions {
  /** Cancel at bounded export checkpoints. */
  signal?: AbortSignal;
  /** Presentation title (appears in core properties) */
  title?: string;
  /** Presentation author */
  author?: string;
  /** Presentation description */
  description?: string;
  /**
   * Which heading depth triggers a new slide.
   * - `'h1'` — only H1 headings start slides
   * - `'h2'` — H1 and H2 headings start slides (default)
   * - `'heading'` — any heading (H1–H6) starts a slide
   */
  slideBreak?: 'h1' | 'h2' | 'heading';
  /** Default body font family. Default: "Calibri" */
  defaultFont?: string;
  /** Default body font size in points. Default: 18 */
  defaultFontSize?: number;
  /**
   * Squisq theme ID to apply (e.g., 'documentary', 'cinematic', 'bold').
   * Controls slide background, text colors, and fonts.
   * Falls back to the document's frontmatter `themeId` if not set here.
   */
  themeId?: string;
  /** Explicit caller-owned registry for non-document custom themes. */
  themeRegistry?: ThemeRegistry;
  /**
   * Image data keyed by the path/URL used in markdown.
   * When provided, images are embedded as picture shapes instead of
   * showing `[Image: alt]` placeholders.
   */
  images?: Map<string, ArrayBuffer>;
  /** Permit carefully validated relative hyperlink targets. Default: false. */
  allowRelativeHyperlinks?: boolean;
  /**
   * Include the Doc's managed cover (`startBlock`) as slide 1. Defaults to
   * the document's `squisq-cover-slide` / `cover-slide` setting, then true.
   * MarkdownDocument export is unaffected because it has no managed cover.
   */
  includeCoverSlide?: boolean;
}

/**
 * Convert a MarkdownDocument to a .pptx ArrayBuffer.
 */
export async function markdownDocToPptx(
  doc: MarkdownDocument,
  options: PptxExportOptions = {},
): Promise<ArrayBuffer> {
  options.signal?.throwIfAborted();
  // Resolve theme from options or frontmatter. The frontmatter lookup
  // accepts the editor's canonical `squisq-theme` key as well as the
  // shorter legacy `themeId` / `theme` aliases — see
  // `readFrontmatterThemeId` for the precedence.
  const themeId = options.themeId ?? readFrontmatterThemeId(doc.frontmatter);
  const style = resolveSlideStyle(themeId, options, doc);

  const slides = segmentIntoSlides(doc.children, options.slideBreak ?? 'h2');

  // Ensure at least one slide
  if (slides.length === 0) {
    slides.push({ bodyNodes: [] });
  }

  const slideXmls: string[] = [];
  const slideContexts: SlideContext[] = [];

  for (let i = 0; i < slides.length; i++) {
    if ((i & 31) === 0) options.signal?.throwIfAborted();
    const ctx = new SlideContext(
      style,
      options.images,
      i,
      options.allowRelativeHyperlinks ?? false,
      options.signal,
    );
    const xml = buildSlideXml(slides[i], ctx);
    slideXmls.push(xml);
    slideContexts.push(ctx);
  }

  return buildPptxPackage(slideXmls, slideContexts, options);
}

/**
 * Convert a squisq Doc to a .pptx ArrayBuffer.
 *
 * Template-backed Docs are exported through the same canonical slideshow
 * expansion as the player, then their materialized visual layers are mapped
 * to native DrawingML shapes. Plain, non-template Docs retain the semantic
 * Markdown export path for backward compatibility.
 */
export async function docToPptx(doc: Doc, options: PptxExportOptions = {}): Promise<ArrayBuffer> {
  options.signal?.throwIfAborted();
  const effectiveOptions =
    !options.themeId && doc.themeId ? { ...options, themeId: doc.themeId } : options;
  const flatBlocks = flattenRenderableBlocks(doc.blocks);

  // A plain Markdown-derived Doc has no fully-specified template inputs.
  // Preserve the established semantic exporter for that shape. Player-ready
  // Docs (including buildPreviewDoc/applyTransform output) take the visual path.
  if (!flatBlocks.some(isTemplateBlock)) {
    return markdownDocToPptx(docToMarkdown(doc), effectiveOptions);
  }

  const theme = resolveThemeForDoc(doc, effectiveOptions.themeId, effectiveOptions.themeRegistry);
  const style = slideStyleFromTheme(theme, effectiveOptions);
  const audioSegments = doc.audio?.segments?.map((segment) => ({
    startTime: segment.startTime,
    duration: segment.duration,
  }));
  const persistentLayers = resolvePersistentLayers(
    { persistentLayers: doc.persistentLayers },
    theme,
  );
  const expanded = expandDocBlocks(flatBlocks, {
    audioSegments,
    viewport: VIEWPORT_PRESETS.landscape,
    persistentLayers,
    theme,
    customTemplates: doc.customTemplates,
  });

  const slideBlocks: Block[] = [];
  if (shouldIncludeCoverSlide(doc, effectiveOptions) && doc.startBlock) {
    const coverContext = createTemplateContext(
      theme,
      0,
      Math.max(1, expanded.length + 1),
      VIEWPORT_PRESETS.landscape,
    );
    slideBlocks.push({
      id: 'cover-block',
      startTime: -1,
      duration: 0,
      audioSegment: -1,
      layers: expandCoverBlock(doc.startBlock, coverContext),
    });
  }
  slideBlocks.push(...expanded);

  // The OOXML package contract always contains at least one slide.
  if (slideBlocks.length === 0) {
    slideBlocks.push({ id: 'empty-slide', startTime: 0, duration: 0, audioSegment: 0, layers: [] });
  }

  const slideXmls: string[] = [];
  const slideContexts: SlideContext[] = [];
  for (let index = 0; index < slideBlocks.length; index++) {
    if ((index & 31) === 0) effectiveOptions.signal?.throwIfAborted();
    const ctx = new SlideContext(
      style,
      effectiveOptions.images,
      index,
      effectiveOptions.allowRelativeHyperlinks ?? false,
      effectiveOptions.signal,
    );
    slideXmls.push(buildLayerSlideXml(slideBlocks[index], ctx));
    slideContexts.push(ctx);
  }

  return buildPptxPackage(slideXmls, slideContexts, effectiveOptions);
}

// ============================================
// Resolved Style
// ============================================

/** Resolved visual style for slides, derived from a Theme or defaults. */
interface SlideStyle {
  background: string; // hex without #
  text: string;
  titleColor: string;
  mutedColor: string;
  titleFont: string;
  bodyFont: string;
  codeFont: string;
  codeColor: string;
  hasTheme: boolean;
}

/** DrawingML accepts one typeface, not a CSS fallback stack. */
function officeTypeface(family: Parameters<typeof resolveFontFamily>[0], fallback: string): string {
  const resolved = resolveFontFamily(family, fallback);
  const first = resolved
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  return first || fallback;
}

function resolveSlideStyle(
  themeId: string | undefined,
  options: PptxExportOptions,
  doc: MarkdownDocument,
): SlideStyle {
  if (!themeId) {
    return {
      background: 'FFFFFF',
      text: '333333',
      titleColor: '333333',
      mutedColor: '666666',
      titleFont: options.defaultFont ?? DEFAULT_TITLE_FONT,
      bodyFont: options.defaultFont ?? DEFAULT_FONT,
      codeFont: DEFAULT_CODE_FONT,
      codeColor: '333333',
      hasTheme: false,
    };
  }

  const theme: Theme = resolveThemeForDoc(doc, themeId, options.themeRegistry);
  return slideStyleFromTheme(theme, options);
}

function slideStyleFromTheme(theme: Theme, options: PptxExportOptions): SlideStyle {
  const c = theme.colors;

  // Normalize at the boundary: `ST_HexColorRGB` (`<a:srgbClr val>`) is
  // exactly six hex digits, but a valid theme may carry `#rgb` shorthand
  // and a programmatic Doc's `customThemes` skip validation entirely — so
  // an arbitrary string can reach here. Unparseable colors fall back to the
  // same neutral defaults the unthemed branch above uses.
  return {
    background: toOoxmlHex(c.background, 'FFFFFF'),
    text: toOoxmlHex(c.text, '333333'),
    titleColor: toOoxmlHex(c.highlight || c.secondary || c.text, '333333'),
    mutedColor: toOoxmlHex(c.textMuted || c.text, '666666'),
    titleFont: officeTypeface(theme.typography?.titleFont, DEFAULT_TITLE_FONT),
    bodyFont: officeTypeface(theme.typography?.bodyFont, options.defaultFont || DEFAULT_FONT),
    codeFont: officeTypeface(theme.typography?.monoFont, DEFAULT_CODE_FONT),
    codeColor: toOoxmlHex(c.textMuted || c.text, '333333'),
    hasTheme: true,
  };
}

function shouldIncludeCoverSlide(doc: Doc, options: PptxExportOptions): boolean {
  if (options.includeCoverSlide !== undefined) return options.includeCoverSlide;
  const frontmatterValue =
    doc.frontmatter?.['squisq-cover-slide'] ?? doc.frontmatter?.['cover-slide'];
  if (typeof frontmatterValue === 'boolean') return frontmatterValue;
  if (typeof frontmatterValue === 'string') {
    const normalized = frontmatterValue.trim().toLowerCase();
    if (
      normalized === 'false' ||
      normalized === 'no' ||
      normalized === 'off' ||
      normalized === '0'
    ) {
      return false;
    }
    if (
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'on' ||
      normalized === '1'
    ) {
      return true;
    }
  }
  return true;
}

// ============================================
// Slide Segmentation
// ============================================

interface SlideData {
  title?: string;
  titleDepth?: number;
  transition?: Transition;
  bodyNodes: MarkdownBlockNode[];
}

function segmentIntoSlides(
  children: MarkdownBlockNode[],
  slideBreak: 'h1' | 'h2' | 'heading',
): SlideData[] {
  const maxDepth = slideBreak === 'h1' ? 1 : slideBreak === 'h2' ? 2 : 6;
  const slides: SlideData[] = [];
  let current: SlideData | undefined;

  for (const node of children) {
    if (node.type === 'heading' && node.depth <= maxDepth) {
      if (current) slides.push(current);
      current = {
        title: extractPlainText(node.children),
        titleDepth: node.depth,
        transition: node.attributes?.blockMeta?.transition,
        bodyNodes: [],
      };
    } else {
      if (!current) {
        current = { bodyNodes: [] };
      }
      current.bodyNodes.push(node);
    }
  }

  if (current) slides.push(current);
  return slides;
}

// ============================================
// Slide Context
// ============================================

interface EmbeddedImage {
  relId: string;
  mediaPath: string; // e.g. ppt/media/image_s0_1.png
  data: ArrayBuffer;
  contentType: string;
  alt: string;
}

class SlideContext {
  /**
   * One id source for this slide's rels part — see `RelIdAllocator`. There is
   * exactly one SlideContext per `ppt/slides/slideN.xml`, and EVERY rel on
   * that part (layout, hyperlinks, images) is allocated here, so duplicate
   * `Id`s are impossible by construction.
   */
  private readonly relIds = new RelIdAllocator();

  readonly relationships: Array<{
    id: string;
    type: string;
    target: string;
    targetMode?: 'External';
  }> = [];

  readonly style: SlideStyle;
  readonly images: Map<string, ArrayBuffer> | undefined;
  readonly slideIndex: number;
  readonly embeddedImages: EmbeddedImage[] = [];
  private nextShapeId = 4; // 1=group, 2=title, 3=body
  private readonly allowRelativeHyperlinks: boolean;
  readonly signal: AbortSignal | undefined;

  constructor(
    style: SlideStyle,
    images: Map<string, ArrayBuffer> | undefined,
    slideIndex: number,
    allowRelativeHyperlinks: boolean,
    signal?: AbortSignal,
  ) {
    this.style = style;
    this.images = images;
    this.slideIndex = slideIndex;
    this.allowRelativeHyperlinks = allowRelativeHyperlinks;
    this.signal = signal;
    // Every slide relates to the shared layout. Allocate it from this slide's
    // own counter (first, so it keeps the conventional rId1) rather than
    // hardcoding an id in the package builder alongside a separate counter —
    // that split is exactly what let fixed and dynamic rels collide.
    this.relationships.push({
      id: this.allocRelId(),
      type: REL_SLIDE_LAYOUT,
      target: '../slideLayouts/slideLayout1.xml',
    });
  }

  allocRelId(): string {
    return this.relIds.alloc();
  }

  allocShapeId(): number {
    return this.nextShapeId++;
  }

  addHyperlink(url: string): string | null {
    const target = sanitizeOfficeHyperlink(url, {
      allowRelative: this.allowRelativeHyperlinks,
    });
    if (!target) return null;
    const id = this.allocRelId();
    this.relationships.push({
      id,
      type: REL_HYPERLINK,
      target,
      targetMode: 'External',
    });
    return id;
  }

  /** Register an embedded image and return its relationship ID */
  addImage(src: string, data: ArrayBuffer, alt: string): string {
    const relId = this.allocRelId();
    const ext = inferExtension(src);
    const contentType = inferMimeType(ext);
    const imgIndex = this.embeddedImages.length + 1;
    const mediaPath = `ppt/media/image_s${this.slideIndex}_${imgIndex}.${ext}`;

    this.embeddedImages.push({ relId, mediaPath, data, contentType, alt });
    this.relationships.push({
      id: relId,
      type: REL_IMAGE,
      target: `../media/image_s${this.slideIndex}_${imgIndex}.${ext}`,
    });

    return relId;
  }
}

// ============================================
// Slide XML Generation
// ============================================

function buildSlideXml(slide: SlideData, ctx: SlideContext): string {
  const shapes: string[] = [];

  shapes.push(
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` + `<p:grpSpPr/>`,
  );

  if (slide.title) {
    shapes.push(buildTitleShape(slide.title, ctx.style));
  }

  // Convert body blocks and collect any image-only paragraphs
  const bodyParas = convertBodyBlocks(slide.bodyNodes, ctx);
  const hasImages = ctx.embeddedImages.length > 0;
  const hasText = bodyParas.length > 0;

  if (hasText && hasImages) {
    // Split: text in top half of body area, images below
    const textHeight = Math.round(BODY_HEIGHT * 0.45);
    const imgTop = BODY_TOP + textHeight + 91440; // 0.1" gap
    const imgHeight = BODY_HEIGHT - textHeight - 91440;
    shapes.push(buildBodyShapeCustom(bodyParas, BODY_TOP, textHeight, ctx.style));
    shapes.push(
      buildImageShape(
        ctx.embeddedImages[0],
        ctx.allocShapeId(),
        BODY_LEFT,
        imgTop,
        BODY_WIDTH,
        imgHeight,
      ),
    );
  } else if (hasImages && !hasText) {
    // Full content area for image
    shapes.push(
      buildImageShape(
        ctx.embeddedImages[0],
        ctx.allocShapeId(),
        BODY_LEFT,
        BODY_TOP,
        BODY_WIDTH,
        BODY_HEIGHT,
      ),
    );
  } else {
    // Text only (or empty)
    shapes.push(
      buildBodyShapeCustom(
        bodyParas || `<a:p><a:endParaRPr lang="en-US"/></a:p>`,
        BODY_TOP,
        BODY_HEIGHT,
        ctx.style,
      ),
    );
  }

  // Additional images beyond the first get placed as extra shapes
  for (let i = 1; i < ctx.embeddedImages.length; i++) {
    shapes.push(
      buildImageShape(
        ctx.embeddedImages[i],
        ctx.allocShapeId(),
        BODY_LEFT,
        BODY_TOP,
        BODY_WIDTH,
        BODY_HEIGHT,
      ),
    );
  }

  // Build background
  const bgXml = ctx.style.hasTheme
    ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${ctx.style.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
    : '';
  const transitionXml = buildTransitionXml(slide.transition);
  const extensionAttrs = transitionXml.includes('p14:')
    ? ` xmlns:mc="${NS_MC}" xmlns:p14="${NS_PML_2010}" mc:Ignorable="p14"`
    : '';

  return (
    xmlDeclaration() +
    `<p:sld xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}"${extensionAttrs}>` +
    `<p:cSld>` +
    bgXml +
    `<p:spTree>` +
    shapes.join('') +
    `</p:spTree>` +
    `</p:cSld>` +
    transitionXml +
    `</p:sld>`
  );
}

/** Build a slide from the exact materialized layer stack used by DocPlayer. */
function buildLayerSlideXml(block: Block, ctx: SlideContext): string {
  const shapes: string[] = [
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` + `<p:grpSpPr/>`,
  ];

  const textLayerY = (block.layers ?? [])
    .filter((layer): layer is TextLayer => layer.type === 'text')
    .map((layer) => resolvePositionValue(layer.position.y, 1080));

  for (let index = 0; index < (block.layers?.length ?? 0); index++) {
    if ((index & 31) === 0) ctx.signal?.throwIfAborted();
    const layer = block.layers![index];
    const currentY =
      layer.type === 'text' ? resolvePositionValue(layer.position.y, 1080) : undefined;
    const nextTextY =
      currentY === undefined
        ? undefined
        : textLayerY.filter((candidate) => candidate > currentY + 1).sort((a, b) => a - b)[0];
    shapes.push(
      ...convertLayerToShapes(
        layer,
        ctx,
        nextTextY === undefined || currentY === undefined
          ? undefined
          : Math.max(currentY + 1, nextTextY - 8),
      ),
    );
  }

  const bgXml = ctx.style.hasTheme
    ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${ctx.style.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
    : '';
  const transitionXml = buildTransitionXml(block.transition);
  const extensionAttrs = transitionXml.includes('p14:')
    ? ` xmlns:mc="${NS_MC}" xmlns:p14="${NS_PML_2010}" mc:Ignorable="p14"`
    : '';

  return (
    xmlDeclaration() +
    `<p:sld xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}"${extensionAttrs}>` +
    `<p:cSld>${bgXml}<p:spTree>${shapes.join('')}</p:spTree></p:cSld>` +
    transitionXml +
    `</p:sld>`
  );
}

function convertLayerToShapes(layer: Layer, ctx: SlideContext, textBottom?: number): string[] {
  switch (layer.type) {
    case 'text':
      return [buildLayerTextShape(layer, ctx.allocShapeId(), textBottom)];
    case 'shape':
      return [buildLayerShape(layer, ctx.allocShapeId())];
    case 'image': {
      const data = ctx.images?.get(layer.content.src);
      if (data) {
        const image = ctx.addImage(layer.content.src, data, layer.content.alt);
        const rect = toEmuRect(resolveLayerRect(layer.position, 1920, 1080));
        const embedded = ctx.embeddedImages.find((candidate) => candidate.relId === image)!;
        return [
          buildImageShape(embedded, ctx.allocShapeId(), rect.x, rect.y, rect.width, rect.height),
        ];
      }
      return [
        buildLayerTextShape(
          textLayerForPlaceholder(
            layer.position,
            `[Image: ${layer.content.alt || layer.content.src}]`,
            ctx,
          ),
          ctx.allocShapeId(),
        ),
      ];
    }
    case 'table':
      return buildTableLayerShapes(layer, ctx);
    case 'tree':
      return [
        buildLayerTextShape(
          {
            ...layer,
            type: 'text',
            content: {
              text: treeItemsToText(layer.content.items),
              style: {
                fontSize: layer.content.style.fontSize,
                fontFamily: layer.content.style.fontFamily,
                color: layer.content.style.rowColor,
                lineHeight: 1.35,
              },
            },
          },
          ctx.allocShapeId(),
        ),
      ];
    case 'path':
      return buildPathLayerShapes(layer, ctx);
    case 'map': {
      const staticSrc = layer.content.staticSrc;
      const data = staticSrc ? ctx.images?.get(staticSrc) : undefined;
      if (staticSrc && data) {
        const relId = ctx.addImage(staticSrc, data, 'Map');
        const embedded = ctx.embeddedImages.find((candidate) => candidate.relId === relId)!;
        const rect = toEmuRect(resolveLayerRect(layer.position, 1920, 1080));
        return [
          buildImageShape(embedded, ctx.allocShapeId(), rect.x, rect.y, rect.width, rect.height),
        ];
      }
      return [
        buildLayerTextShape(
          textLayerForPlaceholder(
            layer.position,
            `Map: ${layer.content.center.lat.toFixed(4)}, ${layer.content.center.lng.toFixed(4)}`,
            ctx,
          ),
          ctx.allocShapeId(),
        ),
      ];
    }
    case 'video': {
      const poster = layer.content.posterSrc;
      const data = poster ? ctx.images?.get(poster) : undefined;
      if (poster && data) {
        const relId = ctx.addImage(poster, data, layer.content.alt);
        const embedded = ctx.embeddedImages.find((candidate) => candidate.relId === relId)!;
        const rect = toEmuRect(resolveLayerRect(layer.position, 1920, 1080));
        return [
          buildImageShape(embedded, ctx.allocShapeId(), rect.x, rect.y, rect.width, rect.height),
        ];
      }
      return [
        buildLayerTextShape(
          textLayerForPlaceholder(
            layer.position,
            `[Video: ${layer.content.alt || layer.content.src}]`,
            ctx,
          ),
          ctx.allocShapeId(),
        ),
      ];
    }
    case 'mermaid':
      return [
        buildLayerTextShape(
          textLayerForPlaceholder(layer.position, layer.content.source, ctx),
          ctx.allocShapeId(),
        ),
      ];
  }
}

interface LayerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EmuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function resolvePositionValue(value: number | string | undefined, dimension: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.endsWith('%')) {
      const percent = Number.parseFloat(trimmed);
      if (Number.isFinite(percent)) return (percent / 100) * dimension;
    }
    const numeric = Number.parseFloat(trimmed);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function resolveLayerRect(
  position: Position,
  defaultWidth: number,
  defaultHeight: number,
): LayerRect {
  const width = Math.max(
    1,
    position.width != null ? resolvePositionValue(position.width, 1920) : defaultWidth,
  );
  const height = Math.max(
    1,
    position.height != null ? resolvePositionValue(position.height, 1080) : defaultHeight,
  );
  let x = resolvePositionValue(position.x, 1920);
  let y = resolvePositionValue(position.y, 1080);
  const anchor = position.anchor ?? 'top-left';
  if (anchor === 'center') {
    x -= width / 2;
    y -= height / 2;
  } else {
    if (anchor.endsWith('right')) x -= width;
    if (anchor.startsWith('bottom')) y -= height;
  }
  // BlockRenderer clips the complete layer stack to the 1920x1080 viewBox.
  // Native PowerPoint shapes are not implicitly clipped, so trim their boxes
  // to that same canvas instead of letting long text create off-slide content.
  const clippedX = Math.min(1919, Math.max(0, x));
  const clippedY = Math.min(1079, Math.max(0, y));
  const clippedWidth = Math.max(1, Math.min(width - (clippedX - x), 1920 - clippedX));
  const clippedHeight = Math.max(1, Math.min(height - (clippedY - y), 1080 - clippedY));
  return { x: clippedX, y: clippedY, width: clippedWidth, height: clippedHeight };
}

function toEmuRect(rect: LayerRect): EmuRect {
  return {
    x: Math.round((rect.x / 1920) * SLIDE_WIDTH),
    y: Math.round((rect.y / 1080) * SLIDE_HEIGHT),
    width: Math.max(1, Math.round((rect.width / 1920) * SLIDE_WIDTH)),
    height: Math.max(1, Math.round((rect.height / 1080) * SLIDE_HEIGHT)),
  };
}

function buildLayerTextShape(layer: TextLayer, shapeId: number, maxBottom?: number): string {
  const text = stripIconMarkers(layer.content.text ?? '');
  const style = layer.content.style;
  const padding = style.padding ?? 0;
  const rawLines = text.split('\n');
  const estimatedWidth = Math.min(
    1920,
    Math.max(1, Math.max(...rawLines.map((line) => line.length), 1) * style.fontSize * 0.55),
  );
  const boxWidth =
    layer.position.width != null
      ? resolvePositionValue(layer.position.width, 1920)
      : estimatedWidth;
  // Large one-line display titles are authored to remain on one line in the
  // SVG player. Office font metrics are wider than the player's lightweight
  // wrap estimate, so cap those titles before PowerPoint introduces a second
  // line that collides with the next layer.
  const fittedFontSize =
    rawLines.length === 1 && style.fontSize >= 80 && text.length > 0
      ? Math.min(style.fontSize, boxWidth / (text.length * 0.78))
      : style.fontSize;
  const charsPerLine = Math.max(1, Math.floor(boxWidth / Math.max(1, fittedFontSize * 0.58)));
  const wrappedLineCount = Math.max(
    1,
    rawLines.reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charsPerLine)), 0),
  );
  // DrawingML's no-autofit text layout needs more vertical room than the
  // nominal line spacing, especially for substituted serif/display fonts.
  // Without this font-metric reserve PowerPoint clips the lower half of
  // large template titles and subtitles at the shape boundary.
  const officeFontMetricSlack = fittedFontSize * 0.8;
  const estimatedHeight = Math.max(
    fittedFontSize * (style.lineHeight ?? 1.4) * wrappedLineCount +
      officeFontMetricSlack +
      padding * 2,
    fittedFontSize + officeFontMetricSlack + padding * 2,
  );
  const resolvedRect = resolveLayerRect(layer.position, boxWidth, estimatedHeight);
  // Leave a small bottom inset for Office/LibreOffice glyph descenders and
  // antialiasing. The SVG player clips exactly at 1080; rasterizers otherwise
  // report a one-pixel bleed even when the text box itself ends on-canvas.
  const safeBottom = Math.min(1060, maxBottom ?? 1060);
  const virtualRect = {
    ...resolvedRect,
    y: Math.min(resolvedRect.y, safeBottom - 1),
    height: Math.max(1, Math.min(resolvedRect.height, safeBottom - resolvedRect.y)),
  };
  const heightScale = Math.min(1, virtualRect.height / estimatedHeight);
  const renderedFontSize = Math.max(1, fittedFontSize * heightScale * (heightScale < 1 ? 0.9 : 1));
  const renderedStyle =
    renderedFontSize === style.fontSize ? style : { ...style, fontSize: renderedFontSize };
  const rect = toEmuRect(virtualRect);
  const align = style.textAlign === 'center' ? 'ctr' : style.textAlign === 'right' ? 'r' : 'l';
  const vertical =
    style.verticalAlign === 'bottom' ? 'b' : style.verticalAlign === 'middle' ? 'ctr' : 't';
  const inset = Math.max(0, Math.round((padding / 1920) * SLIDE_WIDTH));
  const bodyPr =
    `<a:bodyPr wrap="square" anchor="${vertical}" vertOverflow="clip" horzOverflow="clip"` +
    ` lIns="${inset}" rIns="${inset}" tIns="${inset}" bIns="${inset}">` +
    `<a:noAutofit/></a:bodyPr>`;
  const paragraphs = text
    .split('\n')
    .map((line) => buildLayerTextParagraph(line, renderedStyle, align))
    .join('');

  return (
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(layer.id)}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${rect.x}" y="${rect.y}"/>` +
    `<a:ext cx="${rect.width}" cy="${rect.height}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    fillXml(style.background, style.backgroundOpacity, style.backgroundGradient) +
    lineXml(style.borderColor, style.borderWidth, style.borderStyle) +
    `</p:spPr>` +
    `<p:txBody>${bodyPr}<a:lstStyle/>${paragraphs}</p:txBody>` +
    `</p:sp>`
  );
}

function buildLayerTextParagraph(text: string, style: TextStyle, align: string): string {
  const size = Math.max(100, Math.round(style.fontSize * 75));
  const color = parseCssColor(style.color, '000000');
  const typeface = officeTypeface(style.fontFamily, DEFAULT_FONT);
  const runProperties = [
    `lang="en-US"`,
    `dirty="0"`,
    `sz="${size}"`,
    ...(style.fontWeight === 'bold' ? ['b="1"'] : []),
    ...(style.fontStyle === 'italic' ? ['i="1"'] : []),
  ].join(' ');
  const lineSpacing = Math.max(10000, Math.round((style.lineHeight ?? 1.4) * 100000));
  return (
    `<a:p><a:pPr algn="${align}"><a:lnSpc><a:spcPct val="${lineSpacing}"/></a:lnSpc></a:pPr>` +
    `<a:r><a:rPr ${runProperties}>${solidColorXml(color)}` +
    `<a:latin typeface="${escapeXml(typeface)}"/></a:rPr>` +
    `<a:t>${escapeXml(text || ' ')}</a:t></a:r></a:p>`
  );
}

function buildLayerShape(layer: ShapeLayer, shapeId: number): string {
  const rect = toEmuRect(resolveLayerRect(layer.position, 100, 100));
  const geometry =
    layer.content.shape === 'circle'
      ? 'ellipse'
      : layer.content.shape === 'line'
        ? 'line'
        : layer.content.borderRadius
          ? 'roundRect'
          : 'rect';
  const fill =
    layer.content.shape === 'line'
      ? '<a:noFill/>'
      : fillXml(layer.content.fill, layer.content.fillOpacity, layer.content.gradient);
  const stroke = lineXml(
    layer.content.stroke ?? (layer.content.shape === 'line' ? '#ffffff' : undefined),
    layer.content.strokeWidth ?? (layer.content.shape === 'line' ? 2 : undefined),
    layer.content.borderStyle,
  );
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(layer.id)}"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${rect.x}" y="${rect.y}"/><a:ext cx="${rect.width}" cy="${rect.height}"/></a:xfrm>` +
    `<a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>` +
    fill +
    stroke +
    `</p:spPr></p:sp>`
  );
}

function buildTableLayerShapes(layer: TableLayer, ctx: SlideContext): string[] {
  const rows = [layer.content.headers, ...layer.content.rows];
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const rowCount = Math.max(1, rows.length);
  const rect = resolveLayerRect(layer.position, 1920, 1080);
  const cellWidth = rect.width / columnCount;
  const cellHeight = rect.height / rowCount;
  const shapes: string[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const isHeader = rowIndex === 0;
      const text = rows[rowIndex]?.[columnIndex] ?? '';
      shapes.push(
        buildLayerTextShape(
          {
            id: `${layer.id}-${rowIndex}-${columnIndex}`,
            type: 'text',
            position: {
              x: rect.x + columnIndex * cellWidth,
              y: rect.y + rowIndex * cellHeight,
              width: cellWidth,
              height: cellHeight,
            },
            content: {
              text,
              style: {
                fontSize: layer.content.style.fontSize,
                fontFamily: isHeader
                  ? (layer.content.style.headerFontFamily ?? layer.content.style.fontFamily)
                  : layer.content.style.fontFamily,
                fontWeight: isHeader ? 'bold' : 'normal',
                color: isHeader ? layer.content.style.headerColor : layer.content.style.cellColor,
                background: isHeader
                  ? layer.content.style.headerBackground
                  : layer.content.style.cellBackground,
                borderColor: layer.content.style.borderColor,
                borderWidth: 1,
                padding: Math.max(4, layer.content.style.fontSize * 0.25),
                verticalAlign: 'middle',
                textAlign: layer.content.align?.[columnIndex] ?? 'left',
                lineHeight: 1.2,
              },
            },
          },
          ctx.allocShapeId(),
        ),
      );
    }
  }
  return shapes;
}

function treeItemsToText(items: TreeLayerItem[], depth = 0): string {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(
      `${'  '.repeat(depth)}${item.isDir ? '▾ ' : '• '}${item.label}${item.comment ? ` — ${item.comment}` : ''}`,
    );
    if (item.children.length > 0) lines.push(treeItemsToText(item.children, depth + 1));
  }
  return lines.filter(Boolean).join('\n');
}

function buildPathLayerShapes(layer: PathLayer, ctx: SlideContext): string[] {
  if (layer.content.shapeKind) {
    const shape: ShapeLayer = {
      id: layer.id,
      type: 'shape',
      position: layer.position,
      content: {
        shape: layer.content.shapeKind === 'circle' ? 'circle' : 'rect',
        fill: layer.content.fill,
        fillOpacity: layer.content.fillOpacity,
        gradient: layer.content.gradient,
        stroke: layer.content.stroke,
        strokeWidth: layer.content.strokeWidth,
        borderStyle: layer.content.borderStyle,
      },
    };
    return [buildLayerShape(shape, ctx.allocShapeId())];
  }

  const numbers = layer.content.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!numbers || numbers.length < 4) return [];
  const x1 = numbers[0];
  const y1 = numbers[1];
  const x2 = numbers[numbers.length - 2];
  const y2 = numbers[numbers.length - 1];
  const rect = toEmuRect({
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  });
  const flipH = x2 < x1 ? ' flipH="1"' : '';
  const flipV = y2 < y1 ? ' flipV="1"' : '';
  const stroke = parseCssColor(layer.content.stroke, 'FFFFFF');
  const width = Math.max(1, Math.round((layer.content.strokeWidth ?? 2) * 9525));
  const head = markerXml('headEnd', layer.content.startMarker);
  const tail = markerXml('tailEnd', layer.content.endMarker);
  const dash = dashXml(layer.content.borderStyle, layer.content.dasharray);
  const shapeId = ctx.allocShapeId();
  return [
    `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(layer.id)}"/>` +
      `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
      `<a:xfrm${flipH}${flipV}><a:off x="${rect.x}" y="${rect.y}"/>` +
      `<a:ext cx="${rect.width}" cy="${rect.height}"/></a:xfrm>` +
      `<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/>` +
      `<a:ln w="${width}">${solidColorXml(stroke)}${dash}${head}${tail}</a:ln>` +
      `</p:spPr></p:sp>`,
  ];
}

function textLayerForPlaceholder(position: Position, text: string, ctx: SlideContext): TextLayer {
  return {
    id: `placeholder-${ctx.allocShapeId()}`,
    type: 'text',
    position,
    content: {
      text,
      style: {
        fontSize: 28,
        fontFamily: ctx.style.bodyFont,
        fontStyle: 'italic',
        color: `#${ctx.style.mutedColor}`,
        textAlign: 'center',
        verticalAlign: 'middle',
        padding: 12,
      },
    },
  };
}

interface ParsedColor {
  hex: string;
  alpha: number;
}

function parseCssColor(color: string | undefined, fallback: string): ParsedColor {
  if (!color) return { hex: toOoxmlHex(fallback), alpha: 100000 };
  const trimmed = color.trim();
  if (trimmed === 'transparent' || trimmed === 'none') return { hex: '000000', alpha: 0 };

  const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
  if (hexMatch) {
    const raw = hexMatch[1];
    const expanded =
      raw.length === 3
        ? raw
            .split('')
            .map((char) => char + char)
            .join('')
        : raw;
    const alpha =
      expanded.length === 8
        ? Math.round((Number.parseInt(expanded.slice(6, 8), 16) / 255) * 100000)
        : 100000;
    return { hex: expanded.slice(0, 6).toUpperCase(), alpha };
  }

  const rgbMatch =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(trimmed);
  if (rgbMatch) {
    const channel = (value: string): string =>
      Math.max(0, Math.min(255, Math.round(Number(value))))
        .toString(16)
        .padStart(2, '0');
    const alpha = rgbMatch[4]
      ? Math.round(Math.max(0, Math.min(1, Number(rgbMatch[4]))) * 100000)
      : 100000;
    return {
      hex: `${channel(rgbMatch[1])}${channel(rgbMatch[2])}${channel(rgbMatch[3])}`.toUpperCase(),
      alpha,
    };
  }

  const named: Record<string, string> = {
    black: '000000',
    white: 'FFFFFF',
    red: 'FF0000',
    blue: '0000FF',
    green: '008000',
    gray: '808080',
    grey: '808080',
  };
  return { hex: named[trimmed.toLowerCase()] ?? toOoxmlHex(fallback), alpha: 100000 };
}

function solidColorXml(color: ParsedColor): string {
  const alpha = color.alpha < 100000 ? `<a:alpha val="${color.alpha}"/>` : '';
  return `<a:solidFill><a:srgbClr val="${color.hex}">${alpha}</a:srgbClr></a:solidFill>`;
}

function fillXml(
  fill: string | undefined,
  opacity: number | undefined,
  gradient: { from: string; to: string; angle?: number } | undefined,
): string {
  if (gradient) return gradientFillXml(gradient.from, gradient.to, gradient.angle ?? 0, opacity);
  if (!fill || fill === 'none' || fill === 'transparent') return '<a:noFill/>';
  if (fill.includes('gradient(')) {
    const colors = fill.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi) ?? [];
    if (colors.length >= 2) {
      const angle = Number.parseFloat(
        /(?:linear-gradient\()\s*([\d.-]+)deg/i.exec(fill)?.[1] ?? '0',
      );
      return gradientFillXml(colors[0]!, colors[colors.length - 1]!, angle, opacity);
    }
  }
  const color = parseCssColor(fill, '000000');
  if (opacity !== undefined)
    color.alpha = Math.round(color.alpha * Math.max(0, Math.min(1, opacity)));
  return solidColorXml(color);
}

function gradientFillXml(
  from: string,
  to: string,
  angle: number,
  opacity: number | undefined,
): string {
  const first = parseCssColor(from, '000000');
  const second = parseCssColor(to, first.hex);
  if (opacity !== undefined) {
    const factor = Math.max(0, Math.min(1, opacity));
    first.alpha = Math.round(first.alpha * factor);
    second.alpha = Math.round(second.alpha * factor);
  }
  const ooxmlAngle = Math.round(((((90 - angle) % 360) + 360) % 360) * 60000);
  return (
    `<a:gradFill rotWithShape="1"><a:gsLst>` +
    `<a:gs pos="0"><a:srgbClr val="${first.hex}">${first.alpha < 100000 ? `<a:alpha val="${first.alpha}"/>` : ''}</a:srgbClr></a:gs>` +
    `<a:gs pos="100000"><a:srgbClr val="${second.hex}">${second.alpha < 100000 ? `<a:alpha val="${second.alpha}"/>` : ''}</a:srgbClr></a:gs>` +
    `</a:gsLst><a:lin ang="${ooxmlAngle}" scaled="1"/></a:gradFill>`
  );
}

function lineXml(
  color: string | undefined,
  widthPx: number | undefined,
  borderStyle: 'solid' | 'dashed' | 'dotted' | undefined,
): string {
  if (!color || !widthPx || widthPx <= 0) return '<a:ln><a:noFill/></a:ln>';
  const width = Math.max(1, Math.round(widthPx * 9525));
  return `<a:ln w="${width}">${solidColorXml(parseCssColor(color, '000000'))}${dashXml(borderStyle)}</a:ln>`;
}

function dashXml(style: 'solid' | 'dashed' | 'dotted' | undefined, dasharray?: string): string {
  if (style === 'dashed' || (dasharray && dasharray !== 'none')) return '<a:prstDash val="dash"/>';
  if (style === 'dotted') return '<a:prstDash val="dot"/>';
  return '';
}

function markerXml(tag: 'headEnd' | 'tailEnd', marker: PathLayer['content']['endMarker']): string {
  if (!marker || marker === 'none') return '';
  const type =
    marker === 'arrow'
      ? 'triangle'
      : marker === 'open'
        ? 'arrow'
        : marker === 'diamond'
          ? 'diamond'
          : marker === 'circle'
            ? 'oval'
            : 'square';
  return `<a:${tag} type="${type}" w="med" len="med"/>`;
}

interface TransitionXml {
  xml: string;
}

function buildTransitionXml(transition: Transition | undefined): string {
  if (!transition || transition.type === 'cut') return '';

  const child = buildTransitionChildXml(transition);
  const spd = pptxSpeedForDuration(transition.duration);
  return `<p:transition spd="${spd}">${child.xml}</p:transition>`;
}

function buildTransitionChildXml(transition: Transition): TransitionXml {
  const type = transition.type;
  switch (type) {
    case 'fade':
    case 'morph':
      return p('fade');
    case 'dissolve':
      return p('dissolve');
    case 'push':
      return p('push', ` dir="${sideDir(transition.direction, 'left')}"`);
    case 'slideLeft':
      return p('push', ` dir="l"`);
    case 'slideRight':
      return p('push', ` dir="r"`);
    case 'slideUp':
      return p('push', ` dir="u"`);
    case 'slideDown':
      return p('push', ` dir="d"`);
    case 'wipe':
      return p('wipe', ` dir="${sideDir(transition.direction, 'left')}"`);
    case 'split':
      return p('split', ` orient="${orientation(transition.direction)}" dir="out"`);
    case 'randomBars':
    case 'randomBar':
      return p('randomBar', ` dir="${orientation(transition.direction)}"`);
    case 'shape':
    case 'circle':
      return p('circle');
    case 'diamond':
      return p('diamond');
    case 'plus':
      return p('plus');
    case 'uncover':
    case 'pull':
      return p('pull', ` dir="${sideDir(transition.direction, 'left')}"`);
    case 'cover':
      return p('cover', ` dir="${sideDir(transition.direction, 'left')}"`);
    case 'checkerboard':
    case 'checker':
      return p('checker', ` dir="${orientation(transition.direction)}"`);
    case 'blinds':
      return p('blinds', ` dir="${orientation(transition.direction)}"`);
    case 'comb':
      return p('comb', ` dir="${orientation(transition.direction)}"`);
    case 'clock':
    case 'wheel':
      return p('wheel', ` spokes="4"`);
    case 'wheelReverse':
      return p14('wheelReverse');
    case 'newsflash':
      return p('newsflash');
    case 'random':
      return p('random');
    case 'strips':
      return p('strips', ` dir="${cornerDir(transition.direction)}"`);
    case 'wedge':
      return p('wedge');
    case 'zoom':
    case 'box':
      return p('zoom', ` dir="${inOutDir(transition.direction, 'in')}"`);
    case 'flash':
      return p14('flash');
    case 'vortex':
    case 'orbit':
    case 'rotate':
      return p14('vortex');
    case 'switch':
    case 'cube':
      return p14('switch');
    case 'flip':
    case 'fallOver':
      return p14('flip');
    case 'ripple':
      return p14('ripple');
    case 'glitter':
    case 'prestige':
      return p14('glitter');
    case 'honeycomb':
      return p14('honeycomb');
    case 'prism':
      return p14('prism');
    case 'doors':
    case 'drape':
    case 'curtains':
      return p14('doors');
    case 'window':
      return p14('window');
    case 'shred':
    case 'fracture':
    case 'crush':
      return p14('shred');
    case 'ferris':
    case 'ferrisWheel':
      return p14('ferris');
    case 'flythrough':
    case 'flyThrough':
    case 'airplane':
    case 'origami':
      return p14('flythrough');
    case 'warp':
    case 'pageCurl':
    case 'pageCurlDouble':
    case 'pageCurlSingle':
    case 'peelOff':
      return p14('warp');
    case 'gallery':
      return p14('gallery');
    case 'conveyor':
      return p14('conveyor');
    case 'pan':
    case 'wind':
      return p14('pan');
    case 'reveal':
      return p14('reveal');
    default:
      return p('fade');
  }
}

function p(tag: string, attrs: string = ''): TransitionXml {
  return { xml: `<p:${tag}${attrs}/>` };
}

function p14(tag: string, attrs: string = ''): TransitionXml {
  return { xml: `<p14:${tag}${attrs}/>` };
}

function pptxSpeedForDuration(duration: number | undefined): 'fast' | 'med' | 'slow' {
  if (duration != null && duration <= 0.5) return 'fast';
  if (duration != null && duration >= 1.2) return 'slow';
  return 'med';
}

function sideDir(
  direction: TransitionDirection | undefined,
  fallback: TransitionDirection,
): string {
  switch (direction ?? fallback) {
    case 'right':
      return 'r';
    case 'up':
      return 'u';
    case 'down':
      return 'd';
    case 'left':
    default:
      return 'l';
  }
}

function cornerDir(direction: TransitionDirection | undefined): string {
  switch (direction) {
    case 'right':
    case 'down':
      return 'rd';
    case 'up':
      return 'lu';
    case 'left':
    default:
      return 'ld';
  }
}

function orientation(direction: TransitionDirection | undefined): string {
  return direction === 'vertical' || direction === 'up' || direction === 'down' ? 'vert' : 'horz';
}

function inOutDir(direction: TransitionDirection | undefined, fallback: 'in' | 'out'): string {
  return direction === 'out' ? 'out' : direction === 'in' ? 'in' : fallback;
}

function buildTitleShape(title: string, style: SlideStyle): string {
  return (
    `<p:sp>` +
    `<p:nvSpPr>` +
    `<p:cNvPr id="2" name="Title"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="title"/></p:nvPr>` +
    `</p:nvSpPr>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${TITLE_LEFT}" y="${TITLE_TOP}"/>` +
    `<a:ext cx="${TITLE_WIDTH}" cy="${TITLE_HEIGHT}"/></a:xfrm>` +
    `</p:spPr>` +
    `<p:txBody>` +
    `<a:bodyPr/>` +
    `<a:lstStyle/>` +
    `<a:p>` +
    `<a:r>` +
    `<a:rPr lang="en-US" sz="${DEFAULT_TITLE_SIZE}" dirty="0">` +
    `<a:solidFill><a:srgbClr val="${style.titleColor}"/></a:solidFill>` +
    `<a:latin typeface="${escapeXml(style.titleFont)}"/>` +
    `</a:rPr>` +
    `<a:t>${escapeXml(title)}</a:t>` +
    `</a:r>` +
    `</a:p>` +
    `</p:txBody>` +
    `</p:sp>`
  );
}

function buildBodyShapeCustom(
  bodyContent: string,
  top: number,
  height: number,
  style: SlideStyle,
): string {
  // Set default text color for the body via defRPr
  const defRPr = style.hasTheme
    ? `<a:defRPr><a:solidFill><a:srgbClr val="${style.text}"/></a:solidFill><a:latin typeface="${escapeXml(style.bodyFont)}"/></a:defRPr>`
    : '';

  return (
    `<p:sp>` +
    `<p:nvSpPr>` +
    `<p:cNvPr id="3" name="Content"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph idx="1"/></p:nvPr>` +
    `</p:nvSpPr>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${BODY_LEFT}" y="${top}"/>` +
    `<a:ext cx="${BODY_WIDTH}" cy="${height}"/></a:xfrm>` +
    `</p:spPr>` +
    `<p:txBody>` +
    `<a:bodyPr/>` +
    `<a:lstStyle>` +
    `<a:lvl1pPr>${defRPr}</a:lvl1pPr>` +
    `</a:lstStyle>` +
    bodyContent +
    `</p:txBody>` +
    `</p:sp>`
  );
}

function buildImageShape(
  img: EmbeddedImage,
  shapeId: number,
  left: number,
  top: number,
  maxWidth: number,
  maxHeight: number,
): string {
  return (
    `<p:pic>` +
    `<p:nvPicPr>` +
    `<p:cNvPr id="${shapeId}" name="${escapeXml(img.alt || 'Picture')}"/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
    `<p:nvPr/>` +
    `</p:nvPicPr>` +
    `<p:blipFill>` +
    `<a:blip r:embed="${img.relId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</p:blipFill>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${left}" y="${top}"/>` +
    `<a:ext cx="${maxWidth}" cy="${maxHeight}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</p:spPr>` +
    `</p:pic>`
  );
}

// ============================================
// Block Conversion (Markdown -> DrawingML paragraphs)
// ============================================

function convertBodyBlocks(nodes: MarkdownBlockNode[], ctx: SlideContext): string {
  const parts: string[] = [];
  for (const node of nodes) {
    parts.push(convertBlock(node, ctx, 0));
  }
  return parts.join('');
}

function convertBlock(node: MarkdownBlockNode, ctx: SlideContext, listDepth: number): string {
  switch (node.type) {
    case 'heading':
      return convertHeading(node, ctx);
    case 'paragraph':
      return convertParagraph(node, ctx);
    case 'blockquote':
      return convertBlockquote(node, ctx);
    case 'list':
      return convertList(node, ctx, listDepth);
    case 'code':
      return convertCodeBlock(node, ctx);
    case 'table':
      return convertTable(node, ctx);
    case 'thematicBreak':
      return convertThematicBreak(ctx);
    case 'htmlBlock':
      return convertHtmlBlock(node, ctx);
    case 'math':
      return convertMathBlock(node);
    default:
      return '';
  }
}

function convertHeading(node: MarkdownHeading, ctx: SlideContext): string {
  const size = headingSizeForDepth(node.depth);
  const runs = convertInlines(node.children, ctx, { bold: true });
  return (
    `<a:p>` +
    `<a:pPr>` +
    `<a:spcBef><a:spcPts val="600"/></a:spcBef>` +
    `<a:defRPr sz="${size}" b="1">` +
    `<a:solidFill><a:srgbClr val="${ctx.style.titleColor}"/></a:solidFill>` +
    `<a:latin typeface="${escapeXml(ctx.style.titleFont)}"/>` +
    `</a:defRPr>` +
    `</a:pPr>` +
    runs +
    `</a:p>`
  );
}

function headingSizeForDepth(depth: number): number {
  const sizes: Record<number, number> = { 1: 3200, 2: 2800, 3: 2400, 4: 2000, 5: 1800, 6: 1800 };
  return sizes[depth] ?? 1800;
}

/**
 * Check if a paragraph contains only a single image (no surrounding text).
 */
function isImageOnlyParagraph(node: MarkdownParagraph): MarkdownImage | null {
  if (node.children.length === 1 && node.children[0].type === 'image') {
    return node.children[0];
  }
  return null;
}

function convertParagraph(node: MarkdownParagraph, ctx: SlideContext): string {
  // If paragraph is just an image and we have the data, embed it as a shape
  const soloImage = isImageOnlyParagraph(node);
  if (soloImage && ctx.images) {
    const data = ctx.images.get(soloImage.url);
    if (data) {
      ctx.addImage(soloImage.url, data, soloImage.alt || '');
      return ''; // Image will be rendered as a p:pic shape, not inline text
    }
  }

  const runs = convertInlines(node.children, ctx);
  return `<a:p>${runs}</a:p>`;
}

function convertBlockquote(node: MarkdownBlockquote, ctx: SlideContext): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      const runs = convertInlines(child.children, ctx, { italic: true });
      parts.push(
        `<a:p>` +
          `<a:pPr marL="457200">` +
          `<a:spcBef><a:spcPts val="200"/></a:spcBef>` +
          `</a:pPr>` +
          runs +
          `</a:p>`,
      );
    } else {
      parts.push(convertBlock(child, ctx, 0));
    }
  }
  return parts.join('');
}

function convertList(node: MarkdownList, ctx: SlideContext, depth: number): string {
  const parts: string[] = [];
  for (const item of node.children) {
    parts.push(convertListItem(item, ctx, node.ordered ?? false, depth));
  }
  return parts.join('');
}

function convertListItem(
  item: MarkdownListItem,
  ctx: SlideContext,
  ordered: boolean,
  depth: number,
): string {
  const parts: string[] = [];
  for (const child of item.children) {
    if (child.type === 'paragraph') {
      const runs = convertInlines(child.children, ctx);
      const bullet = ordered ? `<a:buAutoNum type="arabicPeriod"/>` : `<a:buChar char="\u2022"/>`;
      const indent = 457200 * (depth + 1);
      parts.push(
        `<a:p>` +
          `<a:pPr lvl="${depth}" marL="${indent}" indent="-228600">` +
          bullet +
          `</a:pPr>` +
          runs +
          `</a:p>`,
      );
    } else if (child.type === 'list') {
      parts.push(convertList(child, ctx, depth + 1));
    } else {
      parts.push(convertBlock(child, ctx, depth));
    }
  }
  return parts.join('');
}

function convertCodeBlock(node: MarkdownCodeBlock, ctx: SlideContext): string {
  const lines = node.value.split('\n');
  const parts: string[] = [];
  for (const line of lines) {
    parts.push(
      `<a:p>` +
        `<a:r>` +
        // Fill group precedes `a:latin` per CT_TextCharacterProperties.
        `<a:rPr lang="en-US" sz="${DEFAULT_CODE_SIZE}" dirty="0">` +
        `<a:solidFill><a:srgbClr val="${ctx.style.codeColor}"/></a:solidFill>` +
        `<a:latin typeface="${escapeXml(ctx.style.codeFont)}"/>` +
        `</a:rPr>` +
        `<a:t>${escapeXml(line || ' ')}</a:t>` +
        `</a:r>` +
        `</a:p>`,
    );
  }
  return parts.join('');
}

function convertTable(node: MarkdownTable, ctx: SlideContext): string {
  const parts: string[] = [];
  for (let ri = 0; ri < node.children.length; ri++) {
    const row = node.children[ri];
    parts.push(convertTableRow(row, ctx, ri === 0));
  }
  return parts.join('');
}

function convertTableRow(row: MarkdownTableRow, ctx: SlideContext, isHeader: boolean): string {
  const cells: string[] = [];
  for (const cell of row.children) {
    cells.push(extractPlainText(cell.children));
  }
  const text = cells.join('  |  ');
  const format: InlineFormat = isHeader ? { bold: true } : {};
  return `<a:p>${makeRun(text, format, ctx.style)}</a:p>`;
}

function convertThematicBreak(ctx: SlideContext): string {
  return `<a:p><a:pPr><a:spcAft><a:spcPts val="1200"/></a:spcAft></a:pPr><a:r><a:rPr lang="en-US" sz="400"><a:solidFill><a:srgbClr val="${ctx.style.mutedColor}"/></a:solidFill></a:rPr><a:t>———</a:t></a:r></a:p>`;
}

function convertHtmlBlock(node: MarkdownHtmlBlock, ctx: SlideContext): string {
  const text = stripHtmlTags(node.rawHtml).trim();
  if (!text) return '';
  return `<a:p>${makeRun(text, {}, ctx.style)}</a:p>`;
}

function convertMathBlock(node: MarkdownMathBlock): string {
  return (
    `<a:p>` +
    `<a:pPr algn="ctr"/>` +
    `<a:r>` +
    `<a:rPr lang="en-US" i="1">` +
    `<a:latin typeface="Cambria Math"/>` +
    `</a:rPr>` +
    `<a:t>${escapeXml(node.value)}</a:t>` +
    `</a:r>` +
    `</a:p>`
  );
}

// ============================================
// Inline Conversion (DrawingML runs)
// ============================================

interface InlineFormat {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

/**
 * PPTX leaf handlers for the shared run-based inline walker. The traversal
 * (format threading) lives in `shared/inlineRuns.ts`; these emit DrawingML.
 */
function pptxRunHandlers(ctx: SlideContext): InlineRunHandlers {
  return {
    run: (text, format) => makeRun(text, format, ctx.style),
    link: (node, format) => convertLink(node, ctx, format),
    image: (node, format) => convertImage(node, format, ctx),
    lineBreak: () => `<a:br/>`,
  };
}

function convertInlines(
  nodes: MarkdownInlineNode[],
  ctx: SlideContext,
  format: InlineFormat = {},
): string {
  return inlineNodesToRuns(nodes, pptxRunHandlers(ctx), format);
}

function convertInline(node: MarkdownInlineNode, ctx: SlideContext, format: InlineFormat): string {
  return inlineNodeToRuns(node, pptxRunHandlers(ctx), format);
}

function makeRun(text: string, format: InlineFormat, style: SlideStyle): string {
  if (!text) return '';

  const rPrParts: string[] = [`lang="en-US"`, `dirty="0"`];

  if (format.bold) rPrParts.push(`b="1"`);
  if (format.italic) rPrParts.push(`i="1"`);
  if (format.strike) rPrParts.push(`strike="sngStrike"`);

  // `a:rPr` children must follow the ECMA-376 `CT_TextCharacterProperties`
  // sequence: ln → EG_FillProperties (solidFill) → EG_EffectProperties →
  // highlight → underline groups → latin → ea → cs → … The fill group must
  // precede `a:latin`; PowerPoint is lenient, strict validators are not.
  let innerParts = '';

  if (format.code) {
    innerParts += `<a:solidFill><a:srgbClr val="${style.codeColor}"/></a:solidFill>`;
    innerParts += `<a:latin typeface="${escapeXml(style.codeFont)}"/>`;
    rPrParts.push(`sz="${DEFAULT_CODE_SIZE}"`);
  } else if (style.hasTheme) {
    innerParts += `<a:solidFill><a:srgbClr val="${style.text}"/></a:solidFill>`;
  }

  return (
    `<a:r>` +
    `<a:rPr ${rPrParts.join(' ')}>${innerParts}</a:rPr>` +
    `<a:t>${escapeXml(text)}</a:t>` +
    `</a:r>`
  );
}

function convertLink(node: MarkdownLink, ctx: SlideContext, format: InlineFormat): string {
  const rId = ctx.addHyperlink(node.url);
  if (!rId) return convertInlines(node.children, ctx, format);
  const parts: string[] = [];

  for (const child of node.children) {
    if (child.type === 'text') {
      parts.push(makeHyperlinkRun(child.value, rId, format));
    } else {
      parts.push(convertInline(child, ctx, format));
    }
  }

  return parts.join('');
}

function makeHyperlinkRun(text: string, rId: string, format: InlineFormat): string {
  if (!text) return '';

  const rPrParts: string[] = [`lang="en-US"`, `dirty="0"`];
  if (format.bold) rPrParts.push(`b="1"`);
  if (format.italic) rPrParts.push(`i="1"`);

  return (
    `<a:r>` +
    `<a:rPr ${rPrParts.join(' ')}>` +
    `<a:solidFill><a:srgbClr val="${HYPERLINK_COLOR}"/></a:solidFill>` +
    `<a:hlinkClick r:id="${rId}"/>` +
    `</a:rPr>` +
    `<a:t>${escapeXml(text)}</a:t>` +
    `</a:r>`
  );
}

function convertImage(node: MarkdownImage, format: InlineFormat, ctx: SlideContext): string {
  // For inline images (not image-only paragraphs), try to embed
  if (ctx.images) {
    const data = ctx.images.get(node.url);
    if (data) {
      // Register for rendering as a shape; return empty text
      ctx.addImage(node.url, data, node.alt || '');
      return '';
    }
  }
  // Fallback: placeholder text
  const alt = node.alt || node.url;
  return makeRun(`[Image: ${alt}]`, { ...format, italic: true }, ctx.style);
}

// ============================================
// Package Assembly
// ============================================

async function buildPptxPackage(
  slideXmls: string[],
  slideContexts: SlideContext[],
  options: PptxExportOptions,
): Promise<ArrayBuffer> {
  const pkg = createPackage();
  const slideCount = slideXmls.length;

  // One allocator, keyed by rels part — see `RelIdAllocator`. The slide,
  // slideMaster and theme rels all live in ppt/_rels/presentation.xml.rels,
  // so they must share a counter. Previously slides counted up from rId1
  // while slideMaster/theme were hardcoded to rId100/rId101, which meant a
  // 100-slide deck emitted a duplicate rId100 and PowerPoint rejected it.
  const relIds = new RelIdAllocator();
  const PRESENTATION_PART = 'ppt/presentation.xml';
  const SLIDE_MASTER_PART = 'ppt/slideMasters/slideMaster1.xml';
  const SLIDE_LAYOUT_PART = 'ppt/slideLayouts/slideLayout1.xml';

  const slideRelIds: string[] = [];
  for (let i = 0; i < slideCount; i++) {
    slideRelIds.push(relIds.alloc(PRESENTATION_PART));
  }
  const slideMasterRelId = relIds.alloc(PRESENTATION_PART);
  const themeRelId = relIds.alloc(PRESENTATION_PART);

  // --- ppt/presentation.xml ---
  const presentationXml = buildPresentationXml(
    slideCount,
    slideRelIds,
    slideMasterRelId,
    themeRelId,
  );
  pkg.addPart('ppt/presentation.xml', presentationXml, CONTENT_TYPE_PPTX_PRESENTATION);

  // --- Slides ---
  for (let i = 0; i < slideCount; i++) {
    const slidePath = `ppt/slides/slide${i + 1}.xml`;
    pkg.addPart(slidePath, slideXmls[i], CONTENT_TYPE_PPTX_SLIDE);

    // Per-slide relationships: layout + hyperlinks + images, all allocated
    // from the slide's own counter inside SlideContext.
    const ctx = slideContexts[i];
    for (const rel of ctx.relationships) {
      pkg.addRelationship(slidePath, {
        id: rel.id,
        type: rel.type,
        target: rel.target,
        ...(rel.targetMode ? { targetMode: rel.targetMode } : {}),
      });
    }

    // Embed image binary parts
    for (const img of ctx.embeddedImages) {
      pkg.addBinaryPart(img.mediaPath, img.data, img.contentType);
    }
  }

  // --- Slide layout ---
  const layoutMasterRelId = relIds.alloc(SLIDE_LAYOUT_PART);
  const slideLayoutXml = buildSlideLayoutXml(layoutMasterRelId);
  pkg.addPart(SLIDE_LAYOUT_PART, slideLayoutXml, CONTENT_TYPE_PPTX_SLIDE_LAYOUT);
  pkg.addRelationship(SLIDE_LAYOUT_PART, {
    id: layoutMasterRelId,
    type: REL_SLIDE_MASTER,
    target: '../slideMasters/slideMaster1.xml',
  });

  // --- Slide master ---
  const masterLayoutRelId = relIds.alloc(SLIDE_MASTER_PART);
  const masterThemeRelId = relIds.alloc(SLIDE_MASTER_PART);
  const slideMasterXml = buildSlideMasterXml(masterLayoutRelId);
  pkg.addPart(SLIDE_MASTER_PART, slideMasterXml, CONTENT_TYPE_PPTX_SLIDE_MASTER);
  pkg.addRelationship(SLIDE_MASTER_PART, {
    id: masterLayoutRelId,
    type: REL_SLIDE_LAYOUT,
    target: '../slideLayouts/slideLayout1.xml',
  });
  pkg.addRelationship(SLIDE_MASTER_PART, {
    id: masterThemeRelId,
    type: REL_THEME,
    target: '../theme/theme1.xml',
  });

  // --- Theme ---
  const themeXml = buildThemeXml();
  pkg.addPart('ppt/theme/theme1.xml', themeXml, CONTENT_TYPE_PPTX_THEME);

  // --- Root relationship ---
  pkg.addRelationship('', {
    id: 'rId1',
    type: REL_OFFICE_DOCUMENT,
    target: 'ppt/presentation.xml',
  });

  // --- Presentation relationships ---
  for (let i = 0; i < slideCount; i++) {
    pkg.addRelationship('ppt/presentation.xml', {
      id: slideRelIds[i],
      type: REL_SLIDE,
      target: `slides/slide${i + 1}.xml`,
    });
  }
  pkg.addRelationship('ppt/presentation.xml', {
    id: slideMasterRelId,
    type: REL_SLIDE_MASTER,
    target: 'slideMasters/slideMaster1.xml',
  });
  pkg.addRelationship('ppt/presentation.xml', {
    id: themeRelId,
    type: REL_THEME,
    target: 'theme/theme1.xml',
  });

  // --- Core properties ---
  if (options.title || options.author || options.description) {
    pkg.setCoreProperties({
      title: options.title,
      creator: options.author,
      description: options.description,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
  }

  return pkg.toArrayBuffer();
}

// ============================================
// Helpers
// ============================================

function inferExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'png';
  const ext = path
    .substring(dot + 1)
    .toLowerCase()
    .split('?')[0];
  return ext || 'png';
}

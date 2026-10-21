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
  Transition,
  TransitionDirection,
  TreeLayerItem,
} from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import type { Theme, ThemeRegistry } from '@bendyline/squisq/schemas';
import {
  buildPreviewDoc,
  createTemplateContext,
  docToMarkdown,
  expandCoverBlock,
  expandDocBlocks,
  flattenRenderableBlocks,
  isGeometryBoundTemplate,
  isTemplateBlock,
  resolvePersistentLayers,
  resolveThemeForDoc,
} from '@bendyline/squisq/doc';
import { splitIconMarkers } from '@bendyline/squisq/icon-marker';
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
  MarkdownInlineIcon,
} from '@bendyline/squisq/markdown';
import {
  isSvgImageSource,
  parseVideoEmbedUrl,
  readFrontmatterThemeId,
} from '@bendyline/squisq/markdown';

import { createPackage } from '../ooxml/writer.js';
import { RelIdAllocator } from '../ooxml/relIds.js';
import { xmlDeclaration, escapeXml } from '../ooxml/xmlUtils.js';
import {
  buildImageShape,
  mermaidPictureShapes,
  svgImagePictureShapes,
  svgIslandPictureShapes,
} from './pictureLayers.js';
import {
  EMU_PER_CANVAS_PX,
  resolveLayerRect,
  resolvePositionValue,
  toEmuRect,
} from './geometry.js';
import {
  buildLayerShape,
  dashXml,
  officeTypeface,
  parseCssColor,
  solidColorXml,
} from './drawingXml.js';
import { planDeckBackdrops, type SlidePlan } from './backdrop.js';
import { buildLayerTextShape } from './layerText.js';
import {
  buildDeckLayoutXml,
  buildDeckMasterXml,
  buildDeckThemeXml,
  colorBackgroundXml,
  isDarkTheme,
  paintBackgroundXml,
  photoBackgroundXml,
} from './masters.js';
import { estimateSlideTextScale } from './textFit.js';
import { mergeTextFlows } from './textLists.js';
import { inferMimeType } from '../html/imageUtils.js';
import { stripHtmlTags, extractPlainText } from '../shared/text.js';
import { toOoxmlHex } from '../shared/ooxmlColor.js';
import { sanitizeOfficeHyperlink } from '../shared/officeHyperlinks.js';
import {
  fontAwesomeFace,
  fontAwesomeFaces,
  fontAwesomeGlyph,
  type IconFamily,
} from '../shared/fontAwesome.js';
import {
  inlineNodesToRuns,
  inlineNodeToRuns,
  type InlineRunHandlers,
  type InlineRunFormat,
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
  REL_FONT,
  CONTENT_TYPE_PPTX_PRESENTATION,
  CONTENT_TYPE_PPTX_SLIDE,
  CONTENT_TYPE_PPTX_SLIDE_LAYOUT,
  CONTENT_TYPE_PPTX_SLIDE_MASTER,
  CONTENT_TYPE_PPTX_THEME,
  CONTENT_TYPE_PPTX_FONT,
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
  /** Receives non-fatal export warnings. */
  onWarning?: (message: string) => void;
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
  /**
   * Pictures of Mermaid diagrams, keyed by the Mermaid source as written in
   * the fence (trimmed). A Mermaid layer with a picture here is drawn as that
   * picture, fitted inside its area; otherwise its source shows as text.
   * `width` / `height` are the picture's display size and set its aspect
   * ratio, which also shapes the slide area reserved for the diagram.
   */
  diagramImages?: Map<string, { data: ArrayBuffer | Uint8Array; width: number; height: number }>;
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

  const slides = segmentIntoSlides(doc.children, options.slideBreak ?? 'h2', options.onWarning);

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
 * True when the Doc still carries markdown authoring structure rather than the
 * flat, fully-typed slide list the player consumes. `sourceHeading` is the
 * marker `markdownToDoc` sets on every heading-derived block and the one
 * `buildPreviewDoc` strips, so this is also the guard against projecting an
 * already-projected Doc twice. `applyTransform` output has no `sourceHeading`
 * either — those blocks already ARE typed template inputs.
 */
function needsSlideshowProjection(doc: Doc): boolean {
  return (doc.blocks ?? []).some((block) => !!block.sourceHeading);
}

/**
 * Convert a squisq Doc to a .pptx ArrayBuffer.
 *
 * The deck IS the slideshow rendition: an authored Doc runs through the same
 * `buildPreviewDoc` projection and `expandDocBlocks` expansion the player uses,
 * then its materialized visual layers are mapped to native DrawingML shapes.
 * Without that projection a heading with no `{[template]}` annotation renders
 * through `sectionHeader` — heading only — and silently drops its body prose.
 *
 * Docs with no templates at all retain the semantic Markdown export path for
 * backward compatibility.
 */
export async function docToPptx(doc: Doc, options: PptxExportOptions = {}): Promise<ArrayBuffer> {
  options.signal?.throwIfAborted();
  const effectiveOptions =
    !options.themeId && doc.themeId ? { ...options, themeId: doc.themeId } : options;
  const slideshowDoc = needsSlideshowProjection(doc) ? buildPreviewDoc(doc) : doc;
  const flatBlocks = flattenRenderableBlocks(slideshowDoc.blocks);

  // A Doc with no template blocks at all (raw authored layers, or an empty
  // deck) has nothing for the visual path to materialize. Preserve the
  // established semantic exporter for that shape.
  if (!flatBlocks.some(isTemplateBlock)) {
    return markdownDocToPptx(docToMarkdown(doc), effectiveOptions);
  }

  const theme = resolveThemeForDoc(doc, effectiveOptions.themeId, effectiveOptions.themeRegistry);
  const style = slideStyleFromTheme(theme, effectiveOptions);
  // Mirror the player's rule (`audioMode !== 'synthetic'`): only REAL narration
  // reshapes the block sequence. `buildPreviewDoc` synthesizes a single
  // src-less segment purely as a playback clock, and feeding that to the
  // audio-timed path lets narration pacing merge authored slides away.
  const audioSegments = doc.audio?.segments?.length
    ? slideshowDoc.audio?.segments?.map((segment) => ({
        startTime: segment.startTime,
        duration: segment.duration,
      }))
    : undefined;
  const persistentLayers = resolvePersistentLayers(
    { persistentLayers: doc.persistentLayers },
    theme,
  );
  // Reserve each pictured diagram's own shape on the slide, as the player does.
  const mediaAspectRatios: Record<string, number> = {};
  for (const [source, picture] of effectiveOptions.diagramImages ?? []) {
    if (picture.width > 0 && picture.height > 0) {
      mediaAspectRatios[source] = picture.width / picture.height;
    }
  }
  const expanded = expandDocBlocks(flatBlocks, {
    audioSegments,
    viewport: VIEWPORT_PRESETS.landscape,
    persistentLayers,
    theme,
    customTemplates: doc.customTemplates,
    mediaAspectRatios,
    // A .pptx is a discrete deck: the >20s pacing split would emit N identical
    // copies of one authored slide (a long single block became 18 duplicates),
    // and the <5s pacing merge would delete authored slides outright. Keep one
    // authored slide as one slide, matching the slideshow.
    splitLongBlocks: false,
    mergeShortBlocks: false,
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

  // Only a deck with a hosted video or an SVG island loads a poster/PNG encoder.
  const hasLayer = (type: string) =>
    slideBlocks.some((b) => b.layers?.some((l) => l.type === type));
  const videoPosters = hasLayer('videoEmbed') ? await import('../shared/videoPoster.js') : null;
  const hasSvgImage = slideBlocks.some((b) =>
    b.layers?.some((l) => l.type === 'image' && isSvgImageSource(l.content.src)),
  );
  const svgIslandPosters =
    hasLayer('svg') || hasSvgImage ? await import('../shared/svgIslandPoster.js') : null;

  // Where each slide's background paint lives — a native background, its
  // slide layout, or the master — so no full-slide rectangle sits on a slide
  // in the way of its content (see backdrop.ts).
  const backdrops = planDeckBackdrops(slideBlocks);

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
    ctx.diagramImages = effectiveOptions.diagramImages;
    ctx.videoPosters = videoPosters;
    ctx.svgIslandPosters = svgIslandPosters;
    const plan = backdrops.slides[index]!;
    ctx.useLayout(plan.layout + 1);
    slideXmls.push(buildLayerSlideXml(slideBlocks[index], ctx, plan));
    slideContexts.push(ctx);
  }

  return buildPptxPackage(slideXmls, slideContexts, effectiveOptions, {
    layoutXmls: backdrops.layouts.map(buildDeckLayoutXml),
    masterXml: (layoutRelIds) =>
      buildDeckMasterXml({
        backgroundXml: backdrops.master.base
          ? paintBackgroundXml(backdrops.master.base)
          : colorBackgroundXml(style.background),
        overlays: backdrops.master.overlays,
        layoutRelIds,
        dark: isDarkTheme(theme),
      }),
    themeXml: buildDeckThemeXml(theme),
  });
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
  title?: MarkdownInlineNode[];
  titleDepth?: number;
  transition?: Transition;
  bodyNodes: MarkdownBlockNode[];
}

function segmentIntoSlides(
  children: MarkdownBlockNode[],
  slideBreak: 'h1' | 'h2' | 'heading',
  onWarning?: (message: string) => void,
): SlideData[] {
  const maxDepth = slideBreak === 'h1' ? 1 : slideBreak === 'h2' ? 2 : 6;
  const slides: SlideData[] = [];
  let current: SlideData | undefined;
  let redundantThematicBreaks = 0;

  for (const node of children) {
    if (node.type === 'heading' && node.depth <= maxDepth) {
      if (current) {
        while (current.bodyNodes[current.bodyNodes.length - 1]?.type === 'thematicBreak') {
          current.bodyNodes.pop();
          redundantThematicBreaks += 1;
        }
        if (current.title || current.bodyNodes.length > 0) slides.push(current);
      }
      current = {
        title: node.children,
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
  if (redundantThematicBreaks > 0) {
    onWarning?.(
      `PPTX export removed ${redundantThematicBreaks} redundant thematic break(s) immediately before slide headings. ` +
        'A heading already starts the next slide; omit --- unless a visible horizontal rule is intended.',
    );
  }
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
  /** Pictures of Mermaid diagrams by source; see `PptxExportOptions.diagramImages`. */
  diagramImages: PptxExportOptions['diagramImages'];
  /** Poster helpers for hosted videos, loaded only when the deck has one. */
  videoPosters: typeof import('../shared/videoPoster.js') | null = null;
  /** Stand-in PNGs for SVG islands, loaded only when the deck has one. */
  svgIslandPosters: typeof import('../shared/svgIslandPoster.js') | null = null;
  readonly slideIndex: number;
  readonly embeddedImages: EmbeddedImage[] = [];
  private nextShapeId = 4; // 1=group, 2=title, 3=body
  private readonly allowRelativeHyperlinks: boolean;
  readonly signal: AbortSignal | undefined;
  /** Font Awesome families referenced by semantic or materialized text runs. */
  readonly iconFamilies = new Set<IconFamily>();

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

  /** Point this slide at slide layout `number` (1-based, as its part is named). */
  useLayout(number: number): void {
    this.relationships[0]!.target = `../slideLayouts/slideLayout${number}.xml`;
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

  if (slide.title?.length) {
    shapes.push(buildTitleShape(slide.title, ctx));
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

/**
 * Build a slide from the exact materialized layer stack used by DocPlayer.
 * Its background paint is already placed by `plan` (backdrop.ts): the slide
 * draws only its content, plus a background of its own when its paint
 * differs from its layout's — a full-bleed photo, chiefly.
 */
function buildLayerSlideXml(block: Block, ctx: SlideContext, plan: SlidePlan): string {
  const shapes: string[] = [
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` + `<p:grpSpPr/>`,
  ];

  let layers = plan.content;
  let bgXml = '';
  if (plan.base?.type === 'image') {
    const photo = plan.base;
    const data = ctx.images?.get(photo.content.src);
    if (data) {
      bgXml = photoBackgroundXml(
        ctx.addImage(photo.content.src, data, photo.content.alt),
        photo,
        data,
      );
    } else {
      // No bytes to embed: keep the picture path's labelled placeholder.
      layers = [photo, ...layers];
    }
  } else if (plan.base) {
    bgXml = paintBackgroundXml(plan.base);
  }

  // The slideshow grows a slide's text to fill its boxes; export it at the
  // size the player shows, not the template's base size (see textFit.ts).
  const textScale = isGeometryBoundTemplate(block.template) ? 1 : estimateSlideTextScale(layers);
  const units = mergeTextFlows(layers, textScale);
  const textLayerY = units
    .filter(({ layer }) => layer.type === 'text')
    .map(({ layer }) => resolvePositionValue(layer.position.y, 1080));

  for (const layer of layers) {
    if (layer.type !== 'text') continue;
    for (const run of splitIconMarkers(layer.content.text ?? '')) {
      if (run.type === 'icon') ctx.iconFamilies.add(run.family);
    }
  }

  for (let index = 0; index < units.length; index++) {
    if ((index & 31) === 0) ctx.signal?.throwIfAborted();
    const { layer, listIndentPx } = units[index]!;
    const currentY =
      layer.type === 'text' ? resolvePositionValue(layer.position.y, 1080) : undefined;
    const nextTextY =
      currentY === undefined
        ? undefined
        : textLayerY.filter((candidate) => candidate > currentY + 1).sort((a, b) => a - b)[0];
    const textBottom =
      nextTextY === undefined || currentY === undefined
        ? undefined
        : Math.max(currentY + 1, nextTextY - 8);
    shapes.push(
      ...(layer.type === 'text'
        ? [buildLayerTextShape(layer, ctx.allocShapeId(), textBottom, listIndentPx, textScale)]
        : convertLayerToShapes(layer, ctx, textBottom)),
    );
  }

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
      // SVG noise replaces the shape's paint with translucent film grain.
      // DrawingML cannot reproduce that filter: exporting its unfiltered
      // base fill would cover the slide with an opaque rectangle.
      if (layer.content.filter?.type === 'noise') return [];
      return [buildLayerShape(layer, ctx.allocShapeId())];
    case 'image': {
      // An attached SVG is never embedded as written: core's sanitized SVG
      // over a PNG, or the placeholder below.
      const svg = isSvgImageSource(layer.content.src);
      const area = toEmuRect(resolveLayerRect(layer.position, 1920, 1080));
      const picture = svg ? svgImagePictureShapes(layer, area, ctx) : null;
      if (picture) return picture;
      const data = svg ? undefined : ctx.images?.get(layer.content.src);
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
      const data = poster && !isSvgImageSource(poster) ? ctx.images?.get(poster) : undefined;
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
    case 'videoEmbed': {
      // A poster picture that opens the video's page when clicked in the
      // slideshow, letterboxed to the video's shape inside the layer's area.
      const embed = parseVideoEmbedUrl(layer.content.url);
      const thumbnail = embed?.thumbnailUrl ? ctx.images?.get(embed.thumbnailUrl) : undefined;
      const poster =
        embed && (thumbnail ?? ctx.videoPosters?.videoPosterPng(embed.aspectRatio < 1)?.data);
      if (embed && poster) {
        const label = layer.content.title || `${embed.providerName} video`;
        const relId = ctx.addImage(
          thumbnail ? (embed.thumbnailUrl ?? 'poster.jpg') : 'video-poster.png',
          poster,
          label,
        );
        const embedded = ctx.embeddedImages.find((candidate) => candidate.relId === relId)!;
        const area = toEmuRect(resolveLayerRect(layer.position, 1920, 1080));
        const width = Math.min(area.width, Math.round(area.height * embed.aspectRatio));
        const height = Math.round(width / embed.aspectRatio);
        return [
          buildImageShape(
            embedded,
            ctx.allocShapeId(),
            area.x + Math.round((area.width - width) / 2),
            area.y + Math.round((area.height - height) / 2),
            width,
            height,
            ctx.addHyperlink(embed.watchUrl),
          ),
        ];
      }
      return [
        buildLayerTextShape(
          textLayerForPlaceholder(
            layer.position,
            `[Video: ${layer.content.title || layer.content.url}]`,
            ctx,
          ),
          ctx.allocShapeId(),
        ),
      ];
    }
    case 'mermaid': {
      const area = toEmuRect(resolveLayerRect(layer.position, 1920, 1080));
      const picture = mermaidPictureShapes(layer, area, ctx);
      return (
        picture ?? [
          buildLayerTextShape(
            textLayerForPlaceholder(layer.position, layer.content.source, ctx),
            ctx.allocShapeId(),
          ),
        ]
      );
    }
    case 'svg': {
      const area = toEmuRect(resolveLayerRect(layer.position, 1920, 1080));
      const picture = svgIslandPictureShapes(layer, area, ctx);
      const label = layer.content.alt ?? 'SVG illustration';
      return (
        picture ?? [
          buildLayerTextShape(
            textLayerForPlaceholder(layer.position, `[${label}]`, ctx),
            ctx.allocShapeId(),
          ),
        ]
      );
    }
  }
}

function buildTableLayerShapes(layer: TableLayer, ctx: SlideContext): string[] {
  // A live table layer can scroll through a larger preview window. PPTX has
  // no equivalent nested scroll surface, so preserve the initial slide view:
  // the header followed by the first visible body rows.
  const visibleBodyRows = layer.content.maxVisibleRows
    ? layer.content.rows.slice(0, Math.max(1, Math.floor(layer.content.maxVisibleRows)))
    : layer.content.rows;
  const rows = [layer.content.headers, ...visibleBodyRows];
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
  const width = Math.max(1, Math.round((layer.content.strokeWidth ?? 2) * EMU_PER_CANVAS_PX));
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

function buildTitleShape(title: MarkdownInlineNode[], ctx: SlideContext): string {
  const runs = inlineNodesToRuns(title, titleRunHandlers(ctx));
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
    runs +
    `</a:p>` +
    `</p:txBody>` +
    `</p:sp>`
  );
}

function titleRunHandlers(ctx: SlideContext): InlineRunHandlers {
  const handlers: InlineRunHandlers = {
    run: (text, format) => makeTitleRun(text, format, ctx.style),
    link: (node, format) => inlineNodesToRuns(node.children, handlers, format),
    image: (node, format) => makeTitleRun(node.alt ?? '', format, ctx.style),
    icon: (node, format) => makeTitleIconRun(node, format, ctx),
    lineBreak: () => `<a:br/>`,
  };
  return handlers;
}

function makeTitleRun(text: string, format: InlineFormat, style: SlideStyle): string {
  if (!text) return '';
  const attrs = [`lang="en-US"`, `dirty="0"`, `sz="${DEFAULT_TITLE_SIZE}"`];
  if (format.bold) attrs.push(`b="1"`);
  if (format.italic) attrs.push(`i="1"`);
  if (format.strike) attrs.push(`strike="sngStrike"`);
  const typeface = format.code ? style.codeFont : style.titleFont;
  return (
    `<a:r><a:rPr ${attrs.join(' ')}>` +
    `<a:solidFill><a:srgbClr val="${style.titleColor}"/></a:solidFill>` +
    `<a:latin typeface="${escapeXml(typeface)}"/></a:rPr>` +
    `<a:t>${escapeXml(text)}</a:t></a:r>`
  );
}

function makeTitleIconRun(
  node: MarkdownInlineIcon,
  format: InlineFormat,
  ctx: SlideContext,
): string {
  const glyph = fontAwesomeGlyph(node.family, node.name);
  if (!glyph) return makeTitleRun(`{[${node.token}]}`, format, ctx.style);

  const face = fontAwesomeFace(node.family);
  ctx.iconFamilies.add(node.family);
  const attrs = [`lang="en-US"`, `dirty="0"`, `sz="${DEFAULT_TITLE_SIZE}"`];
  if (format.strike) attrs.push(`strike="sngStrike"`);
  return (
    `<a:r><a:rPr ${attrs.join(' ')}>` +
    `<a:solidFill><a:srgbClr val="${ctx.style.titleColor}"/></a:solidFill>` +
    `<a:latin typeface="${escapeXml(face.typeface)}"/></a:rPr>` +
    `<a:t>${escapeXml(glyph)}</a:t></a:r>`
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
    // An SVG file is never embedded as written (this fallback path has no
    // vector picture; it prints the placeholder instead).
    const data = isSvgImageSource(soloImage.url) ? undefined : ctx.images.get(soloImage.url);
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
  return `<a:p><a:pPr algn="ctr"><a:spcBef><a:spcPts val="600"/></a:spcBef><a:spcAft><a:spcPts val="1200"/></a:spcAft><a:buNone/></a:pPr><a:r><a:rPr lang="en-US" sz="800"><a:solidFill><a:srgbClr val="${ctx.style.mutedColor}"/></a:solidFill></a:rPr><a:t>────────────────────</a:t></a:r><a:endParaRPr lang="en-US" sz="800"/></a:p>`;
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

/**
 * Formatting state threaded down by the shared walker in
 * `shared/inlineRuns.ts`. An alias rather than a copy, so a newly threaded
 * format (vertical alignment, say) can't go unnoticed here.
 */
type InlineFormat = InlineRunFormat;

/**
 * PPTX leaf handlers for the shared run-based inline walker. The traversal
 * (format threading) lives in `shared/inlineRuns.ts`; these emit DrawingML.
 */
function pptxRunHandlers(ctx: SlideContext): InlineRunHandlers {
  return {
    run: (text, format) => makeRun(text, format, ctx.style),
    link: (node, format) => convertLink(node, ctx, format),
    image: (node, format) => convertImage(node, format, ctx),
    icon: (node, format) => makeIconRun(node, format, ctx),
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
  // DrawingML expresses vertical alignment as a `baseline` OFFSET in
  // thousandths of a percent of the font size, not as an enum — the values
  // PowerPoint itself writes for its Superscript/Subscript buttons.
  if (format.vertAlign) {
    rPrParts.push(`baseline="${format.vertAlign === 'superscript' ? 30000 : -25000}"`);
  }

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

function makeIconRun(node: MarkdownInlineIcon, format: InlineFormat, ctx: SlideContext): string {
  const glyph = fontAwesomeGlyph(node.family, node.name);
  if (!glyph) return makeRun(`{[${node.token}]}`, format, ctx.style);

  const face = fontAwesomeFace(node.family);
  ctx.iconFamilies.add(node.family);
  const attrs = [`lang="en-US"`, `dirty="0"`];
  if (format.strike) attrs.push(`strike="sngStrike"`);
  const fill = ctx.style.hasTheme
    ? `<a:solidFill><a:srgbClr val="${ctx.style.text}"/></a:solidFill>`
    : '';
  return (
    `<a:r><a:rPr ${attrs.join(' ')}>` +
    fill +
    `<a:latin typeface="${escapeXml(face.typeface)}"/>` +
    `</a:rPr><a:t>${escapeXml(glyph)}</a:t></a:r>`
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
    const data = isSvgImageSource(node.url) ? undefined : ctx.images.get(node.url);
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

/** The master, layouts and theme a deck's slides hang off. */
interface DeckStructure {
  /** One XML part per slide layout, in `slideLayoutN.xml` order. */
  layoutXmls: string[];
  /** The master, given the relationship id of each layout from it. */
  masterXml: (layoutRelIds: string[]) => string;
  themeXml: string;
}

/** The semantic path's structure: one Title and Content layout, Office's theme. */
const SEMANTIC_DECK_STRUCTURE: DeckStructure = {
  layoutXmls: [buildSlideLayoutXml('')],
  masterXml: ([layoutRelId]) => buildSlideMasterXml(layoutRelId!),
  themeXml: buildThemeXml(),
};

async function buildPptxPackage(
  slideXmls: string[],
  slideContexts: SlideContext[],
  options: PptxExportOptions,
  structure: DeckStructure = SEMANTIC_DECK_STRUCTURE,
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

  const slideRelIds: string[] = [];
  for (let i = 0; i < slideCount; i++) {
    slideRelIds.push(relIds.alloc(PRESENTATION_PART));
  }
  const slideMasterRelId = relIds.alloc(PRESENTATION_PART);
  const themeRelId = relIds.alloc(PRESENTATION_PART);
  const usedIconFamilies = new Set<IconFamily>();
  for (const ctx of slideContexts) {
    for (const family of ctx.iconFamilies) usedIconFamilies.add(family);
  }
  const embeddedIconFonts = fontAwesomeFaces(usedIconFamilies).map((face) => ({
    face,
    relId: relIds.alloc(PRESENTATION_PART),
  }));

  // --- ppt/presentation.xml ---
  const presentationXml = buildPresentationXml(
    slideCount,
    slideRelIds,
    slideMasterRelId,
    themeRelId,
    embeddedIconFonts.map(({ face, relId }) => ({ typeface: face.typeface, relId })),
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

  // --- Slide layouts ---
  const masterLayoutRelIds: string[] = [];
  structure.layoutXmls.forEach((layoutXml, index) => {
    const layoutPart = `ppt/slideLayouts/slideLayout${index + 1}.xml`;
    const layoutMasterRelId = relIds.alloc(layoutPart);
    pkg.addPart(layoutPart, layoutXml, CONTENT_TYPE_PPTX_SLIDE_LAYOUT);
    pkg.addRelationship(layoutPart, {
      id: layoutMasterRelId,
      type: REL_SLIDE_MASTER,
      target: '../slideMasters/slideMaster1.xml',
    });
    const masterLayoutRelId = relIds.alloc(SLIDE_MASTER_PART);
    masterLayoutRelIds.push(masterLayoutRelId);
    pkg.addRelationship(SLIDE_MASTER_PART, {
      id: masterLayoutRelId,
      type: REL_SLIDE_LAYOUT,
      target: `../slideLayouts/slideLayout${index + 1}.xml`,
    });
  });

  // --- Slide master ---
  const masterThemeRelId = relIds.alloc(SLIDE_MASTER_PART);
  pkg.addPart(
    SLIDE_MASTER_PART,
    structure.masterXml(masterLayoutRelIds),
    CONTENT_TYPE_PPTX_SLIDE_MASTER,
  );
  pkg.addRelationship(SLIDE_MASTER_PART, {
    id: masterThemeRelId,
    type: REL_THEME,
    target: '../theme/theme1.xml',
  });

  // --- Theme ---
  pkg.addPart('ppt/theme/theme1.xml', structure.themeXml, CONTENT_TYPE_PPTX_THEME);

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
  for (const { face, relId } of embeddedIconFonts) {
    const filename = `${face.fileStem}.fntdata`;
    pkg.addBinaryPart(`ppt/fonts/${filename}`, face.data, CONTENT_TYPE_PPTX_FONT);
    pkg.addRelationship('ppt/presentation.xml', {
      id: relId,
      type: REL_FONT,
      target: `fonts/${filename}`,
    });
  }

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

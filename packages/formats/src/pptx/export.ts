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

import type { Doc } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import { docToMarkdown } from '@bendyline/squisq/doc';
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

import { createPackage } from '../ooxml/writer.js';
import { xmlDeclaration, escapeXml } from '../ooxml/xmlUtils.js';
import {
  NS_PML,
  NS_DRAWINGML,
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
  /**
   * Image data keyed by the path/URL used in markdown.
   * When provided, images are embedded as picture shapes instead of
   * showing `[Image: alt]` placeholders.
   */
  images?: Map<string, ArrayBuffer>;
}

/**
 * Convert a MarkdownDocument to a .pptx ArrayBuffer.
 */
export async function markdownDocToPptx(
  doc: MarkdownDocument,
  options: PptxExportOptions = {},
): Promise<ArrayBuffer> {
  // Resolve theme from options or frontmatter
  const themeId =
    options.themeId ??
    (doc.frontmatter?.themeId as string | undefined) ??
    (doc.frontmatter?.theme as string | undefined);
  const style = resolveSlideStyle(themeId, options);

  const slides = segmentIntoSlides(doc.children, options.slideBreak ?? 'h2');

  // Ensure at least one slide
  if (slides.length === 0) {
    slides.push({ bodyNodes: [] });
  }

  const slideXmls: string[] = [];
  const slideContexts: SlideContext[] = [];

  for (let i = 0; i < slides.length; i++) {
    const ctx = new SlideContext(style, options.images, i);
    const xml = buildSlideXml(slides[i], ctx);
    slideXmls.push(xml);
    slideContexts.push(ctx);
  }

  return buildPptxPackage(slideXmls, slideContexts, options);
}

/**
 * Convert a squisq Doc to a .pptx ArrayBuffer.
 *
 * Convenience wrapper: Doc -> MarkdownDocument -> PPTX.
 */
export async function docToPptx(doc: Doc, options: PptxExportOptions = {}): Promise<ArrayBuffer> {
  const markdownDoc = docToMarkdown(doc);
  // Carry themeId from Doc if not set in options
  if (!options.themeId && doc.themeId) {
    options = { ...options, themeId: doc.themeId };
  }
  return markdownDocToPptx(markdownDoc, options);
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

function resolveSlideStyle(themeId: string | undefined, options: PptxExportOptions): SlideStyle {
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

  const theme: Theme = resolveTheme(themeId);
  const c = theme.colors;

  return {
    background: stripHash(c.background),
    text: stripHash(c.text),
    titleColor: stripHash(c.highlight || c.secondary || c.text),
    mutedColor: stripHash(c.textMuted || c.text),
    titleFont: theme.typography?.titleFontFamily || DEFAULT_TITLE_FONT,
    bodyFont: theme.typography?.bodyFontFamily || options.defaultFont || DEFAULT_FONT,
    codeFont: theme.typography?.monoFontFamily || DEFAULT_CODE_FONT,
    codeColor: stripHash(c.textMuted || c.text),
    hasTheme: true,
  };
}

function stripHash(color: string): string {
  return color.startsWith('#') ? color.slice(1) : color;
}

// ============================================
// Slide Segmentation
// ============================================

interface SlideData {
  title?: string;
  titleDepth?: number;
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

function extractPlainText(nodes: MarkdownInlineNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parts.push(node.value);
        break;
      case 'inlineCode':
        parts.push(node.value);
        break;
      case 'strong':
      case 'emphasis':
      case 'delete':
        parts.push(extractPlainText(node.children));
        break;
      case 'link':
        parts.push(extractPlainText(node.children));
        break;
      case 'image':
        parts.push(node.alt ?? '');
        break;
      case 'inlineMath':
        parts.push(node.value);
        break;
      default:
        break;
    }
  }
  return parts.join('');
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
  private nextRelId = 1;

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

  constructor(style: SlideStyle, images: Map<string, ArrayBuffer> | undefined, slideIndex: number) {
    this.style = style;
    this.images = images;
    this.slideIndex = slideIndex;
  }

  allocRelId(): string {
    return `rId${this.nextRelId++ + 1}`;
  }

  allocShapeId(): number {
    return this.nextShapeId++;
  }

  addHyperlink(url: string): string {
    const id = this.allocRelId();
    this.relationships.push({
      id,
      type: REL_HYPERLINK,
      target: url,
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

  return (
    xmlDeclaration() +
    `<p:sld xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}">` +
    `<p:cSld>` +
    bgXml +
    `<p:spTree>` +
    shapes.join('') +
    `</p:spTree>` +
    `</p:cSld>` +
    `</p:sld>`
  );
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
        `<a:rPr lang="en-US" sz="${DEFAULT_CODE_SIZE}" dirty="0">` +
        `<a:latin typeface="${escapeXml(ctx.style.codeFont)}"/>` +
        `<a:solidFill><a:srgbClr val="${ctx.style.codeColor}"/></a:solidFill>` +
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

function convertInlines(
  nodes: MarkdownInlineNode[],
  ctx: SlideContext,
  format: InlineFormat = {},
): string {
  const parts: string[] = [];
  for (const node of nodes) {
    parts.push(convertInline(node, ctx, format));
  }
  return parts.join('');
}

function convertInline(node: MarkdownInlineNode, ctx: SlideContext, format: InlineFormat): string {
  switch (node.type) {
    case 'text':
      return makeRun(node.value, format, ctx.style);
    case 'strong':
      return convertInlines(node.children, ctx, { ...format, bold: true });
    case 'emphasis':
      return convertInlines(node.children, ctx, { ...format, italic: true });
    case 'delete':
      return convertInlines(node.children, ctx, { ...format, strike: true });
    case 'inlineCode':
      return makeRun(node.value, { ...format, code: true }, ctx.style);
    case 'link':
      return convertLink(node, ctx, format);
    case 'image':
      return convertImage(node, format, ctx);
    case 'break':
      return `<a:br/>`;
    case 'htmlInline':
      return makeRun(stripHtmlTags(node.rawHtml), format, ctx.style);
    case 'inlineMath':
      return makeRun(node.value, { ...format, code: true }, ctx.style);
    default:
      return '';
  }
}

function makeRun(text: string, format: InlineFormat, style: SlideStyle): string {
  if (!text) return '';

  const rPrParts: string[] = [`lang="en-US"`, `dirty="0"`];

  if (format.bold) rPrParts.push(`b="1"`);
  if (format.italic) rPrParts.push(`i="1"`);
  if (format.strike) rPrParts.push(`strike="sngStrike"`);

  let innerParts = '';

  if (format.code) {
    innerParts += `<a:latin typeface="${escapeXml(style.codeFont)}"/>`;
    innerParts += `<a:solidFill><a:srgbClr val="${style.codeColor}"/></a:solidFill>`;
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

  const slideMasterRelId = 'rId100';
  const themeRelId = 'rId101';
  const slideRelIds: string[] = [];

  for (let i = 0; i < slideCount; i++) {
    slideRelIds.push(`rId${i + 1}`);
  }

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

    pkg.addRelationship(slidePath, {
      id: 'rId1',
      type: REL_SLIDE_LAYOUT,
      target: '../slideLayouts/slideLayout1.xml',
    });

    // Per-slide relationships (hyperlinks + images)
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
  const layoutMasterRelId = 'rId1';
  const slideLayoutXml = buildSlideLayoutXml(layoutMasterRelId);
  pkg.addPart('ppt/slideLayouts/slideLayout1.xml', slideLayoutXml, CONTENT_TYPE_PPTX_SLIDE_LAYOUT);
  pkg.addRelationship('ppt/slideLayouts/slideLayout1.xml', {
    id: layoutMasterRelId,
    type: REL_SLIDE_MASTER,
    target: '../slideMasters/slideMaster1.xml',
  });

  // --- Slide master ---
  const masterLayoutRelId = 'rId1';
  const masterThemeRelId = 'rId2';
  const slideMasterXml = buildSlideMasterXml(masterLayoutRelId);
  pkg.addPart('ppt/slideMasters/slideMaster1.xml', slideMasterXml, CONTENT_TYPE_PPTX_SLIDE_MASTER);
  pkg.addRelationship('ppt/slideMasters/slideMaster1.xml', {
    id: masterLayoutRelId,
    type: REL_SLIDE_LAYOUT,
    target: '../slideLayouts/slideLayout1.xml',
  });
  pkg.addRelationship('ppt/slideMasters/slideMaster1.xml', {
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

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function inferExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'png';
  const ext = path
    .substring(dot + 1)
    .toLowerCase()
    .split('?')[0];
  return ext || 'png';
}

function inferMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    avif: 'image/avif',
  };
  return mimeTypes[ext] || 'image/png';
}

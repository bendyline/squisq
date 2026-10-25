/**
 * PDF Export
 *
 * Converts a squisq MarkdownDocument (or Doc) into a PDF file
 * using pdf-lib. Generates paginated, styled output with support for
 * headings, paragraphs, inline formatting, lists, code blocks,
 * blockquotes, tables, thematic breaks, and hyperlinks.
 *
 * Uses the standard PDF fonts for authored text and embeds/subsets Font
 * Awesome only when the document contains an inline icon.
 *
 * @example
 * ```ts
 * import { parseMarkdown } from '@bendyline/squisq/markdown';
 * import { markdownDocToPdf } from '@bendyline/squisq-formats/pdf';
 *
 * const md = parseMarkdown('# Hello\n\nWorld **bold** text');
 * const buffer = await markdownDocToPdf(md);
 * ```
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFImage, PDFPage, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import type { Doc, ThemeRegistry } from '@bendyline/squisq/schemas';
import { contrastRatio } from '@bendyline/squisq/schemas';
import { docToMarkdown, resolveThemeForDoc } from '@bendyline/squisq/doc';
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
  MarkdownTableCell,
  MarkdownHtmlBlock,
  MarkdownMathBlock,
  MarkdownFootnoteDefinition,
  MarkdownText,
  MarkdownEmphasis,
  MarkdownStrong,
  MarkdownStrikethrough,
  MarkdownSuperscript,
  MarkdownSubscript,
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownImage,
  MarkdownInlineHtml,
  MarkdownInlineMath,
  MarkdownFootnoteReference,
  MarkdownInlineIcon,
  MarkdownNode,
} from '@bendyline/squisq/markdown';
import { isHtmlLineBreak, readFrontmatterThemeId, sanitizeUrl } from '@bendyline/squisq/markdown';
import { FootnoteIndex } from '../shared/footnotes.js';
import { authoredImageSize, fitWithin, readImageDimensions } from '../shared/images.js';

import { WinAnsiTracker } from './winAnsi.js';
import {
  PdfTextRuns,
  embedUnicodeFaces,
  loadBundledUnicodeFonts,
  needsUnicodeFont,
  type PdfUnicodeFonts,
  type UnicodeFace,
} from './unicodeText.js';
import {
  collectInlineIconFamilies,
  fontAwesomeFaces,
  fontAwesomeGlyph,
  type IconFamily,
} from '../shared/fontAwesome.js';
import {
  PAGE_WIDTH_LETTER,
  PAGE_HEIGHT_LETTER,
  PAGE_WIDTH_A4,
  PAGE_HEIGHT_A4,
  DEFAULT_MARGIN,
  DEFAULT_FONT_SIZE,
  HEADING_SIZES,
  CODE_FONT_SIZE,
  LINE_HEIGHT_FACTOR,
  HEADING_SPACE_BEFORE,
  HEADING_SPACE_AFTER,
  PARAGRAPH_SPACING,
  LIST_INDENT,
  BULLET_CHAR,
  BLOCKQUOTE_INDENT,
  BLOCKQUOTE_BAR_WIDTH,
  COLOR_TEXT,
  COLOR_HEADING,
  COLOR_LINK,
  COLOR_CODE_TEXT,
  COLOR_BLOCKQUOTE_BAR,
  COLOR_BLOCKQUOTE_TEXT,
  COLOR_THEMATIC_BREAK,
  COLOR_TABLE_BORDER,
  COLOR_TABLE_HEADER_BG,
  TABLE_CELL_PAD_X,
  TABLE_CELL_PAD_Y,
  TABLE_BORDER_WIDTH,
} from './styles.js';

// ============================================
// Public API
// ============================================

/** Page size presets. */
export type PdfPageSize = 'letter' | 'a4';

/**
 * Options for PDF export.
 */
export interface PdfExportOptions {
  /** Cancel at bounded export checkpoints. */
  signal?: AbortSignal;
  /** Document title (PDF metadata). */
  title?: string;
  /** Document author (PDF metadata). */
  author?: string;
  /** Page size preset. Default: "letter". */
  pageSize?: PdfPageSize;
  /** Page margins in points. Default: 72 (1 inch). */
  margin?: number;
  /** Default body font size in points. Default: 11. */
  defaultFontSize?: number;
  /**
   * Squisq theme ID to apply (e.g., 'documentary', 'cinematic').
   * Uses readable heading, text, and link colors from the theme palette on
   * white paper. Colors with insufficient contrast use the default PDF ink.
   * Font changes are not supported (pdf-lib uses standard 14 PDF fonts only).
   */
  themeId?: string;
  /** Explicit caller-owned registry for non-document custom themes. */
  themeRegistry?: ThemeRegistry;
  /**
   * Image data keyed by the image URL/path as it appears in the markdown.
   * A PNG or JPEG found here is drawn when it stands alone in a paragraph
   * (scaled to the text width and the page, centered); images inside running
   * text, and any not supplied, still print as an `[Image: alt]` note.
   *
   * `width` / `height` give the display size in CSS pixels (96 per inch).
   * Pass them for a high-density image, such as a diagram rendered at 2×;
   * otherwise the pixel size is used.
   */
  images?: Map<
    string,
    { data: ArrayBuffer | Uint8Array; contentType?: string; width?: number; height?: number }
  >;
  /**
   * Receives non-fatal notes about the export — today, the one-shot summary
   * raised when characters outside the standard PDF fonts' WinAnsi encoding
   * had to be substituted. When omitted, such notes go to `console.warn`.
   * The registry passes a collector so the message reaches
   * `ConversionResult.warnings` instead.
   */
  onWarning?: (message: string) => void;
  /**
   * Fonts that draw what the standard PDF fonts cannot encode — Greek,
   * Cyrillic, Vietnamese, arrows, math, box drawing, symbols. Default: the
   * bundled DejaVu Sans faces, embedded (subset) only in a document that has
   * such text. Pass your own faces to cover other scripts, or `false` to keep
   * the standard fonts alone and replace those characters.
   */
  unicodeFonts?: PdfUnicodeFonts | false;
}

/**
 * Convert a MarkdownDocument to a PDF ArrayBuffer.
 */
export async function markdownDocToPdf(
  doc: MarkdownDocument,
  options: PdfExportOptions = {},
): Promise<ArrayBuffer> {
  options.signal?.throwIfAborted();
  const pdfDoc = await PDFDocument.create();

  // Metadata
  if (options.title) pdfDoc.setTitle(options.title);
  if (options.author) pdfDoc.setAuthor(options.author);
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());

  const ctx = await createExportContext(pdfDoc, options, doc);
  // Embedding is async and drawing is not, so every image is embedded first.
  ctx.images = await embedDocumentImages(pdfDoc, doc, options.images);

  renderBlocks(doc.children, ctx, 0);

  // Report unencodable-character substitution ONCE for the whole export,
  // rather than per character (a CJK document would emit thousands).
  const warning = ctx.text.warning({ unicodeFont: ctx.unicodeFont });
  if (warning) {
    if (options.onWarning) options.onWarning(warning);
    else console.warn(warning);
  }

  const bytes = await pdfDoc.save();
  return bytes.buffer as ArrayBuffer;
}

/**
 * Convert a squisq Doc to a PDF ArrayBuffer.
 *
 * Convenience wrapper: Doc → MarkdownDocument → PDF.
 */
export async function docToPdf(doc: Doc, options: PdfExportOptions = {}): Promise<ArrayBuffer> {
  const markdownDoc = docToMarkdown(doc);
  return markdownDocToPdf(markdownDoc, options);
}

// ============================================
// Export Context — tracks cursor, fonts, pages
// ============================================

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
  icons: Partial<Record<IconFamily, PDFFont>>;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface ExportContext {
  pdfDoc: PDFDocument;
  fonts: FontSet;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  fontSize: number;
  /** Current page being drawn on. */
  page: PDFPage;
  /** Current y position (from top of page, decreasing). */
  y: number;
  /** Content area width = pageWidth - 2*margin. */
  contentWidth: number;
  /** Bottom margin y position. */
  bottomY: number;
  /**
   * Footnote numbering for the document, so a marker and its definition show
   * the same number and both agree with the HTML/EPUB exporters. Undefined
   * only for documents with no footnotes.
   */
  footnotes?: FootnoteIndex;
  /** Resolved colors (may be overridden by theme). */
  colors: {
    text: RgbColor;
    heading: RgbColor;
    link: RgbColor;
  };
  /**
   * WinAnsi safety net and substitution tally. EVERY string handed to pdf-lib —
   * whether to draw it or merely to measure it — must go through `ctx.runs`
   * (which cleans with this), both because pdf-lib throws on unencodable code
   * points and because measuring the raw string while drawing the sanitized one
   * would desynchronize layout.
   */
  text: WinAnsiTracker;
  /**
   * Splits text into runs with the font that draws each one — the standard
   * font, or the embedded Unicode face for what WinAnsi cannot encode. Text is
   * drawn and measured through this, which cleans it with `text` as it goes.
   */
  runs: PdfTextRuns;
  /** Whether a Unicode font is embedded for this document. */
  unicodeFont: boolean;
  signal?: AbortSignal;
  /** Embedded images by markdown URL, with their display size in CSS pixels. */
  images: Map<string, EmbeddedPdfImage>;
}

interface EmbeddedPdfImage {
  image: PDFImage;
  width: number;
  height: number;
}

/** CSS pixels are 1/96 in; PDF points are 1/72 in. */
const POINTS_PER_CSS_PIXEL = 0.75;

function collectImageUrls(nodes: readonly MarkdownNode[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    if (node.type === 'image') into.add((node as MarkdownImage).url);
    const children = (node as { children?: unknown }).children;
    if (Array.isArray(children)) collectImageUrls(children as MarkdownNode[], into);
  }
  return into;
}

/** Embed every supplied PNG or JPEG the document references. */
async function embedDocumentImages(
  pdfDoc: PDFDocument,
  doc: MarkdownDocument,
  images: PdfExportOptions['images'],
): Promise<Map<string, EmbeddedPdfImage>> {
  const embedded = new Map<string, EmbeddedPdfImage>();
  if (!images || images.size === 0) return embedded;
  for (const url of collectImageUrls(doc.children, new Set())) {
    const entry = images.get(url);
    if (!entry) continue;
    const bytes = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpeg) continue;
    try {
      const image = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const pixels = readImageDimensions(bytes) ?? { width: image.width, height: image.height };
      const sized = Boolean(entry.width && entry.height);
      embedded.set(url, {
        image,
        width: sized ? (entry.width as number) : pixels.width,
        height: sized ? (entry.height as number) : pixels.height,
      });
    } catch {
      // A damaged image keeps its text note rather than failing the export.
    }
  }
  return embedded;
}

async function createExportContext(
  pdfDoc: PDFDocument,
  options: PdfExportOptions,
  doc: MarkdownDocument,
): Promise<ExportContext> {
  const [regular, bold, italic, boldItalic, mono, monoBold] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
    pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
    pdfDoc.embedFont(StandardFonts.Courier),
    pdfDoc.embedFont(StandardFonts.CourierBold),
  ]);
  let unicodeFaces: Map<PDFFont, UnicodeFace> = new Map();
  if (options.unicodeFonts !== false && needsUnicodeFont(doc)) {
    const faces = options.unicodeFonts ?? (await loadBundledUnicodeFonts());
    unicodeFaces = await embedUnicodeFaces(pdfDoc, faces, {
      regular,
      bold,
      italic,
      boldItalic,
      mono,
      monoBold,
    });
  }
  const icons: Partial<Record<IconFamily, PDFFont>> = {};
  const iconFamilies = collectInlineIconFamilies(doc);
  if (iconFamilies.size > 0) {
    pdfDoc.registerFontkit(fontkit);
    await Promise.all(
      fontAwesomeFaces(iconFamilies).map(async (face) => {
        icons[face.family] = await pdfDoc.embedFont(face.data, { subset: true });
      }),
    );
  }

  const isA4 = options.pageSize === 'a4';
  const pageWidth = isA4 ? PAGE_WIDTH_A4 : PAGE_WIDTH_LETTER;
  const pageHeight = isA4 ? PAGE_HEIGHT_A4 : PAGE_HEIGHT_LETTER;
  const margin = options.margin ?? DEFAULT_MARGIN;
  const fontSize = options.defaultFontSize ?? DEFAULT_FONT_SIZE;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // Resolve theme colors if themeId is set
  let colorText = COLOR_TEXT;
  let colorHeading = COLOR_HEADING;
  let colorLink = COLOR_LINK;

  // Honor an explicit themeId, else the doc's frontmatter theme (`squisq-theme`
  // / legacy) — mirroring PPTX/DOCX/HTML so every format themes consistently,
  // including inline custom themes (resolved doc-scoped).
  const themeId = options.themeId ?? readFrontmatterThemeId(doc.frontmatter);
  if (themeId) {
    const theme = resolveThemeForDoc(doc, themeId, options.themeRegistry);
    if (theme.colors) {
      colorText = paperInk(theme.colors.text, COLOR_TEXT);
      colorHeading = paperInk(theme.colors.primary, COLOR_HEADING);
      colorLink = paperInk(theme.colors.highlight || theme.colors.secondary, COLOR_LINK);
    }
  }

  const text = new WinAnsiTracker();
  return {
    pdfDoc,
    fonts: { regular, bold, italic, boldItalic, mono, monoBold, icons },
    pageWidth,
    pageHeight,
    margin,
    fontSize,
    page,
    y: pageHeight - margin,
    contentWidth: pageWidth - 2 * margin,
    bottomY: margin,
    colors: { text: colorText, heading: colorHeading, link: colorLink },
    footnotes: new FootnoteIndex(doc),
    text,
    runs: new PdfTextRuns(text, unicodeFaces),
    unicodeFont: unicodeFaces.size > 0,
    signal: options.signal,
    images: new Map(),
  };
}

// ============================================
// Page Break Management
// ============================================

function ensureSpace(ctx: ExportContext, needed: number): void {
  if (ctx.y - needed < ctx.bottomY) {
    newPage(ctx);
  }
}

function newPage(ctx: ExportContext): void {
  const page = ctx.pdfDoc.addPage([ctx.pageWidth, ctx.pageHeight]);
  ctx.page = page;
  ctx.y = ctx.pageHeight - ctx.margin;
}

// ============================================
// Inline "Span" Model
// ============================================

/** Superscript / subscript are drawn at this fraction of the surrounding size. */
const VERT_ALIGN_SCALE = 0.72;

/**
 * Baseline offset in points for a shifted run, as a fraction of the
 * SURROUNDING text size (not the shrunken one) so the shift stays visually
 * constant. The subscript drop is smaller than the superscript rise because it
 * has the glyph descenders to clear rather than the ascenders.
 */
function vertAlignShift(kind: 'superscript' | 'subscript', baseSize: number): number {
  return kind === 'superscript' ? baseSize * 0.33 : baseSize * -0.14;
}

interface TextSpan {
  text: string;
  font: PDFFont;
  fontSize: number;
  color: { r: number; g: number; b: number };
  link?: string;
  strikethrough?: boolean;
  /**
   * Points to raise (positive) or lower (negative) this span off the line's
   * baseline — how superscripts and subscripts are drawn, since pdf-lib has no
   * concept of vertical alignment. Kept small enough that a shifted span stays
   * inside the line box `getLineHeight` reserves.
   */
  baselineShift?: number;
}

/**
 * Flatten an inline node tree into a flat list of TextSpans,
 * accumulating bold/italic/code state as we recurse.
 */
function flattenInlines(
  nodes: MarkdownInlineNode[],
  ctx: ExportContext,
  state: {
    bold: boolean;
    italic: boolean;
    code: boolean;
    link?: string;
    color?: { r: number; g: number; b: number };
    strikethrough?: boolean;
    vertAlign?: 'superscript' | 'subscript';
  },
): TextSpan[] {
  const spans: TextSpan[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        const font = state.code
          ? state.bold
            ? ctx.fonts.monoBold
            : ctx.fonts.mono
          : pickFont(ctx, state.bold, state.italic);
        const baseSize = state.code ? CODE_FONT_SIZE : ctx.fontSize;
        spans.push(
          ...textSpans(ctx, (node as MarkdownText).value, font, {
            fontSize: state.vertAlign ? baseSize * VERT_ALIGN_SCALE : baseSize,
            color: state.code ? COLOR_CODE_TEXT : (state.color ?? ctx.colors.text),
            link: state.link,
            strikethrough: state.strikethrough,
            ...(state.vertAlign
              ? { baselineShift: vertAlignShift(state.vertAlign, baseSize) }
              : {}),
          }),
        );
        break;
      }

      case 'strong':
        spans.push(
          ...flattenInlines((node as MarkdownStrong).children, ctx, { ...state, bold: true }),
        );
        break;

      case 'emphasis':
        spans.push(
          ...flattenInlines((node as MarkdownEmphasis).children, ctx, { ...state, italic: true }),
        );
        break;

      case 'delete':
        spans.push(
          ...flattenInlines((node as MarkdownStrikethrough).children, ctx, {
            ...state,
            strikethrough: true,
          }),
        );
        break;

      case 'superscript':
      case 'subscript':
        spans.push(
          ...flattenInlines((node as MarkdownSuperscript | MarkdownSubscript).children, ctx, {
            ...state,
            vertAlign: node.type === 'superscript' ? 'superscript' : 'subscript',
          }),
        );
        break;

      case 'inlineCode': {
        spans.push(
          ...textSpans(ctx, (node as MarkdownInlineCode).value, ctx.fonts.mono, {
            fontSize: CODE_FONT_SIZE,
            color: COLOR_CODE_TEXT,
            link: state.link,
          }),
        );
        break;
      }

      case 'link': {
        const linkNode = node as MarkdownLink;
        const safeLink = sanitizeUrl(linkNode.url, 'link') ?? undefined;
        spans.push(
          ...flattenInlines(linkNode.children, ctx, {
            ...state,
            link: safeLink,
            color: safeLink ? ctx.colors.link : state.color,
          }),
        );
        break;
      }

      case 'image': {
        const imgNode = node as MarkdownImage;
        spans.push(
          ...textSpans(ctx, imgNode.alt ? `[Image: ${imgNode.alt}]` : '[Image]', ctx.fonts.italic, {
            fontSize: ctx.fontSize,
            color: COLOR_BLOCKQUOTE_TEXT,
          }),
        );
        break;
      }

      case 'inlineIcon': {
        const iconNode = node as MarkdownInlineIcon;
        const glyph = fontAwesomeGlyph(iconNode.family, iconNode.name);
        const font = ctx.fonts.icons[iconNode.family];
        if (glyph && font) {
          spans.push({
            text: glyph,
            font,
            fontSize: ctx.fontSize,
            color: state.color ?? ctx.colors.text,
            link: state.link,
            strikethrough: state.strikethrough,
          });
        } else {
          spans.push(
            ...textSpans(ctx, `{[${iconNode.token}]}`, pickFont(ctx, state.bold, state.italic), {
              fontSize: ctx.fontSize,
              color: state.color ?? ctx.colors.text,
              link: state.link,
              strikethrough: state.strikethrough,
            }),
          );
        }
        break;
      }

      case 'break':
        spans.push(lineBreakSpan(ctx));
        break;

      case 'htmlInline': {
        const html = (node as MarkdownInlineHtml).rawHtml;
        // `<br>` is how a table cell breaks a line (the editor writes one for
        // Enter there), not markup to print.
        if (isHtmlLineBreak(html)) {
          spans.push(lineBreakSpan(ctx));
        } else if (html) {
          spans.push(
            ...textSpans(ctx, html, ctx.fonts.mono, {
              fontSize: CODE_FONT_SIZE,
              color: COLOR_CODE_TEXT,
            }),
          );
        }
        break;
      }

      case 'inlineMath':
        spans.push(
          ...textSpans(ctx, (node as MarkdownInlineMath).value, ctx.fonts.mono, {
            fontSize: CODE_FONT_SIZE,
            color: COLOR_CODE_TEXT,
          }),
        );
        break;

      case 'footnoteReference': {
        const ref = node as MarkdownFootnoteReference;
        // A raised number, the way a printed footnote marker reads — the
        // bracketed `[id]` this used to draw sat on the baseline and showed
        // whatever identifier the source happened to use.
        const marker = ctx.footnotes
          ? String(ctx.footnotes.cite(ref.identifier).number)
          : (ref.label ?? ref.identifier);
        spans.push(
          ...textSpans(ctx, marker, ctx.fonts.regular, {
            fontSize: ctx.fontSize * VERT_ALIGN_SCALE,
            color: ctx.colors.link,
            baselineShift: vertAlignShift('superscript', ctx.fontSize),
          }),
        );
        break;
      }

      // linkReference, imageReference, textDirective — render children or identifier
      default: {
        const fallback = node as unknown as { children?: MarkdownInlineNode[]; value?: string };
        if (fallback.children) {
          spans.push(...flattenInlines(fallback.children, ctx, state));
        } else if (fallback.value) {
          spans.push(
            ...textSpans(ctx, fallback.value, pickFont(ctx, state.bold, state.italic), {
              fontSize: ctx.fontSize,
              color: state.color ?? ctx.colors.text,
            }),
          );
        }
        break;
      }
    }
  }

  return spans;
}

/**
 * A forced line break. Deliberately NOT sanitized: this "\n" is our own
 * control token, not document text. `wrapSpans` matches it exactly to force a
 * line break and consumes it, so it never reaches pdf-lib. (Newlines occurring
 * *inside* author text are sanitized to spaces like any other unencodable
 * character.)
 */
function lineBreakSpan(ctx: ExportContext): TextSpan {
  return { text: '\n', font: ctx.fonts.regular, fontSize: ctx.fontSize, color: ctx.colors.text };
}

const STANDARD_FONT_NAMES: ReadonlySet<string> = new Set(Object.values(StandardFonts));

/**
 * The width pdf-lib actually draws. For the standard fonts,
 * `widthOfTextAtSize` adds the font's kerning pairs, but `drawText` never
 * applies kerning. A word measured that way ends before its drawn glyphs do,
 * so the next word starts inside the space ("Typeto", "PDF,a"). Measuring one
 * character at a time drops the pairs. Embedded fonts already measure glyph
 * advances without kerning, and keep their ligatures.
 */
function drawnWidth(font: PDFFont, text: string, size: number): number {
  if (!STANDARD_FONT_NAMES.has(font.name)) return font.widthOfTextAtSize(text, size);
  let width = 0;
  for (const character of text) width += font.widthOfTextAtSize(character, size);
  return width;
}

/**
 * The spans for one stretch of text: one per run `ctx.runs` splits it into,
 * each in the font that draws it, all sharing the rest of the styling.
 */
function textSpans(
  ctx: ExportContext,
  text: string,
  font: PDFFont,
  style: Omit<TextSpan, 'text' | 'font'>,
): TextSpan[] {
  return ctx.runs.split(text, font).map((run) => ({ ...style, text: run.text, font: run.font }));
}

/**
 * Draw one line of text with its baseline at `at.y`, switching to the Unicode
 * face wherever `ctx.runs` says a run needs it.
 */
function drawTextLine(
  ctx: ExportContext,
  text: string,
  font: PDFFont,
  at: { x: number; y: number; size: number; color: RgbColor },
): void {
  let x = at.x;
  for (const run of ctx.runs.split(text, font)) {
    if (run.text.length === 0) continue;
    ctx.page.drawText(run.text, {
      x,
      y: at.y,
      size: at.size,
      font: run.font,
      color: rgb(at.color.r, at.color.g, at.color.b),
    });
    x += drawnWidth(run.font, run.text, at.size);
  }
}

function pickFont(ctx: ExportContext, bold: boolean, italic: boolean): PDFFont {
  if (bold && italic) return ctx.fonts.boldItalic;
  if (bold) return ctx.fonts.bold;
  if (italic) return ctx.fonts.italic;
  return ctx.fonts.regular;
}

// ============================================
// Word-Wrap & Draw
// ============================================

/**
 * Word-wraps and draws a flat list of TextSpans within the given
 * available width, starting at ctx.y. Updates ctx.y after drawing.
 * Returns the y position after the last line.
 */
function drawSpans(
  spans: TextSpan[],
  ctx: ExportContext,
  availableWidth: number,
  x0: number,
): void {
  if (spans.length === 0) return;

  // Split spans at \n and word boundaries, then wrap into lines
  const lines = wrapSpans(spans, availableWidth);

  for (const line of lines) {
    const lineHeight = getLineHeight(line);
    ensureSpace(ctx, lineHeight);

    let x = x0;
    for (const span of line) {
      const spanBaseline = ctx.y - span.fontSize + (span.baselineShift ?? 0);
      ctx.page.drawText(span.text, {
        x,
        y: spanBaseline, // pdf-lib y is baseline
        size: span.fontSize,
        font: span.font,
        color: rgb(span.color.r, span.color.g, span.color.b),
      });

      const textWidth = drawnWidth(span.font, span.text, span.fontSize);

      // Underline for links
      if (span.link) {
        const baseline = spanBaseline;
        ctx.page.drawLine({
          start: { x, y: baseline - 1 },
          end: { x: x + textWidth, y: baseline - 1 },
          thickness: 0.5,
          color: rgb(span.color.r, span.color.g, span.color.b),
        });
        const annotation = ctx.pdfDoc.context.register(
          ctx.pdfDoc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [x, baseline - 2, x + textWidth, baseline + span.fontSize + 2],
            Border: [0, 0, 0],
            A: {
              Type: 'Action',
              S: 'URI',
              URI: PDFString.of(span.link),
            },
          }),
        );
        ctx.page.node.addAnnot(annotation);
      }

      // Strikethrough
      if (span.strikethrough) {
        const midY = spanBaseline + span.fontSize * 0.4;
        ctx.page.drawLine({
          start: { x, y: midY },
          end: { x: x + textWidth, y: midY },
          thickness: 0.5,
          color: rgb(span.color.r, span.color.g, span.color.b),
        });
      }

      x += textWidth;
    }

    ctx.y -= lineHeight;
  }
}

/**
 * Break a flat list of spans into wrapped lines that fit within
 * `maxWidth`. Respects explicit \n characters.
 */
function wrapSpans(spans: TextSpan[], maxWidth: number): TextSpan[][] {
  const lines: TextSpan[][] = [];
  let currentLine: TextSpan[] = [];
  let lineWidth = 0;

  for (const span of spans) {
    // Handle explicit newlines
    if (span.text === '\n') {
      lines.push(currentLine);
      currentLine = [];
      lineWidth = 0;
      continue;
    }

    // Split by whitespace for word-wrapping, and break any word that could
    // never fit a line of its own.
    const words = splitIntoWords(span.text).flatMap((word) => breakLongWord(word, span, maxWidth));

    for (const word of words) {
      const wordWidth = drawnWidth(span.font, word, span.fontSize);

      if (lineWidth + wordWidth > maxWidth && currentLine.length > 0 && word.trim().length > 0) {
        // Wrap to next line
        lines.push(currentLine);
        currentLine = [];
        lineWidth = 0;
      }

      // Trim leading space on new line
      const trimmedWord = currentLine.length === 0 ? word.replace(/^\s+/, '') : word;
      if (trimmedWord.length > 0) {
        const tw = drawnWidth(span.font, trimmedWord, span.fontSize);
        currentLine.push({ ...span, text: trimmedWord });
        lineWidth += tw;
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [[]];
}

/**
 * A word wider than a whole line, cut into pieces that each fit one. A long
 * URL or an unbroken token otherwise runs past the page margin, or out of its
 * table cell and over the next cell's text. Text with no spaces at all, such
 * as CJK, breaks the same way.
 */
function breakLongWord(word: string, span: TextSpan, maxWidth: number): string[] {
  if (word.trim().length === 0 || drawnWidth(span.font, word, span.fontSize) <= maxWidth) {
    return [word];
  }
  const pieces: string[] = [];
  let piece = '';
  let pieceWidth = 0;
  for (const cluster of characterClusters(word)) {
    const width = drawnWidth(span.font, cluster, span.fontSize);
    if (piece && pieceWidth + width > maxWidth) {
      pieces.push(piece);
      piece = '';
      pieceWidth = 0;
    }
    piece += cluster;
    pieceWidth += width;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Whether a code point belongs to the character before it: a combining mark,
 * a zero-width joiner, a variation selector or an emoji skin tone.
 */
function continuesCluster(ch: string): boolean {
  const codePoint = ch.codePointAt(0) as number;
  return (
    /\p{M}/u.test(ch) ||
    codePoint === 0x200d ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
  );
}

/**
 * Text as the characters a reader sees, near enough to break a word between
 * them: a combining accent, variation selector or skin tone stays with the
 * character it modifies, and a zero-width joiner holds an emoji sequence
 * together.
 */
function characterClusters(text: string): string[] {
  const clusters: string[] = [];
  for (const ch of text) {
    const last = clusters.length - 1;
    if (last >= 0 && (continuesCluster(ch) || clusters[last]!.endsWith('‍'))) {
      clusters[last] += ch;
    } else {
      clusters.push(ch);
    }
  }
  return clusters;
}

/**
 * Split text into "words" preserving whitespace as separate tokens
 * so the wrapping logic can break at whitespace.
 */
function splitIntoWords(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSpace = false;

  for (const ch of text) {
    const isSpace = ch === ' ' || ch === '\t';
    if (isSpace !== inSpace && current.length > 0) {
      tokens.push(current);
      current = '';
    }
    current += ch;
    inSpace = isSpace;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function getLineHeight(line: TextSpan[]): number {
  let maxSize = 0;
  for (const span of line) {
    if (span.fontSize > maxSize) maxSize = span.fontSize;
  }
  return (maxSize || DEFAULT_FONT_SIZE) * LINE_HEIGHT_FACTOR;
}

// ============================================
// Block Renderers
// ============================================

function renderBlocks(nodes: MarkdownBlockNode[], ctx: ExportContext, extraIndent: number): void {
  for (let index = 0; index < nodes.length; index++) {
    if ((index & 255) === 0) ctx.signal?.throwIfAborted();
    const node = nodes[index]!;
    renderBlock(node, ctx, extraIndent);
  }
}

function renderBlock(node: MarkdownBlockNode, ctx: ExportContext, extraIndent: number): void {
  switch (node.type) {
    case 'heading':
      renderHeading(node as MarkdownHeading, ctx, extraIndent);
      break;
    case 'paragraph':
      renderParagraph(node as MarkdownParagraph, ctx, extraIndent);
      break;
    case 'blockquote':
      renderBlockquote(node as MarkdownBlockquote, ctx, extraIndent);
      break;
    case 'list':
      renderList(node as MarkdownList, ctx, extraIndent, 0);
      break;
    case 'code':
      renderCodeBlock(node as MarkdownCodeBlock, ctx, extraIndent);
      break;
    case 'table':
      renderTable(node as MarkdownTable, ctx, extraIndent);
      break;
    case 'thematicBreak':
      renderThematicBreak(ctx, extraIndent);
      break;
    case 'htmlBlock':
      renderHtmlBlock(node as MarkdownHtmlBlock, ctx, extraIndent);
      break;
    case 'math':
      renderMathBlock(node as MarkdownMathBlock, ctx, extraIndent);
      break;
    case 'footnoteDefinition':
      renderFootnoteDefinition(node as MarkdownFootnoteDefinition, ctx, extraIndent);
      break;
    default:
      // containerDirective, leafDirective, definitionList, etc.
      // Render any children or value as best-effort
      renderFallbackBlock(node, ctx, extraIndent);
      break;
  }
}

// ---- Heading ----

function renderHeading(node: MarkdownHeading, ctx: ExportContext, extraIndent: number): void {
  const origFontSize = ctx.fontSize;
  ctx.fontSize = HEADING_SIZES[node.depth] ?? DEFAULT_FONT_SIZE;

  ctx.y -= HEADING_SPACE_BEFORE;

  const x0 = ctx.margin + extraIndent;
  const w = ctx.contentWidth - extraIndent;

  const spans = flattenInlines(node.children, ctx, {
    bold: true,
    italic: false,
    code: false,
    color: ctx.colors.heading,
  });

  drawSpans(spans, ctx, w, x0);

  ctx.y -= HEADING_SPACE_AFTER;
  ctx.fontSize = origFontSize;
}

// ---- Paragraph ----

function renderParagraph(
  node: MarkdownParagraph,
  ctx: ExportContext,
  extraIndent: number,
  colorOverride?: { r: number; g: number; b: number },
): void {
  const x0 = ctx.margin + extraIndent;
  const w = ctx.contentWidth - extraIndent;

  if (renderImageParagraph(node, ctx, x0, w)) return;

  const spans = flattenInlines(node.children, ctx, {
    bold: false,
    italic: false,
    code: false,
    color: colorOverride,
  });

  drawSpans(spans, ctx, w, x0);
  ctx.y -= PARAGRAPH_SPACING;
}

/**
 * Draw a paragraph that holds only images, one after another as blocks.
 * Returns false (drawing nothing) for any other paragraph, or when none of
 * its images was supplied.
 */
function renderImageParagraph(
  node: MarkdownParagraph,
  ctx: ExportContext,
  x0: number,
  width: number,
): boolean {
  const images = node.children.filter((child) => child.type === 'image') as MarkdownImage[];
  const onlyImages = node.children.every(
    (child) =>
      child.type === 'image' ||
      child.type === 'break' ||
      (child.type === 'text' && !(child as MarkdownText).value.trim()),
  );
  if (!onlyImages || images.length === 0) return false;
  if (!images.some((image) => ctx.images.has(image.url))) return false;
  const maxHeight = ctx.pageHeight - 2 * ctx.margin;
  for (const imageNode of images) {
    const embedded = ctx.images.get(imageNode.url);
    if (!embedded) {
      const note = flattenInlines([imageNode], ctx, { bold: false, italic: false, code: false });
      drawSpans(note, ctx, width, x0);
      continue;
    }
    // The size the author resized the picture to in the editor, else its own.
    const display = authoredImageSize(imageNode, embedded) ?? embedded;
    const size = fitWithin(
      display.width * POINTS_PER_CSS_PIXEL,
      display.height * POINTS_PER_CSS_PIXEL,
      width,
      maxHeight,
    );
    ensureSpace(ctx, size.height);
    ctx.page.drawImage(embedded.image, {
      x: x0 + (width - size.width) / 2,
      y: ctx.y - size.height,
      width: size.width,
      height: size.height,
    });
    ctx.y -= size.height + PARAGRAPH_SPACING;
  }
  return true;
}

// ---- Blockquote ----

function renderBlockquote(node: MarkdownBlockquote, ctx: ExportContext, extraIndent: number): void {
  const barX = ctx.margin + extraIndent + 4;
  const indent = extraIndent + BLOCKQUOTE_INDENT;
  const startY = ctx.y;

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      renderParagraph(child as MarkdownParagraph, ctx, indent, COLOR_BLOCKQUOTE_TEXT);
    } else {
      renderBlock(child, ctx, indent);
    }
  }

  // Draw left bar from startY to ctx.y
  const endY = ctx.y + PARAGRAPH_SPACING; // undo last paragraph spacing
  if (startY > endY) {
    // Bar might span pages — draw on current page only
    ctx.page.drawRectangle({
      x: barX,
      y: endY,
      width: BLOCKQUOTE_BAR_WIDTH,
      height: startY - endY,
      color: rgb(COLOR_BLOCKQUOTE_BAR.r, COLOR_BLOCKQUOTE_BAR.g, COLOR_BLOCKQUOTE_BAR.b),
    });
  }

  ctx.y -= PARAGRAPH_SPACING;
}

// ---- List ----

function renderList(
  node: MarkdownList,
  ctx: ExportContext,
  extraIndent: number,
  depth: number,
): void {
  const ordered = node.ordered ?? false;
  let counter = node.start ?? 1;

  for (const child of node.children) {
    if (child.type === 'listItem') {
      renderListItem(child as MarkdownListItem, ctx, extraIndent, depth, ordered, counter);
      if (ordered) counter++;
    }
  }
}

function renderListItem(
  item: MarkdownListItem,
  ctx: ExportContext,
  extraIndent: number,
  depth: number,
  ordered: boolean,
  counter: number,
): void {
  const indent = extraIndent + depth * LIST_INDENT;
  const bullet = ordered ? `${counter}.` : BULLET_CHAR;
  const bulletFont = ctx.fonts.regular;
  const bulletWidth = drawnWidth(bulletFont, bullet + ' ', ctx.fontSize);

  // Draw bullet
  const lineHeight = ctx.fontSize * LINE_HEIGHT_FACTOR;
  ensureSpace(ctx, lineHeight);

  ctx.page.drawText(bullet, {
    x: ctx.margin + indent,
    y: ctx.y - ctx.fontSize,
    size: ctx.fontSize,
    font: bulletFont,
    color: rgb(ctx.colors.text.r, ctx.colors.text.g, ctx.colors.text.b),
  });

  const textIndent = indent + bulletWidth + 4;
  const textWidth = ctx.contentWidth - textIndent;

  // Render children at the text indent
  let isFirstChild = true;
  for (const child of item.children) {
    if (child.type === 'paragraph' && isFirstChild) {
      // First paragraph: render on same line as bullet
      const spans = flattenInlines((child as MarkdownParagraph).children, ctx, {
        bold: false,
        italic: false,
        code: false,
      });
      drawSpans(spans, ctx, textWidth, ctx.margin + textIndent);
      ctx.y -= PARAGRAPH_SPACING / 2;
    } else if (child.type === 'list') {
      renderList(child as MarkdownList, ctx, extraIndent, depth + 1);
    } else {
      renderBlock(child, ctx, textIndent);
    }
    isFirstChild = false;
  }
}

// ---- Code Block ----

function renderCodeBlock(node: MarkdownCodeBlock, ctx: ExportContext, extraIndent: number): void {
  const x0 = ctx.margin + extraIndent;
  const _w = ctx.contentWidth - extraIndent;
  // Split BEFORE sanitizing: the sanitizer maps a newline to a space, which
  // would flatten the fence into one line if applied to the whole value.
  const lines = node.value.split('\n');
  const lineH = CODE_FONT_SIZE * LINE_HEIGHT_FACTOR;
  const totalHeight = lines.length * lineH + 12; // 12 = vertical padding

  ensureSpace(ctx, Math.min(totalHeight, ctx.y - ctx.bottomY));

  const _bgTop = ctx.y;

  // Draw background first (we'll adjust after we know the final y)
  const _bgStartY = ctx.y;
  ctx.y -= 6; // top padding

  for (const line of lines) {
    ensureSpace(ctx, lineH);
    if (line.length > 0) {
      drawTextLine(ctx, line, ctx.fonts.mono, {
        x: x0 + 8,
        y: ctx.y - CODE_FONT_SIZE,
        size: CODE_FONT_SIZE,
        color: COLOR_CODE_TEXT,
      });
    }
    ctx.y -= lineH;
  }

  ctx.y -= 6; // bottom padding

  // Draw background rectangle (behind text — pdf-lib draws on top,
  // so we could draw it first on a separate pass, but since we can't
  // easily re-order, we leave it as a visual approximation).
  // For a production implementation, you'd use a two-pass approach.
  // Here we draw the bg rect at the saved position. Text drawn after
  // will already be on the page. Since pdf-lib paints in order, we
  // accept that the bg goes on top — but only if bg is on same page.
  // A simpler approach: draw bg *before* text per page.

  // Actually, let's use a cleaner approach: draw line by line with bg
  // We already drew the text. For the background box, we'll just
  // not draw it behind (it would overlay). This is a known limitation
  // with pdf-lib's immediate mode. In practice the light grey bg makes
  // text hard to read if drawn on top. So we skip the bg for now and
  // rely on the monospace font to visually distinguish code.

  ctx.y -= PARAGRAPH_SPACING;
}

// ---- Table ----

function renderTable(node: MarkdownTable, ctx: ExportContext, extraIndent: number): void {
  if (node.children.length === 0) return;

  const x0 = ctx.margin + extraIndent;
  const tableWidth = ctx.contentWidth - extraIndent;

  // Measure columns: get max width per column across all rows
  const numCols = Math.max(
    ...node.children.map((row) => (row as MarkdownTableRow).children.length),
  );
  if (numCols === 0) return;

  const rows = node.children.map((rowNode, rowIdx) => {
    const row = rowNode as MarkdownTableRow;
    const isHeader = rowIdx === 0 && row.children.some((c) => (c as MarkdownTableCell).isHeader);
    const cells = row.children.map((cell) =>
      flattenInlines((cell as MarkdownTableCell).children, ctx, {
        bold: isHeader,
        italic: false,
        code: false,
      }),
    );
    return { isHeader, cells };
  });
  const colWidths = tableColumnWidths(
    rows.map((row) => row.cells),
    tableWidth,
    numCols,
  );
  const colX = colWidths.map((_, colIdx) =>
    colWidths.slice(0, colIdx).reduce((sum, width) => sum + width, x0),
  );

  for (const { isHeader, cells } of rows) {
    // Calculate row height
    const rowCellHeights = cells.map((spans, colIdx) => {
      const lines = wrapSpans(spans, colWidths[colIdx]! - 2 * TABLE_CELL_PAD_X);
      return lines.length * ctx.fontSize * LINE_HEIGHT_FACTOR + 2 * TABLE_CELL_PAD_Y;
    });
    const rowHeight = Math.max(
      ...rowCellHeights,
      ctx.fontSize * LINE_HEIGHT_FACTOR + 2 * TABLE_CELL_PAD_Y,
    );

    ensureSpace(ctx, rowHeight);

    // Draw header background
    if (isHeader) {
      ctx.page.drawRectangle({
        x: x0,
        y: ctx.y - rowHeight,
        width: tableWidth,
        height: rowHeight,
        color: rgb(COLOR_TABLE_HEADER_BG.r, COLOR_TABLE_HEADER_BG.g, COLOR_TABLE_HEADER_BG.b),
      });
    }

    // Draw cell borders and text
    for (let colIdx = 0; colIdx < numCols; colIdx++) {
      const cellX = colX[colIdx]!;
      const colWidth = colWidths[colIdx]!;

      // Draw cell border
      ctx.page.drawRectangle({
        x: cellX,
        y: ctx.y - rowHeight,
        width: colWidth,
        height: rowHeight,
        borderColor: rgb(COLOR_TABLE_BORDER.r, COLOR_TABLE_BORDER.g, COLOR_TABLE_BORDER.b),
        borderWidth: TABLE_BORDER_WIDTH,
      });

      const spans = cells[colIdx];
      if (spans) {
        // Draw text inside cell
        const savedY = ctx.y;
        ctx.y = ctx.y - TABLE_CELL_PAD_Y;

        const cellAvailableWidth = colWidth - 2 * TABLE_CELL_PAD_X;
        const wrappedLines = wrapSpans(spans, cellAvailableWidth);

        for (const line of wrappedLines) {
          let lx = cellX + TABLE_CELL_PAD_X;
          for (const span of line) {
            ctx.page.drawText(span.text, {
              x: lx,
              y: ctx.y - span.fontSize,
              size: span.fontSize,
              font: span.font,
              color: rgb(span.color.r, span.color.g, span.color.b),
            });
            lx += drawnWidth(span.font, span.text, span.fontSize);
          }
          ctx.y -= getLineHeight(line);
        }

        ctx.y = savedY; // restore for next cell
      }
    }

    ctx.y -= rowHeight;
  }

  ctx.y -= PARAGRAPH_SPACING;
}

/**
 * Column widths that follow the content, as a browser lays out an auto-width
 * table. Each column first gets the width of its longest word, then the rest
 * of the table width is shared out by how much wider each column's text would
 * like to be, so a column of single digits stays narrow. No column's floor is
 * more than an equal share: a longer word breaks instead (see
 * `breakLongWord`).
 */
function tableColumnWidths(rows: TextSpan[][][], tableWidth: number, numCols: number): number[] {
  const pad = 2 * TABLE_CELL_PAD_X;
  const minimum = new Array<number>(numCols).fill(pad);
  const preferred = new Array<number>(numCols).fill(pad);
  for (const cells of rows) {
    cells.forEach((spans, colIdx) => {
      let longestLine = 0;
      let longestWord = 0;
      let line = 0;
      for (const span of spans) {
        if (span.text === '\n') {
          line = 0;
          continue;
        }
        for (const word of splitIntoWords(span.text)) {
          const width = drawnWidth(span.font, word, span.fontSize);
          line += width;
          if (word.trim().length > 0) longestWord = Math.max(longestWord, width);
        }
        longestLine = Math.max(longestLine, line);
      }
      minimum[colIdx] = Math.max(minimum[colIdx]!, longestWord + pad);
      preferred[colIdx] = Math.max(preferred[colIdx]!, longestLine + pad);
    });
  }

  const share = tableWidth / numCols;
  const floor = minimum.map((width) => Math.min(width, share));
  const wish = preferred.map((width, colIdx) => Math.max(width, floor[colIdx]!));
  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

  // Everything fits on one line per cell: widen every column in proportion,
  // so the table still spans the page.
  const wished = sum(wish);
  if (wished <= tableWidth) return wish.map((width) => (width / wished) * tableWidth);

  // Otherwise each column keeps its floor and the remainder goes to the
  // columns whose text wraps, in proportion to how much more each wants.
  const spare = tableWidth - sum(floor);
  const wants = wish.map((width, colIdx) => width - floor[colIdx]!);
  const wanted = sum(wants);
  return floor.map((width, colIdx) =>
    wanted > 0 ? width + (spare * wants[colIdx]!) / wanted : width + spare / numCols,
  );
}

// ---- Thematic Break ----

function renderThematicBreak(ctx: ExportContext, extraIndent: number): void {
  ctx.y -= PARAGRAPH_SPACING;
  ensureSpace(ctx, 10);

  const x0 = ctx.margin + extraIndent;
  const x1 = ctx.margin + ctx.contentWidth;

  ctx.page.drawLine({
    start: { x: x0, y: ctx.y },
    end: { x: x1, y: ctx.y },
    thickness: 1,
    color: rgb(COLOR_THEMATIC_BREAK.r, COLOR_THEMATIC_BREAK.g, COLOR_THEMATIC_BREAK.b),
  });

  ctx.y -= PARAGRAPH_SPACING;
}

// ---- HTML Block ----

function renderHtmlBlock(node: MarkdownHtmlBlock, ctx: ExportContext, extraIndent: number): void {
  if (!node.rawHtml) return;
  // Render raw HTML as monospace text (best effort). Split before sanitizing
  // so line structure survives — see renderCodeBlock.
  const lines = node.rawHtml.split('\n');
  const x0 = ctx.margin + extraIndent;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const lineH = CODE_FONT_SIZE * LINE_HEIGHT_FACTOR;
    ensureSpace(ctx, lineH);
    drawTextLine(ctx, line, ctx.fonts.mono, {
      x: x0,
      y: ctx.y - CODE_FONT_SIZE,
      size: CODE_FONT_SIZE,
      color: COLOR_CODE_TEXT,
    });
    ctx.y -= lineH;
  }
  ctx.y -= PARAGRAPH_SPACING;
}

// ---- Math Block ----

function renderMathBlock(node: MarkdownMathBlock, ctx: ExportContext, extraIndent: number): void {
  // Render LaTeX source in monospace as fallback. Split before sanitizing so
  // line structure survives — see renderCodeBlock.
  const lines = node.value.split('\n');
  const x0 = ctx.margin + extraIndent;
  for (const line of lines) {
    const lineH = CODE_FONT_SIZE * LINE_HEIGHT_FACTOR;
    ensureSpace(ctx, lineH);
    if (line.length > 0) {
      drawTextLine(ctx, line, ctx.fonts.mono, {
        x: x0,
        y: ctx.y - CODE_FONT_SIZE,
        size: CODE_FONT_SIZE,
        color: COLOR_CODE_TEXT,
      });
    }
    ctx.y -= lineH;
  }
  ctx.y -= PARAGRAPH_SPACING;
}

// ---- Footnote Definition ----

function renderFootnoteDefinition(
  node: MarkdownFootnoteDefinition,
  ctx: ExportContext,
  extraIndent: number,
): void {
  // Draw the reader-facing number, matching the marker in the prose.
  const number = ctx.footnotes?.numberFor(node.identifier);
  const label = number !== undefined ? `${number}.` : `[${node.identifier}]`;
  const lineH = ctx.fontSize * LINE_HEIGHT_FACTOR;
  ensureSpace(ctx, lineH);

  drawTextLine(ctx, label, ctx.fonts.bold, {
    x: ctx.margin + extraIndent,
    y: ctx.y - ctx.fontSize * 0.75,
    size: ctx.fontSize * 0.75,
    color: ctx.colors.link,
  });

  // Render children indented
  renderBlocks(node.children, ctx, extraIndent + LIST_INDENT);
}

// ---- Fallback ----

function renderFallbackBlock(
  node: MarkdownBlockNode,
  ctx: ExportContext,
  extraIndent: number,
): void {
  const fallback = node as unknown as {
    children?: (MarkdownBlockNode | MarkdownInlineNode)[];
    value?: string;
  };
  if (fallback.children && Array.isArray(fallback.children)) {
    // Could be block children or inline children
    if (fallback.children.length > 0 && typeof fallback.children[0]?.type === 'string') {
      const firstType = fallback.children[0].type;
      // Heuristic: if first child looks like an inline node, wrap as paragraph
      const inlineTypes = new Set([
        'text',
        'strong',
        'emphasis',
        'delete',
        'inlineCode',
        'link',
        'image',
        'break',
      ]);
      if (inlineTypes.has(firstType)) {
        const spans = flattenInlines(fallback.children as MarkdownInlineNode[], ctx, {
          bold: false,
          italic: false,
          code: false,
        });
        drawSpans(spans, ctx, ctx.contentWidth - extraIndent, ctx.margin + extraIndent);
        ctx.y -= PARAGRAPH_SPACING;
        return;
      }
    }
    renderBlocks(fallback.children as MarkdownBlockNode[], ctx, extraIndent);
  } else if (fallback.value && typeof fallback.value === 'string') {
    const lineH = ctx.fontSize * LINE_HEIGHT_FACTOR;
    ensureSpace(ctx, lineH);
    drawTextLine(ctx, fallback.value, ctx.fonts.regular, {
      x: ctx.margin + extraIndent,
      y: ctx.y - ctx.fontSize,
      size: ctx.fontSize,
      color: ctx.colors.text,
    });
    ctx.y -= lineH + PARAGRAPH_SPACING;
  }
}

// ============================================
// Color Helpers
// ============================================

/**
 * PDF pages are white, independent of the theme's screen background. Never
 * copy pale screen text onto paper. The same ink also appears in shaded
 * table headers, so require readable contrast on both exported surfaces.
 */
function paperInk(hex: string, fallback: RgbColor): RgbColor {
  const color = hexToRgb(hex);
  if (!color) return fallback;
  const tableHeader =
    '#' +
    [COLOR_TABLE_HEADER_BG.r, COLOR_TABLE_HEADER_BG.g, COLOR_TABLE_HEADER_BG.b]
      .map((channel) =>
        Math.round(channel * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  return contrastRatio(hex, '#ffffff') >= 4.5 && contrastRatio(hex, tableHeader) >= 4.5
    ? color
    : fallback;
}

function hexToRgb(hex: string): RgbColor | undefined {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length !== 6) return undefined;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return undefined;
  return { r: r / 255, g: g / 255, b: b / 255 };
}

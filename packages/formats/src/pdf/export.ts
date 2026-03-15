/**
 * PDF Export
 *
 * Converts a squisq MarkdownDocument (or Doc) into a PDF file
 * using pdf-lib. Generates paginated, styled output with support for
 * headings, paragraphs, inline formatting, lists, code blocks,
 * blockquotes, tables, thematic breaks, and hyperlinks.
 *
 * Uses only the 14 standard PDF fonts (no font embedding required),
 * keeping output size small and rendering fast.
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

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';

import type { Doc } from '@bendyline/squisq/schemas';
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
  MarkdownTableCell,
  MarkdownHtmlBlock,
  MarkdownMathBlock,
  MarkdownFootnoteDefinition,
  MarkdownText,
  MarkdownEmphasis,
  MarkdownStrong,
  MarkdownStrikethrough,
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownImage,
  MarkdownInlineHtml,
  MarkdownInlineMath,
  MarkdownFootnoteReference,
} from '@bendyline/squisq/markdown';

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
}

/**
 * Convert a MarkdownDocument to a PDF ArrayBuffer.
 */
export async function markdownDocToPdf(
  doc: MarkdownDocument,
  options: PdfExportOptions = {},
): Promise<ArrayBuffer> {
  const pdfDoc = await PDFDocument.create();

  // Metadata
  if (options.title) pdfDoc.setTitle(options.title);
  if (options.author) pdfDoc.setAuthor(options.author);
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());

  const ctx = await createExportContext(pdfDoc, options);

  renderBlocks(doc.children, ctx, 0);

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
}

async function createExportContext(
  pdfDoc: PDFDocument,
  options: PdfExportOptions,
): Promise<ExportContext> {
  const [regular, bold, italic, boldItalic, mono, monoBold] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
    pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
    pdfDoc.embedFont(StandardFonts.Courier),
    pdfDoc.embedFont(StandardFonts.CourierBold),
  ]);

  const isA4 = options.pageSize === 'a4';
  const pageWidth = isA4 ? PAGE_WIDTH_A4 : PAGE_WIDTH_LETTER;
  const pageHeight = isA4 ? PAGE_HEIGHT_A4 : PAGE_HEIGHT_LETTER;
  const margin = options.margin ?? DEFAULT_MARGIN;
  const fontSize = options.defaultFontSize ?? DEFAULT_FONT_SIZE;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  return {
    pdfDoc,
    fonts: { regular, bold, italic, boldItalic, mono, monoBold },
    pageWidth,
    pageHeight,
    margin,
    fontSize,
    page,
    y: pageHeight - margin,
    contentWidth: pageWidth - 2 * margin,
    bottomY: margin,
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

interface TextSpan {
  text: string;
  font: PDFFont;
  fontSize: number;
  color: { r: number; g: number; b: number };
  link?: string;
  strikethrough?: boolean;
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
        spans.push({
          text: (node as MarkdownText).value,
          font,
          fontSize: state.code ? CODE_FONT_SIZE : ctx.fontSize,
          color: state.code ? COLOR_CODE_TEXT : (state.color ?? COLOR_TEXT),
          link: state.link,
          strikethrough: state.strikethrough,
        });
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

      case 'inlineCode': {
        spans.push({
          text: (node as MarkdownInlineCode).value,
          font: ctx.fonts.mono,
          fontSize: CODE_FONT_SIZE,
          color: COLOR_CODE_TEXT,
          link: state.link,
        });
        break;
      }

      case 'link': {
        const linkNode = node as MarkdownLink;
        spans.push(
          ...flattenInlines(linkNode.children, ctx, {
            ...state,
            link: linkNode.url,
            color: COLOR_LINK,
          }),
        );
        break;
      }

      case 'image': {
        const imgNode = node as MarkdownImage;
        spans.push({
          text: imgNode.alt ? `[Image: ${imgNode.alt}]` : '[Image]',
          font: ctx.fonts.italic,
          fontSize: ctx.fontSize,
          color: COLOR_BLOCKQUOTE_TEXT,
        });
        break;
      }

      case 'break':
        spans.push({
          text: '\n',
          font: ctx.fonts.regular,
          fontSize: ctx.fontSize,
          color: COLOR_TEXT,
        });
        break;

      case 'htmlInline': {
        const html = (node as MarkdownInlineHtml).rawHtml;
        if (html) {
          spans.push({
            text: html,
            font: ctx.fonts.mono,
            fontSize: CODE_FONT_SIZE,
            color: COLOR_CODE_TEXT,
          });
        }
        break;
      }

      case 'inlineMath':
        spans.push({
          text: (node as MarkdownInlineMath).value,
          font: ctx.fonts.mono,
          fontSize: CODE_FONT_SIZE,
          color: COLOR_CODE_TEXT,
        });
        break;

      case 'footnoteReference': {
        const ref = node as MarkdownFootnoteReference;
        spans.push({
          text: `[${ref.identifier}]`,
          font: ctx.fonts.regular,
          fontSize: ctx.fontSize * 0.75,
          color: COLOR_LINK,
        });
        break;
      }

      // linkReference, imageReference, textDirective — render children or identifier
      default: {
        const fallback = node as unknown as { children?: MarkdownInlineNode[]; value?: string };
        if (fallback.children) {
          spans.push(...flattenInlines(fallback.children, ctx, state));
        } else if (fallback.value) {
          spans.push({
            text: fallback.value,
            font: pickFont(ctx, state.bold, state.italic),
            fontSize: ctx.fontSize,
            color: state.color ?? COLOR_TEXT,
          });
        }
        break;
      }
    }
  }

  return spans;
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
      ctx.page.drawText(span.text, {
        x,
        y: ctx.y - span.fontSize, // pdf-lib y is baseline
        size: span.fontSize,
        font: span.font,
        color: rgb(span.color.r, span.color.g, span.color.b),
      });

      const textWidth = span.font.widthOfTextAtSize(span.text, span.fontSize);

      // Underline for links
      if (span.link) {
        ctx.page.drawLine({
          start: { x, y: ctx.y - span.fontSize - 1 },
          end: { x: x + textWidth, y: ctx.y - span.fontSize - 1 },
          thickness: 0.5,
          color: rgb(span.color.r, span.color.g, span.color.b),
        });
      }

      // Strikethrough
      if (span.strikethrough) {
        const midY = ctx.y - span.fontSize * 0.6;
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

    // Split by whitespace for word-wrapping
    const words = splitIntoWords(span.text);

    for (const word of words) {
      const wordWidth = span.font.widthOfTextAtSize(word, span.fontSize);

      if (lineWidth + wordWidth > maxWidth && currentLine.length > 0 && word.trim().length > 0) {
        // Wrap to next line
        lines.push(currentLine);
        currentLine = [];
        lineWidth = 0;
      }

      // Trim leading space on new line
      const trimmedWord = currentLine.length === 0 ? word.replace(/^\s+/, '') : word;
      if (trimmedWord.length > 0) {
        const tw = span.font.widthOfTextAtSize(trimmedWord, span.fontSize);
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
  for (const node of nodes) {
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
    color: COLOR_HEADING,
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

  const spans = flattenInlines(node.children, ctx, {
    bold: false,
    italic: false,
    code: false,
    color: colorOverride,
  });

  drawSpans(spans, ctx, w, x0);
  ctx.y -= PARAGRAPH_SPACING;
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
  const bulletWidth = bulletFont.widthOfTextAtSize(bullet + ' ', ctx.fontSize);

  // Draw bullet
  const lineHeight = ctx.fontSize * LINE_HEIGHT_FACTOR;
  ensureSpace(ctx, lineHeight);

  ctx.page.drawText(bullet, {
    x: ctx.margin + indent,
    y: ctx.y - ctx.fontSize,
    size: ctx.fontSize,
    font: bulletFont,
    color: rgb(COLOR_TEXT.r, COLOR_TEXT.g, COLOR_TEXT.b),
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
      ctx.page.drawText(line, {
        x: x0 + 8,
        y: ctx.y - CODE_FONT_SIZE,
        size: CODE_FONT_SIZE,
        font: ctx.fonts.mono,
        color: rgb(COLOR_CODE_TEXT.r, COLOR_CODE_TEXT.g, COLOR_CODE_TEXT.b),
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

  // Simple equal-width columns
  const colWidth = tableWidth / numCols;

  for (let rowIdx = 0; rowIdx < node.children.length; rowIdx++) {
    const row = node.children[rowIdx] as MarkdownTableRow;
    const isHeader = rowIdx === 0 && row.children.some((c) => (c as MarkdownTableCell).isHeader);

    // Calculate row height
    const rowCellHeights = row.children.map((cell) => {
      const cellNode = cell as MarkdownTableCell;
      const spans = flattenInlines(cellNode.children, ctx, {
        bold: isHeader,
        italic: false,
        code: false,
      });
      const lines = wrapSpans(spans, colWidth - 2 * TABLE_CELL_PAD_X);
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
      const cellX = x0 + colIdx * colWidth;

      // Draw cell border
      ctx.page.drawRectangle({
        x: cellX,
        y: ctx.y - rowHeight,
        width: colWidth,
        height: rowHeight,
        borderColor: rgb(COLOR_TABLE_BORDER.r, COLOR_TABLE_BORDER.g, COLOR_TABLE_BORDER.b),
        borderWidth: TABLE_BORDER_WIDTH,
      });

      if (colIdx < row.children.length) {
        const cellNode = row.children[colIdx] as MarkdownTableCell;
        const spans = flattenInlines(cellNode.children, ctx, {
          bold: isHeader,
          italic: false,
          code: false,
        });

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
            lx += span.font.widthOfTextAtSize(span.text, span.fontSize);
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
  // Render raw HTML as monospace text (best effort)
  const lines = node.rawHtml.split('\n');
  const x0 = ctx.margin + extraIndent;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const lineH = CODE_FONT_SIZE * LINE_HEIGHT_FACTOR;
    ensureSpace(ctx, lineH);
    ctx.page.drawText(line, {
      x: x0,
      y: ctx.y - CODE_FONT_SIZE,
      size: CODE_FONT_SIZE,
      font: ctx.fonts.mono,
      color: rgb(COLOR_CODE_TEXT.r, COLOR_CODE_TEXT.g, COLOR_CODE_TEXT.b),
    });
    ctx.y -= lineH;
  }
  ctx.y -= PARAGRAPH_SPACING;
}

// ---- Math Block ----

function renderMathBlock(node: MarkdownMathBlock, ctx: ExportContext, extraIndent: number): void {
  // Render LaTeX source in monospace as fallback
  const lines = node.value.split('\n');
  const x0 = ctx.margin + extraIndent;
  for (const line of lines) {
    const lineH = CODE_FONT_SIZE * LINE_HEIGHT_FACTOR;
    ensureSpace(ctx, lineH);
    if (line.length > 0) {
      ctx.page.drawText(line, {
        x: x0,
        y: ctx.y - CODE_FONT_SIZE,
        size: CODE_FONT_SIZE,
        font: ctx.fonts.mono,
        color: rgb(COLOR_CODE_TEXT.r, COLOR_CODE_TEXT.g, COLOR_CODE_TEXT.b),
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
  // Draw footnote identifier
  const label = `[${node.identifier}]`;
  const lineH = ctx.fontSize * LINE_HEIGHT_FACTOR;
  ensureSpace(ctx, lineH);

  ctx.page.drawText(label, {
    x: ctx.margin + extraIndent,
    y: ctx.y - ctx.fontSize * 0.75,
    size: ctx.fontSize * 0.75,
    font: ctx.fonts.bold,
    color: rgb(COLOR_LINK.r, COLOR_LINK.g, COLOR_LINK.b),
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
    ctx.page.drawText(fallback.value, {
      x: ctx.margin + extraIndent,
      y: ctx.y - ctx.fontSize,
      size: ctx.fontSize,
      font: ctx.fonts.regular,
      color: rgb(COLOR_TEXT.r, COLOR_TEXT.g, COLOR_TEXT.b),
    });
    ctx.y -= lineH + PARAGRAPH_SPACING;
  }
}

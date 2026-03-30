/**
 * DOCX Export
 *
 * Converts a squisq MarkdownDocument (or Doc) into a .docx file
 * by generating WordprocessingML XML and assembling the OOXML package.
 *
 * No third-party docx library — all XML is generated directly using
 * the shared ooxml/ infrastructure of this package.
 *
 * @example
 * ```ts
 * import { parseMarkdown } from '@bendyline/squisq/markdown';
 * import { markdownDocToDocx } from '@bendyline/squisq-formats/docx';
 *
 * const md = parseMarkdown('# Hello\n\nWorld **bold** text');
 * const blob = await markdownDocToDocx(md);
 * ```
 */

import type { Doc, Theme } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
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
  MarkdownLink,
  MarkdownImage,
  MarkdownFootnoteReference,
} from '@bendyline/squisq/markdown';

import { createPackage } from '../ooxml/writer.js';
import { xmlDeclaration, escapeXml } from '../ooxml/xmlUtils.js';
import {
  NS_WML,
  NS_R,
  NS_MC,
  REL_OFFICE_DOCUMENT,
  REL_STYLES,
  REL_NUMBERING,
  REL_SETTINGS,
  REL_FONT_TABLE,
  REL_HYPERLINK,
  REL_IMAGE,
  REL_FOOTNOTES,
  CONTENT_TYPE_DOCX_DOCUMENT,
  CONTENT_TYPE_DOCX_STYLES,
  CONTENT_TYPE_DOCX_NUMBERING,
  CONTENT_TYPE_DOCX_SETTINGS,
  CONTENT_TYPE_DOCX_FONT_TABLE,
  CONTENT_TYPE_DOCX_FOOTNOTES,
} from '../ooxml/namespaces.js';
import {
  DEPTH_TO_STYLE_ID,
  HEADING_FONT_SIZES,
  DEFAULT_FONT,
  DEFAULT_HEADING_FONT,
  DEFAULT_FONT_SIZE_HALF_POINTS,
  DEFAULT_CODE_FONT,
  DEFAULT_CODE_FONT_SIZE,
  HYPERLINK_COLOR,
  pointsToTwips,
} from './styles.js';

// ============================================
// Public API
// ============================================

/**
 * Options for DOCX export.
 */
export interface DocxExportOptions {
  /** Document title (appears in core properties) */
  title?: string;
  /** Document author */
  author?: string;
  /** Document description */
  description?: string;
  /** Default body font family. Default: "Calibri" */
  defaultFont?: string;
  /** Default body font size in points. Default: 11 */
  defaultFontSize?: number;
  /**
   * Squisq theme ID to apply (e.g., 'documentary', 'cinematic').
   * When set, overrides fonts with the theme's typography and applies
   * the theme's primary color to headings.
   */
  themeId?: string;
  /**
   * Pre-resolved image data keyed by image URL/path as it appears in the
   * markdown source. When provided, images are embedded in the .docx file
   * as binary parts instead of emitting placeholder text.
   */
  images?: Map<string, { data: ArrayBuffer | Uint8Array; contentType: string }>;
}

/**
 * Convert a MarkdownDocument to a .docx Blob.
 *
 * @param doc - The parsed markdown document
 * @param options - Export options
 * @returns An ArrayBuffer containing the .docx file
 */
export async function markdownDocToDocx(
  doc: MarkdownDocument,
  options: DocxExportOptions = {},
): Promise<ArrayBuffer> {
  const ctx = new ExportContext(options);
  const bodyXml = convertBlocks(doc.children, ctx);
  return buildDocxPackage(bodyXml, ctx, options);
}

/**
 * Convert a squisq Doc to a .docx Blob.
 *
 * Convenience wrapper that converts Doc → MarkdownDocument → DOCX.
 *
 * @param doc - The squisq Doc
 * @param options - Export options
 * @returns An ArrayBuffer containing the .docx file
 */
export async function docToDocx(doc: Doc, options: DocxExportOptions = {}): Promise<ArrayBuffer> {
  const markdownDoc = docToMarkdown(doc);
  return markdownDocToDocx(markdownDoc, options);
}

// ============================================
// Export Context
// ============================================

/**
 * Tracks state during export: relationship IDs, numbering definitions,
 * footnote bodies, and embedded images.
 */
class ExportContext {
  private nextRelId = 1;
  private nextNumId = 1;
  private nextFootnoteId = 1; // 0 is separator, start user footnotes at 1

  /** Relationships for word/_rels/document.xml.rels */
  readonly relationships: Array<{
    id: string;
    type: string;
    target: string;
    targetMode?: 'External';
  }> = [];

  /** Numbering definitions (abstract + num) */
  readonly numberingDefs: NumberingDef[] = [];

  /** Footnote XML bodies (keyed by footnote id) */
  readonly footnotes = new Map<number, string>();

  /** Footnote identifier → numeric id mapping */
  readonly footnoteIdMap = new Map<string, number>();

  /** Embedded images: rId → { path, data, contentType } */
  readonly images: Array<{
    relId: string;
    path: string;
    data: ArrayBuffer | Uint8Array;
    contentType: string;
  }> = [];

  /** Whether we have any lists (determines if numbering.xml is needed) */
  hasLists = false;

  /** Whether we have any footnotes */
  hasFootnotes = false;

  readonly font: string;
  readonly headingFont: string;
  readonly fontSize: number;
  /** Heading text color (hex without #), or undefined for default */
  readonly headingColor: string | undefined;

  /** Pre-resolved image data keyed by markdown image URL */
  readonly resolvedImages: Map<string, { data: ArrayBuffer | Uint8Array; contentType: string }>;

  private nextDocPrId = 1;

  constructor(options: DocxExportOptions) {
    let themeFont: string | undefined;
    let themeTitleFont: string | undefined;
    let themeHeadingColor: string | undefined;

    if (options.themeId) {
      const theme: Theme = resolveTheme(options.themeId);
      themeFont = theme.typography?.bodyFontFamily;
      themeTitleFont = theme.typography?.titleFontFamily;
      if (theme.colors?.primary) {
        const c = theme.colors.primary;
        themeHeadingColor = c.startsWith('#') ? c.slice(1) : c;
      }
    }

    this.font = options.defaultFont ?? themeFont ?? DEFAULT_FONT;
    this.headingFont = themeTitleFont ?? this.font;
    this.fontSize = options.defaultFontSize
      ? options.defaultFontSize * 2
      : DEFAULT_FONT_SIZE_HALF_POINTS;
    this.headingColor = themeHeadingColor;
    this.resolvedImages = options.images ?? new Map();
  }

  /** Allocate a new relationship ID */
  allocRelId(): string {
    return `rId${this.nextRelId++}`;
  }

  /** Add a hyperlink relationship and return the rId */
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

  /** Add an embedded image and return the rId and docPrId */
  addImage(
    data: ArrayBuffer | Uint8Array,
    contentType: string,
    filename: string,
  ): { relId: string; docPrId: number } {
    const relId = this.allocRelId();
    const docPrId = this.nextDocPrId++;
    const path = `word/media/${filename}`;

    this.images.push({ relId, path, data, contentType });
    this.relationships.push({
      id: relId,
      type: REL_IMAGE,
      target: `media/${filename}`,
    });

    return { relId, docPrId };
  }

  /** Allocate a numbering definition for a list */
  allocNumbering(ordered: boolean): number {
    const numId = this.nextNumId++;
    this.numberingDefs.push({ numId, ordered });
    this.hasLists = true;
    return numId;
  }

  /** Register or look up a footnote by its string identifier */
  getFootnoteId(identifier: string): number {
    let id = this.footnoteIdMap.get(identifier);
    if (id === undefined) {
      id = this.nextFootnoteId++;
      this.footnoteIdMap.set(identifier, id);
      this.hasFootnotes = true;
    }
    return id;
  }
}

interface NumberingDef {
  numId: number;
  ordered: boolean;
}

// ============================================
// Block Conversion
// ============================================

function convertBlocks(nodes: MarkdownBlockNode[], ctx: ExportContext): string {
  const parts: string[] = [];
  for (const node of nodes) {
    parts.push(convertBlock(node, ctx, 0));
  }
  return parts.join('');
}

function convertBlock(node: MarkdownBlockNode, ctx: ExportContext, listDepth: number): string {
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
      return convertCodeBlock(node);
    case 'table':
      return convertTable(node, ctx);
    case 'thematicBreak':
      return convertThematicBreak();
    case 'htmlBlock':
      return convertHtmlBlock(node);
    case 'math':
      return convertMathBlock(node);
    case 'footnoteDefinition':
      return convertFootnoteDefinition(node, ctx);
    default:
      // Definition lists, directives, link definitions — skip or emit as plain text
      return '';
  }
}

function convertHeading(node: MarkdownHeading, ctx: ExportContext): string {
  const styleId = DEPTH_TO_STYLE_ID[node.depth] ?? 'Heading1';
  const runs = convertInlines(node.children, ctx);
  return `<w:p>` + `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` + runs + `</w:p>`;
}

function convertParagraph(node: MarkdownParagraph, ctx: ExportContext): string {
  const runs = convertInlines(node.children, ctx);
  return `<w:p>${runs}</w:p>`;
}

function convertBlockquote(node: MarkdownBlockquote, ctx: ExportContext): string {
  // Render each child block as a paragraph with Quote style
  const parts: string[] = [];
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      const runs = convertInlines(child.children, ctx);
      parts.push(
        `<w:p>` +
          `<w:pPr><w:pStyle w:val="Quote"/>` +
          `<w:ind w:left="${pointsToTwips(36)}"/>` +
          `<w:pBdr><w:left w:val="single" w:sz="12" w:space="4" w:color="CCCCCC"/></w:pBdr>` +
          `</w:pPr>` +
          runs +
          `</w:p>`,
      );
    } else {
      // Nested non-paragraph (e.g., nested blockquote, list) — recurse
      parts.push(convertBlock(child, ctx, 0));
    }
  }
  return parts.join('');
}

function convertList(node: MarkdownList, ctx: ExportContext, depth: number): string {
  const numId = ctx.allocNumbering(node.ordered ?? false);
  const parts: string[] = [];
  for (const item of node.children) {
    parts.push(convertListItem(item, ctx, numId, depth));
  }
  return parts.join('');
}

function convertListItem(
  item: MarkdownListItem,
  ctx: ExportContext,
  numId: number,
  depth: number,
): string {
  const parts: string[] = [];
  for (const child of item.children) {
    if (child.type === 'paragraph') {
      const runs = convertInlines(child.children, ctx);
      parts.push(
        `<w:p>` +
          `<w:pPr>` +
          `<w:pStyle w:val="ListParagraph"/>` +
          `<w:numPr><w:ilvl w:val="${depth}"/><w:numId w:val="${numId}"/></w:numPr>` +
          `</w:pPr>` +
          runs +
          `</w:p>`,
      );
    } else if (child.type === 'list') {
      // Nested list — increase depth
      parts.push(convertList(child, ctx, depth + 1));
    } else {
      parts.push(convertBlock(child, ctx, depth));
    }
  }
  return parts.join('');
}

function convertCodeBlock(node: MarkdownCodeBlock): string {
  // Emit each line as a separate paragraph with code styling
  const lines = node.value.split('\n');
  const parts: string[] = [];
  for (const line of lines) {
    parts.push(
      `<w:p>` +
        `<w:pPr>` +
        `<w:pStyle w:val="Code"/>` +
        `<w:pBdr>` +
        `<w:top w:val="single" w:sz="4" w:space="1" w:color="CCCCCC"/>` +
        `<w:left w:val="single" w:sz="4" w:space="4" w:color="CCCCCC"/>` +
        `<w:bottom w:val="single" w:sz="4" w:space="1" w:color="CCCCCC"/>` +
        `<w:right w:val="single" w:sz="4" w:space="4" w:color="CCCCCC"/>` +
        `</w:pBdr>` +
        `<w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>` +
        `</w:pPr>` +
        `<w:r>` +
        `<w:rPr><w:rFonts w:ascii="${DEFAULT_CODE_FONT}" w:hAnsi="${DEFAULT_CODE_FONT}"/>` +
        `<w:sz w:val="${DEFAULT_CODE_FONT_SIZE}"/></w:rPr>` +
        `<w:t xml:space="preserve">${escapeXml(line)}</w:t>` +
        `</w:r>` +
        `</w:p>`,
    );
  }
  return parts.join('');
}

function convertTable(node: MarkdownTable, ctx: ExportContext): string {
  const rows: string[] = [];
  for (let ri = 0; ri < node.children.length; ri++) {
    const row = node.children[ri];
    rows.push(convertTableRow(row, ctx, ri === 0, node.align));
  }

  return (
    `<w:tbl>` +
    `<w:tblPr>` +
    `<w:tblStyle w:val="TableGrid"/>` +
    `<w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `</w:tblBorders>` +
    `</w:tblPr>` +
    `<w:tblGrid/>` +
    rows.join('') +
    `</w:tbl>`
  );
}

function convertTableRow(
  row: MarkdownTableRow,
  ctx: ExportContext,
  isHeader: boolean,
  align?: (('left' | 'right' | 'center') | null)[],
): string {
  const cells: string[] = [];
  for (let ci = 0; ci < row.children.length; ci++) {
    const cell = row.children[ci];
    const cellAlign = align?.[ci] ?? null;
    cells.push(convertTableCell(cell, ctx, isHeader, cellAlign));
  }
  const trPr = isHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
  return `<w:tr>${trPr}${cells.join('')}</w:tr>`;
}

function convertTableCell(
  cell: MarkdownTableCell,
  ctx: ExportContext,
  isHeader: boolean,
  align: 'left' | 'right' | 'center' | null,
): string {
  const runs = convertInlines(cell.children, ctx);
  const rPr = isHeader ? '<w:rPr><w:b/></w:rPr>' : '';
  const jcMap = { left: 'left', center: 'center', right: 'right' };
  const jc = align ? `<w:jc w:val="${jcMap[align]}"/>` : '';
  const pPr = rPr || jc ? `<w:pPr>${jc}</w:pPr>` : '';
  return `<w:tc><w:p>${pPr}${runs}</w:p></w:tc>`;
}

function convertThematicBreak(): string {
  return (
    `<w:p>` +
    `<w:pPr>` +
    `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>` +
    `</w:pPr>` +
    `</w:p>`
  );
}

function convertHtmlBlock(node: MarkdownHtmlBlock): string {
  // Best-effort: extract text content from the HTML
  const text = stripHtmlTags(node.rawHtml);
  if (!text.trim()) return '';
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function convertMathBlock(node: MarkdownMathBlock): string {
  // Emit as a styled paragraph with the raw LaTeX
  return (
    `<w:p>` +
    `<w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:r>` +
    `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(node.value)}</w:t>` +
    `</w:r>` +
    `</w:p>`
  );
}

function convertFootnoteDefinition(node: MarkdownFootnoteDefinition, ctx: ExportContext): string {
  const fnId = ctx.getFootnoteId(node.identifier);

  // Build the footnote body XML
  const bodyParts: string[] = [];
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      const runs = convertInlines(child.children, ctx);
      bodyParts.push(`<w:p>${runs}</w:p>`);
    }
  }

  const footnoteXml =
    `<w:footnote w:id="${fnId}">` +
    (bodyParts.length > 0 ? bodyParts.join('') : `<w:p/>`) +
    `</w:footnote>`;

  ctx.footnotes.set(fnId, footnoteXml);

  // Don't emit anything in the main body for the definition
  return '';
}

// ============================================
// Inline Conversion
// ============================================

/**
 * Formatting state passed down through nested inline elements.
 */
interface InlineFormat {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

function convertInlines(
  nodes: MarkdownInlineNode[],
  ctx: ExportContext,
  format: InlineFormat = {},
): string {
  const parts: string[] = [];
  for (const node of nodes) {
    parts.push(convertInline(node, ctx, format));
  }
  return parts.join('');
}

function convertInline(node: MarkdownInlineNode, ctx: ExportContext, format: InlineFormat): string {
  switch (node.type) {
    case 'text':
      return makeRun(node.value, format);
    case 'strong':
      return convertInlines(node.children, ctx, { ...format, bold: true });
    case 'emphasis':
      return convertInlines(node.children, ctx, { ...format, italic: true });
    case 'delete':
      return convertInlines(node.children, ctx, { ...format, strike: true });
    case 'inlineCode':
      return makeRun(node.value, { ...format, code: true });
    case 'link':
      return convertLink(node, ctx, format);
    case 'image':
      return convertImage(node, ctx);
    case 'break':
      return `<w:r><w:br/></w:r>`;
    case 'htmlInline':
      return makeRun(stripHtmlTags(node.rawHtml), format);
    case 'inlineMath':
      return makeRun(node.value, { ...format, code: true });
    case 'footnoteReference':
      return convertFootnoteRef(node, ctx);
    default:
      // linkReference, imageReference, textDirective — skip or emit plain
      return '';
  }
}

function makeRun(text: string, format: InlineFormat): string {
  if (!text) return '';

  const rPrParts: string[] = [];
  if (format.bold) rPrParts.push('<w:b/>');
  if (format.italic) rPrParts.push('<w:i/>');
  if (format.strike) rPrParts.push('<w:strike/>');
  if (format.code) {
    rPrParts.push(
      `<w:rFonts w:ascii="${DEFAULT_CODE_FONT}" w:hAnsi="${DEFAULT_CODE_FONT}"/>`,
      `<w:sz w:val="${DEFAULT_CODE_FONT_SIZE}"/>`,
    );
  }

  const rPr = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';

  // Use xml:space="preserve" to keep leading/trailing whitespace
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function convertLink(node: MarkdownLink, ctx: ExportContext, format: InlineFormat): string {
  const rId = ctx.addHyperlink(node.url);
  const _runs = convertInlines(node.children, ctx, { ...format });

  // Wrap each run's rPr with hyperlink styling
  // For simplicity, emit inline runs with hyperlink color + underline
  const styledRuns = convertInlinesWithHyperlinkStyle(node.children, ctx, format);

  return `<w:hyperlink r:id="${rId}">${styledRuns}</w:hyperlink>`;
}

function convertInlinesWithHyperlinkStyle(
  nodes: MarkdownInlineNode[],
  ctx: ExportContext,
  format: InlineFormat,
): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      parts.push(makeHyperlinkRun(node.value, format));
    } else {
      // For nested formatting inside links, add hyperlink style
      parts.push(convertInline(node, ctx, format));
    }
  }
  return parts.join('');
}

function makeHyperlinkRun(text: string, format: InlineFormat): string {
  if (!text) return '';

  const rPrParts: string[] = [
    '<w:rStyle w:val="Hyperlink"/>',
    `<w:color w:val="${HYPERLINK_COLOR}"/>`,
    '<w:u w:val="single"/>',
  ];
  if (format.bold) rPrParts.push('<w:b/>');
  if (format.italic) rPrParts.push('<w:i/>');

  return (
    `<w:r><w:rPr>${rPrParts.join('')}</w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  );
}

function convertImage(node: MarkdownImage, ctx: ExportContext): string {
  const imageEntry = ctx.resolvedImages.get(node.url);
  if (!imageEntry) {
    // No resolved data — emit placeholder text
    const alt = node.alt || node.url;
    return makeRun(`[Image: ${alt}]`, { italic: true });
  }

  const { data, contentType } = imageEntry;
  const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const filename = `image${ctx.images.length + 1}.${ext}`;
  const { relId, docPrId } = ctx.addImage(data, contentType, filename);

  // Read dimensions from binary header; fall back to 5×3 inches
  const dims = readImageDimensions(data);
  const EMU_PER_INCH = 914400;
  const MAX_WIDTH_EMU = 6 * EMU_PER_INCH; // 6 inch content width
  let cx: number;
  let cy: number;

  if (dims) {
    // Scale to fit within max width, assuming 96 DPI for pixel → inch
    const widthEmu = (dims.width / 96) * EMU_PER_INCH;
    const heightEmu = (dims.height / 96) * EMU_PER_INCH;
    if (widthEmu > MAX_WIDTH_EMU) {
      const scale = MAX_WIDTH_EMU / widthEmu;
      cx = MAX_WIDTH_EMU;
      cy = Math.round(heightEmu * scale);
    } else {
      cx = Math.round(widthEmu);
      cy = Math.round(heightEmu);
    }
  } else {
    cx = 5 * EMU_PER_INCH;
    cy = 3 * EMU_PER_INCH;
  }

  const name = escapeXml(node.alt || filename);
  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

  return (
    `<w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docPrId}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${NS_A}">` +
    `<a:graphicData uri="${NS_PIC}">` +
    `<pic:pic xmlns:pic="${NS_PIC}">` +
    `<pic:nvPicPr>` +
    `<pic:cNvPr id="0" name="${name}"/>` +
    `<pic:cNvPicPr/>` +
    `</pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip r:embed="${relId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr>` +
    `<a:xfrm>` +
    `<a:off x="0" y="0"/>` +
    `<a:ext cx="${cx}" cy="${cy}"/>` +
    `</a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing></w:r>`
  );
}

/** Read width/height from PNG or JPEG binary headers. */
function readImageDimensions(
  data: ArrayBuffer | Uint8Array,
): { width: number; height: number } | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 24) return null;

  // PNG: signature 0x89504E47, IHDR chunk at byte 16
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { width, height };
  }

  // JPEG: search for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length - 9) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return { width, height };
      }
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + segLen;
    }
  }

  // GIF: width at bytes 6-7, height at bytes 8-9 (little-endian)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    return { width, height };
  }

  return null;
}

function convertFootnoteRef(node: MarkdownFootnoteReference, ctx: ExportContext): string {
  const fnId = ctx.getFootnoteId(node.identifier);
  return (
    `<w:r>` +
    `<w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:footnoteReference w:id="${fnId}"/>` +
    `</w:r>`
  );
}

// ============================================
// Package Assembly
// ============================================

async function buildDocxPackage(
  bodyXml: string,
  ctx: ExportContext,
  options: DocxExportOptions,
): Promise<ArrayBuffer> {
  const pkg = createPackage();

  // --- Register fixed relationships ---
  let relCounter = 100; // Start high to avoid collisions with dynamic rels
  const stylesRelId = `rId${relCounter++}`;
  const numberingRelId = `rId${relCounter++}`;
  const settingsRelId = `rId${relCounter++}`;
  const fontTableRelId = `rId${relCounter++}`;
  const footnotesRelId = `rId${relCounter++}`;

  // --- word/document.xml ---
  const documentXml = buildDocumentXml(bodyXml);
  pkg.addPart('word/document.xml', documentXml, CONTENT_TYPE_DOCX_DOCUMENT);

  // --- word/styles.xml ---
  const stylesXml = buildStylesXml(options, ctx);
  pkg.addPart('word/styles.xml', stylesXml, CONTENT_TYPE_DOCX_STYLES);

  // --- word/settings.xml ---
  const settingsXml = buildSettingsXml();
  pkg.addPart('word/settings.xml', settingsXml, CONTENT_TYPE_DOCX_SETTINGS);

  // --- word/fontTable.xml ---
  const fontTableXml = buildFontTableXml(options);
  pkg.addPart('word/fontTable.xml', fontTableXml, CONTENT_TYPE_DOCX_FONT_TABLE);

  // --- word/numbering.xml (only if lists present) ---
  if (ctx.hasLists) {
    const numberingXml = buildNumberingXml(ctx);
    pkg.addPart('word/numbering.xml', numberingXml, CONTENT_TYPE_DOCX_NUMBERING);
  }

  // --- word/footnotes.xml (only if footnotes present) ---
  if (ctx.hasFootnotes) {
    const footnotesXml = buildFootnotesXml(ctx);
    pkg.addPart('word/footnotes.xml', footnotesXml, CONTENT_TYPE_DOCX_FOOTNOTES);
  }

  // --- Root relationship: this package contains a word document ---
  pkg.addRelationship('', {
    id: 'rId1',
    type: REL_OFFICE_DOCUMENT,
    target: 'word/document.xml',
  });

  // --- Document relationships ---
  pkg.addRelationship('word/document.xml', {
    id: stylesRelId,
    type: REL_STYLES,
    target: 'styles.xml',
  });
  pkg.addRelationship('word/document.xml', {
    id: settingsRelId,
    type: REL_SETTINGS,
    target: 'settings.xml',
  });
  pkg.addRelationship('word/document.xml', {
    id: fontTableRelId,
    type: REL_FONT_TABLE,
    target: 'fontTable.xml',
  });

  if (ctx.hasLists) {
    pkg.addRelationship('word/document.xml', {
      id: numberingRelId,
      type: REL_NUMBERING,
      target: 'numbering.xml',
    });
  }

  if (ctx.hasFootnotes) {
    pkg.addRelationship('word/document.xml', {
      id: footnotesRelId,
      type: REL_FOOTNOTES,
      target: 'footnotes.xml',
    });
  }

  // --- Dynamic relationships (hyperlinks, images) ---
  for (const rel of ctx.relationships) {
    pkg.addRelationship('word/document.xml', {
      id: rel.id,
      type: rel.type,
      target: rel.target,
      ...(rel.targetMode ? { targetMode: rel.targetMode } : {}),
    });
  }

  // --- Embedded images ---
  for (const img of ctx.images) {
    pkg.addBinaryPart(img.path, img.data, img.contentType);
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
// XML Part Generators
// ============================================

function buildDocumentXml(bodyXml: string): string {
  return (
    xmlDeclaration() +
    `<w:document` +
    ` xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"` +
    ` xmlns:mc="${NS_MC}"` +
    ` xmlns:o="urn:schemas-microsoft-com:office:office"` +
    ` xmlns:r="${NS_R}"` +
    ` xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"` +
    ` xmlns:v="urn:schemas-microsoft-com:vml"` +
    ` xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"` +
    ` xmlns:w10="urn:schemas-microsoft-com:office:word"` +
    ` xmlns:w="${NS_WML}"` +
    ` xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml">` +
    `<w:body>` +
    bodyXml +
    `<w:sectPr>` +
    `<w:pgSz w:w="12240" w:h="15840"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
    `<w:cols w:space="720"/>` +
    `</w:sectPr>` +
    `</w:body>` +
    `</w:document>`
  );
}

function buildStylesXml(options: DocxExportOptions, ctx: ExportContext): string {
  const font = ctx.font;
  const headingFont = ctx.headingFont;

  return (
    xmlDeclaration() +
    `<w:styles xmlns:w="${NS_WML}">` +
    // Default run properties
    `<w:docDefaults>` +
    `<w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}" w:eastAsia="${escapeXml(font)}" w:cs="${escapeXml(font)}"/>` +
    `<w:sz w:val="${DEFAULT_FONT_SIZE_HALF_POINTS}"/>` +
    `<w:szCs w:val="${DEFAULT_FONT_SIZE_HALF_POINTS}"/>` +
    `</w:rPr></w:rPrDefault>` +
    `<w:pPrDefault/>` +
    `</w:docDefaults>` +
    // Normal style
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
    `<w:name w:val="Normal"/>` +
    `<w:qFormat/>` +
    `</w:style>` +
    // Heading styles
    buildHeadingStyles(headingFont, ctx.headingColor) +
    // Quote style
    `<w:style w:type="paragraph" w:styleId="Quote">` +
    `<w:name w:val="Quote"/>` +
    `<w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:ind w:left="720"/></w:pPr>` +
    `<w:rPr><w:i/><w:color w:val="404040"/></w:rPr>` +
    `</w:style>` +
    // Code style
    `<w:style w:type="paragraph" w:styleId="Code">` +
    `<w:name w:val="Code"/>` +
    `<w:basedOn w:val="Normal"/>` +
    `<w:rPr>` +
    `<w:rFonts w:ascii="${DEFAULT_CODE_FONT}" w:hAnsi="${DEFAULT_CODE_FONT}"/>` +
    `<w:sz w:val="${DEFAULT_CODE_FONT_SIZE}"/>` +
    `</w:rPr>` +
    `</w:style>` +
    // ListParagraph style
    `<w:style w:type="paragraph" w:styleId="ListParagraph">` +
    `<w:name w:val="List Paragraph"/>` +
    `<w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:ind w:left="720"/></w:pPr>` +
    `</w:style>` +
    // Hyperlink character style
    `<w:style w:type="character" w:styleId="Hyperlink">` +
    `<w:name w:val="Hyperlink"/>` +
    `<w:rPr><w:color w:val="${HYPERLINK_COLOR}"/><w:u w:val="single"/></w:rPr>` +
    `</w:style>` +
    // FootnoteReference character style
    `<w:style w:type="character" w:styleId="FootnoteReference">` +
    `<w:name w:val="footnote reference"/>` +
    `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `</w:style>` +
    // Table Grid style
    `<w:style w:type="table" w:styleId="TableGrid">` +
    `<w:name w:val="Table Grid"/>` +
    `<w:tblPr>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `</w:tblBorders>` +
    `</w:tblPr>` +
    `</w:style>` +
    `</w:styles>`
  );
}

function buildHeadingStyles(headingFont: string, headingColor?: string): string {
  let result = '';
  for (let depth = 1; depth <= 6; depth++) {
    const styleId = DEPTH_TO_STYLE_ID[depth];
    const fontSize = HEADING_FONT_SIZES[depth] ?? 22;
    const colorXml = headingColor ? `<w:color w:val="${headingColor}"/>` : '';
    result +=
      `<w:style w:type="paragraph" w:styleId="${styleId}">` +
      `<w:name w:val="heading ${depth}"/>` +
      `<w:basedOn w:val="Normal"/>` +
      `<w:next w:val="Normal"/>` +
      `<w:qFormat/>` +
      `<w:pPr><w:outlineLvl w:val="${depth - 1}"/><w:spacing w:before="240" w:after="60"/></w:pPr>` +
      `<w:rPr>` +
      `<w:rFonts w:ascii="${escapeXml(headingFont)}" w:hAnsi="${escapeXml(headingFont)}"/>` +
      `<w:b/>` +
      colorXml +
      `<w:sz w:val="${fontSize}"/>` +
      `<w:szCs w:val="${fontSize}"/>` +
      `</w:rPr>` +
      `</w:style>`;
  }
  return result;
}

function buildSettingsXml(): string {
  return (
    xmlDeclaration() +
    `<w:settings xmlns:w="${NS_WML}">` +
    `<w:defaultTabStop w:val="720"/>` +
    `<w:characterSpacingControl w:val="doNotCompress"/>` +
    `</w:settings>`
  );
}

function buildFontTableXml(options: DocxExportOptions): string {
  const font = options.defaultFont ?? DEFAULT_FONT;
  return (
    xmlDeclaration() +
    `<w:fonts xmlns:w="${NS_WML}">` +
    `<w:font w:name="${escapeXml(font)}">` +
    `<w:panose1 w:val="020F0502020204030204"/>` +
    `<w:charset w:val="00"/>` +
    `<w:family w:val="swiss"/>` +
    `<w:pitch w:val="variable"/>` +
    `</w:font>` +
    `<w:font w:name="${DEFAULT_HEADING_FONT}">` +
    `<w:panose1 w:val="020F0302020204030204"/>` +
    `<w:charset w:val="00"/>` +
    `<w:family w:val="swiss"/>` +
    `<w:pitch w:val="variable"/>` +
    `</w:font>` +
    `<w:font w:name="${DEFAULT_CODE_FONT}">` +
    `<w:charset w:val="00"/>` +
    `<w:family w:val="modern"/>` +
    `<w:pitch w:val="fixed"/>` +
    `</w:font>` +
    `</w:fonts>`
  );
}

function buildNumberingXml(ctx: ExportContext): string {
  const abstract: string[] = [];
  const concrete: string[] = [];

  for (const def of ctx.numberingDefs) {
    const absId = def.numId;
    const levels: string[] = [];

    for (let lvl = 0; lvl < 9; lvl++) {
      if (def.ordered) {
        levels.push(
          `<w:lvl w:ilvl="${lvl}">` +
            `<w:start w:val="1"/>` +
            `<w:numFmt w:val="decimal"/>` +
            `<w:lvlText w:val="%${lvl + 1}."/>` +
            `<w:lvlJc w:val="left"/>` +
            `<w:pPr><w:ind w:left="${720 * (lvl + 1)}" w:hanging="360"/></w:pPr>` +
            `</w:lvl>`,
        );
      } else {
        const bullets = ['\u2022', '\u25E6', '\u25AA']; // •, ◦, ▪
        const bullet = bullets[lvl % bullets.length];
        levels.push(
          `<w:lvl w:ilvl="${lvl}">` +
            `<w:start w:val="1"/>` +
            `<w:numFmt w:val="bullet"/>` +
            `<w:lvlText w:val="${bullet}"/>` +
            `<w:lvlJc w:val="left"/>` +
            `<w:pPr><w:ind w:left="${720 * (lvl + 1)}" w:hanging="360"/></w:pPr>` +
            `<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>` +
            `</w:lvl>`,
        );
      }
    }

    abstract.push(
      `<w:abstractNum w:abstractNumId="${absId}">` + levels.join('') + `</w:abstractNum>`,
    );
    concrete.push(
      `<w:num w:numId="${def.numId}">` + `<w:abstractNumId w:val="${absId}"/>` + `</w:num>`,
    );
  }

  return (
    xmlDeclaration() +
    `<w:numbering xmlns:w="${NS_WML}">` +
    abstract.join('') +
    concrete.join('') +
    `</w:numbering>`
  );
}

function buildFootnotesXml(ctx: ExportContext): string {
  const footnotes: string[] = [];

  // Separator and continuation separator (required by Word)
  footnotes.push(
    `<w:footnote w:type="separator" w:id="-1">` +
      `<w:p><w:r><w:separator/></w:r></w:p>` +
      `</w:footnote>`,
  );
  footnotes.push(
    `<w:footnote w:type="continuationSeparator" w:id="0">` +
      `<w:p><w:r><w:continuationSeparator/></w:r></w:p>` +
      `</w:footnote>`,
  );

  // User footnotes
  for (const [_id, xml] of ctx.footnotes) {
    footnotes.push(xml);
  }

  return (
    xmlDeclaration() +
    `<w:footnotes xmlns:w="${NS_WML}" xmlns:r="${NS_R}">` +
    footnotes.join('') +
    `</w:footnotes>`
  );
}

// ============================================
// Helpers
// ============================================

/**
 * Strip HTML tags from a string, keeping only text content.
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

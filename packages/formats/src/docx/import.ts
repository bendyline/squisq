/**
 * DOCX Import
 *
 * Parses a .docx file (Office Open XML WordprocessingML) and converts
 * its content into a squisq MarkdownDocument (or Doc).
 *
 * Uses JSZip + DOMParser to read the archive and parse the XML — no
 * third-party docx library. Handles headings, paragraphs, inline
 * formatting (bold, italic, strikethrough), hyperlinks, lists, tables,
 * blockquotes, code blocks, images, and footnotes.
 *
 * @example
 * ```ts
 * import { docxToMarkdownDoc } from '@bendyline/squisq-formats/docx';
 *
 * const response = await fetch('document.docx');
 * const data = await response.arrayBuffer();
 * const doc = await docxToMarkdownDoc(data);
 * ```
 */

import type { Doc } from '@bendyline/squisq/schemas';
import { markdownToDoc } from '@bendyline/squisq/doc';
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
  MarkdownText,
  MarkdownEmphasis,
  MarkdownStrong,
  MarkdownStrikethrough,
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownImage,
  MarkdownBreak,
  MarkdownFootnoteReference,
  MarkdownFootnoteDefinition,
} from '@bendyline/squisq/markdown';

import { openPackage, getPartXml, getPartBinary, getPartRelationships } from '../ooxml/reader.js';
import type { OoxmlPackage, Relationship } from '../ooxml/types.js';
import { NS_WML, NS_R } from '../ooxml/namespaces.js';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { ContentContainer } from '@bendyline/squisq/storage';
import {
  HEADING_STYLE_MAP,
  QUOTE_STYLE_IDS,
  CODE_STYLE_IDS,
  INLINE_CODE_STYLE_IDS,
  BULLET_NUM_FORMATS,
} from './styles.js';

// ============================================
// Public API
// ============================================

/**
 * Options for DOCX import.
 */
export interface DocxImportOptions {
  /**
   * Whether to extract embedded images as base64 data URIs.
   * When false, images are represented as `[Image]` placeholders.
   * Default: false
   */
  extractImages?: boolean;
}

/**
 * Convert a .docx file to a MarkdownDocument.
 *
 * @param data - The raw .docx file as ArrayBuffer or Blob
 * @param options - Import options
 * @returns A MarkdownDocument representing the document content
 */
export async function docxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options: DocxImportOptions = {},
): Promise<MarkdownDocument> {
  const pkg = await openPackage(data);
  const ctx = await buildImportContext(pkg, options);

  const documentXml = await getPartXml(pkg, 'word/document.xml');
  if (!documentXml) {
    return { type: 'document', children: [] };
  }

  const body = getFirstElement(documentXml, 'body');
  if (!body) {
    return { type: 'document', children: [] };
  }

  const blocks = await convertBody(body, ctx);

  return { type: 'document', children: blocks };
}

/**
 * Convert a .docx file to a squisq Doc.
 *
 * Convenience wrapper: DOCX → MarkdownDocument → Doc.
 *
 * @param data - The raw .docx file as ArrayBuffer or Blob
 * @param options - Import options
 * @returns A squisq Doc
 */
export async function docxToDoc(
  data: ArrayBuffer | Blob,
  options: DocxImportOptions = {},
): Promise<Doc> {
  const markdownDoc = await docxToMarkdownDoc(data, options);
  return markdownToDoc(markdownDoc);
}

/**
 * Convert a .docx file to a ContentContainer with markdown + extracted images.
 *
 * The container will contain:
 * - The primary markdown document (index.md)
 * - Any embedded images under images/ (e.g., images/image1.png)
 *
 * @param data - The raw .docx file as ArrayBuffer or Blob
 * @param options - Import options
 * @returns A ContentContainer with the document and its media
 */
export async function docxToContainer(
  data: ArrayBuffer | Blob,
  options: DocxImportOptions = {},
): Promise<ContentContainer> {
  const pkg = await openPackage(data);
  const ctx = await buildImportContext(pkg, { ...options, extractImages: true });

  const documentXml = await getPartXml(pkg, 'word/document.xml');
  if (!documentXml) {
    const container = new MemoryContentContainer();
    await container.writeDocument('');
    return container;
  }

  const body = getFirstElement(documentXml, 'body');
  if (!body) {
    const container = new MemoryContentContainer();
    await container.writeDocument('');
    return container;
  }

  const blocks = await convertBody(body, ctx);
  const markdownDoc: MarkdownDocument = { type: 'document', children: blocks };

  // Serialize to markdown
  const { stringifyMarkdown } = await import('@bendyline/squisq/markdown');
  const markdown = stringifyMarkdown(markdownDoc);

  // Build container with markdown + images
  const container = new MemoryContentContainer();
  await container.writeDocument(markdown);

  for (const [path, { data: imageData, mimeType }] of ctx.extractedImages) {
    await container.writeFile(path, new Uint8Array(imageData), mimeType);
  }

  return container;
}

// ============================================
// Import Context
// ============================================

interface ImportContext {
  /** Style ID → heading depth mapping (from styles.xml) */
  headingStyles: Map<string, number>;
  /** Style IDs that represent blockquotes */
  quoteStyles: Set<string>;
  /** Style IDs that represent code blocks */
  codeStyles: Set<string>;
  /** Character style IDs that represent inline code */
  inlineCodeStyles: Set<string>;
  /** Document relationship map: rId → Relationship */
  documentRels: Map<string, Relationship>;
  /** Numbering definitions: numId → { levels: Map<ilvl, isOrdered> } */
  numbering: Map<string, NumberingInfo>;
  /** Footnote bodies: footnoteId → Element */
  footnotes: Map<string, Element>;
  /** Reference to the OOXML package (for extracting images) */
  pkg: OoxmlPackage;
  /** Import options */
  options: DocxImportOptions;
  /** Collected image files: relative path → { data, mimeType } */
  extractedImages: Map<string, { data: ArrayBuffer; mimeType: string }>;
  /** Counter for generating unique image filenames */
  imageCounter: number;
}

interface NumberingInfo {
  levels: Map<number, boolean>; // ilvl → isOrdered
}

async function buildImportContext(
  pkg: OoxmlPackage,
  options: DocxImportOptions,
): Promise<ImportContext> {
  const ctx: ImportContext = {
    headingStyles: new Map(),
    quoteStyles: new Set(),
    codeStyles: new Set(),
    inlineCodeStyles: new Set(),
    documentRels: new Map(),
    numbering: new Map(),
    footnotes: new Map(),
    pkg,
    options,
    extractedImages: new Map(),
    imageCounter: 0,
  };

  // Initialize with built-in defaults
  for (const [id, depth] of Object.entries(HEADING_STYLE_MAP)) {
    ctx.headingStyles.set(id, depth);
  }
  for (const id of QUOTE_STYLE_IDS) {
    ctx.quoteStyles.add(id);
  }
  for (const id of CODE_STYLE_IDS) {
    ctx.codeStyles.add(id);
  }
  for (const id of INLINE_CODE_STYLE_IDS) {
    ctx.inlineCodeStyles.add(id);
  }

  // Parse styles.xml for custom heading/quote/code mappings
  await parseStyles(pkg, ctx);

  // Parse document relationships
  const rels = await getPartRelationships(pkg, 'word/document.xml');
  for (const rel of rels) {
    ctx.documentRels.set(rel.id, rel);
  }

  // Parse numbering.xml
  await parseNumbering(pkg, ctx);

  // Parse footnotes.xml
  await parseFootnotes(pkg, ctx);

  return ctx;
}

// ============================================
// Styles Parsing
// ============================================

async function parseStyles(pkg: OoxmlPackage, ctx: ImportContext): Promise<void> {
  const doc = await getPartXml(pkg, 'word/styles.xml');
  if (!doc) return;

  const styles = doc.getElementsByTagNameNS(NS_WML, 'style');
  // Fallback for documents that don't use namespace prefixes properly
  const stylesList = styles.length > 0 ? styles : doc.getElementsByTagName('style');

  for (let i = 0; i < stylesList.length; i++) {
    const style = stylesList[i];
    const styleId = style.getAttributeNS(NS_WML, 'styleId') ?? style.getAttribute('w:styleId');
    if (!styleId) continue;

    const nameEl = getFirstChildElement(style, 'name');
    const styleName = nameEl?.getAttributeNS(NS_WML, 'val') ?? nameEl?.getAttribute('w:val') ?? '';

    // Check if this is a heading style by name
    const headingMatch = styleName.match(/^heading\s+(\d+)$/i);
    if (headingMatch) {
      const depth = parseInt(headingMatch[1], 10);
      if (depth >= 1 && depth <= 6) {
        ctx.headingStyles.set(styleId, depth);
      }
    }

    // Check pPr > outlineLvl for heading detection
    const pPr = getFirstChildElement(style, 'pPr');
    if (pPr) {
      const outlineLvl = getFirstChildElement(pPr, 'outlineLvl');
      if (outlineLvl) {
        const val = outlineLvl.getAttributeNS(NS_WML, 'val') ?? outlineLvl.getAttribute('w:val');
        if (val !== null) {
          const depth = parseInt(val, 10) + 1;
          if (depth >= 1 && depth <= 6) {
            ctx.headingStyles.set(styleId, depth);
          }
        }
      }
    }
  }
}

// ============================================
// Numbering Parsing
// ============================================

async function parseNumbering(pkg: OoxmlPackage, ctx: ImportContext): Promise<void> {
  const doc = await getPartXml(pkg, 'word/numbering.xml');
  if (!doc) return;

  // Parse abstract numbering definitions
  const abstractNums = new Map<string, Map<number, boolean>>(); // abstractNumId → levels(ilvl → isOrdered)

  const abstractNumEls = getAllElements(doc, 'abstractNum');
  for (const absNum of abstractNumEls) {
    const absId = getAttr(absNum, 'abstractNumId');
    if (!absId) continue;

    const levels = new Map<number, boolean>();
    const lvlEls = getAllChildElements(absNum, 'lvl');
    for (const lvl of lvlEls) {
      const ilvlStr = getAttr(lvl, 'ilvl');
      if (ilvlStr === null) continue;
      const ilvl = parseInt(ilvlStr, 10);

      const numFmtEl = getFirstChildElement(lvl, 'numFmt');
      const numFmt = numFmtEl ? getAttr(numFmtEl, 'val') : null;

      const isOrdered = numFmt !== null && !BULLET_NUM_FORMATS.has(numFmt);
      levels.set(ilvl, isOrdered);
    }

    abstractNums.set(absId, levels);
  }

  // Parse concrete num → abstractNum mappings
  const numEls = getAllElements(doc, 'num');
  for (const num of numEls) {
    const numId = getAttr(num, 'numId');
    if (!numId) continue;

    const abstractNumIdEl = getFirstChildElement(num, 'abstractNumId');
    const absId = abstractNumIdEl ? getAttr(abstractNumIdEl, 'val') : null;
    if (!absId) continue;

    const levels = abstractNums.get(absId);
    if (levels) {
      ctx.numbering.set(numId, { levels });
    }
  }
}

// ============================================
// Footnotes Parsing
// ============================================

async function parseFootnotes(pkg: OoxmlPackage, ctx: ImportContext): Promise<void> {
  const doc = await getPartXml(pkg, 'word/footnotes.xml');
  if (!doc) return;

  const footnoteEls = getAllElements(doc, 'footnote');
  for (const fn of footnoteEls) {
    const id = getAttr(fn, 'id');
    const type = getAttr(fn, 'type');
    // Skip separator and continuation separator footnotes
    if (!id || type === 'separator' || type === 'continuationSeparator') continue;
    ctx.footnotes.set(id, fn);
  }
}

// ============================================
// Body Conversion
// ============================================

async function convertBody(body: Element, ctx: ImportContext): Promise<MarkdownBlockNode[]> {
  const result: MarkdownBlockNode[] = [];
  const children = Array.from(body.children);

  let i = 0;
  while (i < children.length) {
    const el = children[i];
    const localName = el.localName;

    if (localName === 'p') {
      // Check if this is part of a list
      const numPr = getNumPr(el);
      if (numPr) {
        // Collect consecutive list paragraphs
        const { node, consumed } = await collectList(children, i, ctx);
        result.push(node);
        i += consumed;
        continue;
      }

      const block = await convertParagraph(el, ctx);
      if (block) {
        result.push(block);
      }
      i++;
    } else if (localName === 'tbl') {
      const table = await convertTable(el, ctx);
      if (table) result.push(table);
      i++;
    } else {
      // Skip unknown elements (sectPr, bookmarkStart, etc.)
      i++;
    }
  }

  // Append footnote definitions at the end
  const footnoteNodes = await convertFootnoteDefinitions(ctx);
  result.push(...footnoteNodes);

  return result;
}

// ============================================
// Paragraph Conversion
// ============================================

async function convertParagraph(
  el: Element,
  ctx: ImportContext,
): Promise<MarkdownBlockNode | null> {
  const pPr = getFirstChildElement(el, 'pPr');
  const styleId = getParagraphStyleId(pPr);

  // Check for heading
  if (styleId && ctx.headingStyles.has(styleId)) {
    const depth = ctx.headingStyles.get(styleId)!;
    const inlines = await convertRuns(el, ctx);
    if (inlines.length === 0) return null;
    return {
      type: 'heading',
      depth: Math.min(Math.max(depth, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6,
      children: inlines,
    } satisfies MarkdownHeading;
  }

  // Check for blockquote
  if (styleId && ctx.quoteStyles.has(styleId)) {
    const inlines = await convertRuns(el, ctx);
    if (inlines.length === 0) return null;
    const paragraph: MarkdownParagraph = { type: 'paragraph', children: inlines };
    return { type: 'blockquote', children: [paragraph] } satisfies MarkdownBlockquote;
  }

  // Check for code block
  if (styleId && ctx.codeStyles.has(styleId)) {
    const text = getElementTextContent(el);
    return { type: 'code', value: text } satisfies MarkdownCodeBlock;
  }

  // Regular paragraph
  const inlines = await convertRuns(el, ctx);
  if (inlines.length === 0) return null;
  return { type: 'paragraph', children: inlines } satisfies MarkdownParagraph;
}

// ============================================
// Run (Inline) Conversion
// ============================================

async function convertRuns(
  paragraphEl: Element,
  ctx: ImportContext,
): Promise<MarkdownInlineNode[]> {
  const result: MarkdownInlineNode[] = [];
  const children = Array.from(paragraphEl.children);

  for (const child of children) {
    const localName = child.localName;

    if (localName === 'r') {
      const inlines = await convertRun(child, ctx);
      result.push(...inlines);
    } else if (localName === 'hyperlink') {
      const link = await convertHyperlink(child, ctx);
      if (link) result.push(link);
    }
    // Skip pPr, bookmarkStart, bookmarkEnd, etc.
  }

  return mergeAdjacentText(result);
}

async function convertRun(runEl: Element, ctx: ImportContext): Promise<MarkdownInlineNode[]> {
  const result: MarkdownInlineNode[] = [];
  const rPr = getFirstChildElement(runEl, 'rPr');
  const format = parseRunFormat(rPr, ctx);

  for (const child of Array.from(runEl.children)) {
    const localName = child.localName;

    if (localName === 't') {
      const text = child.textContent ?? '';
      if (!text) continue;

      if (format.code) {
        result.push({ type: 'inlineCode', value: text } satisfies MarkdownInlineCode);
      } else {
        let node: MarkdownInlineNode = { type: 'text', value: text } satisfies MarkdownText;
        if (format.strike) {
          node = { type: 'delete', children: [node] } satisfies MarkdownStrikethrough;
        }
        if (format.italic) {
          node = { type: 'emphasis', children: [node] } satisfies MarkdownEmphasis;
        }
        if (format.bold) {
          node = { type: 'strong', children: [node] } satisfies MarkdownStrong;
        }
        result.push(node);
      }
    } else if (localName === 'br') {
      result.push({ type: 'break' } satisfies MarkdownBreak);
    } else if (localName === 'footnoteReference') {
      const fnId = getAttr(child, 'id');
      if (fnId && fnId !== '0' && fnId !== '-1') {
        result.push({
          type: 'footnoteReference',
          identifier: `fn${fnId}`,
        } satisfies MarkdownFootnoteReference);
      }
    } else if (localName === 'drawing' || localName === 'pict') {
      const img = await extractImage(child, ctx);
      if (img) result.push(img);
    }
  }

  return result;
}

interface RunFormat {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
}

function parseRunFormat(rPr: Element | null, ctx: ImportContext): RunFormat {
  if (!rPr) return { bold: false, italic: false, strike: false, code: false };

  const bold = hasChildElement(rPr, 'b') && !isFalseToggle(getFirstChildElement(rPr, 'b')!);
  const italic = hasChildElement(rPr, 'i') && !isFalseToggle(getFirstChildElement(rPr, 'i')!);
  const strike =
    hasChildElement(rPr, 'strike') && !isFalseToggle(getFirstChildElement(rPr, 'strike')!);

  // Check for inline code via character style
  const rStyle = getFirstChildElement(rPr, 'rStyle');
  const charStyleId = rStyle ? getAttr(rStyle, 'val') : null;
  const isCodeStyle = charStyleId ? ctx.inlineCodeStyles.has(charStyleId) : false;

  // Check for monospace font as a code indicator
  const rFonts = getFirstChildElement(rPr, 'rFonts');
  const fontName = rFonts ? (getAttr(rFonts, 'ascii') ?? getAttr(rFonts, 'hAnsi') ?? '') : '';
  const isMonospace = /consolas|courier|mono/i.test(fontName);

  return { bold, italic, strike, code: isCodeStyle || isMonospace };
}

function isFalseToggle(el: Element): boolean {
  const val = getAttr(el, 'val');
  return val === '0' || val === 'false';
}

// ============================================
// Hyperlink Conversion
// ============================================

async function convertHyperlink(el: Element, ctx: ImportContext): Promise<MarkdownLink | null> {
  const rId = el.getAttributeNS(NS_R, 'id') ?? el.getAttribute('r:id');

  let url = '';
  if (rId) {
    const rel = ctx.documentRels.get(rId);
    if (rel) url = rel.target;
  }

  // Also check for w:anchor (internal bookmarks)
  if (!url) {
    const anchor = el.getAttributeNS(NS_WML, 'anchor') ?? el.getAttribute('w:anchor');
    if (anchor) url = `#${anchor}`;
  }

  const inlines: MarkdownInlineNode[] = [];
  for (const child of Array.from(el.children)) {
    if (child.localName === 'r') {
      inlines.push(...(await convertRun(child, ctx)));
    }
  }

  if (inlines.length === 0) return null;

  return {
    type: 'link',
    url,
    children: mergeAdjacentText(inlines),
  };
}

// ============================================
// Image Extraction
// ============================================

async function extractImage(el: Element, ctx: ImportContext): Promise<MarkdownImage | null> {
  // Find <a:blip r:embed="rIdX"/> anywhere in the drawing tree
  const blip = findDescendant(el, 'blip');
  if (!blip) {
    return { type: 'image', url: '', alt: 'Image' };
  }

  const rId = blip.getAttributeNS(NS_R, 'embed') ?? blip.getAttribute('r:embed');
  if (!rId) {
    return { type: 'image', url: '', alt: 'Image' };
  }

  const rel = ctx.documentRels.get(rId);
  if (!rel) {
    return { type: 'image', url: '', alt: 'Image' };
  }

  // Resolve the target path relative to word/
  const target = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`;

  // Extract binary data from the zip
  const data = await getPartBinary(ctx.pkg, target);
  if (!data) {
    return { type: 'image', url: '', alt: 'Image' };
  }

  // Determine extension and MIME type
  const dot = target.lastIndexOf('.');
  const ext = dot !== -1 ? target.slice(dot).toLowerCase() : '.png';
  const mimeType = IMAGE_MIME_MAP[ext] ?? 'application/octet-stream';

  // Generate a unique image path
  ctx.imageCounter++;
  const imagePath = `images/image${ctx.imageCounter}${ext}`;

  // Store the extracted image data
  ctx.extractedImages.set(imagePath, { data, mimeType });

  // Try to extract alt text from the drawing's docPr element
  const docPr = findDescendant(el, 'docPr');
  const alt = docPr?.getAttribute('descr') || docPr?.getAttribute('title') || 'Image';

  return {
    type: 'image',
    url: imagePath,
    alt,
  };
}

const IMAGE_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.emf': 'image/emf',
  '.wmf': 'image/wmf',
};

/** Recursively find the first descendant element with the given local name. */
function findDescendant(el: Element, localName: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.localName === localName) return child;
    const found = findDescendant(child, localName);
    if (found) return found;
  }
  return null;
}

// ============================================
// List Collection
// ============================================

interface ListResult {
  node: MarkdownList;
  consumed: number;
}

interface NumPrInfo {
  numId: string;
  ilvl: number;
}

async function collectList(
  elements: Element[],
  startIdx: number,
  ctx: ImportContext,
): Promise<ListResult> {
  const firstNumPr = getNumPr(elements[startIdx])!;
  const { numId } = firstNumPr;

  // Determine if ordered from numbering definition
  const numInfo = ctx.numbering.get(numId);
  const isOrdered = numInfo?.levels.get(0) ?? false;

  const items: MarkdownListItem[] = [];
  let consumed = 0;

  let i = startIdx;
  while (i < elements.length) {
    const el = elements[i];
    if (el.localName !== 'p') break;

    const numPr = getNumPr(el);
    if (!numPr || numPr.numId !== numId) break;

    // Convert this paragraph's inline content
    const inlines = await convertRuns(el, ctx);
    if (inlines.length > 0) {
      const paragraph: MarkdownParagraph = { type: 'paragraph', children: inlines };

      // Check if this is a nested list item
      if (numPr.ilvl > firstNumPr.ilvl) {
        // Collect nested list items
        const nested = await collectNestedList(elements, i, ctx, firstNumPr.ilvl);
        if (items.length > 0) {
          // Attach nested list to the last item
          const lastItem = items[items.length - 1];
          const nestedIsOrdered = numInfo?.levels.get(numPr.ilvl) ?? false;
          const nestedList: MarkdownList = {
            type: 'list',
            ordered: nestedIsOrdered,
            children: nested.items,
          };
          lastItem.children.push(nestedList);
        }
        i += nested.consumed;
        consumed += nested.consumed;
        continue;
      }

      items.push({
        type: 'listItem',
        children: [paragraph],
      });
    }

    i++;
    consumed++;
  }

  return {
    node: {
      type: 'list',
      ordered: isOrdered,
      children: items,
    },
    consumed,
  };
}

interface NestedListResult {
  items: MarkdownListItem[];
  consumed: number;
}

async function collectNestedList(
  elements: Element[],
  startIdx: number,
  ctx: ImportContext,
  parentIlvl: number,
): Promise<NestedListResult> {
  const items: MarkdownListItem[] = [];
  let consumed = 0;

  let i = startIdx;
  while (i < elements.length) {
    const el = elements[i];
    if (el.localName !== 'p') break;

    const numPr = getNumPr(el);
    if (!numPr) break;
    if (numPr.ilvl <= parentIlvl) break;

    const inlines = await convertRuns(el, ctx);
    if (inlines.length > 0) {
      const paragraph: MarkdownParagraph = { type: 'paragraph', children: inlines };
      items.push({ type: 'listItem', children: [paragraph] });
    }

    i++;
    consumed++;
  }

  return { items, consumed };
}

function getNumPr(el: Element): NumPrInfo | null {
  const pPr = getFirstChildElement(el, 'pPr');
  if (!pPr) return null;

  const numPr = getFirstChildElement(pPr, 'numPr');
  if (!numPr) return null;

  const ilvlEl = getFirstChildElement(numPr, 'ilvl');
  const numIdEl = getFirstChildElement(numPr, 'numId');

  const ilvlVal = ilvlEl ? getAttr(ilvlEl, 'val') : null;
  const numIdVal = numIdEl ? getAttr(numIdEl, 'val') : null;

  if (!numIdVal || numIdVal === '0') return null; // numId 0 means "no list"

  return {
    numId: numIdVal,
    ilvl: ilvlVal ? parseInt(ilvlVal, 10) : 0,
  };
}

// ============================================
// Table Conversion
// ============================================

async function convertTable(tblEl: Element, ctx: ImportContext): Promise<MarkdownTable | null> {
  const rows: MarkdownTableRow[] = [];

  const trEls = getAllChildElements(tblEl, 'tr');
  for (let ri = 0; ri < trEls.length; ri++) {
    const row = await convertTableRow(trEls[ri], ctx, ri === 0);
    rows.push(row);
  }

  if (rows.length === 0) return null;

  // If first row isn't explicitly a header, treat it as one anyway
  // (Markdown tables require a header row)
  return {
    type: 'table',
    children: rows,
  };
}

async function convertTableRow(
  trEl: Element,
  ctx: ImportContext,
  isHeader: boolean,
): Promise<MarkdownTableRow> {
  const cells: MarkdownTableCell[] = [];
  const tcEls = getAllChildElements(trEl, 'tc');

  for (const tc of tcEls) {
    const cell = await convertTableCell(tc, ctx, isHeader);
    cells.push(cell);
  }

  return { type: 'tableRow', children: cells };
}

async function convertTableCell(
  tcEl: Element,
  ctx: ImportContext,
  isHeader: boolean,
): Promise<MarkdownTableCell> {
  const inlines: MarkdownInlineNode[] = [];

  // A cell can contain multiple paragraphs; flatten them with breaks
  const paragraphs = getAllChildElements(tcEl, 'p');
  for (let pi = 0; pi < paragraphs.length; pi++) {
    if (pi > 0) {
      inlines.push({ type: 'break' } as MarkdownBreak);
    }
    const runs = await convertRuns(paragraphs[pi], ctx);
    inlines.push(...runs);
  }

  return {
    type: 'tableCell',
    isHeader,
    children: mergeAdjacentText(inlines),
  };
}

// ============================================
// Footnote Definition Conversion
// ============================================

async function convertFootnoteDefinitions(
  ctx: ImportContext,
): Promise<MarkdownFootnoteDefinition[]> {
  const results: MarkdownFootnoteDefinition[] = [];

  for (const [id, el] of ctx.footnotes) {
    const children: MarkdownBlockNode[] = [];
    const paragraphs = getAllChildElements(el, 'p');

    for (const p of paragraphs) {
      const inlines = await convertRuns(p, ctx);
      if (inlines.length > 0) {
        children.push({
          type: 'paragraph',
          children: inlines,
        } satisfies MarkdownParagraph);
      }
    }

    if (children.length > 0) {
      results.push({
        type: 'footnoteDefinition',
        identifier: `fn${id}`,
        children,
      });
    }
  }

  return results;
}

// ============================================
// XML Helper Utilities
// ============================================

/**
 * Get the first element child with a given local name.
 * Handles both namespaced and non-namespaced elements.
 */
function getFirstChildElement(parent: Element | Document, localName: string): Element | null {
  for (const child of Array.from(parent.children ?? [])) {
    if (child.localName === localName) return child;
  }
  return null;
}

/**
 * Get all direct child elements with a given local name.
 */
function getAllChildElements(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.localName === localName) result.push(child);
  }
  return result;
}

/**
 * Get all elements with a given local name in the document.
 */
function getAllElements(doc: Document | Element, localName: string): Element[] {
  // Try namespace-aware first
  const nsEls =
    'getElementsByTagNameNS' in doc ? doc.getElementsByTagNameNS(NS_WML, localName) : null;
  if (nsEls && nsEls.length > 0) return Array.from(nsEls);

  // Fallback: try with w: prefix
  const prefixed = doc.getElementsByTagName(`w:${localName}`);
  if (prefixed.length > 0) return Array.from(prefixed);

  // Final fallback: bare name
  return Array.from(doc.getElementsByTagName(localName));
}

/**
 * Get the first element with given local name in the document or subtree.
 */
function getFirstElement(doc: Document | Element, localName: string): Element | null {
  const els = getAllElements(doc, localName);
  return els.length > 0 ? els[0] : null;
}

/**
 * Get a w:-prefixed attribute, trying namespace-aware first then fallback.
 */
function getAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(NS_WML, localName) || el.getAttribute(`w:${localName}`) || null;
}

/**
 * Check if an element has a direct child with the given local name.
 */
function hasChildElement(parent: Element, localName: string): boolean {
  return getFirstChildElement(parent, localName) !== null;
}

/**
 * Get the paragraph style ID from a pPr element.
 */
function getParagraphStyleId(pPr: Element | null): string | null {
  if (!pPr) return null;
  const pStyle = getFirstChildElement(pPr, 'pStyle');
  if (!pStyle) return null;
  return getAttr(pStyle, 'val');
}

/**
 * Get all text content from an element (concatenating all w:t descendants).
 */
function getElementTextContent(el: Element): string {
  const parts: string[] = [];

  function walk(node: Element): void {
    if (node.localName === 't') {
      parts.push(node.textContent ?? '');
    }
    for (const child of Array.from(node.children)) {
      walk(child);
    }
  }

  walk(el);
  return parts.join('');
}

/**
 * Merge adjacent MarkdownText nodes to reduce fragmentation.
 */
function mergeAdjacentText(nodes: MarkdownInlineNode[]): MarkdownInlineNode[] {
  if (nodes.length <= 1) return nodes;

  const result: MarkdownInlineNode[] = [];
  for (const node of nodes) {
    const prev = result[result.length - 1];
    if (node.type === 'text' && prev?.type === 'text') {
      // Merge into previous text node
      (prev as MarkdownText).value += (node as MarkdownText).value;
    } else {
      result.push(node);
    }
  }
  return result;
}

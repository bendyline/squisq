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
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
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
  MarkdownContainerDirective,
} from '@bendyline/squisq/markdown';

import {
  openPackage,
  getPartXml,
  getPartBinary,
  getPartRelationships,
  requireMainPartPath,
} from '../ooxml/reader.js';
import type { OoxmlOpenOptions } from '../ooxml/reader.js';
import type { OoxmlPackage, Relationship } from '../ooxml/types.js';
import { NS_WML, NS_R } from '../ooxml/namespaces.js';
import { baseDirOf, resolveTarget } from '../ooxml/readUtils.js';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { buildContainer } from '../shared/container.js';
import { extToMime } from '../shared/images.js';
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

/** Conventional main part path; the root `officeDocument` rel wins when present. */
const DOCX_MAIN_PART = 'word/document.xml';

/**
 * Options for DOCX import.
 */
export interface DocxImportOptions extends OoxmlOpenOptions {
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
  const pkg = await openPackage(data, options);
  const mainPart = requireMainPartPath(pkg, DOCX_MAIN_PART, 'DOCX');
  const ctx = await buildImportContext(pkg, options, mainPart);

  const documentXml = await getPartXml(pkg, mainPart);
  if (!documentXml) {
    throw new Error(`Invalid DOCX package: main document part "${mainPart}" could not be parsed.`);
  }

  const body = getFirstElement(documentXml, 'body');
  if (!body) {
    return { type: 'document', children: [] };
  }

  const blocks = await convertDocumentStories(body, ctx);

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
  const pkg = await openPackage(data, options);
  const mainPart = requireMainPartPath(pkg, DOCX_MAIN_PART, 'DOCX');
  const ctx = await buildImportContext(pkg, { ...options, extractImages: true }, mainPart);

  const documentXml = await getPartXml(pkg, mainPart);
  if (!documentXml) {
    throw new Error(`Invalid DOCX package: main document part "${mainPart}" could not be parsed.`);
  }

  const body = getFirstElement(documentXml, 'body');
  if (!body) return buildContainer('', []);

  const blocks = await convertDocumentStories(body, ctx);
  const markdownDoc: MarkdownDocument = { type: 'document', children: blocks };

  return buildContainer(stringifyMarkdown(markdownDoc), ctx.extractedImages);
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
  /** Endnote bodies: endnoteId → Element */
  endnotes: Map<string, Element>;
  /** Part whose relationships are active while converting runs. */
  currentPartPath: string;
  /** The resolved main document part (may differ from the conventional path). */
  mainPartPath: string;
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
  mainPartPath: string = DOCX_MAIN_PART,
): Promise<ImportContext> {
  const ctx: ImportContext = {
    headingStyles: new Map(),
    quoteStyles: new Set(),
    codeStyles: new Set(),
    inlineCodeStyles: new Set(),
    documentRels: new Map(),
    numbering: new Map(),
    footnotes: new Map(),
    endnotes: new Map(),
    currentPartPath: mainPartPath,
    mainPartPath,
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
  const rels = await getPartRelationships(pkg, mainPartPath);
  for (const rel of rels) {
    ctx.documentRels.set(rel.id, rel);
  }

  // Parse numbering.xml
  await parseNumbering(pkg, ctx);

  // Parse footnotes.xml
  await parseFootnotes(pkg, ctx);

  // Parse endnotes.xml
  await parseEndnotes(pkg, ctx);

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

async function parseEndnotes(pkg: OoxmlPackage, ctx: ImportContext): Promise<void> {
  const doc = await getPartXml(pkg, 'word/endnotes.xml');
  if (!doc) return;

  const endnoteEls = getAllElements(doc, 'endnote');
  for (const note of endnoteEls) {
    const id = getAttr(note, 'id');
    const type = getAttr(note, 'type');
    if (!id || type === 'separator' || type === 'continuationSeparator') continue;
    ctx.endnotes.set(id, note);
  }
}

// ============================================
// Body Conversion
// ============================================

/**
 * Convert the main story plus the related header/footer stories. Header and
 * footer blocks live in named directives so Markdown consumers can distinguish
 * them from body content and the DOCX exporter can put them back in the right
 * OOXML parts.
 */
async function convertDocumentStories(
  body: Element,
  ctx: ImportContext,
): Promise<MarkdownBlockNode[]> {
  const bodyBlocks = await convertBody(body, ctx);
  const headers = await convertRelatedStories(body, ctx, 'header');
  const footers = await convertRelatedStories(body, ctx, 'footer');
  const noteDefinitions = await convertNoteDefinitions(ctx);
  return [...bodyBlocks, ...headers, ...footers, ...noteDefinitions];
}

async function convertRelatedStories(
  body: Element,
  ctx: ImportContext,
  kind: 'header' | 'footer',
): Promise<MarkdownContainerDirective[]> {
  const relationshipTypeSuffix = `/${kind}`;
  const referenceName = `${kind}Reference`;
  const referenceTypes = new Map<string, string>();
  for (const reference of getAllElements(body, referenceName)) {
    const id = reference.getAttributeNS(NS_R, 'id') ?? reference.getAttribute('r:id');
    if (id) referenceTypes.set(id, getAttr(reference, 'type') ?? 'default');
  }

  const documentRelationships = ctx.documentRels;
  const previousPartPath = ctx.currentPartPath;
  const results: MarkdownContainerDirective[] = [];

  for (const relationship of documentRelationships.values()) {
    if (!relationship.type.endsWith(relationshipTypeSuffix)) continue;

    const partPath = resolveTarget(baseDirOf(ctx.mainPartPath), relationship.target);
    const part = await getPartXml(ctx.pkg, partPath);
    if (!part?.documentElement) continue;

    const partRelationships = await getPartRelationships(ctx.pkg, partPath);
    ctx.documentRels = new Map(partRelationships.map((rel) => [rel.id, rel]));
    ctx.currentPartPath = partPath;
    try {
      const children = await convertBody(part.documentElement, ctx);
      if (children.length === 0) continue;
      results.push({
        type: 'containerDirective',
        name: `docx-${kind}`,
        attributes: {
          type: referenceTypes.get(relationship.id) ?? 'default',
          source: partPath,
        },
        children,
      });
    } finally {
      ctx.documentRels = documentRelationships;
      ctx.currentPartPath = previousPartPath;
    }
  }

  return results;
}

async function convertBody(body: Element, ctx: ImportContext): Promise<MarkdownBlockNode[]> {
  return convertBlockElements(Array.from(body.children), ctx);
}

async function convertBlockElements(
  children: Element[],
  ctx: ImportContext,
): Promise<MarkdownBlockNode[]> {
  const result: MarkdownBlockNode[] = [];

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
    } else if (localName === 'sdt') {
      const content = getFirstChildElement(el, 'sdtContent');
      if (content) result.push(...(await convertBlockElements(Array.from(content.children), ctx)));
      i++;
    } else if (
      localName === 'ins' ||
      localName === 'moveTo' ||
      localName === 'customXml' ||
      localName === 'smartTag' ||
      localName === 'fldSimple'
    ) {
      result.push(...(await convertBlockElements(Array.from(el.children), ctx)));
      i++;
    } else if (localName === 'AlternateContent') {
      const selected = getFirstChildElement(el, 'Choice') ?? getFirstChildElement(el, 'Fallback');
      if (selected)
        result.push(...(await convertBlockElements(Array.from(selected.children), ctx)));
      i++;
    } else {
      // Skip unknown elements (sectPr, bookmarkStart, etc.)
      i++;
    }
  }

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
  return mergeAdjacentText(await convertInlineElements(Array.from(paragraphEl.children), ctx));
}

async function convertInlineElements(
  children: Element[],
  ctx: ImportContext,
): Promise<MarkdownInlineNode[]> {
  const result: MarkdownInlineNode[] = [];

  for (const child of children) {
    const localName = child.localName;

    if (localName === 'r') {
      const inlines = await convertRun(child, ctx);
      result.push(...inlines);
    } else if (localName === 'hyperlink') {
      const link = await convertHyperlink(child, ctx);
      if (link) result.push(link);
    } else if (localName === 'sdt') {
      const content = getFirstChildElement(child, 'sdtContent');
      if (content) {
        result.push(...(await convertInlineElements(Array.from(content.children), ctx)));
      }
    } else if (
      localName === 'ins' ||
      localName === 'moveTo' ||
      localName === 'customXml' ||
      localName === 'smartTag' ||
      localName === 'fldSimple'
    ) {
      result.push(...(await convertInlineElements(Array.from(child.children), ctx)));
    } else if (localName === 'AlternateContent') {
      // Choice and Fallback represent the same content for different Word
      // versions. Reading both duplicates every text box and legacy image.
      const selected =
        getFirstChildElement(child, 'Choice') ?? getFirstChildElement(child, 'Fallback');
      if (selected) {
        result.push(...(await convertInlineElements(Array.from(selected.children), ctx)));
      }
    } else if (localName === 'drawing' || localName === 'pict') {
      result.push(...(await convertDrawingContent(child, ctx)));
    }
    // Skip pPr, bookmarkStart, bookmarkEnd, etc.
  }

  return result;
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
    } else if (localName === 'br' || localName === 'cr') {
      result.push({ type: 'break' } satisfies MarkdownBreak);
    } else if (localName === 'tab') {
      // Tabs are visible separators in Word. A literal tab is unstable when
      // serialized through Markdown (it may become indentation), so retain the
      // word boundary as a regular space.
      result.push({ type: 'text', value: ' ' } satisfies MarkdownText);
    } else if (localName === 'footnoteReference') {
      const fnId = getAttr(child, 'id');
      if (fnId && fnId !== '0' && fnId !== '-1') {
        result.push({
          type: 'footnoteReference',
          identifier: `fn${fnId}`,
        } satisfies MarkdownFootnoteReference);
      }
    } else if (localName === 'endnoteReference') {
      const noteId = getAttr(child, 'id');
      if (noteId && noteId !== '0' && noteId !== '-1') {
        result.push({
          type: 'footnoteReference',
          identifier: `endnote${noteId}`,
        } satisfies MarkdownFootnoteReference);
      }
    } else if (localName === 'drawing' || localName === 'pict' || localName === 'object') {
      result.push(...(await convertDrawingContent(child, ctx)));
    } else if (localName === 'AlternateContent') {
      const selected =
        getFirstChildElement(child, 'Choice') ?? getFirstChildElement(child, 'Fallback');
      if (selected) {
        result.push(...(await convertInlineElements(Array.from(selected.children), ctx)));
      }
    }
  }

  return result;
}

async function convertDrawingContent(
  el: Element,
  ctx: ImportContext,
): Promise<MarkdownInlineNode[]> {
  const result: MarkdownInlineNode[] = [];

  // A positioned Word shape may be a text box, an image, or both. Text box
  // paragraphs are nested inside the drawing rather than being paragraph
  // siblings, so the normal body walker never sees them.
  const textBoxes = findDescendants(el, 'txbxContent');
  for (const textBox of textBoxes) {
    const inlines = await flattenContainerToInlines(textBox, ctx);
    appendInlineGroup(result, inlines);
  }

  const image = await extractImage(el, ctx);
  if (image) result.push(image);
  if (textBoxes.length > 0 && result.length > 0) {
    // Positioned text boxes are independent visual regions. Several can be
    // anchored in the same otherwise-empty paragraph (for example, labels on
    // a number line); hard boundaries prevent their text from collapsing into
    // one synthetic word during Markdown serialization.
    if (result[0]?.type !== 'break') result.unshift({ type: 'break' } satisfies MarkdownBreak);
    if (result[result.length - 1]?.type !== 'break') {
      result.push({ type: 'break' } satisfies MarkdownBreak);
    }
  }
  return result;
}

async function flattenContainerToInlines(
  container: Element,
  ctx: ImportContext,
): Promise<MarkdownInlineNode[]> {
  const result: MarkdownInlineNode[] = [];

  for (const child of Array.from(container.children)) {
    if (child.localName === 'p') {
      appendInlineGroup(result, await convertRuns(child, ctx));
    } else if (child.localName === 'tbl') {
      appendInlineGroup(result, await flattenTableToInlines(child, ctx));
    } else if (child.localName === 'sdt') {
      const content = getFirstChildElement(child, 'sdtContent');
      if (content) appendInlineGroup(result, await flattenContainerToInlines(content, ctx));
    } else if (
      child.localName === 'ins' ||
      child.localName === 'moveTo' ||
      child.localName === 'customXml' ||
      child.localName === 'smartTag' ||
      child.localName === 'fldSimple'
    ) {
      appendInlineGroup(result, await flattenContainerToInlines(child, ctx));
    } else if (child.localName === 'AlternateContent') {
      const selected =
        getFirstChildElement(child, 'Choice') ?? getFirstChildElement(child, 'Fallback');
      if (selected) appendInlineGroup(result, await flattenContainerToInlines(selected, ctx));
    } else if (child.localName === 'r' || child.localName === 'hyperlink') {
      appendInlineGroup(result, await convertInlineElements([child], ctx));
    }
  }

  return mergeAdjacentText(result);
}

async function flattenTableToInlines(
  table: Element,
  ctx: ImportContext,
): Promise<MarkdownInlineNode[]> {
  const result: MarkdownInlineNode[] = [];
  for (const row of getAllChildElements(table, 'tr')) {
    for (const cell of getAllChildElements(row, 'tc')) {
      appendInlineGroup(result, await flattenContainerToInlines(cell, ctx));
    }
  }
  return mergeAdjacentText(result);
}

function appendInlineGroup(target: MarkdownInlineNode[], group: MarkdownInlineNode[]): void {
  if (group.length === 0) return;
  if (target.length > 0 && target[target.length - 1]?.type !== 'break') {
    target.push({ type: 'break' } satisfies MarkdownBreak);
  }
  target.push(...group);
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

  const inlines = await convertInlineElements(Array.from(el.children), ctx);

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
  // DrawingML uses <a:blip r:embed="...">; older Word/VML documents use
  // <v:imagedata r:id="...">. Supporting both also recovers many scanned
  // forms and older templates in the corpus.
  const blip = findDescendant(el, 'blip');
  const imageData = findDescendant(el, 'imagedata');
  const rId = blip
    ? (blip.getAttributeNS(NS_R, 'embed') ?? blip.getAttribute('r:embed'))
    : (imageData?.getAttributeNS(NS_R, 'id') ??
      imageData?.getAttribute('r:id') ??
      imageData?.getAttribute('o:relid'));
  if (!rId) return null;

  const rel = ctx.documentRels.get(rId);
  if (!rel || rel.targetMode === 'External') return null;

  const target = resolveTarget(baseDirOf(ctx.currentPartPath), rel.target);

  // Extract binary data from the zip
  const data = await getPartBinary(ctx.pkg, target);
  if (!data) return null;

  // Determine extension and MIME type
  const dot = target.lastIndexOf('.');
  const ext = dot !== -1 ? target.slice(dot).toLowerCase() : '.png';
  const mimeType = extToMime(ext);

  // Generate a unique image path
  ctx.imageCounter++;
  const imagePath = `images/image${ctx.imageCounter}${ext}`;

  // Store the extracted image data
  ctx.extractedImages.set(imagePath, { data, mimeType });

  // Try to extract alt text from the drawing's docPr element
  const docPr = findDescendant(el, 'docPr');
  const shape = findDescendant(el, 'shape');
  const alt =
    docPr?.getAttribute('descr') ||
    docPr?.getAttribute('title') ||
    shape?.getAttribute('alt') ||
    shape?.getAttribute('title') ||
    'Image';

  return {
    type: 'image',
    url: imagePath,
    alt,
  };
}

/** Recursively find the first descendant element with the given local name. */
function findDescendant(el: Element, localName: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.localName === localName) return child;
    const found = findDescendant(child, localName);
    if (found) return found;
  }
  return null;
}

/** Recursively find every descendant element with the given local name. */
function findDescendants(el: Element, localName: string): Element[] {
  const results: Element[] = [];
  for (const child of Array.from(el.children)) {
    if (child.localName === localName) results.push(child);
    results.push(...findDescendants(child, localName));
  }
  return results;
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
        } else {
          // Some Word producers emit an empty parent-level numbering
          // paragraph before the first real (more deeply indented) item. With
          // no parent item to attach to, retain those items at this level
          // instead of silently discarding the entire nested subtree.
          items.push(...nested.items);
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
  // Cells may contain paragraphs, content controls, and recursively nested
  // tables (a common layout technique in Word forms). Markdown tables cannot
  // nest, so preserve all cell text in reading order separated by hard breaks.
  const inlines = await flattenContainerToInlines(tcEl, ctx);

  return {
    type: 'tableCell',
    isHeader,
    children: mergeAdjacentText(inlines),
  };
}

// ============================================
// Footnote Definition Conversion
// ============================================

async function convertNoteDefinitions(ctx: ImportContext): Promise<MarkdownFootnoteDefinition[]> {
  return [
    ...(await convertNotePartDefinitions(ctx, ctx.footnotes, 'fn', 'word/footnotes.xml')),
    ...(await convertNotePartDefinitions(ctx, ctx.endnotes, 'endnote', 'word/endnotes.xml')),
  ];
}

async function convertNotePartDefinitions(
  ctx: ImportContext,
  notes: Map<string, Element>,
  identifierPrefix: string,
  partPath: string,
): Promise<MarkdownFootnoteDefinition[]> {
  const results: MarkdownFootnoteDefinition[] = [];
  const previousRelationships = ctx.documentRels;
  const previousPartPath = ctx.currentPartPath;
  const partRelationships = await getPartRelationships(ctx.pkg, partPath);
  ctx.documentRels = new Map(partRelationships.map((rel) => [rel.id, rel]));
  ctx.currentPartPath = partPath;

  try {
    for (const [id, el] of notes) {
      const children = await convertBody(el, ctx);
      if (children.length > 0) {
        results.push({
          type: 'footnoteDefinition',
          identifier: `${identifierPrefix}${id}`,
          children,
        });
      }
    }
  } finally {
    ctx.documentRels = previousRelationships;
    ctx.currentPartPath = previousPartPath;
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

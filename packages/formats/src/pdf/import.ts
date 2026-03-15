/**
 * PDF Import
 *
 * Parses a PDF file and converts its content into a squisq
 * MarkdownDocument (or Doc) using heuristic detection of headings,
 * lists, code blocks, tables, blockquotes, and hyperlinks.
 *
 * Uses pdfjs-dist (Mozilla pdf.js) for text extraction — a battle-tested,
 * browser-compatible PDF parser. Since PDFs encode positioned glyphs
 * rather than semantic structure, all structure detection is inherently
 * heuristic and works best on simply-formatted documents.
 *
 * @example
 * ```ts
 * import { pdfToMarkdownDoc } from '@bendyline/squisq-formats/pdf';
 *
 * const response = await fetch('document.pdf');
 * const data = await response.arrayBuffer();
 * const doc = await pdfToMarkdownDoc(data);
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
  MarkdownInlineCode,
  MarkdownLink,
} from '@bendyline/squisq/markdown';

import {
  DEFAULT_FONT_SIZE,
  IMPORT_HEADING_MIN_SIZE,
  IMPORT_HEADING_SIZE_RANGES,
  IMPORT_PARAGRAPH_GAP,
  IMPORT_BULLET_CHARS,
  IMPORT_ORDERED_PREFIX,
  IMPORT_COLUMN_TOLERANCE,
  IMPORT_TABLE_MIN_ROWS,
  IMPORT_URL_PATTERN,
} from './styles.js';

// ============================================
// Public API
// ============================================

/**
 * Options for PDF import.
 */
export interface PdfImportOptions {
  /**
   * Hint for the body font size used in the PDF (in points).
   * Text items larger than this are considered headings.
   * If not provided, the importer detects the most common font size.
   */
  bodyFontSize?: number;

  /** Whether to detect tables from column-aligned text. Default: true. */
  detectTables?: boolean;

  /** Whether to detect code blocks from monospace fonts. Default: true. */
  detectCodeBlocks?: boolean;

  /** Whether to detect blockquotes from indentation. Default: true. */
  detectBlockquotes?: boolean;

  /** Whether to detect URLs in text and convert to links. Default: true. */
  detectLinks?: boolean;
}

/**
 * Convert a PDF file to a MarkdownDocument.
 *
 * Structure detection is heuristic — results are best-effort.
 *
 * @param data - The raw PDF file as ArrayBuffer, Uint8Array, or Blob
 * @param options - Import options
 * @returns A MarkdownDocument representing the detected content
 */
export async function pdfToMarkdownDoc(
  data: ArrayBuffer | Uint8Array | Blob,
  options: PdfImportOptions = {},
): Promise<MarkdownDocument> {
  const bytes =
    data instanceof Blob
      ? new Uint8Array(await data.arrayBuffer())
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data;

  const textLines = await extractTextLines(bytes);

  if (textLines.length === 0) {
    return { type: 'document', children: [] };
  }

  const bodySize = options.bodyFontSize ?? detectBodyFontSize(textLines);
  const blocks = classifyLines(textLines, bodySize, options);

  return { type: 'document', children: blocks };
}

/**
 * Convert a PDF file to a squisq Doc.
 *
 * Convenience wrapper: PDF → MarkdownDocument → Doc.
 */
export async function pdfToDoc(
  data: ArrayBuffer | Uint8Array | Blob,
  options: PdfImportOptions = {},
): Promise<Doc> {
  const markdownDoc = await pdfToMarkdownDoc(data, options);
  return markdownToDoc(markdownDoc);
}

// ============================================
// Internal Types
// ============================================

/** A single text item extracted from pdfjs. */
interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Internal font ID from pdfjs (e.g. "g_d0_f1") */
  fontName: string;
  /** Resolved font family from pdfjs styles (e.g. "sans-serif", "monospace") */
  fontFamily: string;
}

/** A logical line: text items at roughly the same y-coordinate. */
interface TextLine {
  items: TextItem[];
  y: number;
  /** The page this line is on (0-based). */
  page: number;
  /** The predominant font size on this line. */
  fontSize: number;
  /** The predominant font family on this line. */
  fontFamily: string;
  /** The predominant font ID on this line (may contain bold/italic hints for embedded fonts). */
  fontName: string;
  /** The minimum x position (left edge). */
  minX: number;
  /** Full concatenated text. */
  text: string;
}

// ============================================
// PDF Text Extraction (pdfjs-dist)
// ============================================

/**
 * Configure the pdfjs-dist PDF worker source URL.
 *
 * pdfjs-dist requires a worker for PDF parsing. In the **browser**, bundlers
 * (Vite, webpack) typically handle this automatically, or you can point to a
 * CDN-hosted worker script. In **Node.js / SSR / test** environments, call
 * this with a `file://` URL to the worker module **before** any import call.
 *
 * @example
 * ```ts
 * // Browser — CDN
 * configurePdfWorker('https://cdn.jsdelivr.net/npm/pdfjs-dist@4/legacy/build/pdf.worker.min.mjs');
 *
 * // Node / vitest — file URL
 * import { pathToFileURL } from 'url';
 * configurePdfWorker(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href);
 * ```
 */
export function configurePdfWorker(workerSrc: string): void {
  _workerSrc = workerSrc;
}

/** Module-level storage for the worker source URL. */
let _workerSrc: string | undefined;

/** Minimal typed surface of the pdfjs-dist library used by the import path. */
interface PdfjsLib {
  GlobalWorkerOptions?: { workerSrc?: string };
  getDocument(params: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean }): {
    promise: Promise<PdfjsDocument>;
  };
}

interface PdfjsDocument {
  numPages: number;
  getPage(pageNum: number): Promise<PdfjsPage>;
}

interface PdfjsPage {
  getTextContent(): Promise<{
    items: Array<{
      str: string;
      transform: number[];
      height: number;
      width?: number;
      fontName?: string;
    }>;
    styles?: Record<string, { fontFamily?: string }>;
  }>;
}

async function applyWorkerConfig(pdfjsLib: PdfjsLib): Promise<void> {
  if (!pdfjsLib.GlobalWorkerOptions) return;
  if (pdfjsLib.GlobalWorkerOptions.workerSrc) return;

  if (_workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = _workerSrc;
  }
  // If no workerSrc is set, pdfjs-dist's legacy build will attempt its
  // built-in fake-worker fallback. In browsers this usually works; in
  // Node.js the caller must have called configurePdfWorker() first.
}

async function extractTextLines(data: Uint8Array): Promise<TextLine[]> {
  // Dynamic import — the legacy build bundles a fake-worker fallback
  // that avoids a real Web Worker in environments that don't support it.
  let pdfjsLib: PdfjsLib;
  try {
    pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLib;
  } catch {
    pdfjsLib = (await import('pdfjs-dist')) as unknown as PdfjsLib;
  }

  await applyWorkerConfig(pdfjsLib);

  const loadingTask = pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const allLines: TextLine[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Build a fontName → fontFamily lookup from pdfjs styles
    const styleMap = content.styles || {};

    // Group text items into lines by y-coordinate
    const items: TextItem[] = [];
    for (const item of content.items) {
      if (!item.str || item.str.trim().length === 0) continue;
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const x = transform[4];
      const y = transform[5];
      const height = Math.abs(transform[3]) || item.height || 12;
      const width = item.width || 0;
      const fontName = item.fontName || '';
      const fontFamily = styleMap[fontName]?.fontFamily || '';
      items.push({ str: item.str, x, y, width, height, fontName, fontFamily });
    }

    // Group into lines (items within 2pt of same y are same line)
    const lineMap = new Map<number, TextItem[]>();
    for (const item of items) {
      const roundedY = Math.round(item.y * 2) / 2;
      let foundKey: number | undefined;
      for (const key of lineMap.keys()) {
        if (Math.abs(key - roundedY) < 2) {
          foundKey = key;
          break;
        }
      }
      if (foundKey !== undefined) {
        lineMap.get(foundKey)!.push(item);
      } else {
        lineMap.set(roundedY, [item]);
      }
    }

    // Sort lines top-to-bottom (highest y first), items left-to-right
    const sortedKeys = [...lineMap.keys()].sort((a, b) => b - a);
    for (const key of sortedKeys) {
      const lineItems = lineMap.get(key)!.sort((a, b) => a.x - b.x);

      const fontSizes = lineItems.map((i) => i.height);
      const fontSize = mode(fontSizes) || 12;
      const fontFamilies = lineItems.map((i) => i.fontFamily);
      const fontFamily = modeStr(fontFamilies) || '';
      const fontNames = lineItems.map((i) => i.fontName);
      const fontName = modeStr(fontNames) || '';
      const minX = Math.min(...lineItems.map((i) => i.x));
      const text = lineItems.map((i) => i.str).join(' ');

      allLines.push({
        items: lineItems,
        y: key,
        page: pageNum - 1,
        fontSize,
        fontFamily,
        fontName,
        minX,
        text,
      });
    }
  }

  return allLines;
}

// ============================================
// Font Size Detection
// ============================================

function detectBodyFontSize(lines: TextLine[]): number {
  const sizes = lines.map((l) => Math.round(l.fontSize * 2) / 2);
  return mode(sizes) || DEFAULT_FONT_SIZE;
}

function mode(arr: number[]): number {
  const freq = new Map<number, number>();
  for (const v of arr) freq.set(v, (freq.get(v) || 0) + 1);
  let maxCount = 0;
  let maxVal = 0;
  for (const [v, c] of freq) {
    if (c > maxCount) {
      maxCount = c;
      maxVal = v;
    }
  }
  return maxVal;
}

function modeStr(arr: string[]): string {
  const freq = new Map<string, number>();
  for (const v of arr) freq.set(v, (freq.get(v) || 0) + 1);
  let maxCount = 0;
  let maxVal = '';
  for (const [v, c] of freq) {
    if (c > maxCount) {
      maxCount = c;
      maxVal = v;
    }
  }
  return maxVal;
}

// ============================================
// Line Classification → MarkdownBlockNode[]
// ============================================

function classifyLines(
  lines: TextLine[],
  bodySize: number,
  options: PdfImportOptions,
): MarkdownBlockNode[] {
  const blocks: MarkdownBlockNode[] = [];
  const detectTables = options.detectTables !== false;
  const detectCodeBlocks = options.detectCodeBlocks !== false;
  const detectBlockquotes = options.detectBlockquotes !== false;
  const _detectLinks = options.detectLinks !== false;

  // Determine typical left margin (most common minX)
  const leftMargins = lines.map((l) => Math.round(l.minX));
  const typicalLeftMargin = mode(leftMargins) || 72;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // --- Heading detection ---
    if (line.fontSize >= IMPORT_HEADING_MIN_SIZE && line.fontSize > bodySize + 1) {
      const depth = sizeToHeadingDepth(line.fontSize);
      blocks.push({
        type: 'heading',
        depth,
        children: buildInlineNodes(line, options),
      } as MarkdownHeading);
      i++;
      continue;
    }

    // --- Code block detection (monospace font runs) ---
    if (detectCodeBlocks && isMonospaceLine(line)) {
      const codeLines: string[] = [];
      while (i < lines.length && isMonospaceLine(lines[i])) {
        codeLines.push(lines[i].text);
        i++;
      }
      blocks.push({
        type: 'code',
        value: codeLines.join('\n'),
      } as MarkdownCodeBlock);
      continue;
    }

    // --- Table detection (column-aligned consecutive lines) ---
    if (detectTables && i + 1 < lines.length) {
      const tableLines = tryDetectTable(lines, i, typicalLeftMargin);
      if (tableLines > 0) {
        const table = buildTable(lines.slice(i, i + tableLines), options);
        if (table) {
          blocks.push(table);
          i += tableLines;
          continue;
        }
      }
    }

    // --- List detection ---
    const bulletMatch = tryMatchBullet(line.text);
    const orderedMatch = line.text.match(IMPORT_ORDERED_PREFIX);
    if (bulletMatch || orderedMatch) {
      const listResult = consumeList(lines, i, typicalLeftMargin, bodySize, options);
      blocks.push(listResult.list);
      i = listResult.nextIndex;
      continue;
    }

    // --- Blockquote detection (indented text) ---
    if (detectBlockquotes && line.minX > typicalLeftMargin + 20) {
      const quoteLines: TextLine[] = [];
      while (
        i < lines.length &&
        lines[i].minX > typicalLeftMargin + 20 &&
        !isMonospaceLine(lines[i]) &&
        lines[i].fontSize <= bodySize + 1
      ) {
        quoteLines.push(lines[i]);
        i++;
      }
      const quoteBlocks: MarkdownBlockNode[] = quoteLines.map(
        (ql) =>
          ({
            type: 'paragraph',
            children: buildInlineNodes(ql, options),
          }) as MarkdownParagraph,
      );
      blocks.push({
        type: 'blockquote',
        children: quoteBlocks,
      } as MarkdownBlockquote);
      continue;
    }

    // --- Regular paragraph ---
    // Merge consecutive body-sized lines on the same page with small y-gaps
    const paraLines: TextLine[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      // Same page, same-ish font size, close y (within line-height gap), not bullet/heading
      if (
        next.page === line.page &&
        Math.abs(next.fontSize - bodySize) <= 1 &&
        !isMonospaceLine(next) &&
        next.minX <= typicalLeftMargin + 15 &&
        !tryMatchBullet(next.text) &&
        !next.text.match(IMPORT_ORDERED_PREFIX)
      ) {
        // Check y-gap: lines are sorted top-to-bottom so y decreases
        const yGap = paraLines[paraLines.length - 1].y - next.y;
        const lineHeight = bodySize * 1.6;
        if (yGap > 0 && yGap < lineHeight + IMPORT_PARAGRAPH_GAP) {
          paraLines.push(next);
          i++;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    // Build paragraph from merged lines
    const allInlines: MarkdownInlineNode[] = [];
    for (let j = 0; j < paraLines.length; j++) {
      if (j > 0) {
        allInlines.push({ type: 'text', value: ' ' } as MarkdownText);
      }
      allInlines.push(...buildInlineNodes(paraLines[j], options));
    }

    if (allInlines.length > 0) {
      blocks.push({
        type: 'paragraph',
        children: mergeAdjacentText(allInlines),
      } as MarkdownParagraph);
    }
  }

  return blocks;
}

// ============================================
// Heading Depth Mapping
// ============================================

function sizeToHeadingDepth(fontSize: number): 1 | 2 | 3 | 4 | 5 | 6 {
  for (const range of IMPORT_HEADING_SIZE_RANGES) {
    if (fontSize >= range.min) return range.depth as 1 | 2 | 3 | 4 | 5 | 6;
  }
  return 6;
}

// ============================================
// Font Heuristics
// ============================================

/**
 * Check if a line is predominantly monospace.
 * Uses the resolved fontFamily from pdfjs styles first,
 * falls back to fontName pattern matching for embedded fonts.
 */
function isMonospaceLine(line: TextLine): boolean {
  return isMonospaceFamily(line.fontFamily) || isMonospaceName(line.fontName);
}

/**
 * Check if a text item is monospace.
 */
function isMonospaceItem(item: TextItem): boolean {
  return isMonospaceFamily(item.fontFamily) || isMonospaceName(item.fontName);
}

function isMonospaceFamily(fontFamily: string): boolean {
  const lower = fontFamily.toLowerCase();
  return lower === 'monospace' || lower.includes('monospace');
}

function isMonospaceName(fontName: string): boolean {
  const lower = fontName.toLowerCase();
  return (
    lower.includes('courier') ||
    lower.includes('mono') ||
    lower.includes('consolas') ||
    lower.includes('menlo') ||
    lower.includes('inconsolata') ||
    lower.includes('firacode') ||
    lower.includes('source code') ||
    lower.includes('dejavu sans mono')
  );
}

function isBoldFont(fontName: string): boolean {
  const lower = fontName.toLowerCase();
  return lower.includes('bold') || lower.includes('black') || lower.includes('heavy');
}

function isItalicFont(fontName: string): boolean {
  const lower = fontName.toLowerCase();
  return lower.includes('italic') || lower.includes('oblique') || lower.includes('slanted');
}

// ============================================
// Inline Node Construction
// ============================================

function buildInlineNodes(line: TextLine, options: PdfImportOptions): MarkdownInlineNode[] {
  const nodes: MarkdownInlineNode[] = [];
  const detectLinksOpt = options.detectLinks !== false;

  for (const item of line.items) {
    const text = item.str;
    if (!text || text.trim().length === 0) continue;

    const bold = isBoldFont(item.fontName);
    const italic = isItalicFont(item.fontName);
    const mono = isMonospaceItem(item);

    let inlineNodes: MarkdownInlineNode[];

    if (mono) {
      inlineNodes = [{ type: 'inlineCode', value: text } as MarkdownInlineCode];
    } else if (detectLinksOpt) {
      inlineNodes = splitTextWithLinks(text);
    } else {
      inlineNodes = [{ type: 'text', value: text } as MarkdownText];
    }

    // Wrap in formatting
    for (const node of inlineNodes) {
      let wrapped: MarkdownInlineNode = node;
      if (italic) {
        wrapped = { type: 'emphasis', children: [wrapped] } as MarkdownEmphasis;
      }
      if (bold) {
        wrapped = { type: 'strong', children: [wrapped] } as MarkdownStrong;
      }
      nodes.push(wrapped);
    }
  }

  return nodes;
}

/**
 * Split a text string into text nodes and link nodes wherever
 * URL patterns are found.
 */
function splitTextWithLinks(text: string): MarkdownInlineNode[] {
  const nodes: MarkdownInlineNode[] = [];
  let lastIndex = 0;

  // Reset regex state
  IMPORT_URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = IMPORT_URL_PATTERN.exec(text)) !== null) {
    // Text before URL
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) } as MarkdownText);
    }
    // URL as link
    const url = match[0];
    nodes.push({
      type: 'link',
      url,
      children: [{ type: 'text', value: url } as MarkdownText],
    } as MarkdownLink);
    lastIndex = match.index + url.length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', value: text.slice(lastIndex) } as MarkdownText);
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', value: text } as MarkdownText];
}

// ============================================
// List Detection
// ============================================

function tryMatchBullet(text: string): boolean {
  if (text.length === 0) return false;
  return IMPORT_BULLET_CHARS.has(text[0]) || IMPORT_BULLET_CHARS.has(text.trimStart()[0]);
}

function stripBullet(text: string): string {
  const trimmed = text.trimStart();
  if (IMPORT_BULLET_CHARS.has(trimmed[0])) {
    return trimmed.slice(1).trimStart();
  }
  return text;
}

function stripOrderedPrefix(text: string): string {
  return text.replace(IMPORT_ORDERED_PREFIX, '');
}

interface ListResult {
  list: MarkdownList;
  nextIndex: number;
}

function consumeList(
  lines: TextLine[],
  startIdx: number,
  _typicalLeftMargin: number,
  _bodySize: number,
  _options: PdfImportOptions,
): ListResult {
  const firstLine = lines[startIdx];
  const isOrdered = !!firstLine.text.match(IMPORT_ORDERED_PREFIX);
  const items: MarkdownListItem[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const isBullet = tryMatchBullet(line.text);
    const isOrd = !!line.text.match(IMPORT_ORDERED_PREFIX);

    if (!isBullet && !isOrd) break;
    // All items in one list should be same type
    if (isOrdered && !isOrd) break;
    if (!isOrdered && !isBullet) break;

    const cleanText = isOrdered ? stripOrderedPrefix(line.text) : stripBullet(line.text);
    const para: MarkdownParagraph = {
      type: 'paragraph',
      children: splitTextWithLinks(cleanText),
    };
    items.push({
      type: 'listItem',
      children: [para],
    } as MarkdownListItem);
    i++;
  }

  return {
    list: {
      type: 'list',
      ordered: isOrdered,
      children: items,
    } as MarkdownList,
    nextIndex: i,
  };
}

// ============================================
// Table Detection
// ============================================

/**
 * Look ahead from index `start` and return the number of consecutive
 * lines that form an aligned table, or 0 if no table detected.
 */
function tryDetectTable(lines: TextLine[], start: number, _typicalLeftMargin: number): number {
  // A table needs multiple items per line (columns) on consecutive lines
  // with roughly the same x-alignment pattern.

  const firstLine = lines[start];
  if (firstLine.items.length < 2) return 0;

  const cols = getColumnPositions(firstLine);
  if (cols.length < 2) return 0;

  let count = 1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.items.length < 2) break;

    // Check if this line's columns align with the first line's
    const lineCols = getColumnPositions(line);
    if (lineCols.length !== cols.length) break;

    let aligned = true;
    for (let c = 0; c < cols.length; c++) {
      if (Math.abs(lineCols[c] - cols[c]) > IMPORT_COLUMN_TOLERANCE) {
        aligned = false;
        break;
      }
    }
    if (!aligned) break;
    count++;
  }

  return count >= IMPORT_TABLE_MIN_ROWS ? count : 0;
}

function getColumnPositions(line: TextLine): number[] {
  // Cluster item x-positions
  const positions: number[] = [];
  for (const item of line.items) {
    const x = Math.round(item.x);
    // Check if this x is close to an existing column
    let found = false;
    for (const p of positions) {
      if (Math.abs(p - x) < IMPORT_COLUMN_TOLERANCE) {
        found = true;
        break;
      }
    }
    if (!found) positions.push(x);
  }
  return positions.sort((a, b) => a - b);
}

function buildTable(lines: TextLine[], _options: PdfImportOptions): MarkdownTable | null {
  if (lines.length === 0) return null;

  // Use the first line's column positions as anchors
  const cols = getColumnPositions(lines[0]);
  if (cols.length < 2) return null;

  const rows: MarkdownTableRow[] = [];

  for (let ri = 0; ri < lines.length; ri++) {
    const line = lines[ri];
    const cells: MarkdownTableCell[] = [];

    for (let ci = 0; ci < cols.length; ci++) {
      const colLeft = cols[ci] - IMPORT_COLUMN_TOLERANCE;
      const colRight = ci + 1 < cols.length ? cols[ci + 1] - IMPORT_COLUMN_TOLERANCE : Infinity;

      // Collect items in this column
      const cellItems = line.items.filter((item) => item.x >= colLeft && item.x < colRight);
      const text = cellItems
        .map((i) => i.str)
        .join(' ')
        .trim();

      cells.push({
        type: 'tableCell',
        isHeader: ri === 0,
        children: text.length > 0 ? [{ type: 'text', value: text } as MarkdownText] : [],
      } as MarkdownTableCell);
    }

    rows.push({
      type: 'tableRow',
      children: cells,
    } as MarkdownTableRow);
  }

  return {
    type: 'table',
    children: rows,
  } as MarkdownTable;
}

// ============================================
// Text Merging
// ============================================

/**
 * Merge adjacent text nodes to reduce fragmentation.
 */
function mergeAdjacentText(nodes: MarkdownInlineNode[]): MarkdownInlineNode[] {
  if (nodes.length <= 1) return nodes;

  const result: MarkdownInlineNode[] = [];
  for (const node of nodes) {
    const prev = result[result.length - 1];
    if (prev && prev.type === 'text' && node.type === 'text') {
      (prev as MarkdownText).value += (node as MarkdownText).value;
    } else {
      result.push(node);
    }
  }
  return result;
}

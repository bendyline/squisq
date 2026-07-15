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
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownImage,
} from '@bendyline/squisq/markdown';

import type { ContentContainer } from '@bendyline/squisq/storage';
import { buildContainer } from '../shared/container.js';
import UPNG from '@pdf-lib/upng';

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
  /** Cancel between pages and image operations. */
  signal?: AbortSignal;
  /** Maximum pages processed. Default: 5,000. */
  maxPages?: number;
  /** Maximum positioned text items processed. Default: 1,000,000. */
  maxTextItems?: number;
  /** Maximum cumulative decoded image pixels. Default: 100 megapixels. */
  maxImagePixels?: number;
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
  options.signal?.throwIfAborted();
  const bytes =
    data instanceof Blob
      ? new Uint8Array(await data.arrayBuffer())
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data;

  const loaded = await loadPdfDocument(bytes, options.signal);
  try {
    const textLines = await extractTextLines(loaded.pdf, options);

    if (textLines.length === 0) {
      return { type: 'document', children: [] };
    }

    const bodySize = options.bodyFontSize ?? detectBodyFontSize(textLines);
    const blocks = classifyLines(textLines, bodySize, options);

    return { type: 'document', children: blocks };
  } finally {
    await loaded.pdf.destroy?.();
  }
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

/**
 * Convert a PDF file to a ContentContainer with markdown + extracted images.
 *
 * The container will contain:
 * - The primary markdown document (index.md)
 * - Any embedded images under images/ (e.g., images/image1.png)
 *
 * Image extraction uses pdfjs-dist's operator list API and requires a browser
 * environment (canvas is used to encode pixel data to PNG).
 *
 * @param data - The raw PDF file as ArrayBuffer, Uint8Array, or Blob
 * @param options - Import options
 * @returns A ContentContainer with the document and its media
 */
export async function pdfToContainer(
  data: ArrayBuffer | Uint8Array | Blob,
  options: PdfImportOptions = {},
): Promise<ContentContainer> {
  options.signal?.throwIfAborted();
  const bytes =
    data instanceof Blob
      ? new Uint8Array(await data.arrayBuffer())
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data;

  const loaded = await loadPdfDocument(bytes, options.signal);
  let textLines: TextLine[];
  let images: ExtractedImage[];
  try {
    [textLines, images] = await Promise.all([
      extractTextLines(loaded.pdf, options),
      extractImages(loaded, options),
    ]);
  } finally {
    await loaded.pdf.destroy?.();
  }

  const bodySize = options.bodyFontSize ?? detectBodyFontSize(textLines);

  // Classify text into blocks, capturing the originating page of each block
  // (parallel array) so images can be placed on their own page rather than
  // dumped at the document end.
  const blockPages: number[] = [];
  let blocks = classifyLines(textLines, bodySize, options, blockPages);
  if (images.length > 0) {
    blocks = insertImageBlocks(blocks, blockPages, images);
  }

  const markdownDoc: MarkdownDocument = { type: 'document', children: blocks };

  // PDF image extraction only ever produces PNG (lossless re-encode), so every
  // entry gets image/png.
  return buildContainer(
    stringifyMarkdown(markdownDoc),
    images.map((img) => [img.path, { data: img.data, mimeType: 'image/png' }] as const),
  );
}

/**
 * Extracted image with position info for placement.
 *
 * `page` is captured reliably from the operator-list walk. `y` is currently
 * always 0 — recovering a real y within the page would require tracking the
 * current transformation matrix (CTM) during the paint operator, which is out
 * of scope here (see the placement note in `insertImageBlocks`).
 *
 * Exported for direct unit testing of `insertImageBlocks`.
 */
export interface ExtractedImage {
  path: string;
  data: ArrayBuffer;
  page: number;
  y: number;
}

/**
 * Extract embedded images from a PDF using pdfjs-dist operator list API.
 * Uses a runtime-independent PNG encoder.
 */
async function extractImages(
  loaded: LoadedPdf,
  options: PdfImportOptions,
): Promise<ExtractedImage[]> {
  // Canvas is required for PNG encoding — skip in non-browser environments
  const { pdfjsLib, pdf } = loaded;

  const OPS_paintImageXObject = pdfjsLib.OPS?.paintImageXObject ?? 85;
  const OPS_paintInlineImageXObject = pdfjsLib.OPS?.paintInlineImageXObject ?? 86;

  const images: ExtractedImage[] = [];
  let counter = 0;
  let totalPixels = 0;
  const maxPages = safetyLimit('maxPages', options.maxPages ?? 5_000);
  const maxImagePixels = safetyLimit('maxImagePixels', options.maxImagePixels ?? 100_000_000);
  if (pdf.numPages > maxPages)
    throw new RangeError(`PDF exceeds the ${maxPages}-page safety limit`);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    options.signal?.throwIfAborted();
    const page = (await pdf.getPage(pageNum)) as PdfjsPageFull;
    if (!page.getOperatorList) continue;

    const opList = await page.getOperatorList();
    const seen = new Set<string>();

    for (let i = 0; i < opList.fnArray.length; i++) {
      const operation = opList.fnArray[i];
      if (operation !== OPS_paintImageXObject && operation !== OPS_paintInlineImageXObject)
        continue;

      const operand = opList.argsArray[i]?.[0];
      let imgData: PdfjsImageData | null = null;
      if (operation === OPS_paintImageXObject) {
        if (!operand || typeof operand !== 'string' || seen.has(operand)) continue;
        seen.add(operand);
        try {
          imgData = await getPdfImageObject(page.objs, operand, options.signal);
        } catch {
          continue;
        }
      } else if (operand && typeof operand === 'object') {
        imgData = operand as PdfjsImageData;
      }

      try {
        if (!imgData?.data || !imgData.width || !imgData.height) continue;
        totalPixels += imgData.width * imgData.height;
        if (totalPixels > maxImagePixels) {
          throw new RangeError(
            `PDF decoded images exceed the ${maxImagePixels}-pixel safety limit`,
          );
        }

        const pngData = imageDataToPng(imgData);
        if (!pngData) continue;

        counter++;
        images.push({
          path: `images/image${counter}.png`,
          data: pngData,
          page: pageNum - 1,
          y: 0,
        });
      } catch (error) {
        if (error instanceof RangeError) throw error;
        // Skip images that fail to extract
      }
    }
  }

  return images;
}

/** Minimal pdfjs image data shape. */
interface PdfjsImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  kind?: number;
}

/** Extended PdfjsPage with operator list and objs access. */
interface PdfjsPageFull extends PdfjsPage {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs?: {
    get(name: string, callback?: (value: unknown) => void): unknown;
    has?(name: string): boolean;
  };
}

function getPdfImageObject(
  objects: PdfjsPageFull['objs'],
  name: string,
  signal?: AbortSignal,
): Promise<PdfjsImageData | null> {
  if (!objects) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: unknown): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(value as PdfjsImageData | null);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(signal?.reason ?? new DOMException('PDF image extraction cancelled', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const immediate = objects.get(name, finish);
      if (immediate !== undefined && immediate !== null) finish(immediate);
    } catch (error) {
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    }
  });
}

/** Encode pdfjs image data to PNG without DOM or native-canvas dependencies. */
function imageDataToPng(img: PdfjsImageData): ArrayBuffer | null {
  try {
    // pdfjs kind=1 is GRAYSCALE, kind=2 is RGB, kind=3 is RGBA
    let rgba: Uint8ClampedArray;
    if (img.kind === 3 || img.data.length === img.width * img.height * 4) {
      // RGBA — use directly
      rgba = new Uint8ClampedArray(img.data);
    } else if (img.kind === 2 || img.data.length === img.width * img.height * 3) {
      // RGB — expand to RGBA
      rgba = new Uint8ClampedArray(img.width * img.height * 4);
      for (let j = 0, k = 0; j < img.data.length; j += 3, k += 4) {
        rgba[k] = img.data[j];
        rgba[k + 1] = img.data[j + 1];
        rgba[k + 2] = img.data[j + 2];
        rgba[k + 3] = 255;
      }
    } else if (img.kind === 1 || img.data.length === img.width * img.height) {
      // Grayscale — expand to RGBA
      rgba = new Uint8ClampedArray(img.width * img.height * 4);
      for (let j = 0, k = 0; j < img.data.length; j++, k += 4) {
        rgba[k] = img.data[j];
        rgba[k + 1] = img.data[j];
        rgba[k + 2] = img.data[j];
        rgba[k + 3] = 255;
      }
    } else {
      return null;
    }

    const owned = new Uint8Array(rgba.byteLength);
    owned.set(rgba);
    return UPNG.encode([owned.buffer], img.width, img.height, 0);
  } catch {
    return null;
  }
}

/** Wrap an extracted image as a paragraph containing an image node. */
function imageParagraph(img: ExtractedImage): MarkdownParagraph {
  const imgNode: MarkdownImage = {
    type: 'image',
    url: img.path,
    alt: `Image ${img.path.replace('images/image', '').replace('.png', '')}`,
  };
  return { type: 'paragraph', children: [imgNode] };
}

/**
 * Insert image reference blocks among the text blocks, page by page.
 *
 * Each image is placed immediately after the LAST content block that
 * originated from the same page (per the parallel `blockPages` array).
 * Images on a page that produced no text blocks (e.g. an image-only page)
 * fall back to the last block of the nearest preceding page that did; if no
 * such page exists, they are appended at the document end.
 *
 * Placement is intentionally page-level only. Ordering *within* a page follows
 * the extraction order of the images (roughly the paint-operator order) — real
 * vertical (y) ordering within a page is future work, since `ExtractedImage.y`
 * is not yet populated (it needs CTM tracking during the paint operator).
 *
 * @param blocks - The classified content blocks, in document order.
 * @param blockPages - Parallel array: `blockPages[i]` is the 0-based page that
 *   `blocks[i]` came from. Must be the same length as `blocks`.
 * @param images - Extracted images with a reliable `page` field.
 */
export function insertImageBlocks(
  blocks: MarkdownBlockNode[],
  blockPages: number[],
  images: ExtractedImage[],
): MarkdownBlockNode[] {
  if (images.length === 0) return blocks;

  // No text blocks at all → every image simply appends in order.
  if (blocks.length === 0) {
    return images.map(imageParagraph);
  }

  // Map each page → index of its LAST block, and remember which pages have
  // blocks (sorted ascending) for the image-only-page fallback lookup.
  const lastBlockIndexByPage = new Map<number, number>();
  for (let i = 0; i < blocks.length; i++) {
    lastBlockIndexByPage.set(blockPages[i], i);
  }
  const pagesWithBlocks = [...lastBlockIndexByPage.keys()].sort((a, b) => a - b);

  const lastIndex = blocks.length - 1;

  /** Resolve the block index after which an image on `page` should be inserted. */
  const anchorFor = (page: number): number => {
    const direct = lastBlockIndexByPage.get(page);
    if (direct !== undefined) return direct;
    // Image-only page: fall back to the nearest preceding page with blocks.
    let anchor = -1;
    for (const p of pagesWithBlocks) {
      if (p < page) anchor = lastBlockIndexByPage.get(p)!;
      else break;
    }
    // No preceding page with blocks → append at the document end.
    return anchor === -1 ? lastIndex : anchor;
  };

  // Group image paragraphs by the block index they should follow, preserving
  // image order within each group.
  const insertAfter = new Map<number, MarkdownParagraph[]>();
  for (const img of images) {
    const anchor = anchorFor(img.page);
    const group = insertAfter.get(anchor);
    if (group) group.push(imageParagraph(img));
    else insertAfter.set(anchor, [imageParagraph(img)]);
  }

  const result: MarkdownBlockNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    result.push(blocks[i]);
    const imgs = insertAfter.get(i);
    if (imgs) result.push(...imgs);
  }
  return result;
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
  destroy?(): Promise<void>;
}

interface LoadedPdf {
  pdfjsLib: PdfjsLib & { OPS?: Record<string, number> };
  pdf: PdfjsDocument;
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

async function loadPdfDocument(data: Uint8Array, signal?: AbortSignal): Promise<LoadedPdf> {
  signal?.throwIfAborted();
  // Dynamic import — the legacy build bundles a fake-worker fallback
  // that avoids a real Web Worker in environments that don't support it.
  let pdfjsLib: PdfjsLib & { OPS?: Record<string, number> };
  try {
    pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLib & {
      OPS?: Record<string, number>;
    };
  } catch {
    pdfjsLib = (await import('pdfjs-dist')) as unknown as PdfjsLib & {
      OPS?: Record<string, number>;
    };
  }

  await applyWorkerConfig(pdfjsLib);

  const loadingTask = pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  signal?.throwIfAborted();
  return { pdfjsLib, pdf };
}

async function extractTextLines(
  pdf: PdfjsDocument,
  options: PdfImportOptions,
): Promise<TextLine[]> {
  const allLines: TextLine[] = [];
  const maxPages = safetyLimit('maxPages', options.maxPages ?? 5_000);
  const maxTextItems = safetyLimit('maxTextItems', options.maxTextItems ?? 1_000_000);
  let textItemCount = 0;
  if (pdf.numPages > maxPages)
    throw new RangeError(`PDF exceeds the ${maxPages}-page safety limit`);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    options.signal?.throwIfAborted();
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Build a fontName → fontFamily lookup from pdfjs styles
    const styleMap = content.styles || {};

    // Group text items into lines by y-coordinate
    const items: TextItem[] = [];
    for (const item of content.items) {
      if (++textItemCount > maxTextItems) {
        throw new RangeError(`PDF exceeds the ${maxTextItems}-text-item safety limit`);
      }
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

function safetyLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
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
  /**
   * Optional out-parameter: when provided, receives one entry per produced
   * block giving the 0-based page that block originated from. Kept parallel
   * to the returned block array so image placement can be page-aware without
   * mutating the (strictly-typed) block nodes themselves.
   */
  blockPages?: number[],
): MarkdownBlockNode[] {
  const blocks: MarkdownBlockNode[] = [];
  /** Push a block and record its originating page in the parallel array. */
  const pushBlock = (block: MarkdownBlockNode, page: number): void => {
    blocks.push(block);
    if (blockPages) blockPages.push(page);
  };
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
      pushBlock(
        {
          type: 'heading',
          depth,
          children: buildInlineNodes(line, options),
        } as MarkdownHeading,
        line.page,
      );
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
      pushBlock(
        {
          type: 'code',
          value: codeLines.join('\n'),
        } as MarkdownCodeBlock,
        line.page,
      );
      continue;
    }

    // --- Table detection (column-aligned consecutive lines) ---
    if (detectTables && i + 1 < lines.length) {
      const tableLines = tryDetectTable(lines, i, typicalLeftMargin);
      if (tableLines > 0) {
        const table = buildTable(lines.slice(i, i + tableLines), options);
        if (table) {
          pushBlock(table, line.page);
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
      pushBlock(listResult.list, line.page);
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
      pushBlock(
        {
          type: 'blockquote',
          children: quoteBlocks,
        } as MarkdownBlockquote,
        line.page,
      );
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
      pushBlock(
        {
          type: 'paragraph',
          children: mergeAdjacentText(allInlines),
        } as MarkdownParagraph,
        line.page,
      );
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

/**
 * @bendyline/prodcore-formats
 *
 * Format converters for prodcore documents. Converts between prodcore's
 * MarkdownDocument / Doc and various file formats via Office Open XML.
 *
 * Supported formats:
 * - **DOCX** — Microsoft Word (import + export) ✅
 * - **PDF**  — Portable Document Format (import + export) ✅
 * - **PPTX** — Microsoft PowerPoint (planned)
 * - **XLSX** — Microsoft Excel (planned)
 *
 * All converters run in the browser — no server or native binaries required.
 * The shared `ooxml/` subpath export provides reusable OOXML infrastructure.
 *
 * @example
 * ```ts
 * // Import from root
 * import { markdownDocToDocx, docxToMarkdownDoc } from '@bendyline/prodcore-formats';
 *
 * // Or import from subpath
 * import { markdownDocToDocx } from '@bendyline/prodcore-formats/docx';
 * import { createPackage } from '@bendyline/prodcore-formats/ooxml';
 * ```
 */

// DOCX (fully implemented)
export {
  markdownDocToDocx,
  docToDocx,
  docxToMarkdownDoc,
  docxToDoc,
} from './docx/index.js';
export type { DocxExportOptions, DocxImportOptions } from './docx/index.js';

// PPTX (stub)
export {
  markdownDocToPptx,
  docToPptx,
  pptxToMarkdownDoc,
  pptxToDoc,
} from './pptx/index.js';
export type { PptxExportOptions, PptxImportOptions } from './pptx/index.js';

// XLSX (stub)
export {
  markdownDocToXlsx,
  docToXlsx,
  xlsxToMarkdownDoc,
  xlsxToDoc,
} from './xlsx/index.js';
export type { XlsxExportOptions, XlsxImportOptions } from './xlsx/index.js';

// PDF (fully implemented)
export {
  markdownDocToPdf,
  docToPdf,
  pdfToMarkdownDoc,
  pdfToDoc,
  configurePdfWorker,
} from './pdf/index.js';
export type { PdfExportOptions, PdfImportOptions } from './pdf/index.js';

/**
 * @bendyline/squisq-formats
 *
 * Format converters for squisq documents. Converts between squisq's
 * MarkdownDocument / Doc and various file formats via Office Open XML.
 *
 * Supported formats:
 * - **DOCX** — Microsoft Word (import + export) ✅
 * - **PDF**  — Portable Document Format (import + export) ✅
 * - **PPTX** — Microsoft PowerPoint (export ✅, import ✅)
 * - **XLSX** — Microsoft Excel (import ✅, export planned)
 * - **CSV**  — Comma-separated values (import ✅, export ✅)
 *
 * All converters run in the browser — no server or native binaries required.
 * The shared `ooxml/` subpath export provides reusable OOXML infrastructure.
 *
 * @example
 * ```ts
 * // Import from root
 * import { markdownDocToDocx, docxToMarkdownDoc } from '@bendyline/squisq-formats';
 *
 * // Or import from subpath
 * import { markdownDocToDocx } from '@bendyline/squisq-formats/docx';
 * import { createPackage } from '@bendyline/squisq-formats/ooxml';
 * ```
 */

// DOCX (fully implemented)
export { markdownDocToDocx, docToDocx, docxToMarkdownDoc, docxToDoc } from './docx/index.js';
export type { DocxExportOptions, DocxImportOptions } from './docx/index.js';

// PPTX (export implemented, import stub)
export { markdownDocToPptx, docToPptx, pptxToMarkdownDoc, pptxToDoc } from './pptx/index.js';
export type { PptxExportOptions, PptxImportOptions } from './pptx/index.js';

// XLSX (import implemented, export stub)
export { markdownDocToXlsx, docToXlsx, xlsxToMarkdownDoc, xlsxToDoc } from './xlsx/index.js';
export type { XlsxExportOptions, XlsxImportOptions } from './xlsx/index.js';

// CSV (import + export)
export { csvToMarkdownDoc, csvToDoc, markdownDocToCsv, parseCsv } from './csv/index.js';
export type { CsvImportOptions, CsvExportOptions } from './csv/index.js';

// PDF (fully implemented)
export {
  markdownDocToPdf,
  docToPdf,
  pdfToMarkdownDoc,
  pdfToDoc,
  configurePdfWorker,
} from './pdf/index.js';
export type { PdfExportOptions, PdfImportOptions } from './pdf/index.js';

// HTML (fully implemented)
export { docToHtml, docToHtmlZip, collectImagePaths } from './html/index.js';
export type { HtmlExportOptions, HtmlZipExportOptions } from './html/index.js';
export { htmlToMarkdown, htmlToMarkdownDoc, htmlToMarkdownDocSync } from './html/index.js';
export type { HtmlImportOptions } from './html/index.js';

// EPUB (export)
export { markdownDocToEpub, docToEpub } from './epub/index.js';
export type { EpubExportOptions } from './epub/index.js';

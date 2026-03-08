/**
 * @bendyline/squisq-formats PDF Module
 *
 * Import and export squisq documents (MarkdownDocument / Doc)
 * to/from PDF files.
 *
 * - **Export** uses pdf-lib (zero dependencies, standard fonts, pure JS).
 * - **Import** uses pdfjs-dist (Mozilla pdf.js) with heuristic structure detection.
 *
 * All operations run in the browser — no server required.
 *
 * @example
 * ```ts
 * import {
 *   markdownDocToPdf,
 *   docToPdf,
 *   pdfToMarkdownDoc,
 *   pdfToDoc,
 * } from '@bendyline/squisq-formats/pdf';
 * ```
 */

// Export
export { markdownDocToPdf, docToPdf } from './export.js';
export type { PdfExportOptions } from './export.js';

// Import
export { pdfToMarkdownDoc, pdfToDoc, configurePdfWorker } from './import.js';
export type { PdfImportOptions } from './import.js';

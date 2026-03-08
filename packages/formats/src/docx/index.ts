/**
 * @bendyline/prodcore-formats DOCX Module
 *
 * Import and export prodcore documents (MarkdownDocument / Doc)
 * to/from Microsoft Word .docx files (Office Open XML WordprocessingML).
 *
 * All operations run in the browser — no server required.
 *
 * @example
 * ```ts
 * import {
 *   markdownDocToDocx,
 *   docToDocx,
 *   docxToMarkdownDoc,
 *   docxToDoc,
 * } from '@bendyline/prodcore-formats/docx';
 * ```
 */

// Export
export { markdownDocToDocx, docToDocx } from './export.js';
export type { DocxExportOptions } from './export.js';

// Import
export { docxToMarkdownDoc, docxToDoc } from './import.js';
export type { DocxImportOptions } from './import.js';

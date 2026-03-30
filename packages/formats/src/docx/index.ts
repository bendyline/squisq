/**
 * @bendyline/squisq-formats DOCX Module
 *
 * Import and export squisq documents (MarkdownDocument / Doc)
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
 * } from '@bendyline/squisq-formats/docx';
 * ```
 */

// Export
export { markdownDocToDocx, docToDocx } from './export.js';
export type { DocxExportOptions } from './export.js';

// Import
export { docxToMarkdownDoc, docxToDoc, docxToContainer } from './import.js';
export type { DocxImportOptions } from './import.js';

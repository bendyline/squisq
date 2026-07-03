/**
 * @bendyline/squisq-formats XLSX Module (Stub)
 *
 * Placeholder for Excel .xlsx import/export support.
 * Will use SpreadsheetML (`<spreadsheet>`, `<worksheet>`, `<sheetData>`)
 * via the shared ooxml/ infrastructure.
 *
 * @example
 * ```ts
 * import { markdownDocToXlsx } from '@bendyline/squisq-formats/xlsx';
 * ```
 */

import { markdownToDoc } from '@bendyline/squisq/doc';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';
import { type XlsxImportOptions, xlsxToMarkdownDoc } from './import.js';

export type { XlsxImportOptions } from './import.js';
export { xlsxToMarkdownDoc } from './import.js';

/**
 * Options for XLSX export (placeholder).
 */
export interface XlsxExportOptions {
  /** Workbook title */
  title?: string;
  /** Workbook author */
  author?: string;
}

/**
 * Convert a MarkdownDocument to a .xlsx Blob.
 *
 * @throws Error — XLSX export is not yet implemented
 */
export async function markdownDocToXlsx(
  _doc: MarkdownDocument,
  _options?: XlsxExportOptions,
): Promise<Blob> {
  throw new Error('XLSX export is not yet implemented');
}

/**
 * Convert a squisq Doc to a .xlsx Blob.
 *
 * @throws Error — XLSX export is not yet implemented
 */
export async function docToXlsx(_doc: Doc, _options?: XlsxExportOptions): Promise<Blob> {
  throw new Error('XLSX export is not yet implemented');
}

/**
 * Convert a .xlsx file to a squisq Doc (via the markdown table model).
 */
export async function xlsxToDoc(
  data: ArrayBuffer | Blob,
  options?: XlsxImportOptions,
): Promise<Doc> {
  return markdownToDoc(await xlsxToMarkdownDoc(data, options));
}

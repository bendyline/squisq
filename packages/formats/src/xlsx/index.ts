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

import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';

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
 * Options for XLSX import (placeholder).
 */
export interface XlsxImportOptions {
  /** Which sheet to import (0-based index or name). Default: 0 */
  sheet?: number | string;
}

/**
 * Convert a MarkdownDocument to a .xlsx Blob.
 *
 * @throws Error — XLSX support is not yet implemented
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
 * @throws Error — XLSX support is not yet implemented
 */
export async function docToXlsx(
  _doc: Doc,
  _options?: XlsxExportOptions,
): Promise<Blob> {
  throw new Error('XLSX export is not yet implemented');
}

/**
 * Convert a .xlsx file to a MarkdownDocument.
 *
 * @throws Error — XLSX support is not yet implemented
 */
export async function xlsxToMarkdownDoc(
  _data: ArrayBuffer | Blob,
  _options?: XlsxImportOptions,
): Promise<MarkdownDocument> {
  throw new Error('XLSX import is not yet implemented');
}

/**
 * Convert a .xlsx file to a squisq Doc.
 *
 * @throws Error — XLSX support is not yet implemented
 */
export async function xlsxToDoc(
  _data: ArrayBuffer | Blob,
  _options?: XlsxImportOptions,
): Promise<Doc> {
  throw new Error('XLSX import is not yet implemented');
}

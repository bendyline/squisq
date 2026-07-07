/**
 * @bendyline/squisq-formats XLSX Module
 *
 * Excel .xlsx support via SpreadsheetML and the shared ooxml/ infrastructure.
 * Both directions are implemented: import (`xlsxToMarkdownDoc` / `xlsxToDoc`)
 * turns each worksheet grid into a markdown table; export (`markdownDocToXlsx`
 * / `docToXlsx`) turns each markdown table into a worksheet. Export is
 * tables-only fidelity — non-table content is dropped (headings only survive
 * as sheet names). See export.ts for details.
 *
 * @example
 * ```ts
 * import { xlsxToMarkdownDoc, markdownDocToXlsx } from '@bendyline/squisq-formats/xlsx';
 * ```
 */

import { markdownToDoc } from '@bendyline/squisq/doc';
import type { Doc } from '@bendyline/squisq/schemas';
import { type XlsxImportOptions, xlsxToMarkdownDoc } from './import.js';

export type { XlsxImportOptions } from './import.js';
export { xlsxToMarkdownDoc } from './import.js';

export type { XlsxExportOptions } from './export.js';
export { markdownDocToXlsx, docToXlsx } from './export.js';

/**
 * Convert a .xlsx file to a squisq Doc (via the markdown table model).
 */
export async function xlsxToDoc(
  data: ArrayBuffer | Blob,
  options?: XlsxImportOptions,
): Promise<Doc> {
  return markdownToDoc(await xlsxToMarkdownDoc(data, options));
}

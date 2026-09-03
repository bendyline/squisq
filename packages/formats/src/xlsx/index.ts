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

export type { XlsxImportOptions, XlsxContainerOptions } from './import.js';
export { xlsxToMarkdownDoc, xlsxToContainer } from './import.js';

// The data path. `xlsxToMarkdownDoc` renders a workbook for people and its
// number formatting is lossy by design; anything doing arithmetic reads this
// instead. See tables.ts.
export type { XlsxTable, XlsxTableColumn, XlsxTablesOptions } from './tables.js';
export { gridToTables } from './tables.js';
export { xlsxToTables } from './import.js';

// The raw-grid path: every parsed cell with formula AND cached value intact,
// plus workbook calc facts (`fullCalcOnLoad`). Consumed by the corpus
// cached-value oracle and by calculation-engine feeding.
export type { XlsxSheetGrid, XlsxWorkbookGrids } from './import.js';
export { xlsxToCellGrids } from './import.js';
export type { XlsxCell, XlsxCellKind, CellRect } from './cells.js';

export type { XlsxExportOptions } from './export.js';
export { markdownDocToXlsx, docToXlsx } from './export.js';

// In-place cell-value patching — the grid's XLSX save path. Rewrites only
// touched worksheet parts (+ the workbook calc flag); refuses formula/date
// cells all-or-nothing via `XlsxPatchRefusal`. See patch.ts.
export type { XlsxCellPatch, XlsxPatchOptions, XlsxPatchRefusalCode } from './patch.js';
export { patchXlsxCellValues, XlsxPatchRefusal } from './patch.js';
export type { SheetRef } from './import.js';
export { listSheetParts } from './import.js';
export { formatCellRef, parseCellRef } from './cells.js';

/**
 * Convert a .xlsx file to a squisq Doc (via the markdown table model).
 */
export async function xlsxToDoc(
  data: ArrayBuffer | Blob,
  options?: XlsxImportOptions,
): Promise<Doc> {
  return markdownToDoc(await xlsxToMarkdownDoc(data, options));
}

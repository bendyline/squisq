/**
 * @bendyline/squisq-formats PPTX Module
 *
 * PowerPoint .pptx export support using PresentationML (`<p:presentation>`,
 * `<p:sld>`) via the shared ooxml/ infrastructure.
 *
 * Slide segmentation: each H1/H2 heading starts a new slide by default.
 * Inline formatting (bold, italic, code, links) is preserved as DrawingML runs.
 *
 * Includes both export and import paths.
 *
 * @example
 * ```ts
 * import { markdownDocToPptx } from '@bendyline/squisq-formats/pptx';
 * ```
 */

// Export
export { markdownDocToPptx, docToPptx } from './export.js';
export type { PptxExportOptions } from './export.js';

// Import
import { markdownToDoc } from '@bendyline/squisq/doc';
import type { Doc } from '@bendyline/squisq/schemas';
import { type PptxImportOptions, pptxToMarkdownDoc } from './import.js';

export type { PptxImportOptions } from './import.js';
export { pptxToMarkdownDoc, pptxToContainer } from './import.js';

/**
 * Convert a .pptx file to a squisq Doc (via the markdown model).
 */
export async function pptxToDoc(
  data: ArrayBuffer | Blob,
  options?: PptxImportOptions,
): Promise<Doc> {
  return markdownToDoc(await pptxToMarkdownDoc(data, options));
}

/**
 * @bendyline/squisq-formats PPTX Module
 *
 * PowerPoint .pptx export support using PresentationML (`<p:presentation>`,
 * `<p:sld>`) via the shared ooxml/ infrastructure.
 *
 * Slide segmentation: each H1/H2 heading starts a new slide by default.
 * Inline formatting (bold, italic, code, links) is preserved as DrawingML runs.
 *
 * Import is not yet implemented.
 *
 * @example
 * ```ts
 * import { markdownDocToPptx } from '@bendyline/squisq-formats/pptx';
 * ```
 */

// Export
export { markdownDocToPptx, docToPptx } from './export.js';
export type { PptxExportOptions } from './export.js';

// Import (stubs — not yet implemented)
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';

/**
 * Options for PPTX import (placeholder).
 */
export interface PptxImportOptions {
  /** Whether to extract embedded images as data URIs */
  extractImages?: boolean;
}

/**
 * Convert a .pptx file to a MarkdownDocument.
 *
 * @throws Error — PPTX import is not yet implemented
 */
export async function pptxToMarkdownDoc(
  _data: ArrayBuffer | Blob,
  _options?: PptxImportOptions,
): Promise<MarkdownDocument> {
  throw new Error('PPTX import is not yet implemented');
}

/**
 * Convert a .pptx file to a squisq Doc.
 *
 * @throws Error — PPTX import is not yet implemented
 */
export async function pptxToDoc(
  _data: ArrayBuffer | Blob,
  _options?: PptxImportOptions,
): Promise<Doc> {
  throw new Error('PPTX import is not yet implemented');
}

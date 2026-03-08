/**
 * @bendyline/squisq-formats PPTX Module (Stub)
 *
 * Placeholder for PowerPoint .pptx import/export support.
 * Will use PresentationML (`<p:presentation>`, `<p:sld>`) via the
 * shared ooxml/ infrastructure.
 *
 * @example
 * ```ts
 * import { markdownDocToPptx } from '@bendyline/squisq-formats/pptx';
 * ```
 */

import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';

/**
 * Options for PPTX export (placeholder).
 */
export interface PptxExportOptions {
  /** Presentation title */
  title?: string;
  /** Presentation author */
  author?: string;
}

/**
 * Options for PPTX import (placeholder).
 */
export interface PptxImportOptions {
  /** Whether to extract embedded images as data URIs */
  extractImages?: boolean;
}

/**
 * Convert a MarkdownDocument to a .pptx Blob.
 *
 * @throws Error — PPTX support is not yet implemented
 */
export async function markdownDocToPptx(
  _doc: MarkdownDocument,
  _options?: PptxExportOptions,
): Promise<Blob> {
  throw new Error('PPTX export is not yet implemented');
}

/**
 * Convert a squisq Doc to a .pptx Blob.
 *
 * @throws Error — PPTX support is not yet implemented
 */
export async function docToPptx(_doc: Doc, _options?: PptxExportOptions): Promise<Blob> {
  throw new Error('PPTX export is not yet implemented');
}

/**
 * Convert a .pptx file to a MarkdownDocument.
 *
 * @throws Error — PPTX support is not yet implemented
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
 * @throws Error — PPTX support is not yet implemented
 */
export async function pptxToDoc(
  _data: ArrayBuffer | Blob,
  _options?: PptxImportOptions,
): Promise<Doc> {
  throw new Error('PPTX import is not yet implemented');
}

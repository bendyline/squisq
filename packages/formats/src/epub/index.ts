/**
 * @bendyline/squisq-formats EPUB Module
 *
 * Export squisq documents (MarkdownDocument / Doc) to EPUB 3 e-book files.
 *
 * Content is split into chapters at H1/H2 heading boundaries. Images
 * referenced in the markdown are embedded in the archive when provided
 * via the `images` option.
 *
 * @example
 * ```ts
 * import { markdownDocToEpub, docToEpub } from '@bendyline/squisq-formats/epub';
 *
 * const epub = await markdownDocToEpub(markdownDoc, { title: 'My Book' });
 * const epub2 = await docToEpub(doc, { author: 'Jane Doe' });
 * ```
 */

export { markdownDocToEpub, docToEpub } from './export.js';
export type { EpubExportOptions } from './export.js';

/**
 * Pictures of the document's diagrams for DOCX, PDF and PPTX export.
 *
 * Mermaid, timelines, ASCII diagrams, file trees, drawings and layouts have
 * no renderer in those formats, so without this they export as source text.
 * SVG islands are pictured only on request (`'svg'`, or `'all'` for PDF):
 * DOCX and PPTX embed them as vector art and use the pictures as fallbacks.
 */

import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { RasterizedDiagrams, ExportDiagramKind } from '@bendyline/squisq-formats/diagrams';

export async function pictureDiagrams(
  markdownDoc: MarkdownDocument,
  kinds?: readonly ExportDiagramKind[] | 'all',
): Promise<RasterizedDiagrams> {
  const [{ rasterizeDiagrams, EXPORT_DIAGRAM_KINDS }, { createDiagramPictureRenderer }] =
    await Promise.all([
      import('@bendyline/squisq-formats/diagrams'),
      import('@bendyline/squisq-react/diagram-pictures'),
    ]);
  return rasterizeDiagrams(markdownDoc, createDiagramPictureRenderer(), {
    kinds: kinds === 'all' ? EXPORT_DIAGRAM_KINDS : kinds,
    onWarning: (message) => console.warn(message),
  });
}

/**
 * Pictures of the document's diagrams for DOCX, PDF and PPTX export.
 *
 * Mermaid, timelines, ASCII diagrams, file trees, drawings and layouts have
 * no renderer in those formats, so without this they export as source text.
 */

import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { RasterizedDiagrams, ExportDiagramKind } from '@bendyline/squisq-formats/diagrams';

export async function pictureDiagrams(
  markdownDoc: MarkdownDocument,
  kinds?: readonly ExportDiagramKind[],
): Promise<RasterizedDiagrams> {
  const [{ rasterizeDiagrams }, { createDiagramPictureRenderer }] = await Promise.all([
    import('@bendyline/squisq-formats/diagrams'),
    import('@bendyline/squisq-react/diagram-pictures'),
  ]);
  return rasterizeDiagrams(markdownDoc, createDiagramPictureRenderer(), {
    kinds,
    onWarning: (message) => console.warn(message),
  });
}

/**
 * Pictures of the document's diagrams for DOCX, PDF and PPTX export.
 *
 * Mermaid, timelines, ASCII diagrams, file trees, drawings and layouts have
 * no renderer in those formats, so without this they export as source text.
 * SVG islands are pictured only on request (`'svg'`, or `'all'` for PDF):
 * DOCX and PPTX embed them as vector art and use the pictures as fallbacks.
 */

import { isSvgImageSource, svgSourceFromBytes } from '@bendyline/squisq/markdown';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type {
  DiagramPicture,
  ExportDiagramKind,
  RasterizedDiagrams,
} from '@bendyline/squisq-formats/diagrams';

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

/**
 * PNG renderings of the SVG files among a document's attachments, keyed by
 * each file's trimmed text (the key DOCX's `svgIslandFallbacks` and PPTX's
 * `diagramImages` use) — the raster Office stores beside the vector art, and
 * what PDF, which has no vector picture, shows instead. Files that are not
 * usable SVGs are left out.
 */
export async function pictureSvgAttachments(
  attachments: ReadonlyMap<string, ArrayBuffer>,
): Promise<Map<string, DiagramPicture>> {
  const pictures = new Map<string, DiagramPicture>();
  const svgs = [...attachments].filter(([name]) => isSvgImageSource(name));
  if (svgs.length === 0) return pictures;
  const { renderSvgIslandPicture } = await import('@bendyline/squisq-react/diagram-pictures');
  for (const [, data] of svgs) {
    const source = svgSourceFromBytes(data).trim();
    try {
      const picture = await renderSvgIslandPicture(source);
      if (picture) pictures.set(source, picture);
    } catch (error) {
      console.warn('An attached SVG could not be drawn:', error);
    }
  }
  return pictures;
}

/**
 * A document's attachments in the shape the DOCX and PDF exporters take.
 * With `svgPictures`, each SVG is replaced by its PNG (PDF); otherwise SVGs
 * pass through and the exporter writes them as vector art (DOCX).
 */
export async function attachmentImages(
  attachments: ReadonlyMap<string, ArrayBuffer>,
  svgPictures?: ReadonlyMap<string, DiagramPicture>,
): Promise<
  Map<
    string,
    { data: ArrayBuffer | Uint8Array; contentType: string; width?: number; height?: number }
  >
> {
  const { inferMimeType } = await import('@bendyline/squisq-formats/html');
  const images = new Map<
    string,
    { data: ArrayBuffer | Uint8Array; contentType: string; width?: number; height?: number }
  >();
  for (const [name, data] of attachments) {
    if (svgPictures && isSvgImageSource(name)) {
      const picture = svgPictures.get(svgSourceFromBytes(data).trim());
      if (picture) {
        images.set(name, {
          data: picture.data,
          contentType: 'image/png',
          width: picture.width,
          height: picture.height,
        });
      }
      continue;
    }
    images.set(name, { data, contentType: inferMimeType(name) });
  }
  return images;
}

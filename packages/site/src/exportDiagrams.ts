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
import type { Doc } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type {
  DiagramPicture,
  ExportDiagramKind,
  RasterizedDiagrams,
} from '@bendyline/squisq-formats/diagrams';
import type { PreparedPlainHtmlDocument } from '@bendyline/squisq-formats/html';

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
 * The Markdown with each `{[dataTable src=…]}` reference's first rows under
 * its heading, for Word and PDF, which can't carry the data file. Run it
 * before `pictureDiagrams`, so a chart fed by a data file is drawn too.
 */
export async function withDataTables(
  markdownDoc: MarkdownDocument,
  container: ContentContainer | null | undefined,
): Promise<MarkdownDocument> {
  if (!container) return markdownDoc;
  const { materializeDataReferences, DATA_PREVIEW_ROWS } =
    await import('@bendyline/squisq-formats/data');
  return materializeDataReferences(markdownDoc, container, (message) => console.warn(message), {
    maxRows: DATA_PREVIEW_ROWS,
  });
}

/**
 * The Doc with each data reference's preview rows filled in — what the
 * editor preview shows — for exports rendered by the player (HTML, PPTX).
 */
export async function withDataPreviews(
  doc: Doc,
  container: ContentContainer | null | undefined,
): Promise<Doc> {
  if (!container) return doc;
  const [{ resolveDataReferences }, { defaultDataReaders }] = await Promise.all([
    import('@bendyline/squisq/doc'),
    import('@bendyline/squisq-formats/data'),
  ]);
  return (await resolveDataReferences(doc, container, { readers: defaultDataReaders() })).doc;
}

/**
 * A document ready for a plain (script-free) HTML page: data references
 * filled from the workspace's sidecars, diagrams and charts swapped for
 * pictures, returned as `data:` URLs to merge into the page's `images`, and
 * inline icons outlined for the page's `icons`.
 */
export async function prepareForPlainHtml(
  markdownDoc: MarkdownDocument,
  container: ContentContainer | null | undefined,
): Promise<PreparedPlainHtmlDocument> {
  const [{ prepareMarkdownDocForPlainHtml }, { plainHtmlIcons }, { createDiagramPictureRenderer }] =
    await Promise.all([
      import('@bendyline/squisq-formats/html'),
      import('@bendyline/squisq-formats/html-icons'),
      import('@bendyline/squisq-react/diagram-pictures'),
    ]);
  return prepareMarkdownDocForPlainHtml(markdownDoc, {
    renderDiagram: createDiagramPictureRenderer(),
    outlineIcons: plainHtmlIcons,
    container,
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

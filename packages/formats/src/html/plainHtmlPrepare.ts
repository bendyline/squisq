/**
 * Preparing a document for a static HTML page.
 *
 * A plain HTML page (`markdownDocToPlainHtml`, or a page template filled from
 * `markdownDocToPlainHtmlParts`) runs no script, so what the player draws at
 * runtime has to be settled before the page is written:
 *
 * - `{[dataTable src=…]}` references (and charts fed by one) get the table
 *   they point at, bounded to a preview window with a "Showing N of M rows"
 *   note — the author's body link to the full file follows it;
 * - Mermaid fences, ASCII diagrams and timelines, drawing / layout / diagram
 *   blocks, and charts become pictures, drawn by a host-supplied renderer
 *   (drawing needs a browser) and returned as `data:` URLs;
 * - inline icons become inline SVG outlines, so the page needs no Font
 *   Awesome stylesheet or font.
 *
 * File trees stay preformatted text, which a page shows as well as a picture
 * would and keeps selectable; SVG islands the renderer already draws.
 */

import type { MarkdownDocument, MarkdownImage, MarkdownNode } from '@bendyline/squisq/markdown';
import { isDataFilePath, type DataSourceTable } from '@bendyline/squisq/doc';
import type { ContentContainer } from '@bendyline/squisq/storage';
import {
  findDiagrams,
  rasterizeDiagrams,
  type DiagramRasterizer,
  type ExportDiagramKind,
} from '../diagrams/index.js';
import { arrayBufferToBase64DataUrl } from './imageUtils.js';
import type { PlainHtmlIcon } from './plainHtml.js';

/** The kinds a static page pictures. */
const PAGE_DIAGRAM_KINDS: readonly ExportDiagramKind[] = [
  'mermaid',
  'diagram',
  'timeline',
  'container',
  'chart',
];

export interface PlainHtmlPreparationOptions {
  /**
   * Draws diagrams and charts as pictures. In a browser, pass
   * `createDiagramPictureRenderer()` from
   * `@bendyline/squisq-react/diagram-pictures`. Without one, diagrams stay as
   * their source and charts as their table.
   */
  renderDiagram?: DiagramRasterizer;
  /**
   * The container holding the document's data sidecars. Without one, a data
   * reference keeps only its link.
   */
  container?: ContentContainer | null;
  /** Rows per data table; a block's own `previewRows` wins. Default 100. */
  maxDataRows?: number;
  /**
   * A caller-owned memo of data-file reads, for a host that prepares the
   * same document again and again (a live preview). The caller clears it
   * when the files may have changed.
   */
  dataTableCache?: Map<string, Promise<DataSourceTable>>;
  signal?: AbortSignal;
  /** Receives a note for each table or picture that could not be produced. */
  onWarning?: (message: string) => void;
}

export interface PreparedPlainHtmlDocument {
  /** The document to render, with data tables filled in and pictures in place. */
  markdownDoc: MarkdownDocument;
  /**
   * The pictures as `data:` URLs, keyed by the image URL written into
   * `markdownDoc`. Merge them into the renderer's `images` option.
   */
  images: Map<string, string>;
  /** Outlines of the document's inline icons: the renderer's `icons` option. */
  icons: Map<string, PlainHtmlIcon>;
}

/**
 * Whether {@link prepareMarkdownDocForPlainHtml} would change anything for
 * `doc` with these options — so a live preview renders a document with
 * nothing to prepare at once, without waiting on the asynchronous step.
 */
export function needsPlainHtmlPreparation(
  doc: MarkdownDocument,
  options: Pick<PlainHtmlPreparationOptions, 'renderDiagram' | 'container'> = {},
): boolean {
  let icons = false;
  let data = false;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || (icons && data)) return;
    const n = node as MarkdownNode & { children?: unknown };
    if (n.type === 'inlineIcon') icons = true;
    if (n.type === 'heading') {
      const src = n.templateAnnotation?.params?.src;
      if (src && isDataFilePath(src)) data = true;
    }
    if (Array.isArray(n.children)) n.children.forEach(visit);
  };
  doc.children.forEach(visit);
  if (icons || (data && options.container)) return true;
  if (!options.renderDiagram) return false;
  // A chart fed by a data file has no table to find until it is filled.
  return findDiagrams(doc).some((diagram) => PAGE_DIAGRAM_KINDS.includes(diagram.kind));
}

/**
 * Settle everything in `doc` a script-free page cannot draw. Never throws for
 * one table or picture: each degrades to its link or source with a warning.
 */
export async function prepareMarkdownDocForPlainHtml(
  doc: MarkdownDocument,
  options: PlainHtmlPreparationOptions = {},
): Promise<PreparedPlainHtmlDocument> {
  const { renderDiagram, container, signal, onWarning } = options;
  let markdownDoc = doc;
  if (container) {
    const { materializeDataReferences, DATA_PREVIEW_ROWS } = await import('../data/materialize.js');
    markdownDoc = await materializeDataReferences(markdownDoc, container, onWarning, {
      maxRows: options.maxDataRows ?? DATA_PREVIEW_ROWS,
      tableCache: options.dataTableCache,
    });
  }
  signal?.throwIfAborted();

  const { plainHtmlIcons } = await import('./plainHtmlIcons.js');
  const icons = await plainHtmlIcons(markdownDoc);
  const images = new Map<string, string>();
  if (!renderDiagram) return { markdownDoc, images, icons };

  const pictured = await rasterizeDiagrams(markdownDoc, renderDiagram, {
    kinds: PAGE_DIAGRAM_KINDS,
    urlPrefix: 'squisq-picture',
    signal,
    onWarning,
  });
  const widths = new Map<string, number>();
  for (const [url, picture] of pictured.images) {
    const bytes = picture.data;
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    images.set(url, arrayBufferToBase64DataUrl(buffer, picture.contentType));
    widths.set(url, Math.round(picture.width));
  }
  return { markdownDoc: withPictureWidths(pictured.markdownDoc, widths), images, icons };
}

/**
 * Give each picture its display width. The PNG is drawn denser than it
 * displays, and only the width is set so the height follows the column when
 * a narrow screen shrinks it.
 */
function withPictureWidths(
  doc: MarkdownDocument,
  widths: ReadonlyMap<string, number>,
): MarkdownDocument {
  if (widths.size === 0) return doc;
  const visit = <T extends MarkdownNode>(node: T): T => {
    if (node.type === 'image') {
      const width = widths.get((node as MarkdownImage).url);
      return width === undefined ? node : ({ ...node, width } as T);
    }
    const children = (node as { children?: unknown }).children;
    if (!Array.isArray(children)) return node;
    return { ...node, children: (children as MarkdownNode[]).map(visit) } as T;
  };
  return { ...doc, children: doc.children.map(visit) };
}

/**
 * SVG islands (```svg fences) in document exports.
 *
 * Exporters never copy the author's markup: core's `parseSvgIsland` sanitizes
 * and re-serializes it, and only that output is written. Outside a browser —
 * Office, EPUB readers — the SVG is rendered by the reader's own engine with
 * no sandbox, which is exactly why core's sanitizer is strict. `currentColor`
 * is replaced with the document's text color, since those engines may not
 * resolve it from the root.
 */

import {
  isSvgImageSource,
  isSvgIslandLang,
  parseSvgIsland,
  svgIslandMarkup,
  svgSourceFromBytes,
  type MarkdownCodeBlock,
  type MarkdownDocument,
  type MarkdownImage,
  type MarkdownNode,
  type MarkdownParagraph,
} from '@bendyline/squisq/markdown';

/** A sanitized island as an image part. */
export interface SvgIslandImage {
  data: ArrayBuffer;
  contentType: 'image/svg+xml';
  /** Intrinsic size in CSS pixels. */
  width: number;
  height: number;
  /** The island's title, else a generic label. */
  alt: string;
}

export interface SvgIslandImageOptions {
  /** The surrounding text color, substituted for `currentColor`. */
  color?: string;
}

/** Alt text for an island that names nothing itself. */
export const SVG_ISLAND_FALLBACK_ALT = 'Illustration';

/** Bytes in a buffer of this realm (see {@link svgIslandImage}). */
function ownBuffer(encoded: Uint8Array): ArrayBuffer {
  const bytes = new Uint8Array(encoded.length);
  bytes.set(encoded);
  return bytes.buffer;
}

/** The island in a fence body as SVG bytes, or null when it is not one. */
export function svgIslandImage(
  source: string,
  options: SvgIslandImageOptions = {},
): SvgIslandImage | null {
  const result = parseSvgIsland(source);
  if (!result.ok) return null;
  const { island } = result;
  // Copy into a buffer of this realm: some hosts (jsdom) hand TextEncoder's
  // output from another realm, and zip writers check `instanceof ArrayBuffer`.
  const data = ownBuffer(
    new TextEncoder().encode(
      svgIslandMarkup(island, { color: options.color, replaceCurrentColor: true }),
    ),
  );
  return {
    data,
    contentType: 'image/svg+xml',
    width: island.width,
    height: island.height,
    alt: island.title ?? SVG_ISLAND_FALLBACK_ALT,
  };
}

/** Whether any ```svg fence, at any depth, is in the document. */
export function docHasSvgIslands(doc: MarkdownDocument): boolean {
  const visit = (node: MarkdownNode): boolean => {
    if (node.type === 'code') return isSvgIslandLang(node.lang);
    const nested = (node as { children?: unknown }).children;
    return Array.isArray(nested) && (nested as MarkdownNode[]).some(visit);
  };
  return visit(doc);
}

export interface SvgIslandsAsImages {
  /** The document with each usable island replaced by an image paragraph. */
  doc: MarkdownDocument;
  /** Image bytes keyed by the URL the replacement image paragraph uses. */
  images: Map<string, SvgIslandImage>;
}

/**
 * Replace each usable ```svg fence with a paragraph holding only an image of
 * it at `<prefix>-N.svg`, for exporters whose image pipeline packages image
 * files (EPUB). Fences that do not parse stay code. Arrays are copied only on
 * the path to a replacement; the input document is not modified.
 */
export function svgIslandsAsImages(
  doc: MarkdownDocument,
  options: SvgIslandImageOptions & { prefix?: string } = {},
): SvgIslandsAsImages {
  const prefix = options.prefix ?? 'squisq-svg-island';
  const images = new Map<string, SvgIslandImage>();

  const replace = <T extends MarkdownNode>(nodes: readonly T[]): T[] => {
    let changed = false;
    const next = nodes.map((node) => {
      if (node.type === 'code' && isSvgIslandLang((node as MarkdownCodeBlock).lang)) {
        const image = svgIslandImage((node as MarkdownCodeBlock).value, options);
        if (!image) return node;
        const url = `${prefix}-${images.size + 1}.svg`;
        images.set(url, image);
        changed = true;
        const picture: MarkdownImage = { type: 'image', url, alt: image.alt, title: null };
        const paragraph: MarkdownParagraph = { type: 'paragraph', children: [picture] };
        return paragraph as unknown as T;
      }
      const nested = (node as { children?: unknown }).children;
      if (Array.isArray(nested)) {
        const replaced = replace(nested as MarkdownNode[]);
        if (replaced !== nested) {
          changed = true;
          return { ...node, children: replaced } as T;
        }
      }
      return node;
    });
    return changed ? next : (nodes as T[]);
  };

  if (!docHasSvgIslands(doc)) return { doc, images };
  const children = replace(doc.children);
  return { doc: children === doc.children ? doc : { ...doc, children }, images };
}

// ============================================
// Attached SVG image files
// ============================================
//
// An attached `.svg` (`![logo](logo.svg)`) is an island whose source is a
// file. Exporters write core's re-serialization of it — sized, scripts and
// external references removed — and never the file's own bytes. It keeps its
// own colors (no `currentColor` substitution): it is a standalone image.

/** Whether an image entry is SVG, by its path or its content type. */
export function isSvgImageEntry(path: string, contentType?: string | null): boolean {
  return isSvgImageSource(path) || /^image\/svg\+xml\b/i.test(contentType ?? '');
}

/** An attached SVG file as an image part, or null when it is not a usable SVG. */
export function svgImageFromBytes(data: ArrayBuffer | Uint8Array): SvgIslandImage | null {
  return svgIslandImage(svgSourceFromBytes(data));
}

/**
 * The bytes an exporter writes for an image file: core's sanitized
 * re-serialization for an SVG (null — leave it out — when the file is not a
 * usable SVG), the bytes unchanged for anything else.
 */
export function exportImageBytes(
  path: string,
  data: ArrayBuffer,
  contentType?: string | null,
): ArrayBuffer | null {
  if (!isSvgImageEntry(path, contentType)) return data;
  return svgImageFromBytes(data)?.data ?? null;
}

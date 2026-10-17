/**
 * Pictures on slides as PresentationML: the `<p:pic>` element every picture
 * shares, and the two layer kinds that become a picture from data the host or
 * core supplies — Mermaid diagrams (a host-rasterized PNG) and SVG islands
 * (the sanitized SVG itself, as vector art).
 *
 * An SVG island goes in the way PowerPoint 2016+ writes an inserted SVG (see
 * `shared/officeSvgBlip.ts`): a PNG blip carrying the SVG part as an
 * extension. The PNG is the host's rasterization when it supplied one
 * (`diagramImages`, keyed by source), else a generated stand-in — the CLI has
 * no browser to draw with.
 */

import type { MermaidLayer, SvgLayer } from '@bendyline/squisq/schemas';
import { escapeXml } from '../ooxml/xmlUtils.js';
import { blipXml } from '../shared/officeSvgBlip.js';
import { svgIslandImage } from '../shared/svgIslands.js';

/** An area on the slide, in EMU. */
export interface EmuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A picture: decoded size in any unit (only its ratio is used) plus bytes. */
type HostPicture = { data: ArrayBuffer | Uint8Array; width: number; height: number };

/** What drawing a picture needs from the slide being built. */
export interface PictureSlideContext {
  /** Register an image part; returns its relationship id. */
  addImage(src: string, data: ArrayBuffer, alt: string): string;
  allocShapeId(): number;
  /** Host rasterizations of Mermaid diagrams and SVG islands, by trimmed source. */
  diagramImages?: Map<string, HostPicture>;
  /** Stand-in PNGs for SVG islands, loaded only when the deck has one. */
  svgIslandPosters: typeof import('../shared/svgIslandPoster.js') | null;
}

export function buildImageShape(
  img: { relId: string; alt: string },
  shapeId: number,
  left: number,
  top: number,
  maxWidth: number,
  maxHeight: number,
  /** Relationship id of a click hyperlink (a hosted video's page). */
  hyperlinkRelId?: string | null,
  /** Relationship id of the SVG part drawn in place of the raster. */
  svgRelId?: string,
): string {
  const name = escapeXml(img.alt || 'Picture');
  const descr = img.alt ? ` descr="${escapeXml(img.alt)}"` : '';
  const link = hyperlinkRelId ? `<a:hlinkClick r:id="${hyperlinkRelId}"/>` : '';
  return (
    `<p:pic>` +
    `<p:nvPicPr>` +
    (link
      ? `<p:cNvPr id="${shapeId}" name="${name}"${descr}>${link}</p:cNvPr>`
      : `<p:cNvPr id="${shapeId}" name="${name}"${descr}/>`) +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
    `<p:nvPr/>` +
    `</p:nvPicPr>` +
    `<p:blipFill>` +
    blipXml(img.relId, svgRelId) +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</p:blipFill>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${left}" y="${top}"/>` +
    `<a:ext cx="${maxWidth}" cy="${maxHeight}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</p:spPr>` +
    `</p:pic>`
  );
}

/** The largest `width × height`-shaped box inside `area`, centered. */
function fitCentered(area: EmuRect, width: number, height: number): EmuRect {
  const scale = Math.min(area.width / width, area.height / height);
  const fitted = { width: Math.round(width * scale), height: Math.round(height * scale) };
  return {
    x: area.x + Math.round((area.width - fitted.width) / 2),
    y: area.y + Math.round((area.height - fitted.height) / 2),
    ...fitted,
  };
}

function arrayBufferOf(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  return data instanceof Uint8Array
    ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
    : data;
}

function usablePicture(picture: HostPicture | undefined): picture is HostPicture {
  return !!picture && picture.width > 0 && picture.height > 0;
}

/** A Mermaid diagram's `accTitle`, for a picture's name; "Diagram" without one. */
function mermaidTitle(source: string): string {
  return /^\s*accTitle\s*:\s*(.+?)\s*$/mu.exec(source)?.[1] ?? 'Diagram';
}

/**
 * A Mermaid layer as the host's picture of it, fitted inside the layer's
 * area; null when the host supplied none (the caller shows the source).
 */
export function mermaidPictureShapes(
  layer: MermaidLayer,
  area: EmuRect,
  ctx: PictureSlideContext,
): string[] | null {
  const picture = ctx.diagramImages?.get(layer.content.source.trim());
  if (!usablePicture(picture)) return null;
  const alt = mermaidTitle(layer.content.source);
  const relId = ctx.addImage('diagram.png', arrayBufferOf(picture.data), alt);
  const rect = fitCentered(area, picture.width, picture.height);
  return [
    buildImageShape({ relId, alt }, ctx.allocShapeId(), rect.x, rect.y, rect.width, rect.height),
  ];
}

/**
 * An SVG island as vector art with its PNG fallback, fitted inside the
 * layer's area; null when the source is not an island or no fallback PNG
 * could be made (the caller shows a placeholder).
 */
export function svgIslandPictureShapes(
  layer: SvgLayer,
  area: EmuRect,
  ctx: PictureSlideContext,
): string[] | null {
  const image = svgIslandImage(layer.content.source, { color: layer.content.color });
  if (!image) return null;
  const hostPicture = ctx.diagramImages?.get(layer.content.source.trim());
  const fallback = usablePicture(hostPicture)
    ? arrayBufferOf(hostPicture.data)
    : ctx.svgIslandPosters?.svgIslandPosterPng(image.width / image.height)?.data;
  if (!fallback) return null;
  const alt = layer.content.alt ?? image.alt;
  const relId = ctx.addImage('svg-island.png', fallback, alt);
  const svgRelId = ctx.addImage('svg-island.svg', image.data, alt);
  const rect = fitCentered(area, image.width, image.height);
  return [
    buildImageShape(
      { relId, alt },
      ctx.allocShapeId(),
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      null,
      svgRelId,
    ),
  ];
}

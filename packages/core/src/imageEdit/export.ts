/**
 * Rasterize an {@link ImageEditDoc} to a PNG / JPEG / WebP {@link Blob}.
 *
 * The pipeline:
 *   1. Build an SVG string mirroring the canvas + layers, with image
 *      hrefs inlined as `data:` URLs (so the canvas isn't tainted).
 *   2. Wrap the SVG in a `Blob` and load it through an `Image`.
 *   3. Draw it onto a canvas (`OffscreenCanvas` when available,
 *      otherwise a detached `HTMLCanvasElement`).
 *   4. Convert the canvas to the requested format.
 *
 * Browser-only — calls `Image`, `URL.createObjectURL`, and canvas APIs.
 * Returns a Promise that rejects on SVG parse / load failures.
 */

import type { ContentContainer } from '../storage/ContentContainer.js';
import type { ImageEditCanvas, ImageEditDoc, ImageEditLayer } from '../schemas/ImageEditDoc.js';
import type { Position } from '../schemas/Doc.js';

/** Supported export formats. */
export type ImageEditExportFormat = 'png' | 'jpeg' | 'webp';

/** Options for {@link exportImageEditDoc}. */
export interface ImageEditExportOptions {
  /** Output format. Defaults to `'png'`. */
  format?: ImageEditExportFormat;
  /** JPEG/WebP quality 0..1. Defaults to `0.92`. Ignored for PNG. */
  quality?: number;
  /** Resolution scale factor. Defaults to `1` (canvas pixels = output pixels). */
  scale?: number;
}

const FORMAT_MIME: Record<ImageEditExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Export the doc to a raster {@link Blob}. Asset bytes referenced by image
 * layers are read from `container` and inlined as data URLs.
 */
export async function exportImageEditDoc(
  doc: ImageEditDoc,
  container: ContentContainer,
  options: ImageEditExportOptions = {},
): Promise<Blob> {
  const format: ImageEditExportFormat = options.format ?? 'png';
  const quality = options.quality ?? 0.92;
  const scale = options.scale ?? 1;
  const mime = FORMAT_MIME[format];

  const svg = await buildSvgString(doc, container);
  const outW = Math.max(1, Math.round(doc.canvas.width * scale));
  const outH = Math.max(1, Math.round(doc.canvas.height * scale));

  const img = await loadSvgImage(svg);
  const canvas = createRasterCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('exportImageEditDoc: 2D canvas context unavailable');

  // For JPEG (no alpha), pre-fill with the canvas background or white so
  // transparent regions aren't rendered as black.
  if (format === 'jpeg') {
    const bg =
      doc.canvas.background && doc.canvas.background !== 'transparent'
        ? doc.canvas.background
        : '#ffffff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, outW, outH);
  }

  ctx.drawImage(img as CanvasImageSource, 0, 0, outW, outH);
  return canvasToBlob(canvas, mime, quality);
}

// ============================================
// SVG construction
// ============================================

async function buildSvgString(doc: ImageEditDoc, container: ContentContainer): Promise<string> {
  const { width, height, background } = doc.canvas;
  const bgRect =
    background && background !== 'transparent'
      ? `<rect width="${width}" height="${height}" fill="${escapeAttr(background)}"/>`
      : '';

  const layerXml: string[] = [];
  for (const layer of doc.layers) {
    if (layer.visible === false) continue;
    layerXml.push(await renderLayerToSvg(layer, doc.canvas, container));
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    bgRect +
    layerXml.join('') +
    `</svg>`
  );
}

async function renderLayerToSvg(
  layer: ImageEditLayer,
  canvas: ImageEditCanvas,
  container: ContentContainer,
): Promise<string> {
  const opacity = layer.opacity ?? 1;
  const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : '';
  const inner = await renderLayerInner(layer, canvas, container);
  return `<g data-layer-id="${escapeAttr(layer.id)}"${opacityAttr}>${inner}</g>`;
}

async function renderLayerInner(
  layer: ImageEditLayer,
  canvas: ImageEditCanvas,
  container: ContentContainer,
): Promise<string> {
  const { x, y, w, h } = resolveBox(layer.position, canvas);

  if (layer.type === 'image') {
    const dataUrl = await loadAssetAsDataUrl(container, layer.content.src);
    return (
      `<image x="${x}" y="${y}" width="${w}" height="${h}"` +
      ` preserveAspectRatio="${preserveAspectRatioFor(layer.content.fit)}"` +
      ` xlink:href="${escapeAttr(dataUrl)}"/>`
    );
  }

  if (layer.type === 'shape') {
    const c = layer.content;
    const fill = c.fill ?? 'none';
    const stroke = c.stroke ? ` stroke="${escapeAttr(c.stroke)}"` : '';
    const strokeWidth = c.strokeWidth ? ` stroke-width="${c.strokeWidth}"` : '';
    if (c.shape === 'rect') {
      const rx = c.borderRadius ? ` rx="${c.borderRadius}" ry="${c.borderRadius}"` : '';
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeAttr(fill)}"${stroke}${strokeWidth}${rx}/>`;
    }
    if (c.shape === 'circle') {
      const r = Math.min(w, h) / 2;
      return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${r}" fill="${escapeAttr(fill)}"${stroke}${strokeWidth}/>`;
    }
    // line
    return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}"${stroke}${strokeWidth}/>`;
  }

  // text
  const c = layer.content;
  const style = c.style;
  const lineHeight = style.lineHeight ?? 1.4;
  const lineHeightPx = style.fontSize * lineHeight;
  const lines = (c.text ?? '').split('\n');
  const tspans = lines
    .map(
      (line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeightPx}">${escapeText(line)}</tspan>`,
    )
    .join('');
  const fontFamily = style.fontFamily ?? 'sans-serif';
  const fontWeight = style.fontWeight ?? 'normal';
  const textAnchor =
    style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start';
  return (
    `<text x="${x}" y="${y + style.fontSize}" font-family="${escapeAttr(fontFamily)}"` +
    ` font-size="${style.fontSize}" font-weight="${fontWeight}"` +
    ` fill="${escapeAttr(style.color)}" text-anchor="${textAnchor}">` +
    tspans +
    `</text>`
  );
}

function preserveAspectRatioFor(fit?: 'cover' | 'contain' | 'fill'): string {
  if (fit === 'cover') return 'xMidYMid slice';
  if (fit === 'fill') return 'none';
  return 'xMidYMid meet'; // contain (default)
}

function resolveBox(
  position: Position,
  canvas: ImageEditCanvas,
): { x: number; y: number; w: number; h: number } {
  const x = resolveValue(position.x, canvas.width);
  const y = resolveValue(position.y, canvas.height);
  const w =
    position.width !== undefined ? resolveValue(position.width, canvas.width) : canvas.width;
  const h =
    position.height !== undefined ? resolveValue(position.height, canvas.height) : canvas.height;
  const offset = anchorOffset(position.anchor, w, h);
  return { x: x + offset.x, y: y + offset.y, w, h };
}

function resolveValue(v: number | string, base: number): number {
  if (typeof v === 'number') return v;
  if (v.endsWith('%')) return (parseFloat(v) / 100) * base;
  return parseFloat(v) || 0;
}

function anchorOffset(
  anchor: Position['anchor'] | undefined,
  w: number,
  h: number,
): { x: number; y: number } {
  switch (anchor) {
    case 'center':
      return { x: -w / 2, y: -h / 2 };
    case 'top-right':
      return { x: -w, y: 0 };
    case 'bottom-left':
      return { x: 0, y: -h };
    case 'bottom-right':
      return { x: -w, y: -h };
    case 'top-left':
    default:
      return { x: 0, y: 0 };
  }
}

// ============================================
// Asset inlining
// ============================================

async function loadAssetAsDataUrl(container: ContentContainer, src: string): Promise<string> {
  // Already a data: or absolute URL — pass through.
  if (/^(data:|https?:|blob:)/.test(src)) return src;
  const data = await container.readFile(src);
  if (!data) throw new Error(`exportImageEditDoc: missing asset "${src}"`);
  const list = await container.listFiles(src);
  const mime = list.find((e) => e.path === src)?.mimeType ?? guessMime(src);
  return arrayBufferToDataUrl(data, mime);
}

function arrayBufferToDataUrl(data: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  // chunk to avoid call-stack limits with large images
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  // btoa exists in browsers and modern Node (>= 16); fall back to Buffer for older runtimes.
  const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function guessMime(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

// ============================================
// SVG → Image → Canvas → Blob
// ============================================

async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('exportImageEditDoc: SVG image failed to load'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

type RasterCanvas = HTMLCanvasElement | OffscreenCanvas;

function createRasterCanvas(width: number, height: number): RasterCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

async function canvasToBlob(canvas: RasterCanvas, mime: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: mime, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('exportImageEditDoc: canvas.toBlob returned null'));
      },
      mime,
      quality,
    );
  });
}

// ============================================
// XML escaping
// ============================================

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * PNG pictures of diagrams, for document exports (DOCX, EPUB, PDF, PPTX).
 *
 * Browser-only. A diagram is drawn as SVG, the SVG is loaded as an image,
 * and the image is painted onto a canvas and read back as PNG. That last
 * step fails in some browsers once the SVG holds `<foreignObject>`, so every
 * path here produces plain SVG: Mermaid with SVG-text labels, Squisq
 * diagrams through `BlockRenderer` without their slide chrome, and file
 * trees as monospace text. A picture also cannot load the page's web fonts,
 * so text is set in a system font stack.
 *
 * `createDiagramPictureRenderer` matches the `DiagramRasterizer` that
 * `@bendyline/squisq-formats/diagrams` takes.
 */

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Block, Layer, Theme } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import {
  DEFAULT_THEME,
  flattenRenderableBlocks,
  markdownToDoc,
  materializeBlockLayers,
} from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { BlockRenderer } from '../BlockRenderer.js';
import { renderMermaidSvgForExport } from '../mermaid/mermaidRuntime.js';

/** A PNG and the size it should display at, in CSS pixels. */
export interface DiagramPicturePng {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface DiagramPictureOptions {
  /** Colors for the diagram. Default: Squisq's default (light) theme. */
  theme?: Theme;
  /** Pixel density of the PNG relative to its display size. Default: 2. */
  scale?: number;
  /** Widest display size in CSS pixels. Default: 680. */
  maxWidth?: number;
  /** Background painted behind the diagram. Default: white. */
  background?: string;
}

/** The diagram description `@bendyline/squisq-formats/diagrams` passes. */
export interface DiagramToPicture {
  kind: 'mermaid' | 'diagram' | 'timeline' | 'tree' | 'container';
  markdown: string;
  source: string;
}

/** System fonts every platform has, since a picture can't load web fonts. */
export const EXPORT_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const EXPORT_MONO_STACK = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/** Squisq canvases are 1920 units wide; this sets their text near body size. */
const CANVAS_UNITS_PER_CSS_PIXEL = 2.5;
const PADDING = 16;
const SVG_NS = 'http://www.w3.org/2000/svg';

let pictureCount = 0;

function settings(options: DiagramPictureOptions) {
  return {
    theme: options.theme ?? DEFAULT_THEME,
    scale: options.scale ?? 2,
    maxWidth: options.maxWidth ?? 680,
    background: options.background ?? '#ffffff',
  };
}

/** Paint `svg` (viewBox already set) at `width` × `height` CSS pixels and read back PNG bytes. */
export async function svgToPng(
  svg: SVGSVGElement,
  width: number,
  height: number,
  options: DiagramPictureOptions = {},
): Promise<DiagramPicturePng> {
  const { scale, background } = settings(options);
  const pixelWidth = Math.max(1, Math.round(width * scale));
  const pixelHeight = Math.max(1, Math.round(height * scale));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(pixelWidth));
  clone.setAttribute('height', String(pixelHeight));
  clone.removeAttribute('style');
  const xml = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas is available to draw the diagram.');
  context.fillStyle = background;
  context.fillRect(0, 0, pixelWidth, pixelHeight);
  // Draw the decoded image element itself: an ImageBitmap of an SVG is
  // treated as cross-origin in Chromium, which would block the read-back.
  context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The diagram could not be encoded as PNG.');
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function parseViewBox(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } | null {
  const values = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/u).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [x = 0, y = 0, width = 0, height = 0] = values;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** A Mermaid diagram as a PNG at its natural size (capped at `maxWidth`). */
export async function renderMermaidPicture(
  source: string,
  options: DiagramPictureOptions = {},
): Promise<DiagramPicturePng> {
  const { theme, maxWidth } = settings(options);
  const markup = await renderMermaidSvgForExport(
    `squisq-export-mermaid-${String(++pictureCount)}`,
    source,
    theme,
    EXPORT_FONT_STACK,
  );
  // Mermaid returns HTML-serialized SVG; parse it as HTML so void elements
  // survive, then let XMLSerializer write well-formed XML.
  const template = document.createElement('template');
  template.innerHTML = markup;
  const svg = template.content.querySelector('svg');
  if (!svg) throw new Error('Mermaid produced no SVG.');
  const box = parseViewBox(svg);
  if (!box) throw new Error('The Mermaid SVG has no size.');
  const width = Math.min(maxWidth, box.width);
  return svgToPng(svg, width, (box.height * width) / box.width, options);
}

/** A file-tree fence as monospace text lines, exactly as written. */
export async function renderTreePicture(
  source: string,
  options: DiagramPictureOptions = {},
): Promise<DiagramPicturePng | null> {
  const { theme, maxWidth } = settings(options);
  const lines = source.replace(/\s+$/u, '').split('\n');
  if (lines.length === 0) return null;
  const fontSize = 14;
  const lineHeight = 20;
  const longest = Math.max(...lines.map((line) => [...line].length));
  const width = Math.min(maxWidth, Math.ceil(longest * fontSize * 0.62) + 2 * PADDING);
  const height = lines.length * lineHeight + 2 * PADDING;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('font-family', EXPORT_MONO_STACK);
  text.setAttribute('font-size', String(fontSize));
  text.setAttribute('fill', theme.colors.text);
  text.setAttribute('xml:space', 'preserve');
  lines.forEach((line, index) => {
    const span = document.createElementNS(SVG_NS, 'tspan');
    span.setAttribute('x', String(PADDING));
    span.setAttribute('y', String(PADDING + (index + 0.75) * lineHeight));
    span.textContent = line;
    text.append(span);
  });
  svg.append(text);
  return svgToPng(svg, width, height, options);
}

/** Layers that are slide chrome rather than the diagram itself. */
function isChrome(layer: Layer): boolean {
  const id = layer.id;
  if (id === 'bg' || id === 'title' || id.endsWith('-title') || id.endsWith('-description')) {
    return true;
  }
  if (id.endsWith('-empty')) return true;
  // A CSS gradient fill would be drawn through <foreignObject>.
  return layer.type === 'shape' && typeof layer.content.fill === 'string' && layer.content.fill.includes('gradient(');
}

function withExportFont(layer: Layer): Layer {
  if (layer.type !== 'text') return layer;
  return {
    ...layer,
    content: { ...layer.content, style: { ...layer.content.style, fontFamily: EXPORT_FONT_STACK } },
  };
}

async function settle(): Promise<void> {
  await document.fonts?.ready;
  for (let frame = 0; frame < 2; frame++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

/**
 * A Squisq-rendered diagram — an ASCII diagram or timeline fence, or a
 * drawing, layout, or diagram heading block — as a PNG cropped to its
 * content, or null when it has nothing to draw.
 */
export async function renderSquisqDiagramPicture(
  markdown: string,
  options: DiagramPictureOptions = {},
): Promise<DiagramPicturePng | null> {
  const { theme, maxWidth } = settings(options);
  const doc = markdownToDoc(parseMarkdown(markdown), { generateCoverBlock: false });
  const block = flattenRenderableBlocks(doc.blocks)[0];
  if (!block) return null;
  const viewport = VIEWPORT_PRESETS.landscape;
  const { layers } = materializeBlockLayers(block, { theme, viewport, persistentLayers: false });
  const kept = layers.filter((layer) => !isChrome(layer)).map(withExportFont);
  if (kept.length === 0) return null;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  // Laid out (getBBox needs geometry) but off screen and inert.
  host.style.cssText = `position:fixed;left:-${String(viewport.width * 2)}px;top:0;width:${String(
    viewport.width,
  )}px;height:${String(viewport.height)}px;pointer-events:none;`;
  document.body.append(host);
  const root = createRoot(host);
  try {
    const pictureBlock: Block = {
      id: `squisq-export-${String(++pictureCount)}`,
      startTime: 0,
      duration: 0,
      audioSegment: 0,
      layers: kept,
    };
    root.render(
      createElement(BlockRenderer, {
        block: pictureBlock,
        blockTime: 0,
        basePath: '',
        viewport,
        animationsEnabled: false,
        theme,
      }),
    );
    await settle();
    const svg = host.querySelector<SVGSVGElement>('svg.block-svg');
    if (!svg) return null;
    const box = svg.getBBox();
    if (box.width <= 0 || box.height <= 0) return null;
    const x = box.x - PADDING;
    const y = box.y - PADDING;
    const contentWidth = box.width + 2 * PADDING;
    const contentHeight = box.height + 2 * PADDING;
    const cropped = svg.cloneNode(true) as SVGSVGElement;
    cropped.setAttribute(
      'viewBox',
      `${String(x)} ${String(y)} ${String(contentWidth)} ${String(contentHeight)}`,
    );
    // The viewport clip would cut off content placed outside the slide.
    cropped.removeAttribute('clip-path');
    const width = Math.min(maxWidth, contentWidth / CANVAS_UNITS_PER_CSS_PIXEL);
    return await svgToPng(cropped, width, (contentHeight * width) / contentWidth, options);
  } finally {
    root.unmount();
    host.remove();
  }
}

/**
 * A renderer for `rasterizeDiagrams` from `@bendyline/squisq-formats/diagrams`:
 * Mermaid, ASCII diagrams and timelines, file trees, and drawing, layout,
 * and diagram blocks.
 */
export function createDiagramPictureRenderer(
  options: DiagramPictureOptions = {},
): (diagram: DiagramToPicture) => Promise<DiagramPicturePng | null> {
  return async (diagram) => {
    switch (diagram.kind) {
      case 'mermaid':
        return renderMermaidPicture(diagram.source, options);
      case 'tree':
        return renderTreePicture(diagram.source, options);
      default:
        return renderSquisqDiagramPicture(diagram.markdown, options);
    }
  };
}

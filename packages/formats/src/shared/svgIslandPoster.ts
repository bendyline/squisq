/**
 * The PNG an Office file carries beside an SVG island's vector part.
 *
 * DrawingML requires a raster blip under every `svgBlip`; Word and PowerPoint
 * 2016+ (and LibreOffice) draw the SVG and never show it, while older readers
 * show only it. When the host has rasterized the island (a browser export) its
 * PNG is used; otherwise — the CLI has no browser — this generated stand-in:
 * a quiet panel at the island's aspect ratio with a small picture glyph.
 *
 * Loaded on demand (`await import(...)`): only a document with an island pays
 * for the PNG encoder.
 */

import { upngEncoder } from '../pdf/upng.js';

export interface SvgIslandPosterImage {
  data: ArrayBuffer;
  contentType: 'image/png';
  width: number;
  height: number;
}

const LONG_EDGE = 480;
const posterCache = new Map<string, SvgIslandPosterImage | null>();

/** A poster at `aspectRatio` (width / height). Null when no PNG encoder exists. */
export function svgIslandPosterPng(aspectRatio: number): SvgIslandPosterImage | null {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 4 / 3;
  // Keep both edges at least 48px so an extreme strip still gets a glyph.
  const width = Math.max(48, Math.round(ratio >= 1 ? LONG_EDGE : LONG_EDGE * ratio));
  const height = Math.max(48, Math.round(ratio >= 1 ? LONG_EDGE / ratio : LONG_EDGE));
  const key = `${width}x${height}`;
  if (posterCache.has(key)) return posterCache.get(key) ?? null;
  if (!upngEncoder) {
    posterCache.set(key, null);
    return null;
  }

  const panel = [243, 244, 246];
  const ink = [156, 163, 175];
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = panel[0]!;
    rgba[i * 4 + 1] = panel[1]!;
    rgba[i * 4 + 2] = panel[2]!;
    rgba[i * 4 + 3] = 255;
  }

  // Glyph: a framed picture — sun and mountain — centred, 4×4 supersampled.
  const size = Math.round(Math.min(width, height) * 0.28);
  const left = (width - size) / 2;
  const top = (height - size * 0.8) / 2;
  const glyphH = size * 0.8;
  const stroke = Math.max(2, size * 0.06);
  const inFrame = (x: number, y: number): boolean => {
    const inside = x >= left && x <= left + size && y >= top && y <= top + glyphH;
    const inner =
      x >= left + stroke &&
      x <= left + size - stroke &&
      y >= top + stroke &&
      y <= top + glyphH - stroke;
    return inside && !inner;
  };
  const sunX = left + size * 0.32;
  const sunY = top + glyphH * 0.34;
  const sunR = size * 0.09;
  const inSun = (x: number, y: number): boolean => (x - sunX) ** 2 + (y - sunY) ** 2 <= sunR ** 2;
  const base = top + glyphH - stroke;
  const inMountain = (x: number, y: number): boolean => {
    if (y > base || x < left + stroke || x > left + size - stroke) return false;
    const peakX = left + size * 0.62;
    const peakY = top + glyphH * 0.42;
    const halfW = size * 0.38;
    return y >= peakY + ((base - peakY) * Math.abs(x - peakX)) / halfW;
  };

  const SAMPLES = 4;
  for (let y = Math.floor(top); y < Math.ceil(top + glyphH); y++) {
    for (let x = Math.floor(left); x < Math.ceil(left + size); x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          if (inFrame(px, py) || inSun(px, py) || inMountain(px, py)) hits++;
        }
      }
      if (!hits) continue;
      const t = hits / SAMPLES ** 2;
      const at = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) rgba[at + c] = Math.round(panel[c]! + (ink[c]! - panel[c]!) * t);
    }
  }

  const data = upngEncoder.encode([rgba.buffer], width, height, 0);
  const poster: SvgIslandPosterImage = { data, contentType: 'image/png', width, height };
  posterCache.set(key, poster);
  return poster;
}

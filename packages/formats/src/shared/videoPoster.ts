/**
 * Hosted videos (YouTube, Vimeo, …) in Office files.
 *
 * Word's online video and a PowerPoint slide both need a PICTURE to stand in
 * for the player: Word renders its player into that picture, and every other
 * reader just sees the picture. Exports never reach the network, so the
 * picture is generated — a dark frame with a centred play button, as PNG —
 * unless the caller pre-resolved the provider's thumbnail into its image map.
 *
 * Loaded on demand (`await import(...)`): only a document that has a video
 * pays for the PNG encoder.
 */

import { videoEmbedIframeAttributes, type VideoEmbed } from '@bendyline/squisq/markdown';
import { upngEncoder } from '../pdf/upng.js';

export interface VideoPosterImage {
  data: ArrayBuffer;
  contentType: 'image/png';
  width: number;
  height: number;
}

const LONG_EDGE = 640;
const SHORT_EDGE = 360;
const posterCache = new Map<string, VideoPosterImage | null>();

/** Linear 0..1 mix of two RGB triples. */
function mix(a: readonly number[], b: readonly number[], t: number): number[] {
  return [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t));
}

/**
 * A poster frame: a vertical dark gradient with a translucent rounded play
 * button and a white triangle, anti-aliased by 4×4 supersampling inside the
 * button's bounds. Null when the PNG encoder is unavailable.
 */
export function videoPosterPng(portrait: boolean): VideoPosterImage | null {
  const key = portrait ? 'portrait' : 'landscape';
  if (posterCache.has(key)) return posterCache.get(key) ?? null;
  if (!upngEncoder) {
    posterCache.set(key, null);
    return null;
  }

  const width = portrait ? SHORT_EDGE : LONG_EDGE;
  const height = portrait ? LONG_EDGE : SHORT_EDGE;
  const rgba = new Uint8Array(width * height * 4);
  const top = [40, 44, 54];
  const bottom = [14, 15, 20];
  for (let y = 0; y < height; y++) {
    const [r, g, b] = mix(top, bottom, y / (height - 1));
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      rgba[at] = r!;
      rgba[at + 1] = g!;
      rgba[at + 2] = b!;
      rgba[at + 3] = 255;
    }
  }

  // Play button: a rounded rectangle centred in the frame, triangle inside.
  const buttonW = Math.round(Math.min(width, height) * 0.3);
  const buttonH = Math.round(buttonW * 0.7);
  const radius = buttonH * 0.24;
  const left = (width - buttonW) / 2;
  const topY = (height - buttonH) / 2;
  const triH = buttonH * 0.42;
  const triW = triH * 0.9;
  const triLeft = width / 2 - triW * 0.4;
  const triTop = height / 2 - triH / 2;

  const inButton = (px: number, py: number): boolean => {
    const dx = Math.max(left + radius - px, 0, px - (left + buttonW - radius));
    const dy = Math.max(topY + radius - py, 0, py - (topY + buttonH - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  const inTriangle = (px: number, py: number): boolean => {
    if (px < triLeft) return false;
    // Right-pointing: the half-height shrinks linearly to the tip.
    const halfAt = (triH / 2) * (1 - (px - triLeft) / triW);
    return Math.abs(py - height / 2) <= halfAt && py >= triTop && py <= triTop + triH;
  };

  const SAMPLES = 4;
  for (let y = Math.floor(topY); y < Math.ceil(topY + buttonH); y++) {
    for (let x = Math.floor(left); x < Math.ceil(left + buttonW); x++) {
      let button = 0;
      let triangle = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          if (inButton(px, py)) button++;
          if (inTriangle(px, py)) triangle++;
        }
      }
      if (!button && !triangle) continue;
      const at = (y * width + x) * 4;
      const base = [rgba[at]!, rgba[at + 1]!, rgba[at + 2]!];
      // A white wash at 18% for the button, then solid white for the glyph.
      const washed = mix(base, [255, 255, 255], 0.18 * (button / SAMPLES ** 2));
      const [r, g, b] = mix(washed, [255, 255, 255], triangle / SAMPLES ** 2);
      rgba[at] = r!;
      rgba[at + 1] = g!;
      rgba[at + 2] = b!;
    }
  }

  const data = upngEncoder.encode([rgba.buffer], width, height, 0);
  const poster: VideoPosterImage = { data, contentType: 'image/png', width, height };
  posterCache.set(key, poster);
  return poster;
}

/**
 * The player URL an Office app gets. Office plays embed codes only from hosts
 * it recognizes, so YouTube goes out on its standard embed host rather than
 * the privacy-enhanced one browsers get.
 */
export function officeVideoEmbedUrl(embed: VideoEmbed): string {
  return embed.provider === 'youtube'
    ? embed.embedUrl.replace(/^https:\/\/www\.youtube-nocookie\.com\//, 'https://www.youtube.com/')
    : embed.embedUrl;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The `<iframe>` embed code for an Office online video (Word's
 * `wp15:webVideoPr@embeddedHtml`): the canonical player attributes, sized,
 * on {@link officeVideoEmbedUrl}. Built from the validated embed — never from
 * an author's HTML.
 */
export function officeVideoEmbedHtml(
  embed: VideoEmbed,
  title: string | null,
  width: number,
  height: number,
): string {
  const { loading: _lazy, ...attrs } = videoEmbedIframeAttributes(embed, title);
  const all: Record<string, string> = {
    width: String(width),
    height: String(height),
    ...attrs,
    src: officeVideoEmbedUrl(embed),
    frameborder: '0',
  };
  const serialized = Object.entries(all)
    .map(([name, value]) => (value === '' ? name : `${name}="${escapeHtmlAttr(value)}"`))
    .join(' ');
  return `<iframe ${serialized}></iframe>`;
}

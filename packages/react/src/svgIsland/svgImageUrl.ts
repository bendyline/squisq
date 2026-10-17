/**
 * An attached SVG image (`![logo](logo.svg)`) shown the way an SVG island is:
 * its bytes run through core's sanitizer, and only core's re-serialization —
 * sized from its viewBox, scripts and external references removed — reaches
 * the page, as a `data:` URL.
 *
 * Only local sources are read: `blob:` and `data:` URLs (a media provider's
 * output) and same-origin paths. A remote SVG keeps its own URL — an image of
 * it already runs no script, and exports never carry remote images.
 */

import { useEffect, useState } from 'react';
import {
  parseSvgIsland,
  svgIslandDataUrl,
  svgSourceFromBytes,
  svgSourceFromDataUrl,
} from '@bendyline/squisq/markdown';

/** Whether `url` can be read without a cross-origin request. */
export function isLocalSvgUrl(url: string): boolean {
  if (/^(?:blob|data):/i.test(url)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//');
}

export interface SanitizedSvgImageOptions {
  /** Draw a still: no SMIL or CSS animation (frame capture). */
  static?: boolean;
}

const CACHE_LIMIT = 64;
const cache = new Map<string, Promise<string>>();

async function load(url: string, isStatic: boolean): Promise<string> {
  let source = svgSourceFromDataUrl(url);
  if (source === null) {
    const response = await fetch(url);
    if (!response.ok) return '';
    source = svgSourceFromBytes(await response.arrayBuffer());
  }
  const result = parseSvgIsland(source, { static: isStatic });
  return result.ok ? svgIslandDataUrl(result.island) : '';
}

/**
 * Core's sanitized `data:` URL for the SVG at a local `url`, or `''` when it
 * cannot be read or is not a usable SVG. Never rejects. Results are cached by
 * URL — a media provider mints a new blob URL when a file changes.
 */
export function sanitizedSvgImageUrl(
  url: string,
  options: SanitizedSvgImageOptions = {},
): Promise<string> {
  const isStatic = options.static === true;
  const key = `${isStatic ? 's' : 'a'}|${url}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = load(url, isStatic).catch(() => '');
    cache.set(key, pending);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return pending;
}

/**
 * `src` when it is an SVG `data:` URL, else null — for the image paths that
 * screen sources with `sanitizeUrl` (which refuses SVG data) before handing
 * them to `useMediaUrl`, where SVG is sanitized instead.
 */
export function svgDataImageSrc(src: string | null | undefined): string | null {
  const trimmed = src?.trim() ?? '';
  return /^data:image\/svg\+xml[;,]/i.test(trimmed) ? trimmed : null;
}

/**
 * For an SVG image at a local `url`: core's sanitized data URL of it, `null`
 * when the file is not a usable SVG, `undefined` while it is being read.
 * Any other `url` (not SVG, remote, empty) comes back as is.
 *
 * @param url - The resolved URL (a provider's blob/data URL, or a path).
 * @param isSvg - Whether the image it names is SVG (see `isSvgImageSource`).
 */
export function useSanitizedSvgImage(
  url: string,
  isSvg: boolean,
  options: SanitizedSvgImageOptions = {},
): string | null | undefined {
  const isStatic = options.static === true;
  const needsSanitizing = isSvg && url !== '' && isLocalSvgUrl(url);
  const [sanitized, setSanitized] = useState<{
    url: string;
    isStatic: boolean;
    result: string;
  } | null>(null);

  useEffect(() => {
    if (!needsSanitizing) return;
    let cancelled = false;
    void sanitizedSvgImageUrl(url, { static: isStatic }).then((result) => {
      if (!cancelled) setSanitized({ url, isStatic, result });
    });
    return () => {
      cancelled = true;
    };
  }, [needsSanitizing, url, isStatic]);

  if (!needsSanitizing) return url;
  if (sanitized?.url !== url || sanitized.isStatic !== isStatic) return undefined;
  return sanitized.result || null;
}

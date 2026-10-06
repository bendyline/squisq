/**
 * Shared extension → MIME-type mapping for embedded media.
 *
 * Previously triplicated with subtle drift: the docx and pptx importers each
 * carried a byte-identical dotted-key map (png/jpg/.../emf/wmf), while the html
 * exporter's `inferMimeType` used no-dot keys and a different key set (added
 * audio/video/ico/avif, omitted tiff/emf/wmf). This module is the single union
 * of all of them, so a newly-supported type only has to be added once.
 */

/** Union of every extension→MIME entry the format modules need. */
const EXT_TO_MIME: Record<string, string> = {
  // Raster / vector images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  ico: 'image/x-icon',
  avif: 'image/avif',
  // Office vector formats (docx/pptx embedded metafiles)
  emf: 'image/emf',
  wmf: 'image/wmf',
  // Audio / video (html export inlines these as data URIs)
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  // Sidecar data files (`{[dataTable src=…]}` references)
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  parquet: 'application/vnd.apache.parquet',
};

/**
 * Map a file extension to its MIME type. Tolerates a leading dot and any
 * casing (`.PNG`, `png`, `.png` all resolve). Returns
 * `application/octet-stream` for unknown extensions.
 */
export function extToMime(ext: string): string {
  const key = ext.replace(/^\./, '').toLowerCase();
  return EXT_TO_MIME[key] ?? 'application/octet-stream';
}

/** Pixel width/height from a PNG, JPEG, or GIF header, or null when unrecognized. */
export function readImageDimensions(
  data: ArrayBuffer | Uint8Array,
): { width: number; height: number } | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 24) return null;

  // PNG: signature 0x89504E47, IHDR chunk at byte 16
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { width, height };
  }

  // JPEG: search for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length - 9) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return { width, height };
      }
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + segLen;
    }
  }

  // GIF: width at bytes 6-7, height at bytes 8-9 (little-endian)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    return { width, height };
  }

  return null;
}

/**
 * The largest size with the same aspect ratio as `width` × `height` that fits
 * inside `maxWidth` × `maxHeight`, never enlarging the original.
 */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

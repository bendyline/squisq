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

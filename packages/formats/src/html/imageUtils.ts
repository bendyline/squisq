/**
 * Image Utilities for HTML Export
 *
 * Browser-compatible helpers for converting image data to base64 data URIs
 * and inferring MIME types from filenames.
 */

/** Map of file extensions to MIME types */
const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/**
 * Infer a MIME type from a filename's extension.
 * Returns 'application/octet-stream' for unknown types.
 */
export function inferMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Convert an ArrayBuffer to a base64-encoded data URI string.
 *
 * @param buffer - The binary image data
 * @param mimeType - MIME type (e.g., 'image/jpeg'). If not provided, defaults to
 *   'application/octet-stream'.
 * @returns A `data:` URI string
 */
export function arrayBufferToBase64DataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Extract the filename from a path or URL (strips directory and query).
 *
 * @example
 *   extractFilename('images/hero.jpg') // 'hero.jpg'
 *   extractFilename('https://example.com/photo.png?v=2') // 'photo.png'
 */
export function extractFilename(path: string): string {
  // Strip query/hash
  const clean = path.split('?')[0].split('#')[0];
  // Get last segment
  const parts = clean.split('/');
  return parts[parts.length - 1] || path;
}

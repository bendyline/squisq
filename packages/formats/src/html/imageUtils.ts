/**
 * Image Utilities for HTML Export
 *
 * Browser-compatible helpers for converting image data to base64 data URIs
 * and inferring MIME types from filenames.
 */

import { extToMime } from '../shared/images.js';

/**
 * Infer a MIME type from a filename's extension.
 * Returns 'application/octet-stream' for unknown types.
 *
 * Thin wrapper over the shared {@link extToMime} map so html export, docx
 * import, and pptx import all agree on extension → MIME.
 */
export function inferMimeType(filename: string): string {
  return extToMime(filename.split('.').pop() ?? '');
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
  // Keep chunks divisible by three so concatenating their independently
  // encoded results cannot introduce padding in the middle of the stream.
  // This avoids both quadratic string concatenation and one image-sized
  // intermediate binary string for large embedded assets.
  const chunkSize = 3 * 8192;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    let binary = '';
    for (let i = offset; i < end; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    chunks.push(btoa(binary));
  }
  return `data:${mimeType};base64,${chunks.join('')}`;
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

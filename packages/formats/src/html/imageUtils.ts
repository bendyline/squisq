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

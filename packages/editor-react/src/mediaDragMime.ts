/**
 * Shared MIME type used to signal an in-app drag from the MediaBin to either
 * the Raw or WYSIWYG editor. Carries a JSON payload of the form
 * `{ name, mimeType, alt }` so the receiving editor can insert a reference
 * to an existing media entry without re-uploading it.
 */
export const SQUISQ_MEDIA_MIME = 'application/x-squisq-media';

export interface SquisqMediaDragPayload {
  /** Relative path / filename as stored in the MediaProvider. */
  name: string;
  /** MIME type of the entry. */
  mimeType: string;
  /** Default alt text derived from the filename. */
  alt: string;
}

export function parseSquisqMediaPayload(raw: string): SquisqMediaDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SquisqMediaDragPayload>;
    if (
      typeof parsed.name === 'string' &&
      typeof parsed.mimeType === 'string' &&
      typeof parsed.alt === 'string'
    ) {
      return parsed as SquisqMediaDragPayload;
    }
  } catch {
    // fall through
  }
  return null;
}

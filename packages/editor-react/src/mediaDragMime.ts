/**
 * Shared MIME type used to signal an in-app drag from the MediaBin to either
 * the Raw or WYSIWYG editor. Carries a JSON payload of the form
 * `{ name, mimeType, alt }` so the receiving editor can insert a reference
 * to an existing media entry without re-uploading it.
 */
export const SQUISQ_MEDIA_MIME = 'application/x-squisq-media';

export type SquisqMediaKind = 'image' | 'video' | 'audio' | 'file';

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

/** Choose the document representation used when a Files-panel item is inserted. */
export function squisqMediaKind(mimeType: string): SquisqMediaKind {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  return 'file';
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the source-form reference for an existing Files-panel entry.
 *
 * Images retain native Markdown syntax, playable media uses the same HTML
 * representation as recorder output, and other files remain ordinary links.
 */
export function buildSquisqMediaReference(payload: SquisqMediaDragPayload): string {
  switch (squisqMediaKind(payload.mimeType)) {
    case 'image':
      return `![${payload.alt}](${payload.name})`;
    case 'video':
      return `<video src="${escapeHtmlAttribute(payload.name)}" controls width="480"></video>`;
    case 'audio':
      return `<audio src="${escapeHtmlAttribute(payload.name)}" controls></audio>`;
    default:
      return `[${payload.alt}](${payload.name})`;
  }
}

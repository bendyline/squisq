/**
 * Shared MIME type used to signal an in-app drag from the MediaBin to either
 * the Raw or WYSIWYG editor. Carries a JSON payload of the form
 * `{ name, mimeType, alt }` so the receiving editor can insert a reference
 * to an existing media entry without re-uploading it.
 *
 * Also the one vocabulary for what an inserted media file BECOMES — markdown
 * source ({@link buildSquisqMediaReference}) and Write-view node
 * ({@link squisqMediaNode}) — used by Files-panel drags, file drops and the
 * toolbar's Image/Media and File items alike.
 */
import { escapeLinkLabel, formatLinkDestination } from './markdownDestination';

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

/**
 * MIME by extension for media files whose `File.type` arrives empty or
 * generic — browsers take it from the OS, which often has no entry for
 * .m4a, .flac, .mkv and friends.
 */
const MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  weba: 'audio/webm',
};

/**
 * `accept` value for an image/media file picker. The wildcards cover what
 * the OS can type; the extensions keep files it cannot (a .flac on a system
 * with no registered audio type) selectable.
 */
export const MEDIA_FILE_ACCEPT = [
  'image/*',
  'video/*',
  'audio/*',
  ...Object.keys(MEDIA_MIME_BY_EXTENSION).map((ext) => `.${ext}`),
].join(',');

/**
 * The MIME type to record for a media file: its own `type` when it names a
 * real media type, else one inferred from the file name's extension.
 */
export function mediaMimeType(file: { name: string; type: string }): string {
  const reported = file.type.toLowerCase();
  if (/^(?:image|video|audio)\//.test(reported)) return file.type;
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  return MEDIA_MIME_BY_EXTENSION[ext] ?? (file.type || 'application/octet-stream');
}

/** Default alt text / link label for an inserted file: its name, less the
 *  extension, with `-`/`_` read as spaces. */
export function mediaAltText(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

/** Choose the document representation used when a Files-panel item is inserted. */
export function squisqMediaKind(mimeType: string): SquisqMediaKind {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Width a newly inserted video starts at, so a large source does not blow
 *  the editor up to its natural resolution. Height stays intrinsic. */
export const INSERTED_VIDEO_WIDTH = 480;

/** A Write-view node for an inserted media reference. */
export type SquisqMediaNodeSpec =
  | { type: 'image'; attrs: { src: string; alt: string } }
  | { type: 'video'; attrs: { src: string; controls: true; width: number } }
  | { type: 'audio'; attrs: { src: string; controls: true } };

/**
 * The Write-view node a reference becomes — the editable counterpart of
 * {@link buildSquisqMediaReference}. `null` for a generic file, which is
 * inserted as a link.
 */
export function squisqMediaNode(payload: SquisqMediaDragPayload): SquisqMediaNodeSpec | null {
  switch (squisqMediaKind(payload.mimeType)) {
    case 'image':
      return { type: 'image', attrs: { src: payload.name, alt: payload.alt } };
    case 'video':
      return {
        type: 'video',
        attrs: { src: payload.name, controls: true, width: INSERTED_VIDEO_WIDTH },
      };
    case 'audio':
      return { type: 'audio', attrs: { src: payload.name, controls: true } };
    default:
      return null;
  }
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
      return `![${escapeLinkLabel(payload.alt)}](${formatLinkDestination(payload.name)})`;
    case 'video':
      return `<video src="${escapeHtmlAttribute(payload.name)}" controls width="${INSERTED_VIDEO_WIDTH}"></video>`;
    case 'audio':
      return `<audio src="${escapeHtmlAttribute(payload.name)}" controls></audio>`;
    default:
      return `[${escapeLinkLabel(payload.alt)}](${formatLinkDestination(payload.name)})`;
  }
}

/**
 * The reference for a file just stored at `path`: its MIME type (inferred
 * from the name when the browser supplied none) and its label — alt text for
 * media, but the file NAME for anything linked, so a reader can see what the
 * link downloads (`data.zip`, not `data`).
 */
export function fileReference(
  path: string,
  fileName: string,
  mimeType: string,
): SquisqMediaDragPayload {
  const type = mediaMimeType({ name: fileName, type: mimeType });
  const linked = squisqMediaKind(type) === 'file';
  return { name: path, mimeType: type, alt: linked ? fileName : mediaAltText(fileName) };
}

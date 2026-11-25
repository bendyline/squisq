/**
 * Write-back bookkeeping for the image editors that save over a picture
 * (the image-edit modal and `ImageFileEditor`).
 *
 * The editor persists its layers to the sidecar's `state.json` as the user
 * works, but the picture only changes when the flattened raster is written
 * back over it. This module records which layer state was last written back
 * (`writeback.json` beside `state.json`), so closing or leaving the editor
 * can tell whether the picture is behind the layers, including edits left
 * behind by an earlier session. `ImageFileEditor` also records a digest of
 * the bytes it wrote, so a picture replaced outside the editor is noticed
 * instead of being overwritten from stale layers.
 */

import type { ImageEditExportFormat } from '@bendyline/squisq/imageEdit';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';

/** Sidecar-relative path of the write-back record. */
export const IMAGE_EDIT_WRITE_BACK_FILENAME = 'writeback.json';

interface WriteBackRecord {
  version: 1;
  /** {@link imageEditSignature} of the layer state last written back. */
  signature: string;
  /** {@link digestBytes} of the picture bytes that write produced, when known. */
  pictureDigest?: string;
  writtenAt: string;
}

/** What `writeback.json` says about the last write-back. */
export interface WriteBackState {
  signature: string;
  /** Null for records written without one (the modal does not keep one). */
  pictureDigest: string | null;
}

/**
 * The format an edited picture is saved back in, chosen so the file keeps
 * its type: PNG, JPEG, and WebP only. Null for anything else (GIF, SVG,
 * AVIF, BMP, ICO), which the raster editor cannot save back losslessly.
 */
export function imageSaveFormatForPath(path: string): ImageEditExportFormat | null {
  const name = (path.split(/[?#]/, 1)[0] ?? '').split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  const extension = dot < 0 ? null : name.slice(dot + 1).toLowerCase();
  if (extension === 'png') return 'png';
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'webp') return 'webp';
  return null;
}

/**
 * Stable fingerprint of what the picture renders: canvas and layers, with
 * object keys sorted so key order never counts as a change. `meta` is
 * excluded because every `state.json` write touches its timestamps.
 */
export function imageEditSignature(doc: ImageEditDoc): string {
  return hashString(canonicalJson({ canvas: doc.canvas, layers: doc.layers }));
}

/**
 * True when the doc is still the untouched seed of its source image: one
 * visible, fully opaque image layer covering the whole canvas. A picture
 * with no write-back record matches its sidecar only in this state.
 */
export function isPristineImageEditDoc(doc: ImageEditDoc): boolean {
  if (doc.layers.length !== 1) return false;
  const [layer] = doc.layers;
  if (!layer || layer.type !== 'image') return false;
  if (layer.visible === false || (layer.opacity ?? 1) !== 1) return false;
  if (doc.meta?.sourcePath && layer.content.src !== doc.meta.sourcePath) return false;
  const { x, y, width, height, anchor } = layer.position;
  return (
    x === 0 &&
    y === 0 &&
    width === doc.canvas.width &&
    height === doc.canvas.height &&
    (anchor === undefined || anchor === 'top-left')
  );
}

/**
 * Whether the picture needs the current layers written back. `written` is
 * the recorded signature, or null when this sidecar has never recorded one
 * (it was seeded before records existed, or never saved).
 */
export function needsWriteBack(doc: ImageEditDoc, written: string | null): boolean {
  return written === null ? !isPristineImageEditDoc(doc) : imageEditSignature(doc) !== written;
}

/** Read the write-back record. Absent or unreadable records read as null. */
export async function readWriteBackState(
  container: ContentContainer,
): Promise<WriteBackState | null> {
  try {
    const data = await container.readFile(IMAGE_EDIT_WRITE_BACK_FILENAME);
    if (!data) return null;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Partial<WriteBackRecord>;
    if (typeof record.signature !== 'string') return null;
    return {
      signature: record.signature,
      pictureDigest: typeof record.pictureDigest === 'string' ? record.pictureDigest : null,
    };
  } catch {
    return null;
  }
}

/** Read the recorded signature. Absent or unreadable records read as null. */
export async function readWriteBackSignature(container: ContentContainer): Promise<string | null> {
  return (await readWriteBackState(container))?.signature ?? null;
}

/**
 * Record that the picture now matches the layer state with `signature`,
 * and, when given, that its bytes have digest `pictureDigest`.
 */
export async function writeWriteBackSignature(
  container: ContentContainer,
  signature: string,
  pictureDigest?: string,
): Promise<void> {
  const record: WriteBackRecord = {
    version: 1,
    signature,
    ...(pictureDigest !== undefined ? { pictureDigest } : {}),
    writtenAt: new Date().toISOString(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(record, null, 2));
  await container.writeFile(IMAGE_EDIT_WRITE_BACK_FILENAME, bytes, 'application/json');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Fingerprint of a picture's bytes (cyrb53 over the bytes, plus length).
 * Tells whether a picture is still the one the editor last wrote; a
 * collision would only keep layers for a picture replaced outside.
 */
export function digestBytes(input: Uint8Array | ArrayBuffer): string {
  const bytes = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input);
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${bytes.length.toString(36)}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** cyrb53: a fast 53-bit string hash. A collision would only skip one save on close. */
function hashString(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

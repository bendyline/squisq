/**
 * Write-back bookkeeping for the image-edit modal.
 *
 * The editor persists its layers to the sidecar's `state.json` as the user
 * works, but the document's picture only changes when the flattened raster
 * is written back over it. This module records which layer state was last
 * written back (`writeback.json` beside `state.json`), so closing the modal
 * can tell whether the picture is behind the layers, including edits left
 * behind by an earlier session.
 */

import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';

/** Sidecar-relative path of the write-back record. */
export const IMAGE_EDIT_WRITE_BACK_FILENAME = 'writeback.json';

interface WriteBackRecord {
  version: 1;
  /** {@link imageEditSignature} of the layer state last written back. */
  signature: string;
  writtenAt: string;
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

/** Read the recorded signature. Absent or unreadable records read as null. */
export async function readWriteBackSignature(container: ContentContainer): Promise<string | null> {
  try {
    const data = await container.readFile(IMAGE_EDIT_WRITE_BACK_FILENAME);
    if (!data) return null;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Partial<WriteBackRecord>).signature === 'string'
    ) {
      return (parsed as WriteBackRecord).signature;
    }
    return null;
  } catch {
    return null;
  }
}

/** Record that the picture now matches the layer state with `signature`. */
export async function writeWriteBackSignature(
  container: ContentContainer,
  signature: string,
): Promise<void> {
  const record: WriteBackRecord = {
    version: 1,
    signature,
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

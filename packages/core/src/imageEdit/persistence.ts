/**
 * Load and save {@link ImageEditDoc} JSON to a sidecar
 * {@link ContentContainer} (typically a {@link ScopedContentContainer}
 * rooted at `<basename>_files/`).
 */

import type { ContentContainer } from '../storage/ContentContainer.js';
import type { ImageEditDoc } from '../schemas/ImageEditDoc.js';
import { IMAGE_EDIT_STATE_FILENAME } from './state.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Read `state.json` from the sidecar and parse it. Returns `null` when
 * the file does not exist; throws on parse / shape errors.
 */
export async function readImageEditDoc(
  container: ContentContainer,
  filename: string = IMAGE_EDIT_STATE_FILENAME,
): Promise<ImageEditDoc | null> {
  const data = await container.readFile(filename);
  if (!data) return null;
  const text = decoder.decode(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`readImageEditDoc: ${filename} is not valid JSON: ${msg}`);
  }
  assertImageEditDoc(parsed, filename);
  return parsed;
}

/** Serialize `doc` to JSON and write it to the sidecar. */
export async function writeImageEditDoc(
  container: ContentContainer,
  doc: ImageEditDoc,
  filename: string = IMAGE_EDIT_STATE_FILENAME,
): Promise<void> {
  const text = JSON.stringify(doc, null, 2);
  await container.writeFile(filename, encoder.encode(text), 'application/json');
}

/**
 * Validate a parsed value as an {@link ImageEditDoc}, throwing with an
 * actionable message.
 *
 * Exported so every path that turns stored JSON back into a doc validates
 * identically. `readImageEditVersion` used to bare-cast instead, which let a
 * corrupt snapshot survive a revert and land in `state.json` — after which
 * every subsequent `readImageEditDoc` threw and the editor was wedged on a
 * file that had loaded fine moments earlier.
 *
 * @param context - The calling API, used to prefix errors.
 */
export function assertImageEditDoc(
  value: unknown,
  filename: string,
  context = 'readImageEditDoc',
): asserts value is ImageEditDoc {
  if (!value || typeof value !== 'object') {
    throw new Error(`${context}: ${filename} root must be an object`);
  }
  const v = value as Partial<ImageEditDoc>;
  if (v.version !== 1) {
    throw new Error(
      `${context}: ${filename} has unsupported schema version ${String(v.version)} (expected 1)`,
    );
  }
  if (!v.canvas || typeof v.canvas.width !== 'number' || typeof v.canvas.height !== 'number') {
    throw new Error(`${context}: ${filename} canvas.width/height must be numbers`);
  }
  if (!Array.isArray(v.layers)) {
    throw new Error(`${context}: ${filename} layers must be an array`);
  }
  v.layers.forEach((layer, i) => assertLayer(layer, i, filename));
}

const VALID_LAYER_TYPES = new Set(['image', 'text', 'shape', 'path']);

function assertLayer(value: unknown, index: number, filename: string): void {
  const ctx = `${filename} layers[${index}]`;
  if (!value || typeof value !== 'object') {
    throw new Error(`readImageEditDoc: ${ctx} must be an object`);
  }
  const layer = value as Record<string, unknown>;

  if (typeof layer['id'] !== 'string') {
    throw new Error(`readImageEditDoc: ${ctx} must have a string id`);
  }
  if (typeof layer['type'] !== 'string' || !VALID_LAYER_TYPES.has(layer['type'])) {
    throw new Error(
      `readImageEditDoc: ${ctx} type must be one of image|text|shape, got ${String(layer['type'])}`,
    );
  }

  const pos = layer['position'];
  if (
    !pos ||
    typeof pos !== 'object' ||
    (typeof (pos as Record<string, unknown>)['x'] !== 'number' &&
      typeof (pos as Record<string, unknown>)['x'] !== 'string') ||
    (typeof (pos as Record<string, unknown>)['y'] !== 'number' &&
      typeof (pos as Record<string, unknown>)['y'] !== 'string')
  ) {
    throw new Error(`readImageEditDoc: ${ctx} position must have numeric or string x and y`);
  }

  const content = layer['content'];
  if (!content || typeof content !== 'object') {
    throw new Error(`readImageEditDoc: ${ctx} content must be an object`);
  }
  const c = content as Record<string, unknown>;

  if (layer['type'] === 'image' && typeof c['src'] !== 'string') {
    throw new Error(`readImageEditDoc: ${ctx} (image) content.src must be a string`);
  }
  if (layer['type'] === 'text' && typeof c['text'] !== 'string') {
    throw new Error(`readImageEditDoc: ${ctx} (text) content.text must be a string`);
  }
  if (layer['type'] === 'shape' && typeof c['shape'] !== 'string') {
    throw new Error(`readImageEditDoc: ${ctx} (shape) content.shape must be a string`);
  }
  if (layer['type'] === 'path' && typeof c['d'] !== 'string') {
    throw new Error(`readImageEditDoc: ${ctx} (path) content.d must be a string`);
  }
}

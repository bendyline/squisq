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

function assertImageEditDoc(value: unknown, filename: string): asserts value is ImageEditDoc {
  if (!value || typeof value !== 'object') {
    throw new Error(`readImageEditDoc: ${filename} root must be an object`);
  }
  const v = value as Partial<ImageEditDoc>;
  if (v.version !== 1) {
    throw new Error(
      `readImageEditDoc: ${filename} has unsupported schema version ${String(v.version)} (expected 1)`,
    );
  }
  if (!v.canvas || typeof v.canvas.width !== 'number' || typeof v.canvas.height !== 'number') {
    throw new Error(`readImageEditDoc: ${filename} canvas.width/height must be numbers`);
  }
  if (!Array.isArray(v.layers)) {
    throw new Error(`readImageEditDoc: ${filename} layers must be an array`);
  }
}

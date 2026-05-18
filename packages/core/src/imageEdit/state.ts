/**
 * Pure helpers for constructing and mutating {@link ImageEditDoc} values.
 *
 * All functions are side-effect free and return new doc objects rather
 * than mutating their inputs, so they're safe to use from a reducer.
 */

import type { ImageEditDoc, ImageEditLayer } from '../schemas/ImageEditDoc.js';

/** Filename used for the persisted editor state inside the sidecar. */
export const IMAGE_EDIT_STATE_FILENAME = 'state.json';

/** Subfolder (inside the sidecar) for embedded asset bytes. */
export const IMAGE_EDIT_ASSETS_PREFIX = 'assets/';

/** Generate a short random layer id. */
function nextLayerId(): string {
  return `layer-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create an empty doc with the given canvas size and no layers.
 *
 * `meta.createdAt` and `meta.updatedAt` are set to the current time so
 * the doc has a complete metadata footprint from the start.
 */
export function createEmptyImageEditDoc(
  width: number,
  height: number,
  options: { background?: string; sourcePath?: string; now?: Date } = {},
): ImageEditDoc {
  const now = (options.now ?? new Date()).toISOString();
  return {
    version: 1,
    canvas: {
      width,
      height,
      background: options.background ?? 'transparent',
    },
    layers: [],
    meta: {
      sourcePath: options.sourcePath,
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Append a layer (top of stack). Assigns an id when missing. */
export function addLayer(doc: ImageEditDoc, layer: ImageEditLayer): ImageEditDoc {
  const withId: ImageEditLayer = layer.id ? layer : { ...layer, id: nextLayerId() };
  return touch({ ...doc, layers: [...doc.layers, withId] });
}

/** Remove the layer with the given id. No-op if not found. */
export function removeLayer(doc: ImageEditDoc, layerId: string): ImageEditDoc {
  const next = doc.layers.filter((l) => l.id !== layerId);
  if (next.length === doc.layers.length) return doc;
  return touch({ ...doc, layers: next });
}

/**
 * Reorder a layer to a new index in the stack. The index is clamped to
 * the valid range; out-of-range / missing layers are no-ops.
 */
export function reorderLayer(doc: ImageEditDoc, layerId: string, toIndex: number): ImageEditDoc {
  const fromIndex = doc.layers.findIndex((l) => l.id === layerId);
  if (fromIndex < 0) return doc;
  const clamped = Math.max(0, Math.min(doc.layers.length - 1, Math.floor(toIndex)));
  if (clamped === fromIndex) return doc;
  const next = doc.layers.slice();
  const [layer] = next.splice(fromIndex, 1);
  next.splice(clamped, 0, layer!);
  return touch({ ...doc, layers: next });
}

/**
 * Replace the layer with the given id by applying a partial update.
 * The patch is shallow-merged at the top level; callers updating
 * `content`, `position`, etc. must spread those sub-objects themselves.
 */
export function updateLayer(
  doc: ImageEditDoc,
  layerId: string,
  patch: Partial<ImageEditLayer>,
): ImageEditDoc {
  let changed = false;
  const next = doc.layers.map((l) => {
    if (l.id !== layerId) return l;
    changed = true;
    return { ...l, ...patch } as ImageEditLayer;
  });
  if (!changed) return doc;
  return touch({ ...doc, layers: next });
}

/** Replace the canvas configuration. */
export function setCanvas(doc: ImageEditDoc, canvas: ImageEditDoc['canvas']): ImageEditDoc {
  return touch({ ...doc, canvas });
}

/** Bump `meta.updatedAt`. Pure: returns a new doc. */
export function touch(doc: ImageEditDoc, now: Date = new Date()): ImageEditDoc {
  return {
    ...doc,
    meta: {
      ...doc.meta,
      createdAt: doc.meta?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    },
  };
}

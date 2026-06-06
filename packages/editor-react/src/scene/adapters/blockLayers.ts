/**
 * blockLayers — read / write a block's free-form Layer[] override.
 *
 * Layouts and drawings need a way to persist arbitrary Layer arrays per
 * block. Rather than add a new heading attribute, we piggy-back on the
 * existing `data-block-attrs` round-trip path by encoding the layers as
 * a base64-JSON Pandoc param named `layers="<...>"`. The bridge already
 * handles `{#id key="value"}` round-tripping verbatim, so the markdown
 * surface picks this up for free.
 *
 * Encoding choice — base64 keeps the JSON's commas, quotes, and braces
 * from clashing with the Pandoc attribute tokenizer. Authors who want
 * to hand-edit raw layer arrays can do so by switching to the raw
 * markdown view, decoding, editing, re-encoding; future work may
 * expose this in a more friendly format (e.g. a fenced `~~~layers`
 * block).
 */

import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Layer } from '@bendyline/squisq/schemas';
import {
  parsePandocAttrTokens,
  serializePandocAttributes,
  type HeadingAttributes,
} from '@bendyline/squisq/markdown';

const LAYERS_PARAM = 'layers';

/** Decode the `layers="..."` param into a Layer[]; returns [] when absent or invalid. */
export function readLayersFromHeading(node: PMNode): Layer[] {
  const attrs = getHeadingAttrs(node);
  const encoded = attrs.params?.[LAYERS_PARAM];
  if (!encoded) return [];
  return decodeLayers(encoded);
}

/** Write a Layer[] back into the heading's `data-block-attrs`. */
export function writeLayersToHeading(
  editor: Editor,
  headingPos: number,
  layers: readonly Layer[],
): boolean {
  return editor
    .chain()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(headingPos);
      if (!node || node.type.name !== 'heading') return false;
      const attrs = getHeadingAttrs(node);
      const params = { ...(attrs.params ?? {}) };
      if (layers.length === 0) {
        delete params[LAYERS_PARAM];
      } else {
        params[LAYERS_PARAM] = encodeLayers(layers);
      }
      const nextAttrs: HeadingAttributes = { ...attrs };
      nextAttrs.params = Object.keys(params).length > 0 ? params : undefined;
      const raw = serializePandocAttributes(nextAttrs);
      tr.setNodeAttribute(headingPos, 'dataBlockAttrs', raw ?? null);
      return true;
    })
    .run();
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return globalThis.btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToUtf8(b64: string): string {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}

/** Base64-encode a Layer array as JSON. UTF-8 safe — handles Unicode layer content. */
export function encodeLayers(layers: readonly Layer[]): string {
  return utf8ToBase64(JSON.stringify(layers));
}

/** Inverse of {@link encodeLayers}. Returns [] when the string isn't valid. */
export function decodeLayers(encoded: string): Layer[] {
  try {
    const parsed = JSON.parse(base64ToUtf8(encoded));
    if (!Array.isArray(parsed)) return [];
    return parsed as Layer[];
  } catch {
    return [];
  }
}

function getHeadingAttrs(node: PMNode): HeadingAttributes {
  const raw = (node.attrs as Record<string, unknown>).dataBlockAttrs;
  if (typeof raw === 'string' && raw.length > 0) return parsePandocAttrTokens(raw);
  return {};
}

/**
 * Apply a per-layer transform to the persisted layer list. Convenience
 * for adapter dispatch functions that need to mutate one layer in place
 * (e.g. `moveLayer`, `setLayerAttr`). The transform receives the
 * matching layer (or `undefined` to insert) and returns the next
 * version (or `null` to remove).
 */
export function updateLayer(
  editor: Editor,
  headingPos: number,
  layerId: string,
  transform: (current: Layer | undefined) => Layer | null,
): boolean {
  const node = editor.state.doc.nodeAt(headingPos);
  if (!node) return false;
  const layers = readLayersFromHeading(node);
  const idx = layers.findIndex((l) => l.id === layerId);
  const current = idx >= 0 ? layers[idx] : undefined;
  const next = transform(current);
  let updated: Layer[];
  if (next == null) {
    updated = layers.filter((l) => l.id !== layerId);
  } else if (idx >= 0) {
    updated = layers.slice();
    updated[idx] = next;
  } else {
    updated = [...layers, next];
  }
  return writeLayersToHeading(editor, headingPos, updated);
}

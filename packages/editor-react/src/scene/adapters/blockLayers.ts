/**
 * blockLayers — read / decode a block's legacy base64 Layer[] blob.
 *
 * **Legacy / migration only.** Layouts (and drawings) now persist every
 * layer as a readable child sub-block heading (see `layoutCommands.ts` /
 * `drawingCommands.ts`); nothing new is written here. These helpers remain
 * so the editor can *read* documents authored before that change and
 * migrate them to child sub-blocks on first edit (see `LayoutAdapter`'s
 * migration effect). `updateLayer` is still used by the in-memory image
 * editor designer.
 *
 * The legacy encoding piggy-backed on the `data-block-attrs` round-trip
 * path by storing the layers as a base64-JSON Pandoc param named
 * `layers="<...>"`. The bridge round-trips `{#id key="value"}` verbatim,
 * so the markdown surface picked this up for free.
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
      // `serializePandocAttributes` returns the full `{…}` block, but
      // `data-block-attrs` stores the INSIDE of those braces (matching the
      // reader `parsePandocAttrTokens` and `tiptapBridge`). Strip them so
      // the value round-trips — otherwise the next read sees `{layers=…}`
      // as a malformed token and drops every layer.
      const raw = serializePandocAttributes(nextAttrs);
      tr.setNodeAttribute(headingPos, 'dataBlockAttrs', stripBraces(raw));
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
 * Strip the wrapping `{…}` from a serialized Pandoc attribute block so it
 * matches the inner form stored in `data-block-attrs`. An empty `{}`
 * marker collapses to `null` (nothing to persist).
 */
function stripBraces(s: string | null): string | null {
  if (s == null) return null;
  if (s === '{}') return null;
  if (s.startsWith('{') && s.endsWith('}')) return s.slice(1, -1);
  return s;
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

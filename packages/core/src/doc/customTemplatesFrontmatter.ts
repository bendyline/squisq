/**
 * Frontmatter serialization for user-defined custom templates.
 *
 * Custom template definitions live in the document's YAML frontmatter
 * under the key `squisq-custom-templates`. The entire array is encoded
 * as a single base64-JSON string — Squisq's frontmatter parser is
 * intentionally flat (key: value only, no nested YAML), so encoding the
 * whole structure into one opaque string is the simplest way to carry
 * arbitrary nested data through that parser.
 *
 * Shape on disk:
 *
 * ```yaml
 * squisq-custom-templates: "<base64-JSON of CustomTemplateDefinition[]>"
 * ```
 *
 * Parser is forgiving: malformed payloads return undefined rather than
 * failing the whole doc load. This matches Squisq's broader "lossy is
 * better than fatal" approach to frontmatter.
 *
 * The exported `encodeLayersForFrontmatter` / `decodeLayersFromFrontmatter`
 * pair handles a single Layer array (used by the editor's
 * `dataLayers="..."` Pandoc param path and re-exported here for
 * consistency). The `read*` / `write*FromFrontmatter` pair handles the
 * whole array of definitions.
 */

import type { Layer } from '../schemas/Doc.js';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';
import { FRONTMATTER_CUSTOM_TEMPLATES_KEY } from '../schemas/CustomTemplates.js';

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

/** Re-export for callers that need the canonical key spelling. */
export { FRONTMATTER_CUSTOM_TEMPLATES_KEY };

/**
 * Base64-encode a Layer array as JSON, UTF-8 safe.
 *
 * `btoa` only accepts Latin1 strings — any character outside the
 * Latin1 range (e.g. an em-dash in a description) throws. We round
 * through `TextEncoder` so the wire format handles arbitrary Unicode
 * (which the user is almost certain to type into a template label or
 * preview text).
 *
 * Works in both Node ≥18 and browsers (both have TextEncoder + btoa
 * on `globalThis`).
 */
export function encodeLayersForFrontmatter(layers: readonly Layer[]): string {
  return utf8ToBase64(JSON.stringify(layers));
}

/** Inverse of {@link encodeLayersForFrontmatter}. Returns [] on parse failure. */
export function decodeLayersFromFrontmatter(encoded: string): Layer[] {
  try {
    const json = base64ToUtf8(encoded);
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Layer[]) : [];
  } catch {
    return [];
  }
}

/** UTF-8 safe `btoa` — uses TextEncoder so arbitrary Unicode round-trips. */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return globalThis.btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

/** UTF-8 safe `atob`. */
function base64ToUtf8(b64: string): string {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}

/**
 * Read the `squisq-custom-templates` frontmatter key and decode it
 * into an array of CustomTemplateDefinitions. Returns undefined when
 * the key is absent so callers can omit the field from the Doc.
 *
 * Two payload shapes are accepted for forward compatibility:
 *   1. A base64-encoded JSON string of `CustomTemplateDefinition[]`
 *      (the canonical v1 shape, produced by `writeCustomTemplatesToFrontmatter`).
 *   2. A plain array of definition objects (in case a future richer
 *      YAML parser delivers structured arrays directly).
 */
export function readCustomTemplatesFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
): CustomTemplateDefinition[] | undefined {
  if (!frontmatter) return undefined;
  const raw = frontmatter[FRONTMATTER_CUSTOM_TEMPLATES_KEY];
  const candidates = normalizeCandidates(raw);
  if (!candidates) return undefined;
  const out: CustomTemplateDefinition[] = [];
  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== 'string' || typeof e.label !== 'string') continue;
    if (!Array.isArray(e.layers)) continue;
    const def: CustomTemplateDefinition = {
      name: e.name,
      label: e.label,
      viewport: readViewport(e.viewport),
      layers: e.layers as Layer[],
    };
    if (typeof e.description === 'string') def.description = e.description;
    out.push(def);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Encode a list of custom template definitions into a single base64-
 * JSON string suitable for the flat frontmatter parser. Returns
 * undefined when the input list is empty so callers can leave the key
 * off the output.
 */
export function writeCustomTemplatesToFrontmatter(
  templates: readonly CustomTemplateDefinition[] | undefined,
): string | undefined {
  if (!templates || templates.length === 0) return undefined;
  const payload = templates.map((def) => ({
    name: def.name,
    label: def.label,
    ...(def.description ? { description: def.description } : {}),
    viewport: def.viewport,
    layers: def.layers,
  }));
  return encodeAsBase64Json(payload);
}

function readViewport(raw: unknown): { width: number; height: number } {
  if (raw && typeof raw === 'object') {
    const v = raw as Record<string, unknown>;
    const w = typeof v.width === 'number' ? v.width : DEFAULT_VIEWPORT.width;
    const h = typeof v.height === 'number' ? v.height : DEFAULT_VIEWPORT.height;
    return { width: w, height: h };
  }
  return DEFAULT_VIEWPORT;
}

/**
 * Accept either a base64-JSON string or a structured array (already
 * decoded by a richer YAML parser). Returns null when the value is
 * neither shape.
 */
function normalizeCandidates(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(base64ToUtf8(raw));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function encodeAsBase64Json(value: unknown): string {
  return utf8ToBase64(JSON.stringify(value));
}

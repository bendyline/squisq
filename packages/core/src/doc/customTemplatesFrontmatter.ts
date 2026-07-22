/**
 * Frontmatter serialization for user-defined custom templates (layouts).
 *
 * Custom template definitions live in the document's YAML frontmatter
 * under the key `squisq-custom-templates`. They're stored as a single
 * **compact JSON** object keyed by template name:
 *
 * ```yaml
 * squisq-custom-templates: {"hero":{"lb":"Hero Section","ly":[{"ty":"text",…}]}}
 * ```
 *
 * Squisq's frontmatter parser is line-based; a JSON object literal
 * round-trips through it verbatim (no leading quote to strip, single
 * line), so the value is written **unquoted** and stays human-readable
 * and diffable — important for a codebase edited by people and agents.
 *
 * The JSON is kept small by:
 *   - keying definitions by `name` (drops the `name` field + array wrapper),
 *   - omitting the viewport when it's the 1920×1080 default,
 *   - renaming well-known property names to two-letter codes via
 *     {@link LONG_TO_SHORT} (e.g. `fontSize` → `fz`).
 *
 * The rename is a generic, recursive, bijective pass: **any property not
 * in the map passes through unchanged**, so the format is lossless even
 * as the Layer schema grows — new fields are simply stored under their
 * full name until (optionally) added to the map.
 *
 * Back-compat: the reader still accepts the historical base64-of-JSON
 * payload and a structured array, so older documents load unchanged.
 * The first save migrates them to the compact form.
 *
 */

import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';
import {
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
  validateCustomTemplateDefinition,
} from '../schemas/CustomTemplates.js';
import { base64ToUtf8 } from '../base64.js';

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

/** Re-export for callers that need the canonical key spelling. */
export { FRONTMATTER_CUSTOM_TEMPLATES_KEY };

// ─── Compact key codec ──────────────────────────────────────────────

/**
 * Long → short property-name map. Values must be unique and must not
 * collide with any real key that passes through unmapped (those are
 * 1-char — `x`/`y`/`d`/`id`/`to` — or full words; the codes here are
 * 2-letter combos, so they never clash). A field literally named like a
 * code (e.g. a real `fz` key) would be the one corruption case — none
 * exist in the schema, and the round-trip test guards against it.
 */
const LONG_TO_SHORT: Readonly<Record<string, string>> = {
  // definition
  label: 'lb',
  description: 'ds',
  viewport: 'vp',
  layers: 'ly',
  name: 'nm',
  // layer
  type: 'ty',
  position: 'po',
  content: 'ct',
  animation: 'am',
  // position
  width: 'wd',
  height: 'hg',
  anchor: 'an',
  // text
  text: 'tx',
  style: 'sy',
  fontSize: 'fz',
  fontFamily: 'ff',
  fontWeight: 'fw',
  color: 'cl',
  textAlign: 'al',
  verticalAlign: 'vl',
  lineHeight: 'lh',
  shadow: 'sd',
  background: 'bg',
  backgroundOpacity: 'bo',
  backgroundGradient: 'bj',
  borderColor: 'bc',
  borderWidth: 'bw',
  borderStyle: 'bs',
  padding: 'pd',
  maxLines: 'mx',
  // shape / path
  shape: 'sp',
  fill: 'fl',
  fillOpacity: 'fo',
  gradient: 'gr',
  stroke: 'sk',
  strokeWidth: 'sw',
  borderRadius: 'br',
  shapeKind: 'kd',
  dasharray: 'da',
  arrow: 'ar',
  startMarker: 'st',
  endMarker: 'em',
  // image
  src: 'sc',
  alt: 'at',
  fit: 'ft',
  credit: 'cr',
  license: 'lc',
  // gradient
  from: 'fr',
  angle: 'ag',
};

const SHORT_TO_LONG: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LONG_TO_SHORT).map(([long, short]) => [short, long]),
);

/** Recursively rename an object's keys via `map`, leaving unmapped keys. */
function renameKeys(value: unknown, map: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(value)) return value.map((v) => renameKeys(v, map));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[map[k] ?? k] = renameKeys(v, map);
    }
    return out;
  }
  return value;
}

function isDefaultViewport(v: { width: number; height: number } | undefined): boolean {
  return !v || (v.width === DEFAULT_VIEWPORT.width && v.height === DEFAULT_VIEWPORT.height);
}

// ─── Definition list read / write ───────────────────────────────────

/**
 * Read the `squisq-custom-templates` frontmatter key and decode it into
 * an array of CustomTemplateDefinitions. Returns undefined when the key
 * is absent or unparseable so callers can omit the field from the Doc.
 *
 * Accepts, in order: the compact JSON object (current), a base64-JSON
 * string (legacy), and an already-structured array/object (in case a
 * richer YAML parser delivers it). Malformed payloads return undefined
 * rather than failing the whole doc load.
 */
export function readCustomTemplatesFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
): CustomTemplateDefinition[] | undefined {
  if (!frontmatter) return undefined;
  const candidates = normalizeCandidates(frontmatter[FRONTMATTER_CUSTOM_TEMPLATES_KEY]);
  if (!candidates) return undefined;
  const out: CustomTemplateDefinition[] = [];
  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const candidate: Record<string, unknown> = {
      name: e.name,
      label: e.label,
      viewport: e.viewport ?? { ...DEFAULT_VIEWPORT },
      layers: e.layers,
    };
    if (e.description !== undefined) candidate.description = e.description;
    const result = validateCustomTemplateDefinition(candidate);
    if (result.template) out.push(result.template);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Encode a list of custom template definitions into the compact JSON
 * object described in the module header. Returns undefined when the
 * input list is empty so callers can leave the key off the output.
 */
export function writeCustomTemplatesToFrontmatter(
  templates: readonly CustomTemplateDefinition[] | undefined,
  options?: { pretty?: boolean },
): string | undefined {
  if (!templates || templates.length === 0) return undefined;
  const map: Record<string, Record<string, unknown>> = {};
  for (const def of templates) {
    const entry: Record<string, unknown> = { lb: def.label };
    if (def.description) entry.ds = def.description;
    if (!isDefaultViewport(def.viewport)) entry.vp = def.viewport;
    entry.ly = renameKeys(def.layers, LONG_TO_SHORT);
    map[def.name] = entry;
  }
  // Pretty output is multi-line, so it rides out as a YAML literal block
  // scalar (see `formatBlockScalar` / stringify's frontmatter path) and
  // parses back via `JSON.parse`. Default stays compact (single line) so
  // existing docs and snapshots are byte-unchanged. The compact key codec
  // (LONG_TO_SHORT) is applied in both modes.
  return JSON.stringify(map, null, options?.pretty ? 2 : undefined);
}

/**
 * Expand the compact, name-keyed map into full-keyed definition objects
 * that {@link readCustomTemplatesFromFrontmatter}'s validation loop
 * understands. The `name` comes from the map key.
 */
function expandCompactMap(map: Record<string, unknown>): unknown[] {
  return Object.entries(map).map(([name, raw]) => {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const def: Record<string, unknown> = {
      name,
      label: e.lb,
      viewport: e.vp ?? { ...DEFAULT_VIEWPORT },
      layers: renameKeys(e.ly ?? [], SHORT_TO_LONG),
    };
    if (typeof e.ds === 'string') def.description = e.ds;
    return def;
  });
}

/** Turn a parsed value into a list of full-keyed definition objects. */
function fromParsed(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed; // legacy structured array
  if (parsed && typeof parsed === 'object')
    return expandCompactMap(parsed as Record<string, unknown>);
  return null;
}

function tryJson(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Normalize any supported payload shape into a list of full-keyed
 * definition objects. Returns null when the value is none of them.
 */
function normalizeCandidates(raw: unknown): unknown[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return expandCompactMap(raw as Record<string, unknown>);
  if (typeof raw !== 'string') return null;

  // Current format: a JSON object/array literal stored verbatim.
  const direct = tryJson(raw.trim());
  if (direct !== undefined) return fromParsed(direct);

  // Legacy format: base64-encoded JSON.
  try {
    const decoded = tryJson(base64ToUtf8(raw));
    if (decoded !== undefined) return fromParsed(decoded);
  } catch {
    // not valid base64 either
  }
  return null;
}

/**
 * Template input descriptors — a typed catalog of the inline `{[…]}` params
 * each built-in template understands, plus the pure coercion + lint logic
 * that consumes it.
 *
 * Two jobs, one source of truth:
 *
 * - **Coercion (`coerceTemplateParams`)** turns a flat `key → raw string`
 *   param map (from a `{[name key=value]}` annotation, always strings) into a
 *   partial typed input the template functions can consume directly — e.g.
 *   `center="47.6,-122.3"` → `{ lat: 47.6, lng: -122.3 }`, `zoom=9` → `9`.
 *   This is what makes `{[map center="47.6,-122.3" zoom=9]}` render with no
 *   changes to any template function. Unknown keys ALWAYS pass through
 *   untouched (as strings), so coercion is never lossy; coercion failures are
 *   returned as `warnings` and the raw string is preserved.
 *
 * - **Linting (`lintTemplateParams`)** checks a param map against the
 *   descriptors and reports unknown keys (with a did-you-mean suggestion),
 *   values outside a closed enum / that fail coercion, and missing required
 *   inputs. The document validator surfaces these as diagnostics.
 *
 * This mirrors the proven block-meta descriptor pattern in
 * `markdown/annotationCoercion.ts` (`BLOCK_META_KEY_DESCRIPTORS`), extended
 * from block geometry/timing to per-template content inputs.
 *
 * The descriptors are the `{[…]}` counterpart of the template input
 * interfaces in `schemas/BlockTemplates.ts` — only keys/enums that provably
 * exist on those interfaces are declared. Keys that can't be meaningfully
 * expressed as a single inline string (e.g. a `dataTable`'s `rows`) are still
 * declared with `coerce: 'string'` so they aren't mis-flagged as unknown.
 */

import { KNOWN_BLOCK_META_KEYS, parseNumber } from '../../markdown/annotationCoercion.js';
import { resolveTemplateName } from './templateNames.js';
import { nearestName } from '../utils/nearest.js';

// ============================================
// Types
// ============================================

/** How a raw `{[…]}` param string is coerced into a typed input value. */
export type InputCoercion =
  | 'string'
  | 'number'
  | 'boolean'
  | 'latLng'
  | 'labeledPair'
  | 'stringList';

/**
 * Editor/validator-facing description of a single template input key: what it
 * does, how to coerce its raw string, and either its closed set of valid
 * values or a free-form format hint. `values`/`valueHint` are mutually
 * exclusive (a key has a closed enum OR a hint, not both).
 */
export interface TemplateInputDescriptor {
  /** The `{[name key=…]}` param key, matching the template input interface. */
  key: string;
  /** One-line description of the input. */
  description: string;
  /** Coercion strategy for the raw string (default `'string'`). */
  coerce?: InputCoercion;
  /** Closed set of valid values, for keys backed by an enum. */
  values?: readonly string[];
  /** Format hint shown when the value is free-form (no closed set). */
  valueHint?: string;
  /** When true, the validator warns if the key is absent and can't be derived. */
  required?: boolean;
}

/** A single lint finding produced by {@link lintTemplateParams}. */
export interface TemplateParamFinding {
  kind: 'unknown-input' | 'invalid-input-value' | 'missing-input';
  key: string;
  message: string;
  /** Did-you-mean candidate (for `unknown-input`). */
  suggestion?: string;
}

// ============================================
// Shared enum vocabularies (verified against BlockTemplates.ts)
// ============================================

/** `ambientMotion` on image/video/map templates. */
const AMBIENT_MOTION_VALUES = ['zoomIn', 'zoomOut', 'panLeft', 'panRight'] as const;
/** `captionPosition` on imageWithCaption / videoWithCaption. */
const CAPTION_POSITION_VALUES = ['bottom', 'top', 'center'] as const;
/** `mapStyle` — mirrors `MapTileStyle` in `schemas/Doc.ts`. */
const MAP_STYLE_VALUES = ['terrain', 'satellite', 'road', 'toner', 'watercolor'] as const;
/** `mood` on dateEvent. */
const DATE_EVENT_MOOD_VALUES = ['neutral', 'somber', 'celebratory'] as const;

/** Shared free-form hint for `colorScheme`-style keys. */
const COLOR_SCHEME_HINT = "theme color-scheme name — e.g. 'blue', 'green'";

/**
 * Shared descriptors for the chart templates (all render through the same
 * engine and accept the same column-role params). `extra` appends
 * kind-specific keys (bar/column add `stacked`).
 */
function CHART_DESCRIPTORS(
  extra: readonly TemplateInputDescriptor[] = [],
): readonly TemplateInputDescriptor[] {
  return [
    { key: 'title', description: 'Optional title above the chart' },
    {
      key: 'labelColumn',
      description: 'Category/label column',
      valueHint: 'header name or 0-based index',
    },
    {
      key: 'valueColumns',
      description: 'Value columns to plot',
      coerce: 'stringList',
      valueHint: 'comma-separated header names or 0-based indexes',
    },
    {
      key: 'showTable',
      description: 'Render the source table beneath the chart',
      coerce: 'boolean',
    },
    { key: 'showLegend', description: 'Show a series legend', coerce: 'boolean' },
    { key: 'showValues', description: 'Print numeric value labels on marks', coerce: 'boolean' },
    { key: 'unit', description: 'Unit suffix for tick/value labels (e.g. "km")' },
    {
      key: 'colorScheme',
      description: 'Color scheme seeding the series color rotation',
      valueHint: COLOR_SCHEME_HINT,
    },
    // `headers`/`rows` are normally derived from the block's markdown table;
    // declared so data-fence-supplied values aren't flagged as unknown.
    {
      key: 'headers',
      description: 'Header cells (normally derived from the table)',
      coerce: 'stringList',
    },
    { key: 'rows', description: 'Table rows (supply via a data fence)' },
    ...DATA_SRC_DESCRIPTORS(),
    { key: 'sheet', description: 'Worksheet inside the src workbook (XLSX src only)' },
    {
      key: 'anchor',
      description: "Top-left cell of the region inside the src workbook, e.g. 'B7'",
    },
    {
      key: 'headerRow',
      description: 'Whether row 1 of the source region is a header row',
      coerce: 'boolean',
    },
    ...extra,
  ];
}

/**
 * Sidecar data-source params shared by `dataTable` and the chart family.
 * `src` names a container-relative data file whose contents are resolved
 * into a bounded preview by `resolveDataReferences` before projection.
 */
function DATA_SRC_DESCRIPTORS(): readonly TemplateInputDescriptor[] {
  return [
    {
      key: 'src',
      description:
        'Container path to a sidecar data file (.csv/.tsv/.xlsx/.parquet) supplying the table',
    },
    {
      key: 'previewRows',
      description: 'Max data rows resolved from src for the bounded preview',
      coerce: 'number',
    },
    // Written by `resolveDataReferences` onto templateData (totalRows/totalCols/
    // previewRows/truncated) — declared so resolved docs don't lint as unknown.
    { key: 'srcStats', description: 'Preview stats recorded by data-reference resolution' },
    // Non-destructive view state over the src data (see @bendyline/squisq/table
    // for the grammar) — applied by the readers before windowing, so previews
    // and exports show the author's curated view.
    {
      key: 'sort',
      description: "Sort order over src data: 'Col:desc,Other' (quote names containing , or :)",
    },
    {
      key: 'filter',
      description:
        "Row filter over src data: 'Col=value;Other>=10' (ops = != > < >= <= ~ !~; AND only)",
    },
  ];
}

/** `stacked` on bar/column charts. */
const STACKED_DESCRIPTOR: TemplateInputDescriptor = {
  key: 'stacked',
  description: 'Stack series instead of grouping them side by side',
  coerce: 'boolean',
};

// ============================================
// Descriptor tables
// ============================================

/**
 * Inputs shared by every template via `BaseTemplateBlock`. Merged into each
 * template's known-key set for coercion + lint. Block-level timing/geometry
 * keys (`duration`, `x`, `y`, …) are NOT here — those stay owned by the
 * block-meta registry (`KNOWN_BLOCK_META_KEYS`) and are folded into the lint
 * known-key set separately.
 */
export const BASE_INPUT_DESCRIPTORS: readonly TemplateInputDescriptor[] = [
  {
    key: 'imageTreatment',
    description: "Per-block photographic grade override ('none' opts out)",
    values: ['none', 'mono', 'duotone', 'warm', 'cool'],
  },
  {
    key: 'useBottomLayer',
    description: "Show the doc's bottom persistent layers",
    coerce: 'boolean',
  },
  { key: 'useTopLayer', description: "Show the doc's top persistent layers", coerce: 'boolean' },
];

/**
 * Per-template input descriptors, keyed by canonical template id. A template
 * absent from this map has no descriptors and is exempt from lint (custom
 * templates and not-yet-described built-ins).
 */
export const TEMPLATE_INPUT_DESCRIPTORS: Readonly<
  Record<string, readonly TemplateInputDescriptor[]>
> = {
  title: [
    { key: 'title', description: 'Main title text' },
    { key: 'subtitle', description: 'Subtitle or tagline' },
    { key: 'backgroundColor', description: 'Background color', valueHint: 'CSS color' },
  ],
  sectionHeader: [
    { key: 'title', description: 'Section title' },
    {
      key: 'colorScheme',
      description: 'Fallback background color scheme',
      valueHint: COLOR_SCHEME_HINT,
    },
    { key: 'imageSrc', description: 'Optional background image path' },
    { key: 'imageAlt', description: 'Alt text for the background image' },
    { key: 'ambientMotion', description: 'Slow zoom/pan effect', values: AMBIENT_MOTION_VALUES },
  ],
  bigText: [
    { key: 'title', description: 'The display text (rendered uppercase)' },
    { key: 'imageSrc', description: 'Optional full-bleed background image path' },
    { key: 'imageAlt', description: 'Alt text for the background image' },
    { key: 'ambientMotion', description: 'Slow zoom/pan effect', values: AMBIENT_MOTION_VALUES },
  ],
  content: [{ key: 'title', description: 'Heading shown above the complete body' }],
  statHighlight: [
    { key: 'stat', description: 'The statistic (e.g. "89%", "2x")' },
    { key: 'description', description: 'What the stat means' },
    { key: 'detail', description: 'Additional detail or context' },
    { key: 'colorScheme', description: 'Color scheme for the stat', valueHint: COLOR_SCHEME_HINT },
  ],
  quote: [
    { key: 'title', description: 'Optional heading above the quote' },
    { key: 'quote', description: 'The quote text' },
    { key: 'attribution', description: 'Attribution (author, source)' },
  ],
  pullQuote: [
    { key: 'text', description: 'Quote text' },
    { key: 'attribution', description: 'Attribution' },
  ],
  twoColumn: [
    {
      key: 'left',
      description: 'Left column, as "label|sublabel"',
      coerce: 'labeledPair',
      required: true,
    },
    {
      key: 'right',
      description: 'Right column, as "label|sublabel"',
      coerce: 'labeledPair',
      required: true,
    },
    { key: 'header', description: 'Optional header above the columns' },
    { key: 'leftColor', description: 'Left column color scheme', valueHint: COLOR_SCHEME_HINT },
    { key: 'rightColor', description: 'Right column color scheme', valueHint: COLOR_SCHEME_HINT },
  ],
  dateEvent: [
    { key: 'date', description: 'The date (e.g. "July 14, 1974")' },
    { key: 'description', description: 'What happened' },
    { key: 'footer', description: 'Optional footer text' },
    { key: 'mood', description: 'Emotional tone', values: DATE_EVENT_MOOD_VALUES },
  ],
  imageWithCaption: [
    { key: 'imageSrc', description: 'Path to the image file', required: true },
    { key: 'imageAlt', description: 'Alt text for accessibility' },
    { key: 'caption', description: 'Caption text' },
    { key: 'captionPosition', description: 'Caption placement', values: CAPTION_POSITION_VALUES },
    { key: 'ambientMotion', description: 'Slow zoom/pan effect', values: AMBIENT_MOTION_VALUES },
    { key: 'isTitle', description: 'Style the caption as a title', coerce: 'boolean' },
    { key: 'subtitle', description: 'Subtitle (only when isTitle)' },
    { key: 'imageCredit', description: 'Photo credit / artist name' },
    { key: 'imageLicense', description: 'License identifier' },
  ],
  leftFeature: FEATURE_DESCRIPTORS(),
  rightFeature: FEATURE_DESCRIPTORS(),
  map: [
    {
      key: 'center',
      description: 'Map center as "lat,lng"',
      coerce: 'latLng',
      required: true,
    },
    { key: 'zoom', description: 'Zoom level (4-16)', coerce: 'number' },
    { key: 'mapStyle', description: 'Map tile style', values: MAP_STYLE_VALUES },
    { key: 'title', description: 'Optional title overlay' },
    { key: 'caption', description: 'Optional caption' },
  ],
  photoGrid: [
    { key: 'images', description: 'Comma-separated image paths', coerce: 'stringList' },
    { key: 'caption', description: 'Optional caption below the grid' },
    {
      key: 'ambientMotion',
      description: 'Slow zoom/pan on the largest image',
      values: AMBIENT_MOTION_VALUES,
    },
  ],
  comparisonBar: [
    { key: 'leftLabel', description: 'Left bar label', required: true },
    { key: 'leftValue', description: 'Left bar numeric value', coerce: 'number', required: true },
    { key: 'rightLabel', description: 'Right bar label', required: true },
    { key: 'rightValue', description: 'Right bar numeric value', coerce: 'number', required: true },
    { key: 'unit', description: 'Unit label (e.g. "km")' },
    { key: 'colorScheme', description: 'Color scheme', valueHint: COLOR_SCHEME_HINT },
  ],
  dataTable: [
    { key: 'title', description: 'Optional title above the table' },
    { key: 'headers', description: 'Comma-separated header cells', coerce: 'stringList' },
    // `rows`/`align` are structured (string[][] / alignment[]) and can't be
    // expressed as a single inline string — declared so they aren't flagged
    // as unknown when supplied via a data fence's overriding params.
    { key: 'rows', description: 'Table rows (supply via a data fence)' },
    { key: 'align', description: 'Per-column alignment (supply via a data fence)' },
    { key: 'colorScheme', description: 'Header color scheme', valueHint: COLOR_SCHEME_HINT },
    // Spreadsheet provenance. These do not affect rendering — they record where
    // a table came from so `markdownDocToXlsx` can put it back at the right
    // address instead of piling every table at A1. Declared here for the same
    // reason `rows`/`align` are: so a round-tripped XLSX import doesn't light up
    // with `unknown-input` warnings.
    { key: 'sheet', description: 'Source worksheet name (XLSX round-trip)' },
    { key: 'anchor', description: "Top-left cell of the region, e.g. 'B7'" },
    {
      key: 'role',
      description: 'What the table holds within its region',
      values: ['values', 'formulas', 'loose'],
    },
    {
      key: 'headerRow',
      description: 'Whether row 1 of the source region is a header row',
      coerce: 'boolean',
    },
    { key: 'titleAnchor', description: 'Cell this heading text was absorbed from' },
    // Sidecar data source (see DATA_SRC_DESCRIPTORS): `src` points at a
    // container data file; `sheet`/`anchor`/`headerRow` above double as the
    // in-workbook address when src names an .xlsx.
    ...DATA_SRC_DESCRIPTORS(),
  ],
  barChart: CHART_DESCRIPTORS([STACKED_DESCRIPTOR]),
  columnChart: CHART_DESCRIPTORS([STACKED_DESCRIPTOR]),
  pieChart: CHART_DESCRIPTORS(),
  donutChart: CHART_DESCRIPTORS(),
  lineChart: CHART_DESCRIPTORS(),
  areaChart: CHART_DESCRIPTORS(),
  scatterChart: CHART_DESCRIPTORS(),
  tree: [
    { key: 'title', description: 'Optional title above the tree' },
    { key: 'colorScheme', description: 'Folder-row color scheme', valueHint: COLOR_SCHEME_HINT },
    // `items` is a nested structure derived from the tree fence, not an
    // inline string — declared so it isn't flagged as unknown.
    { key: 'items', description: 'Tree items (derived from the tree fence)' },
  ],
  timeline: [
    { key: 'title', description: 'Optional title above the timeline' },
    {
      key: 'colorScheme',
      description: 'Track and marker color scheme',
      valueHint: COLOR_SCHEME_HINT,
    },
    // Tracks/events and branch links are nested structures derived from the
    // timeline source, not values that can be expressed as one inline string.
    { key: 'tracks', description: 'Timeline tracks and events (supply via template data)' },
    { key: 'links', description: 'Branch links between event ids (supply via template data)' },
  ],
  videoWithCaption: [
    { key: 'videoSrc', description: 'Path to the video file', required: true },
    { key: 'posterSrc', description: 'Poster frame path' },
    { key: 'videoAlt', description: 'Alt text for accessibility' },
    { key: 'clipStart', description: 'Clip start time (seconds)', coerce: 'number' },
    { key: 'clipEnd', description: 'Clip end time (seconds)', coerce: 'number' },
    { key: 'caption', description: 'Caption text' },
    { key: 'captionPosition', description: 'Caption placement', values: CAPTION_POSITION_VALUES },
    { key: 'videoCredit', description: 'Video credit / artist name' },
    { key: 'videoLicense', description: 'License identifier' },
  ],
};

/** Shared descriptor list for `leftFeature`/`rightFeature` (identical inputs). */
function FEATURE_DESCRIPTORS(): readonly TemplateInputDescriptor[] {
  return [
    { key: 'imageSrc', description: 'Path to the feature image', required: true },
    { key: 'imageAlt', description: 'Alt text for accessibility' },
    { key: 'imageWidth', description: 'Explicit display width in px', coerce: 'number' },
    { key: 'imageHeight', description: 'Explicit display height in px', coerce: 'number' },
    { key: 'title', description: 'Heading text next to the image' },
    { key: 'body', description: 'Body text below the title' },
  ];
}

// ============================================
// Descriptor lookup
// ============================================

/** All descriptors (template-specific + base) for a canonical template id. */
function descriptorsFor(canonical: string): readonly TemplateInputDescriptor[] | undefined {
  const specific = TEMPLATE_INPUT_DESCRIPTORS[canonical];
  if (!specific) return undefined;
  return [...specific, ...BASE_INPUT_DESCRIPTORS];
}

function descriptorMap(
  descriptors: readonly TemplateInputDescriptor[],
): Map<string, TemplateInputDescriptor> {
  return new Map(descriptors.map((d) => [d.key, d]));
}

// ============================================
// Coercion (M2)
// ============================================

/**
 * Coerce a flat `{[…]}` param map into a partial typed template input.
 *
 * Known descriptor keys are coerced per their `coerce` strategy; unknown keys
 * (and `string`-typed keys) pass through unchanged. A coercion failure leaves
 * the raw string in place and adds a human-readable `warnings` entry — the
 * output is never lossy. Returns a fresh object; the caller must NOT feed
 * `templateOverrides` back in — only the ephemeral merged input is coerced.
 */
export function coerceTemplateParams(
  template: string | undefined,
  params: Record<string, string>,
): { input: Record<string, unknown>; warnings: string[] } {
  const input: Record<string, unknown> = {};
  const warnings: string[] = [];
  const descriptors = template ? descriptorsFor(resolveTemplateName(template)) : undefined;
  const byKey = descriptors ? descriptorMap(descriptors) : undefined;

  for (const [key, raw] of Object.entries(params)) {
    const coerce = byKey?.get(key)?.coerce ?? 'string';
    const { value, warning } = coerceValue(coerce, raw);
    if (warning) {
      warnings.push(`"${key}": ${warning}`);
      input[key] = raw; // preserve the raw string on failure
    } else {
      input[key] = value;
    }
  }

  return { input, warnings };
}

/** Coerce one raw string per a coercion kind. `warning` set on failure. */
function coerceValue(coerce: InputCoercion, raw: string): { value: unknown; warning?: string } {
  switch (coerce) {
    case 'number': {
      const n = parseNumber(raw);
      return n == null
        ? { value: raw, warning: `not a number (${JSON.stringify(raw)})` }
        : { value: n };
    }
    case 'boolean':
      return coerceBoolean(raw);
    case 'latLng':
      return coerceLatLng(raw);
    case 'labeledPair':
      return { value: coerceLabeledPair(raw) };
    case 'stringList':
      return { value: coerceStringList(raw) };
    case 'string':
    default:
      return { value: raw };
  }
}

/** `'true'`/`''` (bare flag) → true, `'false'` → false; anything else fails. */
function coerceBoolean(raw: string): { value: unknown; warning?: string } {
  const t = raw.trim().toLowerCase();
  if (t === 'true' || t === '') return { value: true };
  if (t === 'false') return { value: false };
  return { value: raw, warning: `not a boolean (${JSON.stringify(raw)}) — expected true or false` };
}

/** `"47.6,-122.3"` → `{ lat, lng }`; malformed → failure (raw preserved). */
function coerceLatLng(raw: string): { value: unknown; warning?: string } {
  const parts = raw.split(',');
  if (parts.length === 2) {
    const lat = parseNumber(parts[0]);
    const lng = parseNumber(parts[1]);
    if (lat != null && lng != null) return { value: { lat, lng } };
  }
  return { value: raw, warning: `not a "lat,lng" pair (${JSON.stringify(raw)})` };
}

/** `"Label|Sub"` → `{ label, sublabel? }`; sublabel omitted when empty. */
function coerceLabeledPair(raw: string): { label: string; sublabel?: string } {
  const sep = raw.indexOf('|');
  if (sep < 0) return { label: raw.trim() };
  const label = raw.slice(0, sep).trim();
  const sublabel = raw.slice(sep + 1).trim();
  return sublabel ? { label, sublabel } : { label };
}

/** `"a, b ,c"` → `['a','b','c']` (trimmed, empties dropped). */
function coerceStringList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ============================================
// Linting (M5)
// ============================================

/**
 * Lint a template's `{[…]}` params against its descriptors. Returns findings
 * for unknown keys, values outside a closed enum / that fail coercion, and
 * missing required inputs. Templates without descriptors (custom or
 * not-yet-described built-ins) return `[]`.
 */
export function lintTemplateParams(
  template: string,
  params: Record<string, string>,
): TemplateParamFinding[] {
  const canonical = resolveTemplateName(template);
  const specific = TEMPLATE_INPUT_DESCRIPTORS[canonical];
  if (!specific) return [];

  const findings: TemplateParamFinding[] = [];
  const allDescriptors = [...specific, ...BASE_INPUT_DESCRIPTORS];
  const byKey = descriptorMap(allDescriptors);
  // Known keys for did-you-mean: descriptor keys ∪ block-meta keys (which are
  // honored on the same annotation, e.g. `duration`, `transition`).
  const knownKeys = new Set<string>([...byKey.keys(), ...Object.keys(KNOWN_BLOCK_META_KEYS)]);

  for (const [key, raw] of Object.entries(params)) {
    const descriptor = byKey.get(key);
    if (!descriptor) {
      if (knownKeys.has(key)) continue; // block-meta key — valid, not a template input
      const suggestion = nearestName(key, knownKeys);
      findings.push({
        kind: 'unknown-input',
        key,
        message:
          `Unknown input "${key}" for template "${canonical}"` +
          (suggestion ? `. Did you mean "${suggestion}"?` : ''),
        ...(suggestion ? { suggestion } : {}),
      });
      continue;
    }

    // Value validation: closed enum first, then coercion.
    if (descriptor.values) {
      const v = raw.trim();
      if (v !== '' && !descriptor.values.includes(v)) {
        findings.push({
          kind: 'invalid-input-value',
          key,
          message: `Invalid value ${JSON.stringify(raw)} for "${key}" — expected one of: ${descriptor.values.join(', ')}`,
        });
      }
    } else if (descriptor.coerce && descriptor.coerce !== 'string') {
      const { warning } = coerceValue(descriptor.coerce, raw);
      if (warning) {
        findings.push({ kind: 'invalid-input-value', key, message: `"${key}": ${warning}` });
      }
    }
  }

  // Missing required inputs (checked over template-specific descriptors only;
  // base inputs are never required).
  for (const descriptor of specific) {
    if (descriptor.required && params[descriptor.key] == null) {
      findings.push({
        kind: 'missing-input',
        key: descriptor.key,
        message: `Missing required input "${descriptor.key}" for template "${canonical}"`,
      });
    }
  }

  return findings;
}

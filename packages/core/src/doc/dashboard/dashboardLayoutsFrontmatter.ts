/**
 * Frontmatter serialization for user-defined dashboard layouts.
 *
 * Custom layout definitions live in the document's YAML frontmatter under
 * `squisq-dashboard-layouts` as a single **compact JSON** object keyed by
 * layout name (the exact convention `squisq-custom-templates` uses — see
 * `customTemplatesFrontmatter.ts` for the rationale):
 *
 * ```yaml
 * squisq-dashboard-layouts: {"kpi-wall":{"lb":"KPI Wall","ce":{"ls":[{"x":"0%","y":"0%","wd":"50%","hg":"100%","bk":1},…]}}}
 * ```
 *
 * The value is written unquoted on a single line so the line-based
 * frontmatter parser round-trips it verbatim. Well-known property names
 * shrink to two-letter codes via {@link LONG_TO_SHORT}; unmapped keys pass
 * through unchanged, so the format stays lossless as the schema grows.
 */

import type { DashboardLayoutDefinition } from './DashboardLayout.js';
import { validateDashboardLayoutDefinition } from './DashboardLayout.js';

/** Canonical frontmatter key for custom dashboard layouts. */
export const FRONTMATTER_DASHBOARD_LAYOUTS_KEY = 'squisq-dashboard-layouts';

/**
 * Long → short property-name map for the dashboard layout schema. Kept
 * separate from the custom-template map — the schemas evolve independently.
 * `x`/`y` pass through unmapped (already minimal).
 */
const LONG_TO_SHORT: Readonly<Record<string, string>> = {
  label: 'lb',
  description: 'ds',
  cells: 'ce',
  landscape: 'ls',
  portrait: 'pt',
  square: 'sq',
  width: 'wd',
  height: 'hg',
  block: 'bk',
  zoom: 'zo',
  titleSlot: 'ts',
  placement: 'pl',
  auto: 'au',
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

/**
 * Read the `squisq-dashboard-layouts` key into validated layout
 * definitions. Returns undefined when the key is absent or unparseable;
 * individual malformed entries are dropped rather than failing the doc.
 */
export function readDashboardLayoutsFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
): DashboardLayoutDefinition[] | undefined {
  if (!frontmatter) return undefined;
  const candidates = normalizeCandidates(frontmatter[FRONTMATTER_DASHBOARD_LAYOUTS_KEY]);
  if (!candidates) return undefined;
  const out: DashboardLayoutDefinition[] = [];
  for (const entry of candidates) {
    const result = validateDashboardLayoutDefinition(entry);
    if (result.layout) out.push(result.layout);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Encode layout definitions into the compact JSON object described in the
 * module header. Returns undefined for an empty list so callers can omit
 * the key entirely.
 */
export function writeDashboardLayoutsToFrontmatter(
  layouts: readonly DashboardLayoutDefinition[] | undefined,
  options?: { pretty?: boolean },
): string | undefined {
  if (!layouts || layouts.length === 0) return undefined;
  const map: Record<string, unknown> = {};
  for (const def of layouts) {
    const { name, ...rest } = def;
    map[name] = renameKeys(rest, LONG_TO_SHORT);
  }
  return JSON.stringify(map, null, options?.pretty ? 2 : undefined);
}

/** Expand the compact, name-keyed map into full-keyed definition objects. */
function expandCompactMap(map: Record<string, unknown>): unknown[] {
  return Object.entries(map).map(([name, raw]) => {
    const expanded = renameKeys(raw && typeof raw === 'object' ? raw : {}, SHORT_TO_LONG);
    return { name, ...(expanded as Record<string, unknown>) };
  });
}

function fromParsed(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed; // structured array of full definitions
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
 * Normalize any supported payload shape (compact object, structured array,
 * or a raw JSON string) into full-keyed definition objects.
 */
function normalizeCandidates(raw: unknown): unknown[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return expandCompactMap(raw as Record<string, unknown>);
  if (typeof raw !== 'string') return null;
  const parsed = tryJson(raw.trim());
  if (parsed !== undefined) return fromParsed(parsed);
  return null;
}

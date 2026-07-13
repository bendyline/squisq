import { getTransformStyleSummaries } from '@bendyline/squisq/transform';

const VALID_TRANSFORM_IDS = new Set(getTransformStyleSummaries().map((summary) => summary.id));

/**
 * Normalize a transform id read from document frontmatter.
 *
 * `dataDriven` was written by older Squisq versions. It remains accepted as a
 * wire-format compatibility value, but every editor surface exposes and writes
 * only the canonical `data-driven` id.
 */
export function resolvePersistedTransformStyleId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  if (normalized === 'datadriven') return 'data-driven';
  return VALID_TRANSFORM_IDS.has(normalized) ? normalized : null;
}

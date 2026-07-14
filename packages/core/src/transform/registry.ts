/**
 * Transform Style Registry
 *
 * Immutable built-in lookup plus explicit caller-owned custom registries.
 * There is deliberately no process-global mutable registry.
 */

import type { TransformStyleConfig, TransformStyleInput, TransformStyleRegistry } from './types.js';
import { documentaryStyle } from './styles/documentary.js';
import { magazineStyle } from './styles/magazine.js';
import { dataDrivenStyle } from './styles/dataDriven.js';
import { narrativeStyle } from './styles/narrative.js';
import { minimalStyle } from './styles/minimal.js';
import { cloneAndFreezeData } from '../internal/immutable.js';

/** All built-in transform styles, keyed by id. */
const TRANSFORM_STYLES: Readonly<Record<string, TransformStyleConfig>> = Object.freeze({
  [documentaryStyle.id]: cloneAndFreezeData(documentaryStyle),
  [magazineStyle.id]: cloneAndFreezeData(magazineStyle),
  [dataDrivenStyle.id]: cloneAndFreezeData(dataDrivenStyle),
  [narrativeStyle.id]: cloneAndFreezeData(narrativeStyle),
  [minimalStyle.id]: cloneAndFreezeData(minimalStyle),
});

/** Default style used when no id is provided. */
export const DEFAULT_TRANSFORM_STYLE_ID = 'documentary';

const EXTRACTION_TYPES = new Set([
  'stat',
  'date',
  'quote',
  'comparison',
  'fact',
  'impactLine',
  'list',
  'definition',
]);
const TRANSITION_STYLES = new Set(['cut', 'fade', 'dissolve', 'mixed']);

function validateTransformStyle(style: TransformStyleConfig): void {
  const candidate = style as unknown as Record<string, unknown>;
  const fail = (message: string): never => {
    throw new TypeError(`Invalid transform style: ${message}`);
  };
  for (const key of ['id', 'name', 'description']) {
    if (typeof candidate[key] !== 'string' || !(candidate[key] as string).trim()) {
      fail(`${key} must be a non-empty string`);
    }
  }
  for (const key of ['minConfidence', 'transformRatio']) {
    const value = candidate[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      fail(`${key} must be a finite number between 0 and 1`);
    }
  }
  if (
    !Array.isArray(candidate.preferredTypes) ||
    candidate.preferredTypes.some((type) => !EXTRACTION_TYPES.has(type))
  ) {
    fail('preferredTypes contains an unknown extraction type');
  }
  if (
    !Array.isArray(candidate.colorSchemes) ||
    candidate.colorSchemes.length === 0 ||
    candidate.colorSchemes.some((scheme) => typeof scheme !== 'string' || !scheme)
  ) {
    fail('colorSchemes must contain at least one non-empty string');
  }
  for (const key of ['insertSectionHeaders', 'interleaveImages']) {
    if (typeof candidate[key] !== 'boolean') fail(`${key} must be a boolean`);
  }
  const blocks = candidate.blocksPerSection as { max?: unknown } | undefined;
  if (!blocks || !Number.isInteger(blocks.max) || (blocks.max as number) < 1) {
    fail('blocksPerSection.max must be a positive integer');
  }
  if (
    typeof candidate.transitionStyle !== 'string' ||
    !TRANSITION_STYLES.has(candidate.transitionStyle)
  ) {
    fail('transitionStyle must be cut, fade, dissolve, or mixed');
  }
  const templateMap = candidate.templateMap;
  if (templateMap !== undefined) {
    if (!templateMap || typeof templateMap !== 'object' || Array.isArray(templateMap)) {
      fail('templateMap must be an object');
    }
    for (const [type, template] of Object.entries(templateMap as Record<string, unknown>)) {
      if (!EXTRACTION_TYPES.has(type) || typeof template !== 'string' || !template) {
        fail('templateMap must map known extraction types to non-empty template names');
      }
    }
  }
  if (
    candidate.suggestedThemeId !== undefined &&
    (typeof candidate.suggestedThemeId !== 'string' || !candidate.suggestedThemeId)
  ) {
    fail('suggestedThemeId must be a non-empty string');
  }
  const pacingValue = candidate.pacing;
  if (pacingValue !== undefined) {
    if (!pacingValue || typeof pacingValue !== 'object' || Array.isArray(pacingValue)) {
      fail('pacing must be an object');
    }
    const pacing = pacingValue as { intro?: unknown; outro?: unknown };
    for (const key of ['intro', 'outro'] as const) {
      if (pacing[key] !== undefined && typeof pacing[key] !== 'boolean') {
        fail(`pacing.${key} must be a boolean`);
      }
    }
  }
  const budget = candidate.budget as { slidesPerMinute?: unknown } | undefined;
  if (
    candidate.budget !== undefined &&
    (!budget || typeof budget !== 'object' || Array.isArray(budget))
  ) {
    fail('budget must be an object');
  }
  if (budget && budget.slidesPerMinute !== undefined) {
    const value = budget.slidesPerMinute;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      fail('budget.slidesPerMinute must be a positive finite number');
    }
  }
  const pageValue = candidate.page;
  if (pageValue !== undefined) {
    if (!pageValue || typeof pageValue !== 'object' || Array.isArray(pageValue)) {
      fail('page must be an object');
    }
    const page = pageValue as { spacing?: unknown; emphasisCurve?: unknown };
    if (
      page.spacing !== undefined &&
      !['compact', 'comfortable', 'generous'].includes(page.spacing as string)
    ) {
      fail('page.spacing must be compact, comfortable, or generous');
    }
    if (
      page.emphasisCurve !== undefined &&
      !['even', 'front-loaded'].includes(page.emphasisCurve as string)
    ) {
      fail('page.emphasisCurve must be even or front-loaded');
    }
  }
}

function styleSnapshot(style: TransformStyleConfig): TransformStyleConfig {
  validateTransformStyle(style);
  return cloneAndFreezeData(style);
}

/** Stored documents emitted before the canonical kebab-case id. Not exported. */
function normalizeBuiltinStyleId(id: string): string {
  return id === 'dataDriven' ? 'data-driven' : id;
}

function resolveBuiltinStyle(id: string): TransformStyleConfig {
  return (
    TRANSFORM_STYLES[normalizeBuiltinStyleId(id)] ?? TRANSFORM_STYLES[DEFAULT_TRANSFORM_STYLE_ID]
  );
}

/**
 * Create a caller-owned registry. Custom styles are validated, cloned, and
 * deeply frozen at registration time. Built-in resolution remains in the
 * top-level helpers, separate from the registry's caller-owned state.
 */
export function createTransformStyleRegistry(
  initialStyles: readonly TransformStyleConfig[] = [],
): TransformStyleRegistry {
  const registeredStyles = new Map<string, TransformStyleConfig>();
  const registry: TransformStyleRegistry = {
    register(style): void {
      const snapshot = styleSnapshot(style);
      registeredStyles.set(snapshot.id, snapshot);
    },
    unregister(id): boolean {
      return registeredStyles.delete(id);
    },
    get(id): TransformStyleConfig | undefined {
      return registeredStyles.get(id);
    },
    list(): TransformStyleConfig[] {
      return Array.from(registeredStyles.values());
    },
  };
  for (const style of initialStyles) registry.register(style);
  return Object.freeze(registry);
}

/**
 * Resolve a built-in id, explicit-registry id, or call-scoped style config.
 * Unknown ids fall back to the default style.
 */
export function resolveTransformStyle(
  style: TransformStyleInput,
  registry?: TransformStyleRegistry,
): TransformStyleConfig {
  if (typeof style !== 'string') return styleSnapshot(style);
  return registry?.get(style) ?? resolveBuiltinStyle(style);
}

/** Get built-in ids plus ids from an optional caller-owned registry. */
export function getTransformStyleIds(registry?: TransformStyleRegistry): string[] {
  return Array.from(
    new Set([
      ...Object.keys(TRANSFORM_STYLES),
      ...(registry?.list().map((style) => style.id) ?? []),
    ]),
  );
}

/** Get summaries for built-ins plus an optional caller-owned registry. */
export function getTransformStyleSummaries(registry?: TransformStyleRegistry) {
  return getTransformStyleIds(registry).map((id) => {
    const { name, description } = resolveTransformStyle(id, registry);
    return { id, name, description };
  });
}

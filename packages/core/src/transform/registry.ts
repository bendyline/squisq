/**
 * Transform Style Registry
 *
 * Central registry of built-in transform styles plus a dynamic
 * registration API. Follows the same pattern as themeLibrary.ts /
 * `registerTheme` — registered styles take precedence over built-ins,
 * unknown ids fall back to the default.
 */

import type { TransformStyleConfig, TransformStyleSummary } from './types.js';
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

/**
 * Id aliases: the data-driven style's file/export are named `dataDriven`
 * but its registered id is hyphenated — accept both.
 */
const STYLE_ALIASES: Record<string, string> = {
  dataDriven: 'data-driven',
};

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
    throw new TypeError(`Cannot register invalid transform style: ${message}`);
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
}

/** An isolated registry for SSR tenants, tests, and embedded consumers. */
export interface TransformStyleRegistry {
  registerTransformStyle(style: TransformStyleConfig): void;
  unregisterTransformStyle(id: string): void;
  resolveTransformStyle(id: string): TransformStyleConfig;
  getTransformStyleIds(): string[];
  getTransformStyleSummaries(): TransformStyleSummary[];
}

/**
 * Create a caller-owned registry. Custom styles are validated, cloned, and
 * deeply frozen at registration time; built-in styles remain available as
 * fallbacks just like they are through the process-global API.
 */
export function createTransformStyleRegistry(
  initialStyles: readonly TransformStyleConfig[] = [],
): TransformStyleRegistry {
  const registeredStyles = new Map<string, TransformStyleConfig>();
  const canonicalId = (id: string): string => STYLE_ALIASES[id] ?? id;
  const registry: TransformStyleRegistry = {
    registerTransformStyle(style): void {
      validateTransformStyle(style);
      const id = canonicalId(style.id);
      const snapshot = cloneAndFreezeData({ ...style, id });
      registeredStyles.set(id, snapshot);
    },
    unregisterTransformStyle(id): void {
      registeredStyles.delete(canonicalId(id));
    },
    resolveTransformStyle(id): TransformStyleConfig {
      const canonical = canonicalId(id);
      return (
        registeredStyles.get(canonical) ??
        TRANSFORM_STYLES[canonical] ??
        TRANSFORM_STYLES[DEFAULT_TRANSFORM_STYLE_ID]
      );
    },
    getTransformStyleIds(): string[] {
      return Array.from(new Set([...Object.keys(TRANSFORM_STYLES), ...registeredStyles.keys()]));
    },
    getTransformStyleSummaries(): TransformStyleSummary[] {
      return registry.getTransformStyleIds().map((id) => {
        const { name, description } = registry.resolveTransformStyle(id);
        return { id, name, description };
      });
    },
  };
  for (const style of initialStyles) registry.registerTransformStyle(style);
  return Object.freeze(registry);
}

const GLOBAL_TRANSFORM_STYLE_REGISTRY = createTransformStyleRegistry();

/**
 * Register (or replace) a custom transform style at runtime. Hosts use
 * this the same way they use `registerTheme` — to add product-specific
 * styles without forking the registry.
 */
export function registerTransformStyle(style: TransformStyleConfig): void {
  GLOBAL_TRANSFORM_STYLE_REGISTRY.registerTransformStyle(style);
}

/** Remove a previously registered custom style. */
export function unregisterTransformStyle(id: string): void {
  GLOBAL_TRANSFORM_STYLE_REGISTRY.unregisterTransformStyle(id);
}

/**
 * Resolve a transform style by id. Registered styles win over built-ins;
 * aliases are honored; unknown ids fall back to the default style.
 */
export function resolveTransformStyle(id: string): TransformStyleConfig {
  return GLOBAL_TRANSFORM_STYLE_REGISTRY.resolveTransformStyle(id);
}

/** Get all known style ids (built-ins plus registered). */
export function getTransformStyleIds(): string[] {
  return GLOBAL_TRANSFORM_STYLE_REGISTRY.getTransformStyleIds();
}

/** Get summary info for all styles (for UI dropdowns). */
export function getTransformStyleSummaries(): TransformStyleSummary[] {
  return GLOBAL_TRANSFORM_STYLE_REGISTRY.getTransformStyleSummaries();
}

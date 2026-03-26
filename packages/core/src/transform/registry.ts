/**
 * Transform Style Registry
 *
 * Central registry of built-in transform styles. Follows the same pattern
 * as themeLibrary.ts — a record of configs with lookup/summary helpers.
 */

import type { TransformStyleConfig, TransformStyleSummary } from './types.js';
import { documentaryStyle } from './styles/documentary.js';
import { magazineStyle } from './styles/magazine.js';
import { dataDrivenStyle } from './styles/dataDriven.js';
import { narrativeStyle } from './styles/narrative.js';
import { minimalStyle } from './styles/minimal.js';

/** All registered transform styles, keyed by id. */
const TRANSFORM_STYLES: Record<string, TransformStyleConfig> = {
  [documentaryStyle.id]: documentaryStyle,
  [magazineStyle.id]: magazineStyle,
  [dataDrivenStyle.id]: dataDrivenStyle,
  [narrativeStyle.id]: narrativeStyle,
  [minimalStyle.id]: minimalStyle,
};

/** Default style used when no id is provided. */
export const DEFAULT_TRANSFORM_STYLE_ID = 'documentary';

/**
 * Resolve a transform style by id.
 * Returns the default style if the id is not found.
 */
export function resolveTransformStyle(id: string): TransformStyleConfig {
  return TRANSFORM_STYLES[id] ?? TRANSFORM_STYLES[DEFAULT_TRANSFORM_STYLE_ID];
}

/** Get all registered style ids. */
export function getTransformStyleIds(): string[] {
  return Object.keys(TRANSFORM_STYLES);
}

/** Get summary info for all styles (for UI dropdowns). */
export function getTransformStyleSummaries(): TransformStyleSummary[] {
  return Object.values(TRANSFORM_STYLES).map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
}

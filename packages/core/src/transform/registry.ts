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

/** All built-in transform styles, keyed by id. */
const TRANSFORM_STYLES: Record<string, TransformStyleConfig> = {
  [documentaryStyle.id]: documentaryStyle,
  [magazineStyle.id]: magazineStyle,
  [dataDrivenStyle.id]: dataDrivenStyle,
  [narrativeStyle.id]: narrativeStyle,
  [minimalStyle.id]: minimalStyle,
};

/**
 * Id aliases: the data-driven style's file/export are named `dataDriven`
 * but its registered id is hyphenated — accept both.
 */
const STYLE_ALIASES: Record<string, string> = {
  dataDriven: 'data-driven',
};

/** Host-registered custom styles (registered ids win over built-ins). */
const registeredStyles = new Map<string, TransformStyleConfig>();

/** Default style used when no id is provided. */
export const DEFAULT_TRANSFORM_STYLE_ID = 'documentary';

/**
 * Register (or replace) a custom transform style at runtime. Hosts use
 * this the same way they use `registerTheme` — to add product-specific
 * styles without forking the registry.
 */
export function registerTransformStyle(style: TransformStyleConfig): void {
  registeredStyles.set(style.id, style);
}

/** Remove a previously registered custom style. */
export function unregisterTransformStyle(id: string): void {
  registeredStyles.delete(id);
}

/**
 * Resolve a transform style by id. Registered styles win over built-ins;
 * aliases are honored; unknown ids fall back to the default style.
 */
export function resolveTransformStyle(id: string): TransformStyleConfig {
  const canonical = STYLE_ALIASES[id] ?? id;
  return (
    registeredStyles.get(canonical) ??
    TRANSFORM_STYLES[canonical] ??
    TRANSFORM_STYLES[DEFAULT_TRANSFORM_STYLE_ID]
  );
}

/** Get all known style ids (built-ins plus registered). */
export function getTransformStyleIds(): string[] {
  return Array.from(new Set([...Object.keys(TRANSFORM_STYLES), ...registeredStyles.keys()]));
}

/** Get summary info for all styles (for UI dropdowns). */
export function getTransformStyleSummaries(): TransformStyleSummary[] {
  return getTransformStyleIds().map((id) => {
    const { name, description } = resolveTransformStyle(id);
    return { id, name, description };
  });
}

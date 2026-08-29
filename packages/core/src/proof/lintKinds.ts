/**
 * Mapping from harper's `LintKind` vocabulary to squisq's three proofing
 * tiers. The keys pin the full 21-kind union of harper.js 2.7.0; a unit
 * test asserts the map stays in sync with the installed engine so an
 * upgrade that adds a kind is caught at review time rather than falling
 * through silently. Unknown kinds degrade to `style` (the least alarming
 * tier) instead of throwing.
 */

import type { ProofCategory } from './types.js';

/** harper `LintKind` → squisq tier. Spelling = red, grammar = green, style = blue. */
export const LINT_KIND_CATEGORIES: Readonly<Record<string, ProofCategory>> = Object.freeze({
  // Red — the word itself is wrong.
  Spelling: 'spelling',
  Typo: 'spelling',
  // Green — the sentence is wrong; there is a definite fix.
  Agreement: 'grammar',
  BoundaryError: 'grammar',
  Capitalization: 'grammar',
  Eggcorn: 'grammar',
  Grammar: 'grammar',
  Malapropism: 'grammar',
  Miscellaneous: 'grammar',
  Nonstandard: 'grammar',
  Punctuation: 'grammar',
  Repetition: 'grammar',
  Usage: 'grammar',
  WordChoice: 'grammar',
  WordOrder: 'grammar',
  // Blue — the text works but could read better.
  Enhancement: 'style',
  Formatting: 'style',
  Readability: 'style',
  Redundancy: 'style',
  Regionalism: 'style',
  Style: 'style',
});

/**
 * Categorize a raw engine kind. Kinds this build doesn't know (added by a
 * future harper release) fall back to `style` so they render as the least
 * alarming squiggle rather than breaking the pass.
 */
export function categorizeLintKind(kind: string): ProofCategory {
  return LINT_KIND_CATEGORIES[kind] ?? 'style';
}

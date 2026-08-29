/**
 * Plain-data types for the proofing (grammar + spellcheck) pipeline.
 *
 * These types are engine-agnostic: an editor host adapts a concrete
 * engine (harper.js, a service, a test fake) to produce `ProofFinding`s,
 * while this module stays pure and dependency-free so the mapping and
 * masking helpers can run in Node tests and any consumer bundle.
 */

/** Severity/color tier of a finding: red, green, or blue squiggle. */
export type ProofCategory = 'spelling' | 'grammar' | 'style';

/** How a suggestion is applied relative to the finding's span. */
export type ProofSuggestionKind = 'replace' | 'remove' | 'insertAfter';

/** One candidate fix for a finding. */
export interface ProofSuggestion {
  /** Replacement/insertion text (empty for `remove`). */
  text: string;
  kind: ProofSuggestionKind;
}

/** A half-open `[start, end)` range in UTF-16 code units. */
export interface ProofRange {
  start: number;
  end: number;
}

/**
 * One issue found in a linted text. Offsets index into the exact string
 * that was linted (UTF-16 code units — the same coordinate space as
 * ProseMirror, Monaco, and DOM Range).
 */
export interface ProofFinding extends ProofRange {
  /** Stable within one lint pass; the provider maps id → engine handle. */
  id: string;
  category: ProofCategory;
  /** Raw engine kind (e.g. `Typo`), for diagnostics and future filtering. */
  kind: string;
  /** Human-readable description of the issue. */
  message: string;
  /** Text at `[start, end)` when linted — staleness check before applying. */
  originalText: string;
  suggestions: ProofSuggestion[];
}

/** English dialects supported by the proofing engine. */
export type ProofDialect = 'American' | 'British' | 'Australian' | 'Canadian' | 'Indian';

/** All supported dialects, in display order. */
export const PROOF_DIALECTS: readonly ProofDialect[] = Object.freeze([
  'American',
  'British',
  'Australian',
  'Canadian',
  'Indian',
]);

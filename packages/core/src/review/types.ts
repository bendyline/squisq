/**
 * Plain-data types for the review pipeline.
 *
 * Review generalizes proofing. Spellcheck asks "is this word wrong?"; a
 * reviewer may also ask "is this paragraph clear?", and the two differ in three
 * ways the {@link ProofFinding} shape cannot express: a reviewer is slow enough
 * that results must stream and be cancellable, it needs document structure
 * rather than one flat string, and its suggestion is often a rewritten
 * paragraph rather than a replaced word.
 *
 * `@bendyline/squisq/proof` is untouched and keeps working. A
 * {@link ProofingProvider} is adapted into this pipeline by the editor, so
 * there is one renderer rather than two.
 */

import type { ProofCategory, ProofFinding } from '../proof/types.js';

/**
 * How much a finding matters.
 *
 * Separate from the hue a provider draws in: severity orders findings within a
 * provider, while the hue says which provider they came from. Conflating them
 * is what makes a style hint and a spelling mistake indistinguishable.
 */
export type ReviewSeverity = 'info' | 'suggestion' | 'warning' | 'error';

/** How a suggestion is applied relative to the finding. */
export type ReviewSuggestionKind = 'replace' | 'remove' | 'insertAfter' | 'replaceBlock';

export interface ReviewSuggestion {
  /** Replacement text. Empty for `remove`. */
  text: string;
  /**
   * `replaceBlock` swaps the whole owning block rather than the finding's span.
   * A model asked to improve a sentence rewrites the sentence; forcing that
   * into a span replacement is what produces the mangled half-edits.
   */
  kind: ReviewSuggestionKind;
  /** Button label, e.g. "Tighten". Falls back to a kind-derived default. */
  label?: string;
}

/**
 * One issue in a reviewed document.
 *
 * Offsets are UTF-16 code units into {@link ReviewRequest.source} — the same
 * coordinate space as ProseMirror, Monaco and DOM Range.
 */
export interface ReviewFinding {
  /** Unique within one pass of one provider. */
  id: string;
  /**
   * Which provider produced this. Namespaces decorations and groups the panel,
   * so two providers can report the same span without colliding.
   */
  source: string;
  start: number;
  end: number;
  /**
   * The block this finding is about.
   *
   * Present even when the span is exact, because a span goes stale as soon as
   * the user types while the block does not — a finding that can still be
   * navigated to is worth more than one that can only be discarded.
   */
  blockKey?: number;
  severity: ReviewSeverity;
  /** Provider-defined grouping, e.g. `spelling` or `clarity`. */
  category: string;
  /** One sentence. Shown inline. */
  message: string;
  /** The longer "why", shown on expand. A linter rarely has one; a model does. */
  rationale?: string;
  /** Text at `[start, end)` when reviewed — the staleness check before applying. */
  originalText: string;
  suggestions: ReviewSuggestion[];
}

/** One block handed to a provider. */
export interface ReviewBlockInput {
  /** Matches the editor's block key, so a finding can navigate back. */
  key: number;
  /** 1-based line where the block starts in `source`. */
  startLine: number;
  /** Nearest enclosing heading, for context. Null at the top of a document. */
  heading: string | null;
  /** Block text, with machine vocabulary already masked. */
  text: string;
  /** UTF-16 offset of `text` within {@link ReviewRequest.source}. */
  offset: number;
}

/** Identifies the document under review. */
export interface ReviewDocumentRef {
  articleId: string;
  fileName?: string;
}

export interface ReviewRequest {
  /** The whole document, for a provider that wants surrounding context. */
  source: string;
  blocks: readonly ReviewBlockInput[];
  /**
   * Blocks changed since this provider's last pass, when the editor knows.
   *
   * A hint, not a restriction: a cheap provider may ignore it and re-scan
   * everything, while an expensive one can review only what moved. Absent on
   * a first pass.
   */
  changedBlockKeys?: readonly number[];
  language?: 'plaintext' | 'markdown';
  documentRef: ReviewDocumentRef;
}

/**
 * Progress from one provider pass.
 *
 * `findings` is additive and may arrive many times: a reviewer that takes
 * seconds per block should show its first result immediately rather than
 * holding everything until the last block returns.
 */
export type ReviewEvent =
  | { type: 'findings'; findings: readonly ReviewFinding[] }
  | { type: 'progress'; blockKey: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * Severity for a proofing category.
 *
 * A misspelling is definitely wrong, a grammar hit usually is, and a style hit
 * is an opinion. That ordering is what the panel sorts on; it does not change
 * which colour harper's findings draw in, which still comes from the category.
 */
const PROOF_SEVERITY: Readonly<Record<ProofCategory, ReviewSeverity>> = Object.freeze({
  spelling: 'error',
  grammar: 'warning',
  style: 'suggestion',
});

/** The provider id the editor adapts harper under. */
export const PROOFING_REVIEW_SOURCE = 'harper';

/**
 * Adapt one proofing finding into a review finding.
 *
 * `offset` shifts engine-relative offsets into document coordinates, for a
 * provider that linted a block or a joined run rather than the whole source.
 */
export function proofFindingToReviewFinding(
  finding: ProofFinding,
  options: { source?: string; offset?: number; blockKey?: number } = {},
): ReviewFinding {
  const offset = options.offset ?? 0;
  return {
    id: finding.id,
    source: options.source ?? PROOFING_REVIEW_SOURCE,
    start: finding.start + offset,
    end: finding.end + offset,
    ...(options.blockKey === undefined ? {} : { blockKey: options.blockKey }),
    severity: PROOF_SEVERITY[finding.category],
    category: finding.category,
    message: finding.message,
    originalText: finding.originalText,
    suggestions: finding.suggestions.map((suggestion) => ({
      text: suggestion.text,
      kind: suggestion.kind,
    })),
  };
}

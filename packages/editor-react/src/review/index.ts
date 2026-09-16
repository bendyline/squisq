/**
 * Public review API: the provider contract a host implements, and the adapter
 * that runs an existing proofing engine through it. UI internals are wired by
 * `EditorShell` and are not part of this surface.
 */

export type {
  ReviewCapability,
  ReviewHue,
  ReviewProvider,
  ReviewProviderFactory,
} from './types.js';
export { DEFAULT_REVIEW_DEBOUNCE_MS, DEFAULT_REVIEW_HUE, resolveReviewProvider } from './types.js';
export { ReviewRoot, useReviewState } from './ReviewContext.js';
export { ReviewPanel } from './ReviewPanel.js';
export { useReview, type ReviewState } from './useReview.js';
export { ReviewRunner, type ReviewProviderStatus, type ReviewSnapshot } from './runner.js';
export { buildReviewRequest, changedBlockKeys } from './buildRequest.js';
export {
  ReviewExtension,
  clearReviewDecorations,
  reviewDecorationAt,
  reviewDecorationById,
  updateReviewDecorations,
  type ResolvedReviewDecoration,
} from './ReviewExtension.js';
export {
  buildSourceViewDecorations,
  buildWriteViewDecorations,
  findUniqueTextRange,
  reviewHoverMarkdown,
  reviewUnderlineClass,
  type ReviewDecorationSpec,
} from './decorations.js';
export {
  PROOFING_DEBOUNCE_MS,
  createProofingReviewProvider,
  type ProofingReviewAdapterOptions,
} from './proofingAdapter.js';
export type {
  ReviewBlockInput,
  ReviewDocumentRef,
  ReviewEvent,
  ReviewFinding,
  ReviewRequest,
  ReviewSeverity,
  ReviewSuggestion,
  ReviewSuggestionKind,
} from '@bendyline/squisq/review';
export { PROOFING_REVIEW_SOURCE, proofFindingToReviewFinding } from '@bendyline/squisq/review';

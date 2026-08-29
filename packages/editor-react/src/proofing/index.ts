/**
 * Public proofing API: the provider contract a host implements or
 * configures, and the harper.js-backed factory. UI internals (the
 * decoration extension, panel, menu, orchestration) are wired by
 * `EditorShell` and are not part of this surface.
 */

export type {
  ProofingProvider,
  ProofingProviderFactory,
  ProofingCapability,
  ProofingDocumentRef,
  ProofingIgnoreStore,
  ProofingLanguage,
  ProofingLintOptions,
  HarperProofingConfig,
} from './types.js';
export { createHarperProofingProvider } from './harperProvider.js';
export type {
  ProofFinding,
  ProofSuggestion,
  ProofSuggestionKind,
  ProofCategory,
  ProofDialect,
  ProofRange,
} from '@bendyline/squisq/proof';
export { PROOF_DIALECTS, PROOF_FRONTMATTER_KEYS } from '@bendyline/squisq/proof';

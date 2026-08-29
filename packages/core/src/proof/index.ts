/**
 * Proofing (grammar + spellcheck) support: engine-agnostic finding
 * types, the lint-kind → tier map, protected-span masking, joined-
 * segment offset mapping, and the frontmatter settings codec. Pure and
 * dependency-free — the editor's engine adapter (harper.js) lives in
 * `@bendyline/squisq-editor-react/proofing`.
 */

export * from './types.js';
export * from './lintKinds.js';
export * from './masking.js';
export * from './joining.js';
export * from './frontmatter.js';

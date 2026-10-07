/**
 * Human-readable renderings of a {@link ProofFinding}, shared by every
 * surface that explains one: the suggestions menu, the Write view's
 * hover tooltip, and the Source view's Monaco hover card. Keeping them
 * here is what stops the three from wording the same finding
 * differently.
 */

import type { ProofCategory, ProofFinding, ProofSuggestion } from '@bendyline/squisq/proof';

/** Display name for each squiggle tier. */
export const PROOF_CATEGORY_LABELS: Record<ProofCategory, string> = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  style: 'Style',
};

/**
 * One suggestion as a menu/chip label. A `replace` reads as the
 * replacement text itself (what the user will see after applying);
 * the other kinds have to describe the edit instead.
 */
export function proofSuggestionLabel(suggestion: ProofSuggestion): string {
  if (suggestion.kind === 'remove') return 'Remove';
  if (suggestion.kind === 'insertAfter') return `Insert “${suggestion.text}” after`;
  return suggestion.text;
}

/**
 * A finding's message as prose. Engines quote words with Markdown code
 * spans (Did you mean `opportunity`?), which every surface showed as
 * literal backticks. They read as curly quotes instead, as suggestions do.
 */
export function proofMessageText(finding: ProofFinding): string {
  return finding.message.replace(/`([^`]+)`/g, '“$1”');
}

/** The first `limit` suggestion labels, in engine order. */
export function proofSuggestionLabels(finding: ProofFinding, limit: number): string[] {
  return finding.suggestions.slice(0, limit).map(proofSuggestionLabel);
}

/**
 * Markdown for Monaco's hover card — the Source view's equivalent of
 * the Write view's tooltip. Text arrives from the engine, so the few
 * characters Monaco would read as formatting are escaped; suggestions
 * are wrapped in curly quotes rather than code spans so nothing inside
 * them needs escaping at all.
 */
export function proofHoverMarkdown(finding: ProofFinding, suggestionLimit = 3): string {
  const lines = [
    `**${PROOF_CATEGORY_LABELS[finding.category]}**`,
    '',
    escapeMarkdown(proofMessageText(finding)),
  ];
  const labels = proofSuggestionLabels(finding, suggestionLimit);
  if (labels.length > 0) {
    const shown = labels.map((label) => `“${label}”`).join(', ');
    const extra = finding.suggestions.length - labels.length;
    lines.push('', `Suggested: ${shown}${extra > 0 ? ` (+${extra} more)` : ''}`);
  }
  return lines.join('\n');
}

/** Neutralize the inline-markdown characters an engine message may contain. */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

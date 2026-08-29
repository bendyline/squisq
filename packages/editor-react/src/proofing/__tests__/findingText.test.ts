import { describe, expect, it } from 'vitest';
import type { ProofFinding } from '@bendyline/squisq/proof';
import {
  PROOF_CATEGORY_LABELS,
  proofHoverMarkdown,
  proofSuggestionLabel,
  proofSuggestionLabels,
} from '../findingText';

function finding(overrides: Partial<ProofFinding> = {}): ProofFinding {
  return {
    id: 'f1',
    category: 'spelling',
    kind: 'Typo',
    message: 'Did you mean “pint”?',
    start: 0,
    end: 4,
    originalText: 'pnit',
    suggestions: [{ text: 'pint', kind: 'replace' }],
    ...overrides,
  };
}

describe('proofSuggestionLabel', () => {
  it('shows a replacement as the replacement text', () => {
    expect(proofSuggestionLabel({ text: 'pint', kind: 'replace' })).toBe('pint');
  });

  it('describes the non-replace edits', () => {
    expect(proofSuggestionLabel({ text: '', kind: 'remove' })).toBe('Remove');
    expect(proofSuggestionLabel({ text: 'the', kind: 'insertAfter' })).toBe('Insert “the” after');
  });

  it('caps the label list at the limit, in engine order', () => {
    const many = finding({
      suggestions: [
        { text: 'a', kind: 'replace' },
        { text: 'b', kind: 'replace' },
        { text: 'c', kind: 'replace' },
        { text: 'd', kind: 'replace' },
      ],
    });
    expect(proofSuggestionLabels(many, 3)).toEqual(['a', 'b', 'c']);
  });
});

describe('proofHoverMarkdown', () => {
  it('leads with the category and includes the message', () => {
    const markdown = proofHoverMarkdown(finding());
    expect(markdown.startsWith(`**${PROOF_CATEGORY_LABELS.spelling}**`)).toBe(true);
    expect(markdown).toContain('Did you mean');
  });

  it('lists suggestions and counts the overflow', () => {
    const markdown = proofHoverMarkdown(
      finding({
        suggestions: [
          { text: 'a', kind: 'replace' },
          { text: 'b', kind: 'replace' },
          { text: 'c', kind: 'replace' },
          { text: 'd', kind: 'replace' },
          { text: 'e', kind: 'replace' },
        ],
      }),
      3,
    );
    expect(markdown).toContain('Suggested: “a”, “b”, “c” (+2 more)');
  });

  it('omits the suggestions line when the engine offered none', () => {
    expect(proofHoverMarkdown(finding({ suggestions: [] }))).not.toContain('Suggested');
  });

  it('escapes markdown characters an engine message may contain', () => {
    const markdown = proofHoverMarkdown(finding({ message: 'Use *emphasis* not _this_' }));
    expect(markdown).toContain('Use \\*emphasis\\* not \\_this\\_');
  });
});

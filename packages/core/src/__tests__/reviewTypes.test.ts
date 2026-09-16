import { describe, expect, it } from 'vitest';
import {
  PROOFING_REVIEW_SOURCE,
  proofFindingToReviewFinding,
  type ReviewEvent,
  type ReviewFinding,
} from '../review/index.js';
import type { ProofFinding } from '../proof/index.js';

function proofFinding(overrides: Partial<ProofFinding> = {}): ProofFinding {
  return {
    id: 'f1',
    start: 10,
    end: 15,
    category: 'spelling',
    kind: 'Typo',
    message: 'Did you mean "there"?',
    originalText: 'thier',
    suggestions: [{ text: 'their', kind: 'replace' }],
    ...overrides,
  };
}

describe('proofFindingToReviewFinding', () => {
  it('carries the finding across without losing anything a user sees', () => {
    const review = proofFindingToReviewFinding(proofFinding());
    expect(review).toMatchObject({
      id: 'f1',
      source: PROOFING_REVIEW_SOURCE,
      start: 10,
      end: 15,
      category: 'spelling',
      message: 'Did you mean "there"?',
      originalText: 'thier',
      suggestions: [{ text: 'their', kind: 'replace' }],
    });
  });

  it('orders the proofing categories by how wrong they are', () => {
    // A misspelling is definitely wrong, grammar usually is, style is an
    // opinion. The panel sorts on this; it is not what picks the colour.
    expect(proofFindingToReviewFinding(proofFinding({ category: 'spelling' })).severity).toBe(
      'error',
    );
    expect(proofFindingToReviewFinding(proofFinding({ category: 'grammar' })).severity).toBe(
      'warning',
    );
    expect(proofFindingToReviewFinding(proofFinding({ category: 'style' })).severity).toBe(
      'suggestion',
    );
  });

  it('shifts engine-relative offsets into document coordinates', () => {
    // A provider that linted one block reports offsets into that block.
    const review = proofFindingToReviewFinding(proofFinding(), { offset: 100 });
    expect([review.start, review.end]).toEqual([110, 115]);
  });

  it('leaves the block unset when the caller does not know it', () => {
    // A proofing finding carries no block, and inventing one would make an
    // unnavigable finding look navigable.
    expect('blockKey' in proofFindingToReviewFinding(proofFinding())).toBe(false);
    expect(proofFindingToReviewFinding(proofFinding(), { blockKey: 3 }).blockKey).toBe(3);
  });

  it('lets a second proofing-shaped provider claim its own namespace', () => {
    // Two providers may report the same span; the source is what keeps their
    // decorations and panel groups apart.
    const review = proofFindingToReviewFinding(proofFinding(), { source: 'house-style' });
    expect(review.source).toBe('house-style');
  });

  it('copies suggestions rather than aliasing the engine array', () => {
    const original = proofFinding();
    const review = proofFindingToReviewFinding(original);
    expect(review.suggestions).not.toBe(original.suggestions);
    expect(review.suggestions[0]).not.toBe(original.suggestions[0]);
  });
});

describe('review event shape', () => {
  it('allows findings to arrive in more than one batch', () => {
    // An expensive reviewer should show its first block before its last one
    // returns, so `findings` is additive rather than a final answer.
    const events: ReviewEvent[] = [
      { type: 'findings', findings: [] },
      { type: 'progress', blockKey: 1 },
      { type: 'findings', findings: [] },
      { type: 'done' },
    ];
    expect(events.filter((event) => event.type === 'findings')).toHaveLength(2);
  });

  it('describes a block-level rewrite, which a span replacement cannot', () => {
    const finding: ReviewFinding = {
      id: 'r1',
      source: 'assist',
      start: 0,
      end: 40,
      blockKey: 2,
      severity: 'suggestion',
      category: 'clarity',
      message: 'This paragraph buries its point.',
      rationale: 'The conclusion arrives after three clauses of setup.',
      originalText: 'It is not unreasonable to suppose that...',
      suggestions: [{ text: 'We should ship on Tuesday.', kind: 'replaceBlock', label: 'Tighten' }],
    };
    expect(finding.suggestions[0]?.kind).toBe('replaceBlock');
    expect(finding.rationale).toBeTruthy();
  });
});

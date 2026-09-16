import { describe, expect, it } from 'vitest';
import type { ReviewFinding } from '@bendyline/squisq/review';
import {
  buildSourceViewDecorations,
  findUniqueTextRange,
  reviewHoverMarkdown,
} from '../decorations.js';

/** A ProseMirror-shaped doc with just the surface `descendants` touches. */
function doc(texts: string[]) {
  let pos = 1;
  const nodes = texts.map((text) => {
    const node = { isText: true, text, pos };
    pos += text.length + 2;
    return node;
  });
  return {
    descendants(fn: (node: unknown, pos: number) => boolean | void) {
      for (const node of nodes) {
        if (fn(node, node.pos) === false) return;
      }
    },
  } as unknown as Parameters<typeof findUniqueTextRange>[0];
}

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: 'f1',
    source: 'assist',
    start: 0,
    end: 5,
    severity: 'suggestion',
    category: 'clarity',
    message: 'Tighten this.',
    originalText: 'alpha',
    suggestions: [],
    ...overrides,
  };
}

describe('findUniqueTextRange', () => {
  it('locates text that appears exactly once', () => {
    const range = findUniqueTextRange(doc(['alpha beta']), 'beta');
    expect(range).toEqual({ from: 7, to: 11 });
  });

  it('refuses an ambiguous match rather than picking one', () => {
    // Anchoring on the wrong occurrence would mark a different paragraph than
    // the one reviewed, which is worse than drawing nothing.
    expect(findUniqueTextRange(doc(['beta and beta']), 'beta')).toBeNull();
    expect(findUniqueTextRange(doc(['beta', 'beta']), 'beta')).toBeNull();
  });

  it('returns nothing for absent or empty text', () => {
    expect(findUniqueTextRange(doc(['alpha']), 'gamma')).toBeNull();
    expect(findUniqueTextRange(doc(['alpha']), '')).toBeNull();
  });
});

describe('buildSourceViewDecorations', () => {
  const model = {
    getValueLength: () => 20,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
  } as unknown as Parameters<typeof buildSourceViewDecorations>[0];

  it('maps offsets straight through, since both index the source', () => {
    const decorations = buildSourceViewDecorations(model, [finding()], () => 'assist');
    expect(decorations[0]?.range).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 6,
    });
    expect(decorations[0]?.options.inlineClassName).toContain('squisq-review-underline--assist');
  });

  it('skips a finding reported past the end of the document', () => {
    // A provider that answered about a stale document would otherwise have
    // Monaco clamp its range onto whatever text now sits there.
    expect(buildSourceViewDecorations(model, [finding({ end: 999 })], () => 'assist')).toEqual([]);
  });

  it('skips an inverted or empty span', () => {
    expect(
      buildSourceViewDecorations(model, [finding({ start: 5, end: 5 })], () => 'assist'),
    ).toEqual([]);
  });

  it('never grows when typing at the edge of a mark', () => {
    const decorations = buildSourceViewDecorations(model, [finding()], () => 'assist');
    expect(decorations[0]?.options.stickiness).toBe(1);
  });
});

describe('reviewHoverMarkdown', () => {
  it('shows the rationale a model can give and a linter cannot', () => {
    const text = reviewHoverMarkdown(
      finding({
        rationale: 'The conclusion arrives last.',
        suggestions: [{ text: 'x', kind: 'replaceBlock' }],
      }),
    );
    expect(text).toContain('Tighten this.');
    expect(text).toContain('The conclusion arrives last.');
    expect(text).toContain('Rewrite this block');
  });

  it('uses a provider label over the generic one when given', () => {
    const text = reviewHoverMarkdown(
      finding({ suggestions: [{ text: 'x', kind: 'replaceBlock', label: 'Tighten' }] }),
    );
    expect(text).toContain('Tighten');
  });
});
